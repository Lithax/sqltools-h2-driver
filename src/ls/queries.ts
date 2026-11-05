import { IBaseQueries, ContextValue } from '@sqltools/types';
import queryFactory from '@sqltools/base-driver/dist/lib/factory';

const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const qi = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const tableRef = (t: any) => {
  if (typeof t === 'string') return t;
  return t.schema ? `${qi(t.schema)}.${qi(t.label)}` : qi(t.label);
};

const fetchSchemas = queryFactory`
SELECT SCHEMA_NAME AS "label", SCHEMA_NAME AS "schema", '${() => ContextValue.SCHEMA}' AS "type", 'group-by-ref-type' AS "iconId"
FROM INFORMATION_SCHEMA.SCHEMATA
WHERE SCHEMA_NAME <> 'INFORMATION_SCHEMA'
ORDER BY SCHEMA_NAME
`;

const tablesOrViews = (type: ContextValue, isView: boolean): IBaseQueries['fetchTables'] => queryFactory`
SELECT TABLE_NAME AS "label", TABLE_SCHEMA AS "schema", '${() => type}' AS "type", ${() => (isView ? 'TRUE' : 'FALSE')} AS "isView"
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = ${(p: any) => q(p.schema || p.label)}
  AND TABLE_TYPE ${() => (isView ? '=' : '<>')} 'VIEW'
ORDER BY TABLE_NAME
`;

const fetchTables = tablesOrViews(ContextValue.TABLE, false);
const fetchViews = tablesOrViews(ContextValue.VIEW, true);

const fetchColumns: IBaseQueries['fetchColumns'] = queryFactory`
SELECT COLUMN_NAME AS "label", '${() => ContextValue.COLUMN}' AS "type",
  TABLE_NAME AS "table", TABLE_SCHEMA AS "schema", DATA_TYPE AS "dataType",
  CHARACTER_MAXIMUM_LENGTH AS "size", (IS_NULLABLE = 'YES') AS "isNullable",
  COLUMN_DEFAULT AS "defaultValue", FALSE AS "isPk", FALSE AS "isFk"
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ${(p: any) => q(p.schema)} AND TABLE_NAME = ${(p: any) => q(p.label)}
ORDER BY ORDINAL_POSITION
`;

const describeTable: IBaseQueries['describeTable'] = queryFactory`
SELECT * FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = ${(p: any) => q(p.schema)} AND TABLE_NAME = ${(p: any) => q(p.label)}
ORDER BY ORDINAL_POSITION
`;

const fetchRecords: IBaseQueries['fetchRecords'] = queryFactory`
SELECT * FROM ${(p: any) => tableRef(p.table)}
LIMIT ${(p: any) => p.limit || 50} OFFSET ${(p: any) => p.offset || 0}
`;

const countRecords: IBaseQueries['countRecords'] = queryFactory`
SELECT COUNT(1) AS "total" FROM ${(p: any) => tableRef(p.table)}
`;

const searchTables: IBaseQueries['searchTables'] = queryFactory`
SELECT TABLE_NAME AS "label", TABLE_SCHEMA AS "schema",
  CASE WHEN TABLE_TYPE = 'VIEW' THEN '${() => ContextValue.VIEW}' ELSE '${() => ContextValue.TABLE}' END AS "type"
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA'
${(p: any) => (p.search ? `AND LOWER(TABLE_NAME) LIKE ${q('%' + String(p.search).toLowerCase() + '%')}` : '')}
ORDER BY TABLE_NAME
LIMIT ${(p: any) => p.limit || 100}
`;

const searchColumns: IBaseQueries['searchColumns'] = queryFactory`
SELECT COLUMN_NAME AS "label", TABLE_NAME AS "table", TABLE_SCHEMA AS "schema", DATA_TYPE AS "dataType",
  '${() => ContextValue.COLUMN}' AS "type", FALSE AS "isPk", FALSE AS "isFk"
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA <> 'INFORMATION_SCHEMA'
${(p: any) => {
  const tables = (p.tables || []).filter((t: any) => t && t.label);
  return tables.length ? `AND TABLE_NAME IN (${tables.map((t: any) => q(t.label)).join(', ')})` : '';
}}
${(p: any) => (p.search ? `AND LOWER(COLUMN_NAME) LIKE ${q('%' + String(p.search).toLowerCase() + '%')}` : '')}
ORDER BY COLUMN_NAME
LIMIT ${(p: any) => p.limit || 100}
`;

export default {
  fetchSchemas,
  fetchTables,
  fetchViews,
  fetchColumns,
  describeTable,
  fetchRecords,
  countRecords,
  searchTables,
  searchColumns,
};
