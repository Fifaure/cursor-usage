import * as vscode from 'vscode';

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
    return undefined;
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

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    this.item.name = 'Cursor Usage';
    this.item.show();
  }

  setLoading(): void {
    this.item.text = '…';
    this.item.color = undefined;
    this.item.tooltip = undefined;
  }

  setPercent(n: number, otherPercent?: number): void {
    const pct = Math.max(0, Math.min(100, Math.round(n)));
    this.item.text = `$(usage-ring-${pct}) ${pct}%`;
    this.item.color = colorFor(pct);
    this.item.tooltip =
      otherPercent !== undefined ? `Autres modèles : ${otherPercent}%` : undefined;
  }

  setUnavailable(): void {
    this.item.text = '—';
    this.item.color = undefined;
    this.item.tooltip = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
