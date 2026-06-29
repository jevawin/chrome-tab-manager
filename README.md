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
- **Move a tab** — open the popup and use the move strip (shows the active tab
  with a workspace picker) to send the current tab to another workspace or create
  a new one. Stashes the tab; stays in your current workspace.
- **Rename a workspace** — click the pencil icon next to a workspace name in the
  popup. Type a new name and press Enter (or Escape to cancel).

Names are required — both create buttons stay disabled until you type one.

## Test it manually

Smoke test for the core swap guard:
1. Open 3 tabs. Click the extension icon, type a name, click "Save current tabs" to save as workspace "A".
2. Open 2 different tabs. Type another name, click "Save current tabs" to save as workspace "B".
3. In the popup, click workspace "A". B's tabs should close, A's tabs should open.
4. In A, open a new tab. Switch to B, then back to A. The new tab must still be in A. If it is, the swap guard works.

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
