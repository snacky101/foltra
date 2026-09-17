use crate::{databases, storage::Store, Database, Error, Result};
use duckdb::{
    arrow::{
        array::{make_array, Array},
        datatypes::DataType as ArrowDataType,
        util::display::array_value_to_string,
    },
    Config, Connection,
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlparser::{
    ast::{BinaryOperator, DataType, Expr, Query, Select, Statement, TableFactor, Visit, Visitor},
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use std::{
    collections::{HashMap, HashSet},
    ops::ControlFlow,
    sync::mpsc,
    time::Duration,
};

const ROW_LIMIT: usize = 500;
const RESULT_BYTES: usize = 2 * 1024 * 1024;

fn sql_error(error: impl std::fmt::Display) -> Error {
    Error::new("invalid_sql", error.to_string())
}
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Column {
    name: String,
    property_id: Option<String>,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Table {
    database_id: String,
    name: String,
    columns: Vec<Column>,
    sql: String,
}

// Labels remain readable; only collisions or invalid identifiers need an ID suffix.
fn names(items: &[(&str, &str)], reserved: &[&str]) -> Vec<String> {
    let mut counts = HashMap::<String, usize>::new();
    for (label, _) in items {
        *counts.entry(label.to_ascii_lowercase()).or_default() += 1;
    }
    let plain: Vec<_> = items
        .iter()
        .map(|(label, _)| {
            !label.is_empty()
                && !label.contains('\0')
                && counts[&label.to_ascii_lowercase()] == 1
                && !reserved.iter().any(|r| r.eq_ignore_ascii_case(label))
        })
        .collect();
    // Reserve all unambiguous labels first; generated aliases must never shadow them.
    let mut used: HashSet<_> = reserved.iter().map(|r| r.to_ascii_lowercase()).collect();
    for ((label, _), plain) in items.iter().zip(&plain) {
        if *plain {
            used.insert(label.to_ascii_lowercase());
        }
    }
    items
        .iter()
        .zip(plain)
        .map(|((label, id), plain)| {
            if plain {
                return (*label).to_string();
            }
            let mut name = format!("{} [{id}]", label.replace('\0', ""));
            while !used.insert(name.to_ascii_lowercase()) {
                name.push('_');
            }
            name
        })
        .collect()
}

fn tables(databases: &[Database]) -> Vec<Table> {
    let labels: Vec<_> = databases
        .iter()
        .map(|db| (db.name.as_str(), db.id.as_str()))
        .collect();
    databases
        .iter()
        .zip(names(&labels, &[]))
        .map(|(db, name)| {
            let metadata = ["__id", "__note", "__created_at", "__updated_at"];
            let labels: Vec<_> = db
                .properties
                .iter()
                .map(|p| (p.name.as_str(), p.id.as_str()))
                .collect();
            let mut columns: Vec<_> = db
                .properties
                .iter()
                .zip(names(&labels, &metadata))
                .map(|(p, name)| Column {
                    name,
                    property_id: Some(p.id.clone()),
                    kind: match p.kind.as_str() {
                        "number" => "DOUBLE",
                        "checkbox" => "BOOLEAN",
                        "date" => "DATE",
                        _ => "VARCHAR",
                    }
                    .into(),
                })
                .collect();
            let sql = format!(
                "SELECT {}\nFROM {}\nLIMIT 25;",
                columns
                    .iter()
                    .map(|c| quote(&c.name))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote(&name)
            );
            columns.extend(metadata.iter().map(|name| Column {
                name: (*name).into(),
                property_id: None,
                kind: "VARCHAR".into(),
            }));
            Table {
                database_id: db.id.clone(),
                name,
                columns,
                sql,
            }
        })
        .collect()
}

pub fn catalog(store: &Store) -> Result<Value> {
    Ok(json!({"tables": tables(&databases::databases(store)?)}))
}

fn scalar_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Character(_)
            | DataType::Char(_)
            | DataType::CharacterVarying(_)
            | DataType::CharVarying(_)
            | DataType::Varchar(_)
            | DataType::Text
            | DataType::Uuid
            | DataType::Numeric(_)
            | DataType::Decimal(_)
            | DataType::Dec(_)
            | DataType::Float(_)
            | DataType::Real
            | DataType::Float8
            | DataType::Double(_)
            | DataType::DoublePrecision
            | DataType::SmallInt(_)
            | DataType::Int2(_)
            | DataType::Int(_)
            | DataType::Int4(_)
            | DataType::Integer(_)
            | DataType::BigInt(_)
            | DataType::Int8(_)
            | DataType::Bool
            | DataType::Boolean
            | DataType::Date
            | DataType::Time(_, _)
            | DataType::Timestamp(_, _)
            | DataType::Interval { .. }
    )
}

struct ReadOnly;
impl Visitor for ReadOnly {
    type Break = &'static str;
    fn pre_visit_statement(&mut self, statement: &Statement) -> ControlFlow<Self::Break> {
        if !matches!(statement, Statement::Query(_)) {
            return ControlFlow::Break("Only SELECT queries are allowed");
        }
        ControlFlow::Continue(())
    }
    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if query.with.as_ref().is_some_and(|w| w.recursive) || !query.locks.is_empty() {
            return ControlFlow::Break("Recursive queries and row locks are not supported");
        }
        ControlFlow::Continue(())
    }
    fn pre_visit_select(&mut self, select: &Select) -> ControlFlow<Self::Break> {
        if select.into.is_some() {
            return ControlFlow::Break("SELECT INTO is not allowed");
        }
        ControlFlow::Continue(())
    }
    fn pre_visit_table_factor(&mut self, table: &TableFactor) -> ControlFlow<Self::Break> {
        if !matches!(
            table,
            TableFactor::Table { args: None, .. }
                | TableFactor::Derived { .. }
                | TableFactor::NestedJoin { .. }
        ) {
            return ControlFlow::Break("Only vault tables and SELECT subqueries are supported");
        }
        ControlFlow::Continue(())
    }
    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::BinaryOp {
                op: BinaryOperator::StringConcat | BinaryOperator::PGCustomBinaryOperator(_),
                ..
            } => return ControlFlow::Break("This SQL operator is not supported in vault queries"),
            Expr::Array(_)
            | Expr::Tuple(_)
            | Expr::Struct { .. }
            | Expr::Dictionary(_)
            | Expr::Map(_)
            | Expr::Overlay { .. } => {
                return ControlFlow::Break(
                    "Only scalar expressions are supported in vault queries",
                );
            }
            Expr::Cast { data_type, .. } if !scalar_type(data_type) => {
                return ControlFlow::Break("Only scalar SQL types are supported in vault queries");
            }
            Expr::TypedString(value) if !scalar_type(&value.data_type) => {
                return ControlFlow::Break("Only scalar SQL types are supported in vault queries");
            }
            _ => {}
        }
        if let Expr::Function(function) = expr {
            let name = function.name.to_string().to_ascii_lowercase();
            if ![
                "count",
                "sum",
                "avg",
                "min",
                "max",
                "lower",
                "upper",
                "length",
                "char_length",
                "coalesce",
                "nullif",
                "date_trunc",
                "date_part",
                "current_date",
                "current_timestamp",
                "now",
                "localtime",
                "localtimestamp",
                "round",
                "abs",
                "ceil",
                "ceiling",
                "floor",
                "substring",
                "substr",
                "trim",
                "ltrim",
                "rtrim",
                "row_number",
                "rank",
                "dense_rank",
                "lag",
                "lead",
                "first_value",
                "last_value",
                "greatest",
                "least",
                "bool_and",
                "bool_or",
            ]
            .contains(&name.as_str())
            {
                return ControlFlow::Break("This SQL function is not supported in vault queries");
            }
        }
        ControlFlow::Continue(())
    }
}

fn select_sql(sql: &str) -> Result<String> {
    if sql.len() > 32 * 1024 {
        return Err(Error::new("query_limit", "SQL is limited to 32 KiB"));
    }
    let statements = Parser::new(&PostgreSqlDialect {})
        .with_recursion_limit(64)
        .try_with_sql(sql)
        .map_err(sql_error)?
        .parse_statements()
        .map_err(sql_error)?;
    if statements.len() != 1 {
        return Err(sql_error("Enter one SELECT query"));
    }
    if let ControlFlow::Break(message) = statements.visit(&mut ReadOnly) {
        return Err(sql_error(message));
    }
    // Serialize the parsed statement before wrapping, so comments/semicolons cannot escape it.
    Ok(statements[0].to_string())
}

fn populate(connection: &Connection, store: &Store) -> Result<()> {
    let databases = databases::databases(store)?;
    let records = databases::records(store)?;
    if databases.len() > 100 || records.len() > 20_000 {
        return Err(Error::new(
            "query_limit",
            "SQL currently supports up to 100 databases and 20,000 vault records",
        ));
    }
    connection
        .execute_batch("CREATE SCHEMA vault; SET search_path = 'vault'")
        .map_err(sql_error)?;
    // The bundled engine has no ICU extension. Supply query-stable local clock values
    // without enabling extension downloads or changing any vault content.
    let time = chrono::Local::now();
    connection
        .execute_batch(&format!(
            "CREATE MACRO vault.current_date() AS DATE '{}'; \
             CREATE MACRO vault.current_localtime() AS TIME '{}'; \
             CREATE MACRO vault.current_localtimestamp() AS TIMESTAMP '{}'; \
             CREATE MACRO vault.get_current_timestamp() AS TIMESTAMPTZ '{}'; \
             CREATE MACRO vault.now() AS TIMESTAMPTZ '{}'",
            time.format("%Y-%m-%d"),
            time.format("%H:%M:%S%.6f"),
            time.format("%Y-%m-%d %H:%M:%S%.6f"),
            time.to_rfc3339_opts(chrono::SecondsFormat::Micros, false),
            time.to_rfc3339_opts(chrono::SecondsFormat::Micros, false),
        ))
        .map_err(sql_error)?;
    let mut bytes = 0;
    for table in tables(&databases) {
        let definition = table
            .columns
            .iter()
            .map(|c| format!("{} {}", quote(&c.name), c.kind))
            .collect::<Vec<_>>()
            .join(", ");
        connection
            .execute_batch(&format!(
                "CREATE TABLE vault.{} ({definition})",
                quote(&table.name)
            ))
            .map_err(sql_error)?;
        let mut appender = connection
            .appender_to_db(&table.name, "vault")
            .map_err(sql_error)?;
        for record in records
            .iter()
            .filter(|r| r.database_id == table.database_id)
        {
            let values: Vec<duckdb::types::Value> = table
                .columns
                .iter()
                .map(|column| {
                    let value = match column.property_id.as_ref() {
                        Some(id) => record.values.get(id).cloned().unwrap_or(Value::Null),
                        None => match column.name.as_str() {
                            "__id" => json!(record.id),
                            "__note" => json!(record.body_note_id),
                            "__created_at" => json!(record.created_at),
                            _ => json!(record.updated_at),
                        },
                    };
                    bytes += value.to_string().len();
                    match value {
                        Value::Null => duckdb::types::Value::Null,
                        Value::Bool(v) => duckdb::types::Value::Boolean(v),
                        Value::Number(v) => {
                            duckdb::types::Value::Double(v.as_f64().unwrap_or_default())
                        }
                        Value::String(v) if column.kind == "DATE" && v.is_empty() => {
                            duckdb::types::Value::Null
                        }
                        Value::String(v) => duckdb::types::Value::Text(v),
                        _ => duckdb::types::Value::Text(value.to_string()),
                    }
                })
                .collect();
            if bytes > 32 * 1024 * 1024 {
                return Err(Error::new(
                    "query_limit",
                    "SQL source data is limited to 32 MiB",
                ));
            }
            appender
                .append_row(duckdb::appender_params_from_iter(values))
                .map_err(sql_error)?;
        }
        appender.flush().map_err(sql_error)?;
    }
    Ok(())
}

fn evaluate(connection: &Connection, sql: &str) -> Result<Value> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT * FROM ({sql}) AS foltra_result LIMIT {}",
            ROW_LIMIT + 1
        ))
        .map_err(sql_error)?;
    // Inspect output types before fetching rows, including implicit row expressions (SELECT t FROM t).
    // Use the fallible chunk API below instead of Arrow's panicking iterator.
    let _ = statement.stream_arrow([]).map_err(sql_error)?;
    let schema = statement.schema();
    if schema.fields().len() > 128 {
        return Err(Error::new(
            "query_limit",
            "SQL results are limited to 128 columns",
        ));
    }
    if schema
        .fields()
        .iter()
        .any(|field| field.data_type().is_nested())
    {
        return Err(sql_error("SQL results must contain scalar columns"));
    }
    let columns: Vec<_> = schema
        .fields()
        .iter()
        .map(|field| json!({"name":field.name(),"type":field.data_type().to_string()}))
        .collect();
    let mut rows = vec![];
    let mut bytes = 0;
    while let Some(batch) = statement.step().map_err(sql_error)? {
        // Arrow without chrono-tz accepts numeric offsets, not the equivalent UTC name.
        // Change metadata only; timestamp values and their shared buffers stay unchanged.
        let display_columns: Vec<_> = batch
            .columns()
            .iter()
            .map(|column| {
                if let ArrowDataType::Timestamp(unit, Some(zone)) = column.data_type() {
                    if matches!(zone.as_ref(), "UTC" | "Etc/UTC") {
                        let data = column
                            .to_data()
                            .into_builder()
                            .data_type(ArrowDataType::Timestamp(*unit, Some("+00:00".into())))
                            .build()
                            .map_err(sql_error)?;
                        return Ok(make_array(data));
                    }
                }
                Ok(column.clone())
            })
            .collect::<Result<_>>()?;
        for row in 0..batch.len() {
            let mut cells = vec![];
            for column in &display_columns {
                let value = if column.is_null(row) {
                    None
                } else {
                    let text = array_value_to_string(column, row).map_err(sql_error)?;
                    bytes += text.len();
                    if text.len() > 64 * 1024 || bytes > RESULT_BYTES {
                        return Err(Error::new(
                            "query_limit",
                            "SQL result exceeds the display size limit",
                        ));
                    }
                    Some(text)
                };
                cells.push(value);
            }
            rows.push(cells);
        }
    }
    let truncated = rows.len() > ROW_LIMIT;
    rows.truncate(ROW_LIMIT);
    Ok(json!({"columns":columns,"rows":rows,"truncated":truncated,"limit":ROW_LIMIT}))
}

pub fn run(store: &Store, sql: &str) -> Result<Value> {
    let sql = select_sql(sql)?;
    let config = Config::default()
        // Configure spill prevention before external access locks this setting.
        .with("temp_directory", "")
        .map_err(sql_error)?
        .with("max_temp_directory_size", "0B")
        .map_err(sql_error)?
        .enable_external_access(false)
        .map_err(sql_error)?
        .enable_autoload_extension(false)
        .map_err(sql_error)?
        .max_memory("128MB")
        .map_err(sql_error)?
        .threads(1)
        .map_err(sql_error)?
        .with("allow_persistent_secrets", "false")
        .map_err(sql_error)?
        .with("max_expression_depth", "128")
        .map_err(sql_error)?;
    let connection = Connection::open_in_memory_with_flags(config).map_err(sql_error)?;
    populate(&connection, store)?;
    connection
        .execute_batch("SET lock_configuration = true")
        .map_err(sql_error)?;
    let interrupt = connection.interrupt_handle();
    let (done, receiver) = mpsc::channel();
    let timer = std::thread::spawn(move || {
        if receiver.recv_timeout(Duration::from_secs(3)).is_err() {
            interrupt.interrupt();
            true
        } else {
            false
        }
    });
    let result = evaluate(&connection, &sql);
    let _ = done.send(());
    if timer.join().unwrap_or(true) {
        return Err(Error::new(
            "query_timeout",
            "SQL exceeded the 3-second execution limit",
        ));
    }
    result
}
