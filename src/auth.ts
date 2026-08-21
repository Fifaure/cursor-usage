import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ACCESS_KEY = 'cursorAuth/accessToken';

export function resolveCursorStateDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA is not set');
    }
    return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'darwin') {
    return path.join(
      home,
      'Library',
      'Application Support',
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb'
    );
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export async function readCursorAccessToken(): Promise<string | null> {
  let dbPath: string;
  try {
    dbPath = resolveCursorStateDbPath();
  } catch {
    console.log('cursor-usage: cannot resolve Cursor state db');
    return null;
  }
  if (!fs.existsSync(dbPath)) {
    console.log('cursor-usage: Cursor state db missing');
    return null;
  }

  const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (!fs.existsSync(wasmPath)) {
    console.log('cursor-usage: sql.js wasm missing');
    return null;
  }

  const fileBuffer = fs.readFileSync(dbPath);
  const wasmBinary = fs.readFileSync(wasmPath);

  type SqlDb = {
    prepare: (sql: string) => {
      bind: (params: string[]) => void;
      step: () => boolean;
      getAsObject: () => { value?: string | Uint8Array };
      free: () => void;
    };
    close: () => void;
  };
  type InitSqlJs = (opts?: { wasmBinary?: Buffer | Uint8Array }) => Promise<{
    Database: new (data?: ArrayLike<number>) => SqlDb;
  }>;

  let db: SqlDb | undefined;
  try {
    const sqlJsMod = await import('sql.js');
    const initSqlJs: InitSqlJs =
      typeof (sqlJsMod as { default?: InitSqlJs }).default === 'function'
        ? (sqlJsMod as { default: InitSqlJs }).default
        : (sqlJsMod as unknown as InitSqlJs);

    const SQL = await initSqlJs({ wasmBinary });
    db = new SQL.Database(new Uint8Array(fileBuffer));

    const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1');
    stmt.bind([ACCESS_KEY]);
    if (!stmt.step()) {
      return null;
    }
    const row = stmt.getAsObject();
    stmt.free();
    const raw = row.value;
    if (typeof raw === 'string' && raw.length > 0) {
      return raw;
    }
    if (raw instanceof Uint8Array) {
      const text = Buffer.from(raw).toString('utf8');
      return text.length > 0 ? text : null;
    }
    return null;
  } catch {
    console.log('cursor-usage: failed to read access token');
    return null;
  } finally {
    db?.close();
  }
}
