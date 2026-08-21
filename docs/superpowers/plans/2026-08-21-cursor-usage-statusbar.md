# Cursor Usage Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une extension Cursor qui affiche le pourcentage d’usage de l’abonnement (`18%`) à droite de la barre de statut, rafraîchi toutes les 60 secondes.

**Architecture:** Extension VS Code/Cursor en TypeScript. `auth.ts` lit le token dans `state.vscdb`. `usage.ts` appelle l’API interne Cursor et calcule un entier 0–100. `statusBar.ts` affiche `…` / `{n}%` / `—`. `extension.ts` orchestre le premier fetch, le timer 60 s, et le dispose.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode`), `sql.js` (SQLite WASM, lecture seule), `fetch` HTTPS vers `api2.cursor.sh`.

## Global Constraints

- Activation : `onStartupFinished`. Aucune contribution `commands` ni `configuration`.
- Affichage uniquement : `…` (chargement), `{n}%` (entier), `—` (indisponible). Pas de tooltip, pas de clic, pas de couleur d’alerte, pas de popup (`showInformationMessage` / `showErrorMessage` interdits).
- Token : clé SQLite `cursorAuth/accessToken`, jamais persisté par l’extension, jamais loggé. Envoyé seulement en HTTPS vers `https://api2.cursor.sh`.
- Poll : 60_000 ms. Timeout HTTP : 10_000 ms.
- 401/403 ou pas de token → toujours `—`. Autre échec réseau/JSON → dernier pourcentage connu, sinon `—`.
- Pas de tests automatisés. Vérif = `npm run compile` (exit 0) puis, à la fin, install `.vsix` manuelle.
- Ne pas créer de commit git sauf si l’utilisateur le demande.

## File map

| File | Responsibility |
| --- | --- |
| `package.json` | Manifest extension, deps, scripts compile/package |
| `tsconfig.json` | Compile `src/` → `out/` |
| `.gitignore` | `node_modules/`, `out/`, `*.vsix` |
| `.vscodeignore` | Exclure sources du `.vsix` |
| `.vscode/launch.json` | F5 Extension Development Host |
| `.vscode/tasks.json` | Tâche compile |
| `src/auth.ts` | Chemin `state.vscdb` + lecture token |
| `src/usage.ts` | HTTP + parsing % + type `UsageFetchResult` |
| `src/statusBar.ts` | `StatusBarItem` Right, textes |
| `src/extension.ts` | activate / timer / deactivate |

Le timer vit dans `extension.ts` (cycle de vie). `statusBar.ts` ne fait que l’item visuel.

---

### Task 1: Scaffold extension

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.vscodeignore`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Create: `src/extension.ts`

**Interfaces:**
- Consumes: nothing
- Produces: projet compilable ; `activate` / `deactivate` vides

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "cursor-usage",
  "displayName": "Cursor Usage",
  "description": "Shows Cursor subscription usage percent in the status bar",
  "version": "0.0.1",
  "publisher": "camille",
  "private": true,
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "scripts": {
    "compile": "tsc -p .",
    "watch": "tsc -watch -p .",
    "package": "vsce package --allow-missing-repository --skip-license"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.2.0",
    "typescript": "^5.5.0"
  },
  "dependencies": {
    "sql.js": "^1.11.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", "out", "docs"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
out/
*.vsix
```

- [ ] **Step 4: Write `.vscodeignore`**

```
.vscode/**
src/**
docs/**
**/*.map
.gitignore
tsconfig.json
**/*.ts
```

- [ ] **Step 5: Write `.vscode/tasks.json`**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "compile",
      "problemMatcher": "$tsc",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

- [ ] **Step 6: Write `.vscode/launch.json`**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

- [ ] **Step 7: Write stub `src/extension.ts`**

```typescript
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
```

- [ ] **Step 8: Install and compile**

Run:

```bash
npm install
npm run compile
```

Expected: exit 0, fichier `out/extension.js` créé.

---

### Task 2: Auth — lire le token Cursor

**Files:**
- Create: `src/auth.ts`

**Interfaces:**
- Consumes: `sql.js`, `fs`, `path`, `os`
- Produces:
  - `resolveCursorStateDbPath(): string`
  - `readCursorAccessToken(): Promise<string | null>`

- [ ] **Step 1: Write `src/auth.ts`**

```typescript
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
  const sqlJsMod = await import('sql.js');
  type InitSqlJs = (opts?: { wasmBinary?: Buffer | Uint8Array }) => Promise<{
    Database: new (data?: ArrayLike<number>) => {
      prepare: (sql: string) => {
        bind: (params: string[]) => void;
        step: () => boolean;
        getAsObject: () => { value?: string | Uint8Array };
        free: () => void;
      };
      close: () => void;
    };
  }>;
  const initSqlJs: InitSqlJs =
    typeof (sqlJsMod as { default?: InitSqlJs }).default === 'function'
      ? (sqlJsMod as { default: InitSqlJs }).default
      : (sqlJsMod as unknown as InitSqlJs);

  const SQL = await initSqlJs({ wasmBinary });
  const db = new SQL.Database(new Uint8Array(fileBuffer));
  try {
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
    db.close();
  }
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`

Expected: exit 0. `out/auth.js` existe.

---

### Task 3: Usage — API + pourcentage

**Files:**
- Create: `src/usage.ts`

**Interfaces:**
- Consumes: token `string` (fourni par l’appelant, pas par `auth.ts` directement)
- Produces:
  - `export type UsageFetchResult = { status: 'ok'; percent: number } | { status: 'unauth' } | { status: 'unavailable' }`
  - `export function clampPercent(n: number): number`
  - `export function percentFromDashboard(json: unknown): number | null`
  - `export function percentFromAuthUsage(json: unknown): number | null`
  - `export async function fetchUsagePercent(token: string): Promise<UsageFetchResult>`

- [ ] **Step 1: Write `src/usage.ts`**

```typescript
const API_ORIGIN = 'https://api2.cursor.sh';
const DASHBOARD_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const AUTH_USAGE_PATH = '/auth/usage';
const TIMEOUT_MS = 10_000;

export type UsageFetchResult =
  | { status: 'ok'; percent: number }
  | { status: 'unauth' }
  | { status: 'unavailable' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function percentFromUsedLimit(used: number, limit: number): number | null {
  if (!(limit > 0)) {
    return null;
  }
  return clampPercent((used / limit) * 100);
}

export function percentFromDashboard(json: unknown): number | null {
  if (!isRecord(json)) {
    return null;
  }
  const pu = json.planUsage;
  if (!isRecord(pu)) {
    return null;
  }

  const totalPercentUsed = num(pu.totalPercentUsed);
  if (totalPercentUsed !== undefined) {
    return clampPercent(totalPercentUsed);
  }

  const limit = num(pu.limit);
  const remaining = num(pu.remaining);
  const includedSpend = num(pu.includedSpend);
  const totalSpend = num(pu.totalSpend);

  let used: number | undefined;
  if (includedSpend !== undefined) {
    used = includedSpend;
  } else if (limit !== undefined && remaining !== undefined) {
    used = Math.max(0, limit - remaining);
  } else if (totalSpend !== undefined) {
    used = totalSpend;
  }

  if (used === undefined || limit === undefined) {
    return null;
  }
  return percentFromUsedLimit(used, limit);
}

function extractUsedLimit(val: Record<string, unknown>): { used: number; limit: number } | undefined {
  const used = num(val.numRequests) ?? num(val.used);
  const limit = num(val.maxRequestUsage) ?? num(val.limit);
  if (used !== undefined && limit !== undefined) {
    return { used, limit };
  }
  return undefined;
}

export function percentFromAuthUsage(json: unknown): number | null {
  if (!isRecord(json)) {
    return null;
  }

  const gpt4 = json['gpt-4'];
  if (isRecord(gpt4)) {
    const pair = extractUsedLimit(gpt4);
    if (pair) {
      return percentFromUsedLimit(pair.used, pair.limit);
    }
  }

  for (const val of Object.values(json)) {
    if (!isRecord(val)) {
      continue;
    }
    const pair = extractUsedLimit(val);
    if (pair) {
      return percentFromUsedLimit(pair.used, pair.limit);
    }
  }
  return null;
}

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  if (typeof t === 'object' && 'unref' in t) {
    (t as NodeJS.Timeout).unref();
  }
  return c.signal;
}

async function requestJson(
  url: string,
  token: string,
  method: 'GET' | 'POST'
): Promise<{ kind: 'json'; body: unknown } | { kind: 'unauth' } | { kind: 'fail' }> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const init: RequestInit = {
      method,
      headers,
      signal: timeoutSignal(TIMEOUT_MS),
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['Connect-Protocol-Version'] = '1';
      init.body = '{}';
    }
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403) {
      return { kind: 'unauth' };
    }
    if (!res.ok) {
      return { kind: 'fail' };
    }
    return { kind: 'json', body: await res.json() };
  } catch {
    return { kind: 'fail' };
  }
}

export async function fetchUsagePercent(token: string): Promise<UsageFetchResult> {
  const dashboard = await requestJson(`${API_ORIGIN}${DASHBOARD_PATH}`, token, 'POST');
  if (dashboard.kind === 'unauth') {
    return { status: 'unauth' };
  }
  if (dashboard.kind === 'json') {
    const pct = percentFromDashboard(dashboard.body);
    if (pct !== null) {
      return { status: 'ok', percent: pct };
    }
  }

  const authUsage = await requestJson(`${API_ORIGIN}${AUTH_USAGE_PATH}`, token, 'GET');
  if (authUsage.kind === 'unauth') {
    return { status: 'unauth' };
  }
  if (authUsage.kind === 'json') {
    const pct = percentFromAuthUsage(authUsage.body);
    if (pct !== null) {
      return { status: 'ok', percent: pct };
    }
  }

  return { status: 'unavailable' };
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`

Expected: exit 0. `out/usage.js` existe.

---

### Task 4: Status bar item

**Files:**
- Create: `src/statusBar.ts`

**Interfaces:**
- Consumes: `vscode.window.createStatusBarItem`
- Produces: class `UsageStatusBar` with:
  - `constructor()`
  - `setLoading(): void` → texte `…`
  - `setPercent(n: number): void` → texte `` `${n}%` ``
  - `setUnavailable(): void` → texte `—`
  - `dispose(): void`

- [ ] **Step 1: Write `src/statusBar.ts`**

```typescript
import * as vscode from 'vscode';

export class UsageStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    this.item.show();
  }

  setLoading(): void {
    this.item.text = '…';
  }

  setPercent(n: number): void {
    this.item.text = `${n}%`;
  }

  setUnavailable(): void {
    this.item.text = '—';
  }

  dispose(): void {
    this.item.dispose();
  }
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`

Expected: exit 0. `out/statusBar.js` existe.

---

### Task 5: Orchestration activate / timer / erreurs

**Files:**
- Modify: `src/extension.ts` (remplacer le stub)

**Interfaces:**
- Consumes:
  - `readCursorAccessToken(): Promise<string | null>` depuis `src/auth.ts`
  - `fetchUsagePercent(token: string): Promise<UsageFetchResult>` depuis `src/usage.ts`
  - `UsageStatusBar` depuis `src/statusBar.ts`
- Produces: extension active qui poll toutes les 60 s

- [ ] **Step 1: Replace `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { readCursorAccessToken } from './auth';
import { UsageStatusBar } from './statusBar';
import { fetchUsagePercent } from './usage';

const POLL_MS = 60_000;

let bar: UsageStatusBar | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let lastPercent: number | undefined;

function applyResult(
  result: Awaited<ReturnType<typeof fetchUsagePercent>> | { status: 'unauth' }
): void {
  if (!bar) {
    return;
  }
  if (result.status === 'ok') {
    lastPercent = result.percent;
    bar.setPercent(result.percent);
    return;
  }
  if (result.status === 'unauth') {
    lastPercent = undefined;
    bar.setUnavailable();
    return;
  }
  if (lastPercent !== undefined) {
    bar.setPercent(lastPercent);
    return;
  }
  bar.setUnavailable();
}

async function refresh(): Promise<void> {
  const token = await readCursorAccessToken();
  if (!token) {
    applyResult({ status: 'unauth' });
    return;
  }
  try {
    const result = await fetchUsagePercent(token);
    applyResult(result);
  } catch {
    console.log('cursor-usage: refresh failed');
    applyResult({ status: 'unavailable' });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  bar = new UsageStatusBar();
  bar.setLoading();
  void refresh();
  timer = setInterval(() => {
    void refresh();
  }, POLL_MS);
  context.subscriptions.push({
    dispose: () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      bar?.dispose();
      bar = undefined;
    },
  });
}

export function deactivate(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  bar?.dispose();
  bar = undefined;
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`

Expected: exit 0, aucune erreur TypeScript.

---

### Task 6: Package `.vsix` et vérif manuelle

**Files:**
- None new (utilise `npm run package`)

**Interfaces:**
- Consumes: code compilé des tasks 1–5
- Produces: `cursor-usage-0.0.1.vsix`

- [ ] **Step 1: Package**

Run:

```bash
npm run compile
npm run package
```

Expected: exit 0, fichier `cursor-usage-0.0.1.vsix` à la racine du projet.

- [ ] **Step 2: Install in Cursor**

Dans Cursor : palette → `Extensions: Install from VSIX…` → choisir `cursor-usage-0.0.1.vsix`. Recharger la fenêtre si demandé.

Expected:

- Session Cursor connectée : barre de droite montre `…` puis un entier + `%` (ex. `18%`).
- Après ~1 minute : le texte est toujours un pourcentage (peut rester identique si l’API cache).
- Alternative F5 : lancer **Run Extension** depuis `.vscode/launch.json` et vérifier la barre dans la fenêtre Extension Development Host.

- [ ] **Step 3: Check disconnected state (optional)**

Si tu te déconnectes de Cursor, au cycle suivant la barre doit afficher `—`.
