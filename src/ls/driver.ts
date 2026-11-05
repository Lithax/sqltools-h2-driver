import AbstractDriver from '@sqltools/base-driver';
import { IConnectionDriver, MConnectionExplorer, NSDatabase, ContextValue, Arg0 } from '@sqltools/types';
import { v4 as generateId } from 'uuid';
import queries from './queries';
import H2Bridge from './bridge';
import { buildJdbcUrl } from '../connection';
import { resolveJar } from '../h2jar';

/** Split a script into statements on ';' (ignores quotes and comments). */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      // handle doubled quotes ('' or "") by continuing the scan
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      cur += sql.slice(i, Math.min(j + 1, sql.length));
      i = j;
      void end;
    } else if (c === '-' && n === '-') {
      const e = sql.indexOf('\n', i);
      cur += sql.slice(i, e === -1 ? sql.length : e);
      i = e === -1 ? sql.length : e - 1;
    } else if (c === '/' && n === '*') {
      const e = sql.indexOf('*/', i + 2);
      cur += sql.slice(i, e === -1 ? sql.length : e + 2);
      i = e === -1 ? sql.length : e + 1;
    } else if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export default class H2Driver extends AbstractDriver<H2Bridge, any> implements IConnectionDriver {
  queries = queries;

  public async open() {
    if (this.connection) return this.connection;
    const c: any = this.credentials;
    this.connection = (async () => {
      const url = buildJdbcUrl(c);
      const h2Jar = await resolveJar(c.h2Jar);
      return H2Bridge.start({
        javaPath: c.javaPath,
        h2Jar,
        url,
        user: c.username,
        password: c.password,
      });
    })();
    try {
      return await this.connection;
    } catch (e) {
      this.connection = null;
      throw e;
    }
  }

  public async close() {
    if (!this.connection) return;
    const bridge = await this.connection;
    bridge.close();
    this.connection = null;
  }

  public query: (typeof AbstractDriver)['prototype']['query'] = async (q, opt = {}) => {
    const bridge = await this.open();
    const text = q.toString();
    const results: NSDatabase.IResult[] = [];

    for (const stmt of splitSql(text)) {
      const base = {
        connId: this.getId(),
        requestId: opt.requestId,
        resultId: generateId(),
        query: stmt,
      };
      const res = await bridge.request(stmt);
      if (!res.ok) {
        results.push({
          ...base,
          cols: [],
          results: [],
          error: true,
          rawError: new Error(res.error),
          messages: [{ date: new Date(), message: res.error || 'Query failed' }],
        } as NSDatabase.IResult);
        break;
      }
      if (res.cols) {
        const seen: Record<string, number> = {};
        const cols = res.cols.map((c) => {
          seen[c] = (seen[c] || 0) + 1;
          return seen[c] > 1 ? `${c}_${seen[c]}` : c;
        });
        const rows = (res.rows || []).map((r) => {
          const o: Record<string, any> = {};
          cols.forEach((c, i) => (o[c] = r[i]));
          return o;
        });
        results.push({
          ...base,
          cols,
          results: rows,
          messages: [{ date: new Date(), message: `Query ok with ${rows.length} results` }],
        });
      } else {
        results.push({
          ...base,
          cols: [],
          results: [],
          messages: [{ date: new Date(), message: `Query ok, ${res.updated ?? 0} rows affected` }],
        });
      }
    }
    return results;
  };

  private async rows(q: any): Promise<any[]> {
    const [res] = await this.query(q, {});
    if (res && (res as any).error) throw (res as any).rawError;
    return res ? res.results : [];
  }

  public async testConnection() {
    await this.open();
    await this.query('SELECT 1', {});
  }

  public async getChildrenForItem({ item, parent }: Arg0<IConnectionDriver['getChildrenForItem']>) {
    switch (item.type) {
      case ContextValue.CONNECTION:
      case ContextValue.CONNECTED_CONNECTION:
        return this.rows(this.queries.fetchSchemas(item as any));
      case ContextValue.SCHEMA:
        return <MConnectionExplorer.IChildItem[]>[
          { label: 'Tables', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.TABLE },
          { label: 'Views', type: ContextValue.RESOURCE_GROUP, iconId: 'folder', childType: ContextValue.VIEW },
        ];
      case ContextValue.TABLE:
      case ContextValue.VIEW:
        return this.rows(this.queries.fetchColumns(item as NSDatabase.ITable));
      case ContextValue.RESOURCE_GROUP:
        if (item.childType === ContextValue.VIEW) return this.rows(this.queries.fetchViews(parent as NSDatabase.ISchema));
        return this.rows(this.queries.fetchTables(parent as NSDatabase.ISchema));
    }
    return [];
  }

  public async searchItems(itemType: ContextValue, search: string, extraParams: any = {}): Promise<NSDatabase.SearchableItem[]> {
    switch (itemType) {
      case ContextValue.TABLE:
      case ContextValue.VIEW:
        return this.rows(this.queries.searchTables({ search }));
      case ContextValue.COLUMN:
        return this.rows(this.queries.searchColumns({ search, ...extraParams }));
    }
    return [];
  }

  public getStaticCompletions = async () => ({});
}
