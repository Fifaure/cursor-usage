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
      lastPercent = undefined;
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
  lastPercent = undefined;
}
