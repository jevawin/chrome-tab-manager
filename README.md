# Spaces — Workspace Swap

A Safari-style workspace switcher for Chrome. Switch a workspace and all tabs
in the current window swap out. The active workspace tracks tab changes live.

## Load it (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Pick this folder.
5. Pin the extension so its icon shows. Click the icon to open the popup.

## How it works

- **Save current tabs** — names the current window's tabs as a new workspace and
  drops you into it. Tabs stay open.
- **Start empty** — names a new, empty workspace and swaps into it: current tabs
  close and a fresh blank tab opens.
- **Click a workspace** — closes the current tabs and opens that workspace's tabs.
- **Live state** — while you are in a workspace, opening/closing/navigating tabs
  updates that workspace automatically.

Names are required — both create buttons stay disabled until you type one.

## Known v1 limits

- Tracks the last focused normal window. Use one window at a time.
- Saves only http/https tabs. chrome:// and extension pages are skipped.
- The MV3 service worker can unload; a pending live-save may be dropped and
  picked up on the next tab change.

## Iterate in Claude Code

Open this folder in Claude Code and ask for changes, e.g.:
- "add rename"
- "make workspaces per-window"
- "add drag-to-reorder"
- "keep pinned tabs across all workspaces"
