# CLAUDE.md

Context for Claude Code working on this project. Read this first.

**Keep this file current.** When you add a feature, change the architecture, add
a message type, alter the data model, or add tooling, update the matching section
here (File map, Data model, Message protocol, Run and test, Invariants) in the
same change. Stale docs here are worse than none. Prune notes that no longer hold.

## What this is

A Chrome extension (Manifest V3) that gives Safari-style **workspaces**. Switch a
workspace and every tab in the current window swaps out: the old tabs close, the
workspace's tabs open. The active workspace also tracks tab changes live, so it
behaves like saved session state, not a static bookmark list.

It exists because Chrome's native tab groups show all groups at once. They do not
swap. This rebuilds the Safari "tab groups bound to a window" feel.

## Naming (undecided)

Working name is "Spaces — Workspace Swap". Candidates to pick from later:

- **Stagehand** — each workspace is a scene; switching swaps the whole set in and
  out behind the curtain. Fits the swap, no tab-pun fatigue.
- **Tabula** — pun on "tab" + tabula rasa (blank slate); nods at Start empty.
- **Poof** — old tabs go poof, new set appears. Playful, low-key.
- **Hopscotch** — hop between spaces. Bouncy, hints at quick switching.

Repo: `git@github.com:jevawin/chrome-tab-manager.git`.

## Stack and constraints

- Manifest V3. Service worker background, not a persistent page.
- Vanilla JS. No build step, no bundler, no dependencies, no framework.
- No TypeScript. Keep it plain so it loads unpacked with zero tooling.
- Permissions: `tabs`, `storage` only. Do not add more without a clear reason.
- Target: desktop Chrome. Author works on macOS.

## File map

- `manifest.json` — MV3 manifest. Popup + service worker.
- `background.js` — all state, live tracking, the swap. The brain.
- `popup.html` / `popup.css` / `popup.js` — the dropdown UI. Thin. Sends
  messages to the background and renders state.
- `README.md` — user-facing load and usage notes.
- `tests/move.test.js` — Node unit test for the pure state helpers.
- `test/harness.html` — local visual test harness for the popup (gitignored).

The popup holds no logic beyond rendering and sending messages. All decisions
live in `background.js`. Keep it that way.

## Data model

Persistent state in `chrome.storage.local`:

```
{
  workspaces: [
    { id: string (uuid), name: string, tabs: [{ url: string, pinned: boolean }] }
  ],
  activeWorkspaceId: string | null
}
```

Transient guard in `chrome.storage.session`:

```
{ swapping: boolean }
```

`activeWorkspaceId === null` means the **Default** state: no workspace is tracked,
and nothing gets closed automatically. It is no longer user-reachable on purpose
(Detach was removed); it occurs only on fresh install or after deleting the active
workspace.

## How it works

### Live tracking (auto-save)
`scheduleSync()` debounces (~400ms) on `tabs.onCreated`, `onRemoved`, `onMoved`,
and URL/`complete` `onUpdated`. `syncNow()` snapshots the current window into the
active workspace via `snapshotInto()`.

It is muted when:
- a swap is in progress (`swapping === true`), or
- no workspace is active (`activeWorkspaceId === null`).

### The swap (`switchWorkspace`)
1. Save the workspace being left, while its tabs are still open.
2. Set `swapping = true`.
3. Capture old tab ids in the current window.
4. Open the target workspace's tabs (or one blank tab if empty).
5. Close the old tabs.
6. Set `activeWorkspaceId` to the target.
7. Set `swapping = false` (in a `finally`, always).

## Invariants — do not break these

1. **Open new tabs before closing old ones.** Closing the last tab closes the
   window. The window must never reach zero tabs mid-swap.
2. **Mute live tracking during a swap.** Without the `swapping` guard, the close
   events from the swap would feed back into auto-save and wipe the workspace you
   are leaving. This is the central bug the design exists to prevent.
3. **Save the outgoing workspace before closing its tabs.** Otherwise its state
   is lost on switch.
4. **Default (`activeWorkspaceId === null`) never closes or tracks tabs.** It is a
   safe internal state (fresh install, or after deleting the active workspace).
5. **Only http/https tabs are tracked.** chrome:// and extension pages cannot be
   reliably reopened, so `isTrackableUrl()` filters them out.
6. **The target window is the last focused normal window**, resolved by
   `getCurrentWindowId()` (queries the active tab). Never use the popup's own
   window.
7. **All persistent state goes through `getState` / `setState`.** The service
   worker can unload at any time, so never rely on module-level variables for
   anything that must survive. The debounce timer is the one allowed exception
   and it is best-effort.

## Message protocol (popup -> background)

`chrome.runtime.sendMessage({ type, ... })`. Handler returns `true` to keep the
async channel open.

Workspace names are mandatory. The popup disables both create buttons until the
name field has non-whitespace text; `create`/`createEmpty` reject blank names.

- `getState` -> returns `{ workspaces, activeWorkspaceId, activeTab }` where
  `activeTab` is `{ url, title, favIconUrl, trackable } | null` for the move strip.
- `create` `{ name }` -> "Save current tabs": snapshots current window into a new
  workspace, makes it active. Does not swap.
- `createEmpty` `{ name }` -> "Start empty": creates an empty workspace, then runs
  the swap into it (closes current tabs, opens one blank tab).
- `switch` `{ id }` -> runs the swap
- `moveTab` `{ targetId }` -> moves the working window's active tab into an
  existing workspace (stash + close the live tab). No swap. Rejects non-http/https
  tabs and the active workspace as target.
- `moveTabToNew` `{ name }` -> creates a new workspace seeded with the active tab,
  then stashes it. No swap. Stays in the current workspace.
- `delete` `{ id }` -> removes a workspace; clears active if it was active
- `rename` `{ id, name }` -> renames a workspace (inline pencil-edit in the popup)

## Run and test

No build. Load unpacked:
1. `chrome://extensions` -> Developer mode on -> Load unpacked -> this folder.
2. After editing the service worker, click the reload icon on the extension card.
3. After editing the popup only, just reopen the popup.

Manual smoke test for the core guard:
1. Open 3 tabs. Save as "A".
2. Open 2 different tabs. Save as "B".
3. Click A. B's tabs should close, A's should open.
4. In A, open a new tab. Switch to B, then back to A. The new tab must still be
   in A. If it is, the swap guard works.

Pure state logic has a small Node test (`tests/move.test.js`). Run it with
`node --test` (auto-discovers test files; `node --test tests/` fails on Node 24).
Code that touches `chrome.*` APIs is verified by the manual smoke steps above —
keep pure, testable logic separate from the Chrome calls so it can be unit-tested.

### Visual test harness (popup)

The popup can't run in a plain page because `chrome.runtime` doesn't exist.
`test/harness.html` (gitignored, local-only) stubs `chrome.*` with sample data
and loads the **real** `popup.html` markup + `popup.js` + `popup.css`. It fetches
`popup.html` rather than copying it, so it never drifts. Use it to eyeball layout
and interactions (it already caught a real `[hidden]` CSS bug):

```
python3 -m http.server 8731     # file:// is blocked; serve over HTTP
# open http://localhost:8731/test/harness.html
```

Query params switch state: `?state=untrackable` (chrome:// active tab, strip
disabled) and `?state=empty` (no workspaces). The harness uses a stubbed
`chrome`, so real favicon loading and live tab data still need a real Chrome load.

## Known limitations (v1)

- Single window. Tracks the last focused normal window only. Multi-window is not
  handled.
- The MV3 service worker can unload mid-debounce, dropping a pending auto-save.
  It recovers on the next tab event.
- No reorder, no rename UI, no icons, no sync across machines.
- Pinned state is saved per tab but pinned tabs are not shared across workspaces.

## Open decisions (ask the user before assuming)

1. **Per-window workspaces.** Should each Chrome window remember its own active
   workspace, or stay global (current)? This is the biggest architectural fork.
   _Resolved 2026-06-29: stays global._
2. **Pinned tabs.** Should pinned tabs persist across all workspaces instead of
   being per-workspace? _Resolved 2026-06-29: stays per-workspace._

### Resolved

- **Detach removed (2026-06-29).** The Detach button is gone; switching always
  swaps tabs (the literal spec). To start fresh, use "Start empty" instead.
  `activeWorkspaceId === null` survives only as an internal safe state (fresh
  install, or after deleting the active workspace) — invariant 4 still holds.

## Style

- Plain functions, async/await, early returns.
- Comments explain *why*, not *what*, especially around the swap and the guard.
- Keep the popup dumb. New behaviour belongs in `background.js`.
- Icons are inlined [Lucide](https://lucide.dev) SVGs (ISC), `stroke="currentColor"`
  so they inherit text color. No icon dependency, no build step. In `popup.js`
  they are SVG strings (`ICON_EDIT`/`ICON_TRASH`); in `popup.html` they are inline
  `<svg>`; the move-to dropdown indicator is a `list-end` data-URI background on
  the `<select>` (`appearance: none`).