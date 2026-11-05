import * as path from 'path';

export const METHOD_EMBEDDED = 'Embedded (file)';
export const METHOD_SERVER = 'Server (TCP)';
export const METHOD_URL = 'JDBC URL';
export const PW_ASK = 'Ask on connect';
export const PW_EMPTY = 'Use empty password';
export const PW_SAVE = 'Save as plaintext in settings';
export const JAR_AUTO = 'Auto-download latest H2';
export const JAR_OWN = 'Use my own h2.jar';

/** Settings each connection method owns; everything else is dropped on save so switching methods leaves nothing stale. */
const OWNED: Record<string, string[]> = {
  [METHOD_EMBEDDED]: ['databaseFile', 'autoServer', 'createIfMissing', 'urlParams'],
  [METHOD_SERVER]: ['server', 'port', 'database', 'urlParams'],
  [METHOD_URL]: ['jdbcUrl'],
};
const ALL_OWNED = Array.from(new Set(Object.values(OWNED).flat()));

export function parseBeforeSaveConnection({ connInfo }: { connInfo: any }): any {
  const method = OWNED[connInfo.connectionMethod] ? connInfo.connectionMethod : METHOD_EMBEDDED;
  const keep = new Set(OWNED[method]);
  ALL_OWNED.filter((p) => !keep.has(p)).forEach((p) => delete connInfo[p]);

  if (connInfo.usePassword === PW_ASK) {
    connInfo.askForPassword = true;
    delete connInfo.password;
  } else if (connInfo.usePassword === PW_SAVE) {
    delete connInfo.askForPassword;
  } else {
    connInfo.password = '';
    delete connInfo.askForPassword;
  }

  if (connInfo.h2Source !== JAR_OWN) delete connInfo.h2Jar;

  ['connectionMethod', 'id', 'usePassword', 'h2Source'].forEach((p) => delete connInfo[p]);
  return connInfo;
}

export function parseBeforeEditConnection({ connInfo }: { connInfo: any }): any {
  const f: any = { ...connInfo };
  f.connectionMethod = connInfo.jdbcUrl ? METHOD_URL : connInfo.server ? METHOD_SERVER : METHOD_EMBEDDED;

  if (connInfo.askForPassword) {
    f.usePassword = PW_ASK;
    delete f.password;
  } else if (typeof connInfo.password === 'string' && connInfo.password.length > 0) {
    f.usePassword = PW_SAVE;
  } else {
    f.usePassword = PW_EMPTY;
  }

  f.h2Source = connInfo.h2Jar ? JAR_OWN : JAR_AUTO;
  return f;
}

// ---------------------------------------------------------------------------------------------

function parseParams(raw?: string): string[] {
  return String(raw || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

const hasKey = (params: string[], key: string) =>
  params.some((p) => p.split('=')[0].trim().toUpperCase() === key);

function normalizeDbPath(p: string): string {
  const s = p.trim().replace(/\\/g, '/').replace(/\.(mv|h2)\.db$/i, '');
  if (s === '~' || s.startsWith('~/')) return s; // H2 expands ~ itself
  if (path.isAbsolute(s) || /^[a-zA-Z]:\//.test(s)) return s;
  throw new Error(`Database file must be an absolute path (or start with ~/): ${p}`);
}

/** Builds the JDBC URL from the saved connection settings. */
export function buildJdbcUrl(c: any): string {
  if (c.jdbcUrl && String(c.jdbcUrl).trim()) return String(c.jdbcUrl).trim();

  const params = parseParams(c.urlParams);
  const suffix = (extra: string[]) => [...extra, ...params].map((p) => `;${p}`).join('');

  if (c.server) {
    const db = String(c.database ?? '').trim();
    if (!db) throw new Error('Database name/path is required for server connections');
    return `jdbc:h2:tcp://${String(c.server).trim()}:${c.port || 9092}/${db}${suffix([])}`;
  }

  if (!c.databaseFile || !String(c.databaseFile).trim()) throw new Error('Database file is required');
  const extra: string[] = [];
  if (!c.createIfMissing && !hasKey(params, 'IFEXISTS')) extra.push('IFEXISTS=TRUE');
  if (c.autoServer && !hasKey(params, 'AUTO_SERVER')) extra.push('AUTO_SERVER=TRUE');
  return `jdbc:h2:${normalizeDbPath(String(c.databaseFile))}${suffix(extra)}`;
}
