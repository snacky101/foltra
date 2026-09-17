# 노트에서 SQL로 조회하기

`foltra-sql` 블록에 데이터베이스와 컬럼의 **이름**을 적으면 노트 안에 조회 결과를 표로 표시합니다. 데이터베이스 ID를 찾아 JSON에 넣지 않아도 필터·정렬·집계·조인을 작성할 수 있습니다.

명령 팔레트의 **DB SQL 쿼리 삽입** 또는 기본 `<leader>nq`에서 DB를 선택하면 현재 컬럼 이름을 채운 SQL 블록이 삽입됩니다. 아래 예시의 DB·컬럼·상태 값은 자신의 데이터에 맞게 바꿉니다.

````markdown
```foltra-sql
SELECT "이름", "상태", "마감일"
FROM "할 일"
WHERE "상태" <> '완료'
ORDER BY "마감일" ASC NULLS LAST
LIMIT 25;
```
````

읽기 모드와 Live Preview에서 결과를 표시하고, 원문에서는 SQL을 편집합니다. SQL 또는 원본 DB 데이터가 바뀌면 다시 조회합니다. 결과 표는 읽기 전용이며 데이터 수정은 원래 DB에서 합니다. 쿼리 결과 자체를 노트 파일에 저장하지는 않습니다.

Foltra는 **앱에 포함된 DuckDB로 로컬 데이터를 조회**합니다. 별도 PostgreSQL 서버 설치나 접속 정보가 필요하지 않습니다. PostgreSQL을 바탕으로 한 SQL 문법을 사용하지만 PostgreSQL 서버나 완전한 호환 구현은 아닙니다. 문법·형 변환 차이는 [DuckDB의 PostgreSQL 호환성 문서](https://duckdb.org/docs/current/sql/dialect/postgresql_compatibility)를 참고하세요.

## 이름과 값

- DB 이름이 SQL 테이블 이름, 컬럼의 표시 이름이 SQL 컬럼 이름입니다. `"할 일"`, `"마감일"`처럼 **큰따옴표**로 감쌉니다. 이름 속 큰따옴표는 `"참고 ""자료"""`처럼 두 번 씁니다.
- 문자열 값에는 `'완료'`처럼 **작은따옴표**를 사용합니다. 값 속 작은따옴표는 `'O''Reilly'`처럼 두 번 씁니다.
- ASCII 대소문자만 다른 이름을 포함해 같은 DB 이름·같은 DB 안의 컬럼 이름이 중복되면 `이름 [ID]`로 구분합니다. 컬럼이 아래 메타데이터 이름과 충돌하는 경우에도 구분자가 붙습니다. 삽입 메뉴나 아래 `query catalog`가 반환하는 이름을 사용하면 됩니다.
- DB나 컬럼 이름을 바꾸면 기존 SQL의 이름도 직접 수정해야 합니다. 노트 안의 SQL을 자동으로 다시 쓰지는 않습니다.
- 값이 없는 컬럼은 `NULL`입니다. 비교는 `= NULL` 대신 `IS NULL` 또는 `IS NOT NULL`을 사용합니다.

| Foltra 컬럼 | SQL 타입 |
| --- | --- |
| 숫자 | `DOUBLE` (부동소수점) |
| 체크박스 | `BOOLEAN` |
| 날짜 | `DATE` |
| 텍스트·선택 등 나머지 | `VARCHAR` |

비어 있는 날짜 값은 조회할 때 `NULL`로 처리합니다. 이 변환은 조회용 데이터에만 적용하며 원본 JSON을 바꾸지 않습니다.

필요하면 각 테이블의 메타데이터 컬럼도 조회할 수 있습니다. `__id`는 행 ID, `__note`는 연결된 본문 노트 ID 또는 `NULL`, `__created_at`·`__updated_at`은 생성·수정 시각 문자열입니다. 모두 SQL 타입은 `VARCHAR`이며, 날짜 계산이 필요하면 `"__created_at"::TIMESTAMP`처럼 변환합니다. `SELECT *`에는 이 메타데이터도 포함되므로 보여 줄 컬럼을 직접 고르는 편이 읽기 좋습니다.

## 날짜 조건·집계·조인

날짜 컬럼에 최근 7일 조건을 걸 수 있습니다. `CURRENT_DATE`와 날짜 간격을 사용하므로 날짜를 매번 직접 고치지 않아도 됩니다.

```sql
SELECT "이름", "마감일"
FROM "할 일"
WHERE "마감일" >= CURRENT_DATE - INTERVAL '7 days'
  AND "마감일" <= CURRENT_DATE;
```

상태별 개수와 예상 시간 합계를 계산할 수 있습니다.

```sql
SELECT "상태", COUNT(*) AS "개수", SUM("예상 시간") AS "총 시간"
FROM "할 일"
GROUP BY "상태"
HAVING COUNT(*) > 0
ORDER BY "개수" DESC;
```

서로 다른 DB의 값을 비교해 함께 표시할 수도 있습니다. 이 예시는 ‘할 일’의 ‘프로젝트’ 텍스트와 ‘프로젝트’ DB의 ‘이름’을 비교합니다. 이름이 중복되면 SQL 조인 규칙에 따라 여러 행이 나올 수 있습니다.

```sql
SELECT t."이름" AS "할 일", p."이름" AS "프로젝트", p."담당자"
FROM "할 일" AS t
LEFT JOIN "프로젝트" AS p ON t."프로젝트" = p."이름"
WHERE t."이름" ILIKE '%설계%';
```

위 예시는 설명용 `sql` 블록입니다. **노트에서 실행하려면 울타리의 언어를 `foltra-sql`로 지정**합니다. 일반 `sql`·`postgresql` 코드 예시는 자동 실행하지 않습니다.

한 블록에는 하나의 읽기 전용 조회를 작성합니다. `WHERE`, `ORDER BY`, `LIMIT`, `JOIN`, `GROUP BY`·`HAVING`, 하위 쿼리, 비재귀 `WITH`, 윈도 함수, `ILIKE`, `::` 형 변환을 사용할 수 있습니다. 함수는 다음 목록으로 제한합니다.

| 용도 | 허용 함수 |
| --- | --- |
| 집계 | `count`, `sum`, `avg`, `min`, `max`, `bool_and`, `bool_or` |
| 문자열 | `lower`, `upper`, `length`, `char_length`, `substring`, `substr`, `trim`, `ltrim`, `rtrim` |
| 값·숫자 | `coalesce`, `nullif`, `greatest`, `least`, `round`, `abs`, `ceil`, `ceiling`, `floor` |
| 날짜·시각 | `date_trunc`, `date_part`, `current_date`, `current_timestamp`, `now`, `localtime`, `localtimestamp` |
| 윈도 | `row_number`, `rank`, `dense_rank`, `lag`, `lead`, `first_value`, `last_value` |

현재 날짜·시각은 쿼리마다 한 번 읽습니다. `CURRENT_DATE`·`LOCALTIME`·`LOCALTIMESTAMP`는 기기의 로컬 시각을 사용하고, `CURRENT_TIMESTAMP`·`now()`는 같은 순간을 UTC로 표시합니다. IANA 타임존 이름을 이용한 변환은 지원하지 않습니다.

## 기존 쿼리와 CLI

기존 `foltra-query`의 JSON 쿼리는 그대로 동작합니다. 이 블록에 SQL을 써도 조회할 수 있으며, 공백을 제외한 첫 글자가 `{`이면 기존 JSON 쿼리로 해석합니다. 새 SQL 블록에는 목적이 분명한 `foltra-sql`을 권장합니다. 기존 노트나 JSON 쿼리를 자동 변환하지 않습니다.

앱 없이 CLI에서도 같은 코어를 사용합니다.

```sh
# DB·컬럼 이름과 바로 사용할 SELECT 예제 조회
foltra --vault /path/to/vault query catalog

# 이름으로 조회
foltra --vault /path/to/vault query sql --args '{"sql":"SELECT COUNT(*) AS total FROM \"할 일\""}'
```

`query.catalog`는 `{tables:[{databaseId,name,columns,sql}]}`를 반환합니다. `columns`의 각 항목은 `{name,propertyId,type}`이며 메타데이터의 `propertyId`는 `null`입니다. `sql`에는 큰따옴표를 이스케이프한 조회 예제가 들어 있습니다.

`query.sql {sql}`의 응답은 `{columns:[{name,type}],rows,truncated,limit}`입니다. 각 행은 컬럼 순서에 맞춘 **문자열 또는 `null` 배열**이고 `type`은 결과 컬럼의 타입 정보입니다. `truncated: true`이면 표시 상한을 넘은 결과이므로 조건이나 `LIMIT`을 좁힙니다.

## 실행 범위와 한계

조회할 때 vault의 활성 DB·행을 임시 메모리 테이블로 구성합니다. Markdown·JSON 원본은 유지하며 PostgreSQL 파일 형식으로 이전하지 않습니다. 현재 SQL로는 노트 본문 전체를 검색하거나 외부 PostgreSQL 서버에 접속하지 않습니다.

`INSERT`·`UPDATE`·`DELETE`, 스키마 변경, `SELECT INTO`, 여러 SQL 문장, 재귀 조회, 행 잠금, 파일·URL 읽기/쓰기, 엔진 확장 설치·로딩은 지원하지 않습니다. 문자열 연결(`||`, `concat`), `replace`, `overlay`, 사용자 지정 연산자도 현재 지원하지 않습니다.

각 결과 컬럼은 숫자·문자열·날짜 같은 단일 값이어야 합니다. 배열·튜플·맵·구조체 생성과 중첩 타입 결과는 지원하지 않으며, `CAST`·`::`도 단일 값 타입으로의 변환만 허용합니다. 예를 들어 `SELECT t FROM "할 일" AS t`로 행 전체를 한 컬럼에 담는 대신 `SELECT t.* FROM "할 일" AS t`로 컬럼을 펼칩니다.

| 제한 대상 | 현재 상한 |
| --- | --- |
| SQL 원문 / 파서 재귀 깊이 | 32 KiB / 64 |
| 조회용으로 적재하는 vault | DB 100개, 행 20,000개, 값 크기 합계 32 MiB |
| SQL 평가 | 3초가 지나면 중단 요청 |
| 결과 | 500행, 128열 |
| 결과 문자열 | 셀당 64 KiB, 합계 2 MiB |
| DuckDB 메모리 예산 | 128 MB, 실행 스레드 1개, 디스크 임시 저장 비활성 |

3초 제한은 원본 읽기·메모리 적재 이후의 SQL 평가에 적용하며 전체 요청 시간의 보장은 아닙니다. 엔진 메모리 예산도 앱 프로세스 전체의 메모리 상한은 아닙니다. 별도 OS 프로세스 격리나 대형 vault 성능 검증은 아직 제공하지 않습니다.
