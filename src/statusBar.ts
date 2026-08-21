import * as vscode from 'vscode';

export const TOGGLE_COMMAND = 'cursorUsage.toggleDisplayedPercent';

const STOPS: [number, number][] = [
  [70, 0xe2a336],
  [90, 0xe86548],
  [100, 0xf14c4c],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function colorFor(n: number): string | undefined {
  if (n < STOPS[0][0]) {
    return '#a0a0a0';
  }
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [loPct, loRgb] = STOPS[i];
    const [hiPct, hiRgb] = STOPS[i + 1];
    if (n <= hiPct) {
      const t = (n - loPct) / (hiPct - loPct);
      const r = lerp((loRgb >> 16) & 0xff, (hiRgb >> 16) & 0xff, t);
      const g = lerp((loRgb >> 8) & 0xff, (hiRgb >> 8) & 0xff, t);
      const b = lerp(loRgb & 0xff, hiRgb & 0xff, t);
      return rgbHex(r, g, b);
    }
  }
  const last = STOPS[STOPS.length - 1][1];
  return rgbHex((last >> 16) & 0xff, (last >> 8) & 0xff, last & 0xff);
}

export class UsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private cursorPercent: number | undefined;
  private otherPercent: number | undefined;
  private showingOther = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    this.item.name = 'Cursor Usage';
    this.item.command = TOGGLE_COMMAND;
    this.item.show();
  }

  setLoading(): void {
    this.showingOther = false;
    this.cursorPercent = undefined;
    this.otherPercent = undefined;
    this.item.text = '…';
    this.item.color = undefined;
    this.item.tooltip = undefined;
  }

  setPercent(n: number, otherPercent?: number): void {
    this.cursorPercent = Math.max(0, Math.min(100, Math.round(n)));
    this.otherPercent =
      otherPercent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(otherPercent)));
    if (this.otherPercent === undefined) {
      this.showingOther = false;
    }
    this.render();
  }

  toggleDisplayed(): void {
    if (this.otherPercent === undefined) {
      return;
    }
    this.showingOther = !this.showingOther;
    this.render();
  }

  setUnavailable(): void {
    this.showingOther = false;
    this.cursorPercent = undefined;
    this.otherPercent = undefined;
    this.item.text = '—';
    this.item.color = undefined;
    this.item.tooltip = undefined;
    this.item.name = 'Cursor Usage';
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    const n =
      this.showingOther && this.otherPercent !== undefined
        ? this.otherPercent
        : this.cursorPercent;
    if (n === undefined) {
      return;
    }
    this.item.text = `$(usage-ring-${n}) ${n}%`;
    this.item.color = colorFor(n);
    this.item.tooltip = undefined;
    this.item.name = this.showingOther ? 'Autres modèles' : 'Cursor Usage';
  }
}
