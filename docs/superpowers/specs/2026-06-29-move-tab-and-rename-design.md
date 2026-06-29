# Move current tab to a workspace + inline rename — design

Date: 2026-06-29
Status: Approved, ready for implementation plan

## Summary

Two popup features for the Workspace Swap extension:

1. **Move the current tab into another workspace** — existing or a brand-new one.
2. **Rename a workspace inline** via a pencil icon next to the delete (✕).

All decision logic lives in `background.js`. The popup only renders and sends
messages (per the project's "keep the popup dumb" rule).

## Goals

- Park the working window's active tab into any workspace without switching.
- Create a new workspace seeded from the current tab.
- Edit a workspace name in place, no popups.

## Non-goals (parked, see end)

- Intercepting inbound external link clicks.
- Context-menu move.
- Choosy-style custom-browser hook.

---

## Feature 1 — Move current tab to a workspace

### Message protocol additions (popup → background)

- `moveTab { targetId }` → stash the working window's active tab into an existing
  workspace. Returns `{ ok: true }`.
- `moveTabToNew { name }` → create a new workspace seeded with the active tab,
  then stash it. Returns `{ ok: true, ws }`.

### Shared background core

Both messages resolve and move the active tab the same way:

1. Resolve the working window with `getCurrentWindowId()` (the last focused normal
   window — never the popup, invariant 6). Then read its active tab:
   `chrome.tabs.query({ active: true, windowId })`.
2. **Trackable guard.** If the tab's URL is not http/https (`isTrackableUrl`),
   reject with an error. chrome:// and extension pages cannot be reliably
   reopened (invariant 5), so they cannot be moved.
3. **Last-tab guard.** If the active tab is the only tab in the window, open one
   blank tab *before* closing it, so the window never reaches zero tabs
   (invariant 1).
4. **Stash.** Append `{ url, pinned }` to the target workspace's saved `tabs`
   array and persist via `setState`.
5. **Close.** Remove the moved tab. Normal live tracking
   (`tabs.onRemoved → scheduleSync → syncNow`) then re-snapshots the *source*
   (active) workspace without the moved tab. This is correct: the source should
   drop it. No `swapping` guard is used — unlike a swap, we *want* the source to
   re-sync.

Neither variant changes `activeWorkspaceId`. Moving parks a tab elsewhere; the
user stays in the current workspace.

### `moveTab(targetId)` specifics

- If `targetId === activeWorkspaceId`, it is a no-op (the tab is already there).
  The popup excludes the active workspace from the destination picker, so this
  should not be reachable from the UI; the handler still guards against it.
- If the target workspace does not exist, return an error.

### `moveTabToNew(name)` specifics

- `cleanName(name)`; reject blank (same rule as create).
- Build `{ id: crypto.randomUUID(), name, tabs: [ { url, pinned } ] }`, push to
  state, persist.
- The new workspace is **not** made active and its tab is **not** opened — it is
  saved state only, consistent with move-to-existing.

### Edge cases

- **Default state (`activeWorkspaceId === null`).** Move still works: there is no
  tracked source, but the active tab can still be stashed into a workspace or a
  new one. Closing the moved tab does not trigger a source sync (invariant 4).
- **Zero existing workspaces.** The picker offers only `＋ New workspace…`.
- **Active tab unresolved.** If no active tab can be read for the working window,
  reject with an error; the popup shows the strip disabled.

---

## Feature 2 — Move strip (popup UI, Option A)

A thin strip directly under the `WORKSPACES` header, above the list.

```
WORKSPACES
┌──────────────────────────────────────┐
│ ↪ Move "GitHub – pull req…"  [▾ Move] │
└──────────────────────────────────────┘
● Work          4 tabs      ✎  ✕
  Reading       7 tabs      ✎  ✕

Create new workspace
[ Workspace name            ]
[ Save current tabs ][ Start empty ]
```

### Behaviour

- The strip shows the working window's active tab (favicon if available +
  truncated title), resolved from background on render.
- The picker is a native `<select>`:
  - First option is a disabled placeholder (`Move to…`).
  - Then every workspace **except the active one**.
  - Then `＋ New workspace…` as the last option.
- Selecting a workspace → send `moveTab { targetId }`, then re-render.
- Selecting `＋ New workspace…` → the strip reveals an inline `[name…] [Move]`.
  Confirm → send `moveTabToNew { name }`, then re-render. Blank name keeps the
  Move button disabled (mirrors the create buttons).
- If the active tab is not trackable (chrome:// etc.), the strip renders disabled
  with a one-line hint (e.g. "Can't move this page").

The popup stays open after a move so the user can move several tabs in a row;
re-render reflects the updated counts.

### Active-tab data for the strip

Fold the active tab into the existing `getState` response rather than adding a
second message — it avoids a round-trip and keeps the popup's render path single.
`getState` returns, in addition to `workspaces` and `activeWorkspaceId`:

- `activeTab: { url, title, favIconUrl, trackable }` for the working window's
  active tab (resolved via `getCurrentWindowId()`), or `null` if none can be
  read.

---

## Feature 3 — Inline rename + hover-revealed icons

Each workspace row gains a pencil (✎) before the delete (✕):
`dot · label · count · ✎ · ✕`.

### Behaviour

- Click ✎ (with `stopPropagation`, so it does not trigger the row's switch).
- Replace the label span with an autofocused `<input>`, its text pre-selected,
  seeded with the current name.
- **Enter** or **blur** → send `rename { id, name }`, then re-render.
- **Esc** → cancel, re-render with the old name.
- **Blank** → the existing `renameWorkspace` handler already keeps the old name,
  so a blank save is a safe no-op revert.

The `rename` message and `renameWorkspace` handler already exist in
`background.js`; this is popup wiring plus CSS.

### Icon visibility (CSS)

- ✎ and ✕ are hidden at rest and revealed on `.item:hover`.
- On `.item.active` they stay visible always.

---

## Invariants honoured

- **1 (never empty the window):** last-tab guard opens a blank tab before the
  move closes the only tab.
- **4 (Default never tracks/closes):** move in Default state stashes without a
  source sync.
- **5 (only http/https tracked):** trackable guard rejects chrome:// moves.
- **6 (target is the working window):** active tab resolved via
  `getCurrentWindowId()`, never the popup window.
- **7 (all state via getState/setState):** stash and create persist through
  `setState`.

## Testing

No automated harness exists yet. Manual smoke steps to add to README:

1. **Move to existing.** In workspace A (3 tabs), move the active tab to B. The
   tab closes in the window; A shows 2 tabs; B's saved count goes up by one;
   switching to B opens that tab.
2. **Move to new.** Move the active tab to `＋ New workspace…` named "C". A drops
   the tab; a new workspace C exists with 1 saved tab; you remain in A.
3. **Last-tab guard.** With a single tab open, move it away. The window keeps a
   blank tab; the moved URL lands in the target.
4. **Non-trackable.** On a chrome:// page, the strip is disabled with a hint.
5. **Rename.** ✎ → edit → Enter saves; ✎ → Esc cancels; ✎ → clear → save reverts
   to the old name.

If the move core grows beyond trivial, add a lightweight logic harness for it
rather than extending this manual list.

---

## Parked ideas (not in this spec)

1. **In-page overlay chooser for inbound external links.** Detect new top-level
   http/https tabs with no `openerTabId` (best effort — Chrome gives no clean
   "opened by an external app" signal) and inject an overlay asking which
   workspace to route the link into. Approximate by nature; needs heuristics to
   avoid prompting on every manual new tab.
2. **Choosy-style custom-browser hook.** Register a pseudo-browser (à la Choosy)
   that appends a query parameter the extension reads to pick a workspace.
3. **Context-menu move (Option C).** Right-click → "Move to workspace ▸" submenu
   (+ "New workspace…"). Most Safari-like, reuses the `moveTab` plumbing, but
   needs the `contextMenus` permission.
