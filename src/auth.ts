import { createDecipheriv } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

const ACCESS_KEY = 'cursorAuth/accessToken';
const SQLJS_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 15_000;
const SAFE_STORAGE_PREFIX = 'cursor-safe-storage:v1:';
const OSCRYPT_VERSION = 'v10';
const DPAPI_PREFIX = 'DPAPI';

let cachedOsCryptKey: Buffer | undefined;

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

type NodeSqliteRead = { ok: true; token: string | null } | { ok: false };

async function readTokenViaNodeSqlite(dbPath: string): Promise<NodeSqliteRead> {
  let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return { ok: false };
  }

  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(ACCESS_KEY);
    if (!row || row.value == null || row.value === '') {
      return { ok: true, token: null };
    }
    if (typeof row.value === 'string') {
      return { ok: true, token: row.value };
    }
    const text = Buffer.from(row.value).toString('utf8');
    return { ok: true, token: text.length > 0 ? text : null };
  } catch {
    console.log('cursor-usage: node sqlite read failed');
    return { ok: false };
  } finally {
    db?.close();
  }
}

function isWindowsStoreAlias(cmd: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const found = spawnSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true });
  return (found.stdout ?? '').toLowerCase().includes('\\windowsapps\\');
}

function isStoredToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith(SAFE_STORAGE_PREFIX)) {
    return true;
  }
  const parts = trimmed.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
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
    if (isWindowsStoreAlias(cmd)) {
      continue;
    }
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

function localStatePath(dbPath: string): string {
  return path.join(path.dirname(path.dirname(path.dirname(dbPath))), 'Local State');
}

function dpapiUnprotect(blob: Buffer): Buffer | null {
  const script = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Security',
    `$bytes=[Convert]::FromBase64String('${blob.toString('base64')}')`,
    '$dec=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($dec)',
  ].join(';');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.status !== 0) {
    return null;
  }
  const out = (result.stdout ?? '').replace(/\s+/g, '');
  return out.length > 0 ? Buffer.from(out, 'base64') : null;
}

function loadWindowsOsCryptKey(dbPath: string): Buffer | null {
  if (cachedOsCryptKey) {
    return cachedOsCryptKey;
  }
  let encryptedKey: string | undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath(dbPath), 'utf8')) as {
      os_crypt?: { encrypted_key?: string };
    };
    encryptedKey = parsed.os_crypt?.encrypted_key;
  } catch {
    console.log('cursor-usage: cannot read Cursor Local State');
    return null;
  }
  if (!encryptedKey) {
    console.log('cursor-usage: Cursor Local State has no storage key');
    return null;
  }
  const wrapped = Buffer.from(encryptedKey, 'base64');
  if (wrapped.subarray(0, DPAPI_PREFIX.length).toString('latin1') !== DPAPI_PREFIX) {
    console.log('cursor-usage: unsupported Cursor storage key');
    return null;
  }
  const key = dpapiUnprotect(wrapped.subarray(DPAPI_PREFIX.length));
  if (!key || key.length !== 32) {
    console.log('cursor-usage: could not unwrap Cursor storage key');
    return null;
  }
  cachedOsCryptKey = key;
  return key;
}

function decryptSafeStorage(payload: string, dbPath: string): string | null {
  if (process.platform !== 'win32') {
    console.log('cursor-usage: encrypted token is only decrypted on Windows');
    return null;
  }
  const key = loadWindowsOsCryptKey(dbPath);
  if (!key) {
    return null;
  }
  const blob = Buffer.from(payload, 'base64');
  if (blob.length < OSCRYPT_VERSION.length + 12 + 16) {
    console.log('cursor-usage: encrypted token is too short');
    return null;
  }
  if (blob.subarray(0, OSCRYPT_VERSION.length).toString('latin1') !== OSCRYPT_VERSION) {
    console.log('cursor-usage: unsupported token encryption version');
    return null;
  }
  const nonce = blob.subarray(OSCRYPT_VERSION.length, OSCRYPT_VERSION.length + 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(OSCRYPT_VERSION.length + 12, blob.length - 16);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return plain.length > 0 ? plain : null;
  } catch {
    console.log('cursor-usage: failed to decrypt access token');
    return null;
  }
}

function unwrapStoredToken(stored: string, dbPath: string): string | null {
  const value = stored.trim();
  if (!value.startsWith(SAFE_STORAGE_PREFIX)) {
    return value.length > 0 ? value : null;
  }
  return decryptSafeStorage(value.slice(SAFE_STORAGE_PREFIX.length).trim(), dbPath);
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

  const sqliteRead = await readTokenViaNodeSqlite(dbPath);
  if (sqliteRead.ok) {
    return sqliteRead.token ? unwrapStoredToken(sqliteRead.token, dbPath) : null;
  }

  const pythonToken = await readTokenViaPython(dbPath);
  if (pythonToken && isStoredToken(pythonToken)) {
    return unwrapStoredToken(pythonToken, dbPath);
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

  const sqlToken = await readTokenViaSqlJs(dbPath);
  if (!sqlToken) {
    return null;
  }
  return unwrapStoredToken(sqlToken, dbPath);
}
