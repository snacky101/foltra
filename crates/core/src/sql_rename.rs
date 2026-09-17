//! Rewrite only bound SQL identifiers; keep Markdown, SQL layout, comments and literals intact.
use crate::{
    databases, frontmatter, notes, now, sql_query,
    storage::{revision, Store},
    Database, Result,
};
use pulldown_cmark::{CodeBlockKind, Event, Tag, TagEnd};
use serde_json::{json, Value};
use sqlparser::{
    ast::*,
    dialect::PostgreSqlDialect,
    parser::Parser,
    tokenizer::{Location, Token, Tokenizer},
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ops::{ControlFlow, Range},
};

type Columns = Vec<(String, String)>;
type Catalog = HashMap<String, Columns>;
type RewriteResult<T> = std::result::Result<T, String>;

#[derive(Clone)]
struct Relation {
    name: String,
    columns: Columns,
}
#[derive(Clone, Default)]
struct Scope {
    relations: Vec<Relation>,
    outer: Vec<Relation>,
}

fn key(name: &str) -> String {
    name.to_ascii_lowercase()
}
fn ident_parts(expr: &Expr) -> Option<&[Ident]> {
    match expr {
        Expr::Identifier(id) => Some(std::slice::from_ref(id)),
        Expr::CompoundIdentifier(ids) => Some(ids),
        _ => None,
    }
}
fn resolve(parts: &[Ident], scope: &Scope) -> RewriteResult<Option<(String, String)>> {
    if parts.len() == 3 && parts[0].value.eq_ignore_ascii_case("vault") {
        return resolve(&parts[1..], scope);
    }
    let Some(column) = parts.last() else {
        return Ok(None);
    };
    for relations in [&scope.relations, &scope.outer] {
        let matches: Vec<_> = relations
            .iter()
            .filter(|r| {
                parts.len() == 1
                    || (parts.len() == 2 && r.name.eq_ignore_ascii_case(&parts[0].value))
            })
            .flat_map(|r| &r.columns)
            .filter(|(old, _)| old.eq_ignore_ascii_case(&column.value))
            .collect();
        if matches.len() > 1 && matches.iter().any(|(old, new)| old != new) {
            return Err(format!(
                "컬럼 '{}'의 테이블을 확인할 수 없습니다. 테이블 별칭을 붙여 주세요.",
                column.value
            ));
        }
        if let Some(found) = matches.first() {
            return Ok(Some((*found).clone()));
        }
        // A local qualifier shadows an outer table even if its column is unknown.
        if parts.len() == 2
            && relations
                .iter()
                .any(|r| r.name.eq_ignore_ascii_case(&parts[0].value))
        {
            break;
        }
    }
    Ok(None)
}

struct Rewriter<'a> {
    sql: &'a str,
    catalog: &'a Catalog,
    patches: BTreeMap<(usize, usize), String>,
    visited: HashSet<usize>,
}
impl Rewriter<'_> {
    fn position(&self, position: Location) -> RewriteResult<usize> {
        if position.line == 0 || position.column == 0 {
            return Err("SQL 위치를 확인할 수 없습니다.".into());
        }
        let mut offset = 0;
        for (index, line) in self.sql.split_inclusive('\n').enumerate() {
            if index + 1 == position.line as usize {
                return line
                    .char_indices()
                    .map(|(i, _)| i)
                    .chain(std::iter::once(line.len()))
                    .nth(position.column as usize - 1)
                    .map(|i| offset + i)
                    .ok_or_else(|| "SQL 위치를 확인할 수 없습니다.".into());
            }
            offset += line.len();
        }
        Err("SQL 위치를 확인할 수 없습니다.".into())
    }
    fn patch(&mut self, ident: &Ident, new: &str) -> RewriteResult<()> {
        let start = self.position(ident.span.start)?;
        let end = self.position(ident.span.end)?;
        if start >= end {
            return Err("SQL 식별자 위치를 확인할 수 없습니다.".into());
        }
        self.patches
            .insert((start, end), format!("\"{}\"", new.replace('"', "\"\"")));
        Ok(())
    }
    fn visit<T: Visit>(
        &mut self,
        value: &T,
        scope: &Scope,
        ctes: &Catalog,
        outputs: &Columns,
    ) -> RewriteResult<()> {
        let mut visitor = Expressions {
            engine: self,
            scope,
            ctes,
            outputs,
            fallback: &vec![],
            depth: 0,
        };
        match value.visit(&mut visitor) {
            ControlFlow::Continue(()) => Ok(()),
            ControlFlow::Break(error) => Err(error),
        }
    }
    fn visit_input<T: Visit>(
        &mut self,
        value: &T,
        scope: &Scope,
        ctes: &Catalog,
        aliases: &Columns,
    ) -> RewriteResult<()> {
        let mut visitor = Expressions {
            engine: self,
            scope,
            ctes,
            outputs: &vec![],
            fallback: aliases,
            depth: 0,
        };
        match value.visit(&mut visitor) {
            ControlFlow::Continue(()) => Ok(()),
            ControlFlow::Break(error) => Err(error),
        }
    }
    fn relation(
        &mut self,
        table: &TableFactor,
        ctes: &Catalog,
        outer: &[Relation],
    ) -> RewriteResult<Relation> {
        let (name, mut columns, alias) =
            match table {
                TableFactor::Table {
                    name,
                    alias,
                    args: None,
                    ..
                } if name.0.len() == 1
                    || (name.0.len() == 2
                        && name.0[0]
                            .as_ident()
                            .is_some_and(|id| id.value.eq_ignore_ascii_case("vault"))) =>
                {
                    let Some(id) = name.0.last().and_then(ObjectNamePart::as_ident) else {
                        return Err("이 테이블 표현식은 자동 변경할 수 없습니다.".into());
                    };
                    let columns = (name.0.len() == 1)
                        .then(|| ctes.get(&key(&id.value)))
                        .flatten()
                        .or_else(|| self.catalog.get(&key(&id.value)))
                        .ok_or_else(|| format!("테이블 '{}'을 확인할 수 없습니다.", id.value))?
                        .clone();
                    (id.value.clone(), columns, alias)
                }
                TableFactor::Derived {
                    subquery, alias, ..
                } => (
                    String::new(),
                    self.query(subquery, ctes, outer, true)?,
                    alias,
                ),
                _ => return Err(
                    "이 테이블 표현식은 자동 변경할 수 없습니다. 단순 SELECT/별칭으로 바꿔 주세요."
                        .into(),
                ),
            };
        if let Some(alias) = alias {
            for (column, name) in columns.iter_mut().zip(&alias.columns) {
                *column = (name.name.value.clone(), name.name.value.clone());
            }
            return Ok(Relation {
                name: alias.name.value.clone(),
                columns,
            });
        }
        Ok(Relation { name, columns })
    }
    fn query(
        &mut self,
        query: &Query,
        inherited: &Catalog,
        outer: &[Relation],
        nested: bool,
    ) -> RewriteResult<Columns> {
        self.visited.insert(query as *const Query as usize);
        let mut ctes = inherited.clone();
        if let Some(with) = &query.with {
            if with.recursive {
                return Err("재귀 CTE는 자동 변경할 수 없습니다.".into());
            }
            for cte in &with.cte_tables {
                let mut columns = self.query(&cte.query, &ctes, outer, true)?;
                for (column, alias) in columns.iter_mut().zip(&cte.alias.columns) {
                    *column = (alias.name.value.clone(), alias.name.value.clone());
                }
                ctes.insert(key(&cte.alias.name.value), columns);
            }
        }
        let (columns, scope) = self.body(&query.body, &ctes, outer, nested)?;
        self.visit(&query.order_by, &scope, &ctes, &columns)?;
        self.visit(&query.limit_clause, &scope, &ctes, &vec![])?;
        self.visit(&query.fetch, &scope, &ctes, &vec![])?;
        Ok(columns)
    }
    fn body(
        &mut self,
        body: &SetExpr,
        ctes: &Catalog,
        outer: &[Relation],
        nested: bool,
    ) -> RewriteResult<(Columns, Scope)> {
        let select = match body {
            SetExpr::Select(select) => select,
            SetExpr::Query(query) => {
                return Ok((self.query(query, ctes, outer, nested)?, Scope::default()))
            }
            SetExpr::SetOperation {
                left,
                right,
                set_quantifier,
                ..
            } => {
                if matches!(
                    set_quantifier,
                    SetQuantifier::ByName
                        | SetQuantifier::AllByName
                        | SetQuantifier::DistinctByName
                ) {
                    return Err("BY NAME 결합은 자동 변경할 수 없습니다. 결과 컬럼에 고정 AS 별칭을 지정해 주세요.".into());
                }
                let result = self.body(left, ctes, outer, nested)?;
                self.body(right, ctes, outer, nested)?;
                return Ok(result);
            }
            _ => return Err("이 쿼리는 자동 변경할 수 없습니다. SELECT로 바꿔 주세요.".into()),
        };
        let mut scope = Scope {
            relations: vec![],
            outer: outer.to_vec(),
        };
        for from in &select.from {
            let visible: Vec<_> = scope.relations.iter().chain(outer).cloned().collect();
            scope
                .relations
                .push(self.relation(&from.relation, ctes, &visible)?);
            for join in &from.joins {
                let visible: Vec<_> = scope.relations.iter().chain(outer).cloned().collect();
                scope
                    .relations
                    .push(self.relation(&join.relation, ctes, &visible)?);
                // Renaming just one side of USING/NATURAL can silently change join semantics.
                use JoinOperator::*;
                let constraint = match &join.join_operator {
                    Join(c) | Inner(c) | Left(c) | LeftOuter(c) | Right(c) | RightOuter(c)
                    | FullOuter(c) | CrossJoin(c) | Semi(c) | LeftSemi(c) | RightSemi(c)
                    | Anti(c) | LeftAnti(c) | RightAnti(c) | StraightJoin(c) => Some(c),
                    AsOf { constraint, .. } => Some(constraint),
                    _ => None,
                };
                if matches!(
                    constraint,
                    Some(JoinConstraint::Using(_) | JoinConstraint::Natural)
                ) {
                    return Err(
                        "USING/NATURAL 조인은 자동 변경할 수 없습니다. ON 조건으로 바꿔 주세요."
                            .into(),
                    );
                }
            }
        }
        let aliases: Columns = select
            .projection
            .iter()
            .filter_map(|item| match item {
                SelectItem::ExprWithAlias { alias, .. } => {
                    Some((alias.value.clone(), alias.value.clone()))
                }
                _ => None,
            })
            .collect();
        let input = vec![];
        self.visit_input(&select.projection, &scope, ctes, &aliases)?;
        self.visit(&select.from, &scope, ctes, &input)?;
        self.visit_input(&select.distinct, &scope, ctes, &aliases)?;
        self.visit_input(&select.selection, &scope, ctes, &aliases)?;
        self.visit_input(&select.prewhere, &scope, ctes, &aliases)?;
        self.visit_input(&select.group_by, &scope, ctes, &aliases)?;
        self.visit(&select.named_window, &scope, ctes, &input)?;
        self.visit(&select.cluster_by, &scope, ctes, &input)?;
        self.visit(&select.distribute_by, &scope, ctes, &input)?;
        self.visit_input(&select.sort_by, &scope, ctes, &aliases)?;
        self.visit(&select.having, &scope, ctes, &aliases)?;
        self.visit_input(&select.qualify, &scope, ctes, &aliases)?;
        let mut columns = vec![];
        for item in &select.projection {
            match item {
                SelectItem::ExprWithAlias { alias, .. } => {
                    columns.push((alias.value.clone(), alias.value.clone()))
                }
                SelectItem::UnnamedExpr(expr) => {
                    if let Some(parts) = ident_parts(expr) {
                        if let Some(found) = resolve(parts, &scope)? {
                            columns.push(found);
                        } else {
                            columns.push((expr.to_string(), expr.to_string()));
                        }
                    } else {
                        // The engine generates expression output names. Require explicit aliases
                        // when an inner expression changes instead of guessing its external name.
                        if nested {
                            use sqlparser::ast::Spanned;
                            let span = expr.span();
                            let from = self.position(span.start)?;
                            let to = self.position(span.end)?;
                            if self.patches.keys().any(|(a, b)| *a >= from && *b <= to) {
                                return Err(
                                    "하위 쿼리의 계산식에 AS 별칭을 지정한 뒤 다시 시도해 주세요."
                                        .into(),
                                );
                            }
                        }
                        columns.push((expr.to_string(), expr.to_string()));
                    }
                }
                SelectItem::Wildcard(options)
                    if *options == WildcardAdditionalOptions::default() =>
                {
                    columns.extend(scope.relations.iter().flat_map(|r| r.columns.clone()))
                }
                SelectItem::QualifiedWildcard(
                    SelectItemQualifiedWildcardKind::ObjectName(name),
                    options,
                ) if *options == WildcardAdditionalOptions::default() && name.0.len() == 1 => {
                    let Some(id) = name.0[0].as_ident() else {
                        return Err("와일드카드 테이블을 확인할 수 없습니다.".into());
                    };
                    let relation = scope
                        .relations
                        .iter()
                        .find(|r| r.name.eq_ignore_ascii_case(&id.value))
                        .ok_or_else(|| "와일드카드 테이블을 확인할 수 없습니다.".to_string())?;
                    columns.extend(relation.columns.clone());
                }
                _ => {
                    return Err(
                        "확장 와일드카드는 자동 변경할 수 없습니다. 컬럼을 직접 지정해 주세요."
                            .into(),
                    )
                }
            }
        }
        for (index, (old, new)) in columns.iter().enumerate() {
            if old == new {
                continue;
            }
            if columns
                .iter()
                .enumerate()
                .any(|(other, (other_old, other_new))| {
                    index != other
                        && new.eq_ignore_ascii_case(other_new)
                        && (nested || !old.eq_ignore_ascii_case(other_old))
                })
            {
                return Err(
                    "변경 후 쿼리 결과 컬럼 이름이 중복됩니다. 서로 다른 AS 별칭을 지정해 주세요."
                        .into(),
                );
            }
        }
        Ok((columns, scope))
    }
}
struct Expressions<'a, 'b> {
    engine: &'a mut Rewriter<'b>,
    scope: &'a Scope,
    ctes: &'a Catalog,
    outputs: &'a Columns,
    fallback: &'a Columns,
    depth: usize,
}
impl Visitor for Expressions<'_, '_> {
    type Break = String;
    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<String> {
        if self.depth == 0
            && !self
                .engine
                .visited
                .contains(&(query as *const Query as usize))
        {
            let outer: Vec<_> = self
                .scope
                .relations
                .iter()
                .chain(&self.scope.outer)
                .cloned()
                .collect();
            if let Err(error) = self.engine.query(query, self.ctes, &outer, false) {
                return ControlFlow::Break(error);
            }
        }
        self.depth += 1;
        ControlFlow::Continue(())
    }
    fn post_visit_query(&mut self, _: &Query) -> ControlFlow<String> {
        self.depth -= 1;
        ControlFlow::Continue(())
    }
    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<String> {
        if self.depth > 0 {
            return ControlFlow::Continue(());
        }
        let Some(parts) = ident_parts(expr) else {
            return ControlFlow::Continue(());
        };
        let output = (parts.len() == 1)
            .then(|| {
                self.outputs
                    .iter()
                    .find(|(old, _)| old.eq_ignore_ascii_case(&parts[0].value))
            })
            .flatten();
        let resolved = output
            .cloned()
            .map(|v| Ok(Some(v)))
            .unwrap_or_else(|| resolve(parts, self.scope));
        match resolved {
            Ok(None)
                if parts.len() == 1
                    && self
                        .fallback
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case(&parts[0].value))
                    && self.scope.relations.iter().flat_map(|r| &r.columns).any(
                        |(old, new)| old != new && new.eq_ignore_ascii_case(&parts[0].value),
                    ) =>
            {
                return ControlFlow::Break(
                    "변경할 컬럼 이름이 쿼리의 AS 별칭과 충돌합니다. 다른 별칭을 지정해 주세요."
                        .into(),
                )
            }
            Ok(Some((old, new))) if old != new => {
                if let Err(error) = self.engine.patch(parts.last().unwrap(), &new) {
                    return ControlFlow::Break(error);
                }
            }
            Err(error) => return ControlFlow::Break(error),
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

fn sql_patches(
    sql: &str,
    catalog: &Catalog,
    affected: &HashSet<String>,
) -> RewriteResult<Vec<(Range<usize>, String)>> {
    // Ignore literals/comments and unrelated (including unfinished) query blocks.
    let mentions_table = || {
        let lower = sql.to_ascii_lowercase();
        affected
            .iter()
            .any(|table| lower.contains(table) || lower.contains(&table.replace('"', "\"\"")))
    };
    if sql.len() > 32 * 1024 {
        return if mentions_table() {
            Err("SQL은 32 KiB 이하여야 합니다. 쿼리를 줄인 뒤 다시 시도해 주세요.".into())
        } else {
            Ok(vec![])
        };
    }
    let tokens = match Tokenizer::new(&PostgreSqlDialect {}, sql).tokenize() {
        Ok(tokens) => tokens,
        Err(_) if !mentions_table() => return Ok(vec![]),
        Err(error) => return Err(format!("SQL을 분석할 수 없습니다: {error}")),
    };
    if !tokens
        .iter()
        .any(|token| matches!(token, Token::Word(word) if affected.contains(&key(&word.value))))
    {
        return Ok(vec![]);
    }
    let statements = Parser::new(&PostgreSqlDialect {})
        .with_recursion_limit(64)
        .try_with_sql(sql)
        .and_then(|mut parser| parser.parse_statements())
        .map_err(|error| format!("SQL을 분석할 수 없습니다: {error}"))?;
    let [Statement::Query(query)] = statements.as_slice() else {
        return Err("하나의 SELECT만 자동 변경할 수 있습니다.".into());
    };
    let mut engine = Rewriter {
        sql,
        catalog,
        patches: BTreeMap::new(),
        visited: HashSet::new(),
    };
    engine.query(query, &HashMap::new(), &[], false)?;
    Ok(engine
        .patches
        .into_iter()
        .map(|((a, b), value)| (a..b, value))
        .collect())
}

pub(crate) struct RenamePlan {
    pub writes: Vec<(String, Option<String>)>,
    pub revision: String,
    pub changed_notes: usize,
    pub changed_queries: usize,
    pub errors: Vec<Value>,
}
pub(crate) fn plan(store: &Store, replacement: &Database) -> Result<RenamePlan> {
    let before = databases::databases(store)?;
    let mut after = before.clone();
    *after.iter_mut().find(|db| db.id == replacement.id).unwrap() = replacement.clone();
    let old_tables = sql_query::tables(&before);
    let new_tables = sql_query::tables(&after);
    let mut catalog = Catalog::new();
    let mut affected = HashSet::new();
    for table in old_tables {
        let new = new_tables
            .iter()
            .find(|t| t.database_id == table.database_id)
            .unwrap();
        let columns: Columns = table
            .columns
            .iter()
            .map(|column| {
                let next = new
                    .columns
                    .iter()
                    .find(|c| {
                        c.property_id == column.property_id
                            && (c.property_id.is_some() || c.name == column.name)
                    })
                    .unwrap();
                (column.name.clone(), next.name.clone())
            })
            .collect();
        if columns.iter().any(|(old, new)| old != new) {
            affected.insert(key(&table.name));
        }
        catalog.insert(key(&table.name), columns);
    }
    let all_notes = notes::notes(store)?;
    let mut revisions: Vec<_> = all_notes
        .iter()
        .map(|note| (&note.meta.id, &note.revision))
        .collect();
    revisions.sort();
    // Include all notes (including additions) and schemas: a new reference or catalog collision
    // between preview/apply must never be updated without the previewed snapshot.
    let revision = revision(&serde_json::to_string(&(before, revisions))?);
    let mut changed = vec![];
    let mut changed_queries = 0;
    let mut errors = vec![];
    for mut note in all_notes {
        let mut block: Option<(String, Vec<usize>, bool, bool)> = None;
        let mut patches = vec![];
        for (event, range) in frontmatter::markdown_events(&note.body) {
            match event {
                Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info)))
                    if matches!(
                        info.split_whitespace().next(),
                        Some("foltra-sql" | "foltra-query")
                    ) =>
                {
                    block = Some((
                        String::new(),
                        vec![],
                        true,
                        info.split_whitespace().next() == Some("foltra-query"),
                    ));
                }
                Event::Text(text) if block.is_some() => {
                    let (sql, positions, exact, _) = block.as_mut().unwrap();
                    *exact &= note.body.get(range.clone()) == Some(text.as_ref());
                    if sql.len() + text.len() <= 32 * 1024 {
                        positions.extend(range.start..range.end);
                    } else {
                        positions.clear();
                    }
                    sql.push_str(&text);
                }
                Event::End(TagEnd::CodeBlock) if block.is_some() => {
                    let (sql, positions, exact, legacy) = block.take().unwrap();
                    if legacy && sql.trim_start().starts_with('{') {
                        continue;
                    }
                    match sql_patches(&sql, &catalog, &affected) {
                        Ok(changes) if changes.is_empty() => {},
                        Ok(changes) if exact => {
                            changed_queries += 1;
                            for (range, text) in changes {
                                if let (Some(start), Some(end)) = (positions.get(range.start), positions.get(range.end - 1)) {
                                    patches.push((*start..end + 1, text));
                                }
                            }
                        }
                        Ok(_) => errors.push(json!({"noteId":note.meta.id,"title":note.meta.title,"message":"중첩된 SQL 블록의 원문 위치를 확인할 수 없습니다. 일반 코드 블록으로 옮겨 주세요."})),
                        Err(message) => errors.push(json!({"noteId":note.meta.id,"title":note.meta.title,"message":message})),
                    }
                }
                _ => {}
            }
        }
        if !patches.is_empty() {
            patches.sort_by_key(|(range, _)| range.start);
            for (range, text) in patches.into_iter().rev() {
                note.body.replace_range(range, &text);
            }
            note.meta.updated_at = now();
            changed.push(note);
        }
    }
    Ok(RenamePlan {
        writes: changed
            .iter()
            .map(|note| notes::plan_body_replacement(store, note))
            .collect::<Result<_>>()?,
        revision,
        changed_notes: changed.len(),
        changed_queries,
        errors,
    })
}
