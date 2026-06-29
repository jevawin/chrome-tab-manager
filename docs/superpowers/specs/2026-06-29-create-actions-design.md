# Design: remove Detach, add "Start empty", mandatory names

Date: 2026-06-29
Status: approved (pre-implementation)

## Problem

Detach (the `activeWorkspaceId === null` parking state, reached by a button)
confused its purpose. The real need is **starting a fresh space**. Replace the
Detach button with a clear pair of create actions and tighten name handling.

## Goals

1. Remove the user-facing Detach button.
2. Offer two ways to create a workspace:
   - **Save current tabs** — snapshot the current window into a new workspace.
   - **Start empty** — swap into a new, empty workspace (fresh window).
3. Make the workspace name mandatory.
4. Fix tab-count pluralisation ("1 tab", not "1 tabs").
5. Restructure the popup layout.

Out of scope: per-window workspaces, shared pinned tabs, rename UI, multi-window.

## Decisions resolved

- **Detach**: removed (was open decision #2 in CLAUDE.md). The literal-spec
  behaviour — switching always swaps tabs — is restored. No user-facing
  no-track parking state remains.
- **Window scope**: stays global (open decision #1 — unchanged).
- **Pinned tabs**: stay per-workspace (open decision #3 — unchanged).

## Design

### 1. Remove Detach (user-facing only)

- `popup.html`: delete the `.default-row` div and its Detach button.
- `popup.js`: delete the detach click handler.
- `background.js`: delete the `detach()` function and the `detach` message case.

**Keep the internal null state.** `activeWorkspaceId === null` is still reachable
internally: fresh install starts null, and `deleteWorkspace` sets it to null when
the active workspace is deleted. Invariant 4 ("Default / null never closes or
tracks tabs") stays in force. Only the button that deliberately entered that
state is removed — the guard logic in `syncNow` and `switchWorkspace` is
untouched.

### 2. "Start empty" — new action

New message `createEmpty { name }` handled in `background.js`:

1. Create a new workspace `{ id, name: name.trim(), tabs: [] }` and push it.
2. Persist, then call the existing `switchWorkspace(newId)`.

No new swap logic. Because the target has no tabs, `switchWorkspace`:
- saves the workspace being left (if any) while its tabs are still open,
- sets the swap guard,
- opens one blank new-tab page (its existing empty-target branch),
- closes the old tabs,
- marks the new workspace active,
- releases the guard in `finally`.

The result: the user lands in a fresh, empty, tracked workspace.

### 3. "Save current tabs" — unchanged behaviour

Keeps the existing `create` action: snapshot the current window into a new
workspace and make it active, **without** closing or swapping tabs. The two
buttons differ exactly as: *keep these tabs as a space* vs *leave for a fresh
space*.

### 4. Mandatory name

- **Popup (primary):** both create buttons are disabled until the name field
  contains non-whitespace text. Enable/disable on `input`. No error copy needed.
- **Background (backstop):** `create` and `createEmpty` reject a blank or
  whitespace-only name, returning `{ ok: false, error }`. Remove the old
  `(name && name.trim()) || "Workspace"` default in `createWorkspace`; use the
  trimmed name directly.
- **Duplicate names:** allowed. Not worth blocking.

### 5. UI layout

```
Workspaces
  ● XYZ        2 tabs   ✕
    ZYX        1 tab    ✕
  ─────────────────────────
  Create new workspace
  [ Workspace name              ]
  [ Save current tabs ][ Start empty ]
```

- Existing list rendering unchanged except pluralisation (below).
- Add a divider and a "Create new workspace" sub-heading above the input.
- Two buttons side by side under the input: "Save current tabs", "Start empty".
- Empty-list message ("No workspaces yet…") stays.

### 6. Pluralisation

In `popup.js` render, the per-row count becomes `n === 1 ? "1 tab" : n + " tabs"`.

### 7. Docs

Update `CLAUDE.md`:
- Mark Detach (open decision #2) resolved: removed.
- Drop `detach` from the message protocol; add `createEmpty { name }`.
- Note both create actions and the mandatory-name rule.

## Message protocol (after change)

- `getState` -> `{ workspaces, activeWorkspaceId }`
- `create { name }` -> snapshot current window into a new active workspace (no swap)
- `createEmpty { name }` -> create empty workspace, then swap into it
- `switch { id }` -> swap
- `delete { id }` -> remove; clears active if it was active
- `rename { id, name }` -> rename (no UI)
- ~~`detach`~~ removed

## Invariants — still hold

All seven invariants in CLAUDE.md remain. "Start empty" goes through
`switchWorkspace`, so invariants 1–3 (open before close, mute tracking during
swap, save outgoing first) are inherited. Invariant 4 (null never closes tabs)
stays as an internal safe state.

## Testing

Manual smoke tests (no automated harness yet):

1. **Start empty swaps cleanly.** With workspace A active (3 tabs), type a name,
   click Start empty. A's 3 tabs close, one blank tab opens, new space is active.
   Switch back to A — its 3 tabs return. (Outgoing save + swap guard intact.)
2. **Save current keeps tabs.** Open 2 tabs, type a name, Save current tabs. The
   2 tabs stay open and are now tracked under the new active workspace.
3. **Mandatory name.** Both buttons disabled with an empty or whitespace-only
   name field; enabled once real text is typed.
4. **Pluralisation.** A 1-tab workspace shows "1 tab"; others show "N tabs".
5. **Core swap guard (regression).** The existing A/B test from CLAUDE.md still
   passes (new tab added in A survives a round trip to B and back).
