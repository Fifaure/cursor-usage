# Cursor Usage

Cursor extension that shows subscription usage **in the status bar**, on the right.

![Logo](media/icon.png)

## What you see

| Element | Detail |
| --- | --- |
| Ring + percent | **Cursor Models** usage (Grok, Composer, etc.) |
| Click | Switches to **Other models** (click again to switch back) |
| Color | Gray below 70%, orange from 70%, red from 90% |
| `…` | First load |
| `—` | Signed out, unreadable token, or API unavailable |

Refreshes every **60 seconds**.

## Install

1. Open Cursor.
2. Command Palette: **Extensions: Install from VSIX…**
3. Pick `cursor-usage-0.0.4.vsix` (repo root, after `npm run package`).
4. Reload the window (`Developer: Reload Window`).

You must be **signed in to Cursor** on this machine.

### Requirements

- Cursor (VS Code ≥ 1.85)
- **Python 3** on `PATH` (`py -3` or `python`) — needed to read `state.vscdb` when the database is too large for sql.js

## Development

```bash
npm install
npm run compile
npm run package
```

Then install the generated `.vsix`.

- `npm run watch` — compile on change
- `npm run build:icons` — rebuild the ring icon font (`media/usage-rings.woff`)
- F5 — **Run Extension** (Extension Development Host)

## How it works

1. Reads the Cursor session token from `state.vscdb` (`cursorAuth/accessToken`), read-only. The token is **never** stored by the extension.
2. Calls `https://api2.cursor.sh` (`GetCurrentPeriodUsage`) over HTTPS.
3. Shows `autoPercentUsed` (Cursor Models). A click shows `apiPercentUsed` (other models) instead, with no popup.

There is **no official usage API**. Endpoints and JSON shapes can change and break the extension.

## License

Personal use. Not affiliated with Cursor.
