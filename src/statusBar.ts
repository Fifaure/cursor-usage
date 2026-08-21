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
