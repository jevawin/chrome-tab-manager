# Per-workspace icons — design

Each workspace can carry its own icon, picked from the Lucide set, shown as the
leading glyph of its row in the popup. Backward compatible: workspaces without an
icon render a default sentinel.

This spec is the agreed design. It precedes the implementation plan.

## Goals

- A workspace can have an identity icon, chosen from a broad Lucide set.
- The icon shows as the row's leading glyph (replacing the old active dot).
- Picking is discoverable from the three places a workspace name is set/edited.
- No new permissions, no build step, no runtime dependency, popup stays "dumb".

## Non-goals

- No icon sync across machines (storage stays `chrome.storage.local`).
- No custom/uploaded icons. Lucide set only.
- No reordering or colour theming of icons.

## Constraints (inherited)

- Manifest V3, vanilla JS, no bundler, no framework, no runtime dependencies.
- Permissions stay `tabs` + `storage`.
- All persistent state goes through `getState` / `setState`.
- The popup renders and sends messages only. All state decisions live in
  `background.js`. The picker is pure presentation and adds neither.

## Data model

Add an optional `icon` field to each workspace record:

```
workspaces: [
  {
    id: string,
    name: string,
    tabs: [{ url, pinned }],
    icon?: { name: string, paths: string }   // optional
  }
]
```

- `icon.name` is the Lucide icon name (e.g. `"rocket"`), kept so the picker can
  highlight the current selection.
- `icon.paths` is the icon's inner SVG path markup, stored so a row renders
  **without** loading the full icon dataset.
- `icon` absent → render the default sentinel (`square-dashed`). Every existing
  workspace is therefore valid as-is; this is the backward-compatible default.

### Why store `paths`, not just the name

A row's leading icon must render the instant the popup opens. The full icon
dataset is lazy-loaded only when the picker opens (see below). Storing the path
markup on the record means rendering is `ICON_SVG(ws.icon.paths)` with zero
lookup and no dataset load at rest. Storing only the name would force the full
dataset to load on every popup open as soon as any workspace had a custom icon,
defeating the lazy-load.

Trade-off accepted: a few hundred extra bytes per workspace in storage, and an
already-chosen icon keeps its stored path if Lucide later redraws that glyph
(until the user re-picks it). Both are fine; stable icons are arguably desirable.

## The icon dataset

A static, committed module `icon-data.js` exporting an array:

```
export default [
  { name: "rocket", category: "...", tags: ["launch", ...], paths: "<path .../>" },
  ...
]
```

- Full Lucide set, minus the exclusion list below.
- Lazy-loaded via `await import('./icon-data.js')` on first picker open, cached
  for the popup's lifetime. The normal popup render never loads it.
- `category` drives the grouped view; `tags` + `name` drive search.

### Excluded icons (not pickable)

The app's own UI icons, plus the default sentinel, are filtered out at generation
time so they can't be picked:

`square-pen`, `trash-2`, `save`, `folder-plus`, `list-end`, `check`, `folder`,
`square-dashed`.

### Generator (dev-only)

A Node script, `tools/gen-icon-data.mjs`, reads Lucide's published metadata (icon
SVG path data + `tags` + `categories`), applies the exclusion list, and writes
`icon-data.js`. It is run manually, not shipped, and is not a runtime dependency
— same spirit as the documented `rsvg-convert` PNG regeneration. It pulls Lucide
via `npx --yes` against a pinned `lucide-static` version, so nothing lands in the
repo except the generated `icon-data.js`. It gets its own regen command in
`CLAUDE.md`.

## The icon picker (shared overlay)

One picker, invoked from every context. Pure presentation; lives in `popup.js`.
It performs no Chrome calls and holds no persistent state — it opens, returns a
chosen `{ name, paths }` (or nothing on dismiss) to its caller.

Layout — a full-width overlay (inside the popup, minus padding) over a scrim:

```
┌─────────────────────────────────────┐  ← scrim darkens the rest of the popup
│  [🔍  search icons…            ]  ✕  │  ← search pinned at top
│  ─────────────────────────────────── │
│  Accessibility                       │  ← category header
│  [▣][▣][▣][▣][▣][▣]                   │  ← icon grid, click = pick
│  Arrows                              │
│  [▣][▣][▣][▣][▣][▣]                   │
│  …scrolls…                           │
└─────────────────────────────────────┘
```

- **Loading state.** Because the dataset is lazy-imported, the picker opens into a
  centred loading state — a Lucide loader (`loader-circle` or `loader-pinwheel`)
  with a CSS `rotate` animation — swapped for the grid once the dataset resolves.
  If the import fails, that area shows a short "Couldn't load icons" message
  instead of spinning forever.
- **Search.** Real-time filter over each icon's `name` + `tags`, so synonyms like
  "bin", "rubbish", "delete" all surface the trash-type icons (note `trash-2`
  itself is excluded, but other trash variants remain). While a search is active,
  category headers collapse to a flat result list; clearing the search restores
  the grouped view.
- **Pick.** Clicking an icon closes the overlay and returns `{ name, paths }` to
  the opener.
- **Dismiss.** ✕, scrim click, or Esc returns nothing; the opener keeps its
  current icon.

## Where the picker is invoked — the icon-box

A small reused **icon-box**: a square button showing an icon; click opens the
picker; the picked icon updates the box. Three placements:

1. **Create form** — icon-box left of `#name` (`[▣] [ Workspace name ]`). Starts on
   the default sentinel. The chosen icon is held in popup state and sent with
   `create` / `createEmpty`.
2. **Move → New workspace** — icon-box left of `#moveNewName`, sent with
   `moveTabToNew`.
3. **Rename mode on a row** — when the pencil swaps the label for the rename
   input, an icon-box appears to its left (`[▣] [ name input ] …`). Picking here
   applies immediately via `setIcon` (so it persists even if the name edit is
   cancelled). Rows at rest are unchanged: the leading slot shows the icon and is
   not clickable.

## Row rendering and active state

- **Leading slot.** `ICON_SVG(ws.icon.paths)` when `icon` is set, else the
  `square-dashed` sentinel. This replaces the old `.dot` element entirely.
- **Active signals** (the dot is gone):
  - The label stays **bold blue** (`.item.active .label`) — unchanged.
  - The count's folder glyph renders **fully solid** (whole body filled), instead
    of today's tab-flap-only fill. This mimics Chrome's active-tab look and is a
    fill change, not a colour tint. So `ICON_FOLDER` gains an active variant;
    inactive rows keep the flap-only fill.
- **Neutral elsewhere.** The leading icon and the count both stay `--fg`
  (identity, not state). Only the label carries the blue tint. The
  green-on-hover count tint is untouched and applies to whichever fill variant is
  showing.

## Message protocol changes

Icon rides along where each name already travels; existing rows apply
immediately.

- `create { name, icon }` — `icon` is `{ name, paths }` or omitted (omitted →
  record has no `icon`, renders default).
- `createEmpty { name, icon }` — same.
- `moveTabToNew { name, icon }` — same.
- `setIcon { id, icon }` — **new.** Fired when an icon is picked in a row's rename
  mode. Sets the record's icon through `getState`/`setState`. Validates the
  workspace exists; ignores unknown ids.
- `rename { id, name }` — unchanged. Name and icon are independent edits.

Background-side: `createWorkspace`, `createEmptyWorkspace`, and the move-to-new
path accept an optional `icon` and set it on the record only when present. A new
`setWorkspaceIcon(id, icon)` mutates the one record like the other mutators. No
new permissions.

### Icon validation

A pure helper normalizes/validates an incoming icon before it is stored:

- Accepts `{ name: string, paths: string }`.
- Rejects malformed input (missing fields, non-strings) and oversized `paths`
  (guard against absurd payloads) → treated as "no icon".
- Absent / rejected → the record gets no `icon` field and renders the default.

This keeps validation in pure, testable code, with the Chrome calls separate.

## Testing

- **Pure helpers** (`tests/`, `node --test`): the icon validator/normalizer —
  accepts `{ name, paths }`, rejects malformed/oversized input, returns the
  default-sentinel behaviour when absent.
- **Action tests** (in-memory `chrome` fake): `setIcon` sets/updates a record's
  icon; `create` / `createEmpty` / `moveTabToNew` persist a passed icon and omit
  it when absent; backward-compat — a workspace with no `icon` loads and renders
  the default.
- **Generator check**: `icon-data.js` parses; every entry has
  `name`/`category`/`tags`/`paths`; none of the excluded names are present.
- **Visual harness** (`test/harness.html`): extend the stubbed sample data so
  some workspaces carry icons and one is active, to eyeball the leading icon, the
  solid-fill active count, and the picker overlay (the stubbed `chrome` is fine —
  the picker is pure UI). Add a `?state=picker` param to open straight into the
  overlay.

## File map impact

- `background.js` — optional `icon` on create paths; new `setWorkspaceIcon` +
  `setIcon` message; pure icon validator.
- `popup.js` — leading-icon render; active solid-fill count variant; the
  icon-box; the picker overlay + lazy `import()` + loading state; icon in the
  create / move-new / rename flows.
- `popup.html` / `popup.css` — icon-box markup/styles; picker overlay + scrim +
  loader styles; remove `.dot`, add the active count variant.
- `icon-data.js` — **new**, generated, committed.
- `tools/gen-icon-data.mjs` — **new**, dev-only generator.
- `tests/` — icon validator + action tests.
- `CLAUDE.md` — data model, message protocol, file map, generator regen command,
  known-limitations update.

## Invariants

No swap/tracking invariants change. The icon is presentation-and-identity only;
it never affects the swap, the live-tracking guard, or which window is targeted.
New rule to keep: **a row's leading icon must render without loading the icon
dataset** (hence `paths` on the record).
