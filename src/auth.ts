import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

const ACCESS_KEY = 'cursorAuth/accessToken';
const SQLJS_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 15_000;

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

function tryPythonCommand(
  cmd: string,
  prefixArgs: string[],
  script: string,
  dbPath: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, [...prefixArgs, '-c', script, dbPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);
      return;
    }

    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, PYTHON_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      finish(text.length > 0 ? text : null);
    });
  });
}

async function readTokenViaPython(dbPath: string): Promise<string | null> {
  const script = [
    'import sqlite3, sys',
    'p = sys.argv[1]',
    "con = sqlite3.connect('file:' + p + '?mode=ro', uri=True)",
    'try:',
    `    row = con.execute("SELECT value FROM ItemTable WHERE key = ?", (${JSON.stringify(ACCESS_KEY)},)).fetchone()`,
    'finally:',
    '    con.close()',
    'if row and row[0] is not None:',
    '    v = row[0]',
    '    if isinstance(v, bytes):',
    '        sys.stdout.buffer.write(v)',
    '    else:',
    '        sys.stdout.write(v)',
  ].join('\n');

  const candidates: Array<{ cmd: string; prefixArgs: string[] }> =
    process.platform === 'win32'
      ? [
          { cmd: 'py', prefixArgs: ['-3'] },
          { cmd: 'python', prefixArgs: [] },
          { cmd: 'python3', prefixArgs: [] },
        ]
      : [
          { cmd: 'python', prefixArgs: [] },
          { cmd: 'python3', prefixArgs: [] },
        ];

  for (const { cmd, prefixArgs } of candidates) {
    const result = await tryPythonCommand(cmd, prefixArgs, script, dbPath);
    if (result) {
      return result;
    }
  }
  return null;
}

async function readTokenViaSqlJs(dbPath: string): Promise<string | null> {
  const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (!fs.existsSync(wasmPath)) {
    console.log('cursor-usage: sql.js wasm missing');
    return null;
  }

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
    const fileBuffer = fs.readFileSync(dbPath);
    const wasmBinary = fs.readFileSync(wasmPath);

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
      stmt.free();
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

  const pythonToken = await readTokenViaPython(dbPath);
  if (pythonToken) {
    return pythonToken;
  }

  let sizeBytes: number;
  try {
    sizeBytes = fs.statSync(dbPath).size;
  } catch {
    console.log('cursor-usage: failed to stat state db');
    return null;
  }
  if (sizeBytes >= SQLJS_MAX_BYTES) {
    console.log('cursor-usage: state db too large');
    return null;
  }

  return readTokenViaSqlJs(dbPath);
}
