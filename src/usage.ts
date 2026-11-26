const API_ORIGIN = 'https://api2.cursor.sh';
const DASHBOARD_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const AUTH_USAGE_PATH = '/auth/usage';
const TIMEOUT_MS = 10_000;

export type UsageFetchResult =
  | { status: 'ok'; percent: number; otherPercent?: number }
  | { status: 'unauth' }
  | { status: 'unavailable' };

export type ParsedUsage = {
  percent: number;
  otherPercent?: number;
};

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

export function percentFromDashboard(json: unknown): ParsedUsage | null {
  if (!isRecord(json)) {
    return null;
  }
  const pu = json.planUsage;
  if (!isRecord(pu)) {
    return null;
  }

  const apiPercentUsed = num(pu.apiPercentUsed);
  const otherPercent = apiPercentUsed !== undefined ? clampPercent(apiPercentUsed) : undefined;
  const included = includedPercent(pu);

  const autoPercentUsed = num(pu.autoPercentUsed);
  if (autoPercentUsed !== undefined && clampPercent(autoPercentUsed) > 0) {
    return { percent: clampPercent(autoPercentUsed), otherPercent };
  }
  // autoPercentUsed/apiPercentUsed can stay at 0 while the dashboard
  // "included usage" percent is includedSpend / limit.
  if (included !== null && included > 0) {
    return { percent: included, otherPercent };
  }
  if (autoPercentUsed !== undefined) {
    return { percent: clampPercent(autoPercentUsed), otherPercent };
  }

  const totalPercentUsed = num(pu.totalPercentUsed);
  if (totalPercentUsed !== undefined) {
    return { percent: clampPercent(totalPercentUsed), otherPercent };
  }

  return included === null ? null : { percent: included, otherPercent };
}

function includedPercent(pu: Record<string, unknown>): number | null {
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

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  if (typeof t === 'object' && 'unref' in t) {
    (t as NodeJS.Timeout).unref();
  }
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

async function requestJson(
  url: string,
  token: string,
  method: 'GET' | 'POST'
): Promise<{ kind: 'json'; body: unknown } | { kind: 'unauth' } | { kind: 'fail' }> {
  const { signal, cancel } = timeoutSignal(TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    const init: RequestInit = {
      method,
      headers,
      signal,
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
  } finally {
    cancel();
  }
}

export async function fetchUsagePercent(token: string): Promise<UsageFetchResult> {
  const dashboard = await requestJson(`${API_ORIGIN}${DASHBOARD_PATH}`, token, 'POST');
  if (dashboard.kind === 'unauth') {
    return { status: 'unauth' };
  }
  if (dashboard.kind === 'json') {
    const parsed = percentFromDashboard(dashboard.body);
    if (parsed !== null) {
      return { status: 'ok', percent: parsed.percent, otherPercent: parsed.otherPercent };
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
