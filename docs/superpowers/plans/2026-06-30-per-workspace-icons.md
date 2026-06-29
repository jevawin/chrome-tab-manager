# Per-workspace Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each workspace an optional Lucide icon, shown as its row's leading glyph in the popup and pickable from a searchable overlay.

**Architecture:** Add an optional `icon: { name, paths }` to each workspace record (path markup stored so a row renders without loading the full icon set). A committed `icon-data.json` (generated from Lucide by a dev-only script) is lazy-fetched only when the picker opens. The popup stays presentation-only; all state mutations go through `background.js` via `getState`/`setState`.

**Tech Stack:** Manifest V3 Chrome extension, vanilla JS, no build step, no bundler, no runtime dependencies. Node's built-in test runner (`node --test`) for pure helpers and action tests against an in-memory `chrome` fake. `test/harness.html` for visual verification of the popup.

## Global Constraints

- Manifest V3; vanilla JS; no build step, no bundler, no framework, no runtime dependencies.
- Permissions stay `tabs` + `storage`. Do not add any.
- All persistent state goes through `getState` / `setState`. Never rely on module-level variables for anything that must survive the service worker unloading.
- The popup renders and sends messages only. All state decisions live in `background.js`. The picker is pure presentation — no Chrome calls, no persistent state.
- A row's leading icon MUST render without loading `icon-data.json` (hence `paths` stored on the record, and the default sentinel hardcoded in `popup.js`).
- Dev-only logging via `dlog()` / `derror()`, never raw `console.log`.
- Excluded-from-picker icon names (the app's own UI icons + the default sentinel): `square-pen`, `trash-2`, `save`, `folder-plus`, `list-end`, `check`, `folder`, `square-dashed`.
- Node test invocation is per-file: `node --test tests/<file>` (`node --test tests/` fails on Node 24).
- **After editing `background.js` you MUST reload the extension card** at `chrome://extensions` (the MV3 worker caches old code).

---

## File Structure

- `background.js` (modify) — pure `normalizeIcon()` validator; optional `icon` on `createWorkspace` / `createEmptyWorkspace` / `moveActiveTabToNew`; new `setWorkspaceIcon()` + `setIcon` message; export the new pure/action functions for tests.
- `tests/fake-chrome.js` (create) — the in-memory `chrome` fake, extracted from `move-actions.test.js` so the new action test can reuse it.
- `tests/move-actions.test.js` (modify) — import the fake from `tests/fake-chrome.js` instead of defining it inline.
- `tests/icon.test.js` (create) — unit tests for `normalizeIcon`.
- `tests/icon-actions.test.js` (create) — action tests for icon persistence against the fake.
- `tools/gen-icon-data.mjs` (create) — dev-only generator that writes `icon-data.json` from a pinned Lucide release.
- `icon-data.json` (create, generated, committed) — `[{ name, category, tags, paths }]`.
- `tests/icon-data.test.js` (create) — sanity checks on the generated dataset.
- `popup.js` (modify) — leading-icon render; active solid-fill count variant; the default sentinel + loader consts; the icon-box; the picker overlay (lazy fetch, loading state, search, category grouping); icon wired into the create / move-new / rename flows.
- `popup.html` (modify) — icon-box markup in the create form and move-new row; the picker overlay container.
- `popup.css` (modify) — remove `.dot`; add `.ws-icon`, `.icon-box`, picker overlay + scrim + loader styles.
- `CLAUDE.md` (modify) — data model, message protocol, file map, generator regen command, known-limitations update.

---

### Task 1: Pure icon validator (`normalizeIcon`)

**Files:**
- Modify: `background.js` (add `normalizeIcon` near `cleanName` at line 138; extend the `module.exports` at line 376)
- Test: `tests/icon.test.js`

**Interfaces:**
- Produces: `normalizeIcon(icon) -> { name: string, paths: string } | null`. Accepts an unknown value; returns a clean `{ name, paths }` or `null` when invalid. Rejects missing/non-string fields, blank fields, and `paths` longer than `MAX_ICON_PATHS` (4096).

- [ ] **Step 1: Write the failing test**

Create `tests/icon.test.js`:

```js
// background.js registers chrome listeners at load; stub them so require() succeeds.
globalThis.chrome = {
  tabs: { onCreated: { addListener() {} }, onRemoved: { addListener() {} }, onMoved: { addListener() {} }, onUpdated: { addListener() {} } },
  runtime: { onMessage: { addListener() {} } },
};

const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeIcon } = require("../background.js");

test("normalizeIcon returns a clean {name, paths} for valid input", () => {
  const out = normalizeIcon({ name: "rocket", paths: "<path d=\"M1 1\"/>", extra: "ignored" });
  assert.deepStrictEqual(out, { name: "rocket", paths: "<path d=\"M1 1\"/>" });
});

test("normalizeIcon rejects missing or non-string fields", () => {
  assert.strictEqual(normalizeIcon({ name: "rocket" }), null);
  assert.strictEqual(normalizeIcon({ paths: "<path/>" }), null);
  assert.strictEqual(normalizeIcon({ name: 1, paths: "<path/>" }), null);
  assert.strictEqual(normalizeIcon({ name: "x", paths: 2 }), null);
});

test("normalizeIcon rejects blank fields", () => {
  assert.strictEqual(normalizeIcon({ name: "   ", paths: "<path/>" }), null);
  assert.strictEqual(normalizeIcon({ name: "x", paths: "   " }), null);
});

test("normalizeIcon rejects oversized paths", () => {
  assert.strictEqual(normalizeIcon({ name: "x", paths: "<path/>".repeat(1000) }), null);
});

test("normalizeIcon returns null for null/undefined/non-object", () => {
  assert.strictEqual(normalizeIcon(null), null);
  assert.strictEqual(normalizeIcon(undefined), null);
  assert.strictEqual(normalizeIcon("rocket"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/icon.test.js`
Expected: FAIL — `normalizeIcon is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

In `background.js`, immediately after `cleanName` (ends at line 141), add:

```js
// Cap on stored icon path markup — guards storage against absurd payloads.
const MAX_ICON_PATHS = 4096;

// Validate/normalize an icon picked in the popup before it is stored.
// Returns a clean { name, paths } or null (null => the record gets no icon and
// renders the default sentinel). Kept pure so it is unit-testable without Chrome.
function normalizeIcon(icon) {
  if (!icon || typeof icon !== "object") return null;
  const { name, paths } = icon;
  if (typeof name !== "string" || typeof paths !== "string") return null;
  if (!name.trim() || !paths.trim()) return null;
  if (paths.length > MAX_ICON_PATHS) return null;
  return { name, paths };
}
```

Then extend the export at line 376:

```js
  module.exports = { buildMovedState, moveActiveTab, moveActiveTabToNew, normalizeIcon };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/icon.test.js`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add background.js tests/icon.test.js
git commit -m "feat: normalizeIcon validator for per-workspace icons"
```

---

### Task 2: Extract the in-memory chrome fake

Refactor only — no behavior change. Moves the fake so Task 3's action test can reuse it (DRY).

**Files:**
- Create: `tests/fake-chrome.js`
- Modify: `tests/move-actions.test.js:9-71` (replace the inline `pick` + `makeChrome` with an import)

**Interfaces:**
- Produces: `makeChrome({ local, tabs }) -> fakeChrome`. The fake exposes `storage.local/session`, `tabs.query/create/remove`, listener no-ops, and `_peek.{local,session,tabs}()` for assertions. Identical behavior to the current inline version.

- [ ] **Step 1: Create `tests/fake-chrome.js`**

Move the `pick` helper and `makeChrome` factory verbatim out of `move-actions.test.js` (lines 30–71) into a new module:

```js
// In-memory chrome fake for action tests (storage + tabs), deep-copying on
// get/set like real storage. Extracted so multiple test files can share it.
const noopListener = { addListener() {} };

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (k in obj) o[k] = obj[k];
  return o;
}

function makeChrome({ local = {}, tabs = [] }) {
  const localStore = structuredClone({ workspaces: [], activeWorkspaceId: null, ...local });
  const sessionStore = { swapping: false };
  let tabStore = structuredClone(tabs);
  let nextId = Math.max(0, ...tabStore.map((t) => t.id)) + 1;

  const query = (q = {}) => {
    let res = tabStore.slice();
    if (q.windowId != null) res = res.filter((t) => t.windowId === q.windowId);
    if (q.active) res = res.filter((t) => t.active);
    return Promise.resolve(structuredClone(res));
  };

  return {
    storage: {
      local: {
        get: (defaults) => Promise.resolve(structuredClone({ ...defaults, ...pick(localStore, Object.keys(defaults)) })),
        set: (patch) => { Object.assign(localStore, structuredClone(patch)); return Promise.resolve(); },
      },
      session: {
        get: (defaults) => Promise.resolve({ ...defaults, ...pick(sessionStore, Object.keys(defaults)) }),
        set: (patch) => { Object.assign(sessionStore, patch); return Promise.resolve(); },
      },
    },
    tabs: {
      query,
      create: (props) => {
        const t = { id: nextId++, windowId: props.windowId, url: props.url || "", active: false, pinned: !!props.pinned };
        tabStore.push(t);
        return Promise.resolve(structuredClone(t));
      },
      remove: (ids) => {
        const arr = Array.isArray(ids) ? ids : [ids];
        const closedActive = tabStore.some((t) => arr.includes(t.id) && t.active);
        tabStore = tabStore.filter((t) => !arr.includes(t.id));
        if (closedActive && tabStore.length && !tabStore.some((t) => t.active)) {
          tabStore[tabStore.length - 1].active = true;
        }
        return Promise.resolve();
      },
      onCreated: noopListener, onRemoved: noopListener, onMoved: noopListener, onUpdated: noopListener,
    },
    runtime: { onMessage: noopListener },
    _peek: { local: () => localStore, session: () => sessionStore, tabs: () => tabStore },
  };
}

module.exports = { makeChrome };
```

- [ ] **Step 2: Rewire `move-actions.test.js`**

In `tests/move-actions.test.js`, delete the inline `pick` function and the `makeChrome` function (lines 30–71), and delete the `noopListener` const and the `globalThis.chrome = {...}` stub on lines 9–14 IF and ONLY IF they are not referenced elsewhere in the file. Keep the `globalThis.chrome` stub that lets `require("../background.js")` succeed at load — `background.js` registers listeners at import. Replace the removed factory with an import at the top, just after the `assert` require:

```js
const { makeChrome } = require("./fake-chrome");
```

The load-time stub must stay before `require("../background.js")`:

```js
const noopListener = { addListener() {} };
globalThis.chrome = {
  tabs: { onCreated: noopListener, onRemoved: noopListener, onMoved: noopListener, onUpdated: noopListener },
  runtime: { onMessage: noopListener },
};
const { moveActiveTab, moveActiveTabToNew } = require("../background.js");
const { makeChrome } = require("./fake-chrome");
```

- [ ] **Step 3: Run the existing action tests — must stay green**

Run: `node --test tests/move-actions.test.js`
Expected: PASS — same tests as before, all passing (proves the extraction is behavior-preserving).

- [ ] **Step 4: Commit**

```bash
git add tests/fake-chrome.js tests/move-actions.test.js
git commit -m "refactor: extract in-memory chrome fake for reuse in tests"
```

---

### Task 3: Persist icons in background actions + `setIcon` message

**Files:**
- Modify: `background.js` — `createWorkspace` (145), `createEmptyWorkspace` (166), `moveActiveTabToNew` push (310), new `setWorkspaceIcon`, router (338–362), exports (376)
- Test: `tests/icon-actions.test.js`

**Interfaces:**
- Consumes: `normalizeIcon` (Task 1), `makeChrome` (Task 2).
- Produces:
  - `createWorkspace(name, icon?)` — sets `ws.icon` only when `normalizeIcon(icon)` is truthy.
  - `createEmptyWorkspace(name, icon?)` — same.
  - `moveActiveTabToNew(name, icon?)` — same on the seeded workspace.
  - `setWorkspaceIcon(id, icon) -> void` — sets `ws.icon` when valid, deletes it when invalid/absent; no-op for unknown id.
  - Message `setIcon { id, icon }` -> `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

Create `tests/icon-actions.test.js`:

```js
const noopListener = { addListener() {} };
globalThis.chrome = {
  tabs: { onCreated: noopListener, onRemoved: noopListener, onMoved: noopListener, onUpdated: noopListener },
  runtime: { onMessage: noopListener },
};

const { test } = require("node:test");
const assert = require("node:assert");
const { makeChrome } = require("./fake-chrome");
const { createWorkspace, setWorkspaceIcon, moveActiveTabToNew } = require("../background.js");

const ICON = { name: "rocket", paths: "<path d=\"M1 1\"/>" };
const oneWindow = () => [
  { id: 1, windowId: 1, url: "https://a.com/", active: true, pinned: false },
  { id: 2, windowId: 1, url: "https://b.com/", active: false, pinned: false },
];

test("createWorkspace stores a valid icon on the new record", async () => {
  const fake = makeChrome({ tabs: oneWindow() });
  globalThis.chrome = fake;
  const ws = await createWorkspace("A", ICON);
  const stored = fake._peek.local().workspaces.find((w) => w.id === ws.id);
  assert.deepStrictEqual(stored.icon, ICON);
});

test("createWorkspace omits icon when none/invalid is passed", async () => {
  const fake = makeChrome({ tabs: oneWindow() });
  globalThis.chrome = fake;
  const ws1 = await createWorkspace("NoIcon");
  const ws2 = await createWorkspace("BadIcon", { name: "x" });
  const stored = fake._peek.local().workspaces;
  assert.ok(!("icon" in stored.find((w) => w.id === ws1.id)));
  assert.ok(!("icon" in stored.find((w) => w.id === ws2.id)));
});

test("setWorkspaceIcon sets then clears a record's icon", async () => {
  const fake = makeChrome({ local: { workspaces: [{ id: "a", name: "A", tabs: [] }], activeWorkspaceId: "a" } });
  globalThis.chrome = fake;
  await setWorkspaceIcon("a", ICON);
  assert.deepStrictEqual(fake._peek.local().workspaces[0].icon, ICON);
  await setWorkspaceIcon("a", { name: "bad" }); // invalid -> clears
  assert.ok(!("icon" in fake._peek.local().workspaces[0]));
});

test("setWorkspaceIcon is a no-op for an unknown id", async () => {
  const fake = makeChrome({ local: { workspaces: [{ id: "a", name: "A", tabs: [] }], activeWorkspaceId: "a" } });
  globalThis.chrome = fake;
  await setWorkspaceIcon("nope", ICON);
  assert.ok(!("icon" in fake._peek.local().workspaces[0]));
});

test("moveActiveTabToNew seeds the new workspace with an icon", async () => {
  const fake = makeChrome({ local: { workspaces: [{ id: "src", name: "Src", tabs: [] }], activeWorkspaceId: "src" }, tabs: oneWindow() });
  globalThis.chrome = fake;
  const ws = await moveActiveTabToNew("New", ICON);
  const created = fake._peek.local().workspaces.find((w) => w.id === ws.id);
  assert.deepStrictEqual(created.icon, ICON);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/icon-actions.test.js`
Expected: FAIL — `createWorkspace is not a function` / `setWorkspaceIcon is not a function` (not yet exported), and the move test fails on the missing icon.

- [ ] **Step 3: Implement**

In `background.js`:

`createWorkspace` — change the signature and set the icon (lines 145–154):

```js
async function createWorkspace(name, icon) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const winId = await getCurrentWindowId();
  const tabs = await readWindowTabs(winId);
  const ws = {
    id: crypto.randomUUID(),
    name: clean,
    tabs
  };
  const ic = normalizeIcon(icon);
  if (ic) ws.icon = ic;
```

`createEmptyWorkspace` — same treatment (lines 166–173):

```js
async function createEmptyWorkspace(name, icon) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const ws = {
    id: crypto.randomUUID(),
    name: clean,
    tabs: []
  };
  const ic = normalizeIcon(icon);
  if (ic) ws.icon = ic;
```

`moveActiveTabToNew` — accept `icon` (line 286) and apply it to the seeded record (line 310):

```js
async function moveActiveTabToNew(name, icon) {
```

```js
    // Add the new workspace seeded with the moved tab and make it active.
    const seeded = { id, name: clean, tabs: [saveable] };
    const ic = normalizeIcon(icon);
    if (ic) seeded.icon = ic;
    state.workspaces.push(seeded);
    state.activeWorkspaceId = id;
```

Add `setWorkspaceIcon` after `renameWorkspace` (after line 193):

```js
// Set or clear a single workspace's icon. Invalid/absent icon clears it (the
// record then renders the default sentinel). No-op for an unknown id.
async function setWorkspaceIcon(id, icon) {
  const state = await getState();
  const ws = state.workspaces.find((w) => w.id === id);
  if (!ws) return;
  const ic = normalizeIcon(icon);
  if (ic) ws.icon = ic;
  else delete ws.icon;
  await setState(state);
}
```

Router — pass icon through and add the `setIcon` case (lines 338–362):

```js
        case "create":
          sendResponse({ ok: true, ws: await createWorkspace(msg.name, msg.icon) });
          break;
        case "createEmpty":
          sendResponse({ ok: true, ws: await createEmptyWorkspace(msg.name, msg.icon) });
          break;
```

```js
        case "rename":
          await renameWorkspace(msg.id, msg.name);
          sendResponse({ ok: true });
          break;
        case "setIcon":
          await setWorkspaceIcon(msg.id, msg.icon);
          sendResponse({ ok: true });
          break;
```

```js
        case "moveTabToNew":
          sendResponse({ ok: true, ws: await moveActiveTabToNew(msg.name, msg.icon) });
          break;
```

Exports (line 376):

```js
  module.exports = { buildMovedState, moveActiveTab, moveActiveTabToNew, normalizeIcon, createWorkspace, setWorkspaceIcon };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/icon-actions.test.js`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Run the whole suite — no regressions**

Run: `node --test tests/icon.test.js tests/move.test.js tests/move-actions.test.js tests/icon-actions.test.js`
Expected: PASS — all files green.

- [ ] **Step 6: Commit**

```bash
git add background.js tests/icon-actions.test.js
git commit -m "feat: persist per-workspace icons + setIcon message"
```

---

### Task 4: Icon dataset generator + `icon-data.json`

**Files:**
- Create: `tools/gen-icon-data.mjs`
- Create (generated): `icon-data.json`
- Test: `tests/icon-data.test.js`

**Interfaces:**
- Produces: `icon-data.json` — a JSON array `[{ name, category, tags, paths }]`, sorted by category then name, with the excluded names removed. `paths` is the inner SVG markup expected by `ICON_SVG()` (e.g. `<path d="…"/><circle …/>`).

- [ ] **Step 1: Write the generator**

Create `tools/gen-icon-data.mjs`:

```js
// Regenerate icon-data.json from a pinned Lucide release.
// Run:  node tools/gen-icon-data.mjs
// Dev-only. Not shipped, not a runtime dependency — same spirit as the
// rsvg-convert PNG regeneration documented in CLAUDE.md.

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LUCIDE_VERSION = "0.544.0"; // pin deliberately; bump on purpose
const EXCLUDE = new Set([
  "square-pen", "trash-2", "save", "folder-plus", "list-end", "check", "folder", "square-dashed",
]);

// 1. Pull the pinned package tarball into a temp dir (nothing lands in the repo).
const dir = mkdtempSync(join(tmpdir(), "lucide-"));
execSync(`npm pack lucide-static@${LUCIDE_VERSION}`, { cwd: dir, stdio: "inherit" });
const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
execSync(`tar -xzf ${tgz}`, { cwd: dir });
const pkg = join(dir, "package");

// 2. name -> SVG node array (the core geometry).
const iconNodes = JSON.parse(readFileSync(join(pkg, "icon-nodes.json"), "utf8"));
// name -> search tags (default [] if the package build lacks tags.json).
let tags = {};
try { tags = JSON.parse(readFileSync(join(pkg, "tags.json"), "utf8")); } catch { /* name-only search */ }
// category -> [names]; inverted to name -> category. Optional.
const categoryOf = {};
try {
  const cats = JSON.parse(readFileSync(join(pkg, "categories.json"), "utf8"));
  for (const [cat, names] of Object.entries(cats)) {
    for (const n of names) if (!categoryOf[n]) categoryOf[n] = cat;
  }
} catch { /* leave uncategorised -> "Other" */ }

// 3. Serialise nodes into the inner markup ICON_SVG() wraps.
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const serialize = (nodes) =>
  nodes.map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`
  ).join("");

// 4. Build, dropping the app's own UI icons + the default sentinel.
const out = [];
for (const [name, nodes] of Object.entries(iconNodes)) {
  if (EXCLUDE.has(name)) continue;
  out.push({ name, category: categoryOf[name] || "Other", tags: tags[name] || [], paths: serialize(nodes) });
}
out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

writeFileSync(new URL("../icon-data.json", import.meta.url), JSON.stringify(out));
console.log(`wrote icon-data.json: ${out.length} icons (lucide ${LUCIDE_VERSION})`);
```

- [ ] **Step 2: Confirm the pinned package ships the expected files**

Run (sanity check before trusting the generator):

```bash
cd "$(mktemp -d)" && npm pack lucide-static@0.544.0 >/dev/null 2>&1 && tar -xzf lucide-static-*.tgz && ls package/*.json
```

Expected: the listing includes `icon-nodes.json` (required). `tags.json` and `categories.json` may or may not be present — the generator degrades gracefully (name-only search / "Other" category) if either is missing. If `icon-nodes.json` is absent, the pinned version's layout differs: bump `LUCIDE_VERSION` to a release that ships it and re-run this check.

- [ ] **Step 3: Generate the dataset**

Run: `node tools/gen-icon-data.mjs`
Expected: prints `wrote icon-data.json: <N> icons (lucide 0.544.0)` with N in the high hundreds / ~1500, and `icon-data.json` now exists at the repo root.

- [ ] **Step 4: Write the dataset sanity test**

Create `tests/icon-data.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const data = require("../icon-data.json");

const EXCLUDED = ["square-pen", "trash-2", "save", "folder-plus", "list-end", "check", "folder", "square-dashed"];

test("icon-data.json is a large array", () => {
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 100, `expected many icons, got ${data.length}`);
});

test("every entry has name/category/tags/paths of the right shape", () => {
  for (const e of data) {
    assert.strictEqual(typeof e.name, "string");
    assert.strictEqual(typeof e.category, "string");
    assert.ok(Array.isArray(e.tags));
    assert.strictEqual(typeof e.paths, "string");
    assert.ok(e.paths.includes("<"), `paths should be SVG markup for ${e.name}`);
  }
});

test("excluded icons are absent from the pickable set", () => {
  const names = new Set(data.map((e) => e.name));
  for (const n of EXCLUDED) assert.ok(!names.has(n), `${n} must be excluded`);
});
```

- [ ] **Step 5: Run the dataset test**

Run: `node --test tests/icon-data.test.js`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tools/gen-icon-data.mjs icon-data.json tests/icon-data.test.js
git commit -m "feat: generate committed Lucide icon dataset"
```

---

### Task 5: Row rendering — leading icon + active solid-fill count

Visually verified (the popup has no Node test rig; `test/harness.html` is the tool).

**Files:**
- Modify: `popup.js` — add `ICON_SQUARE_DASHED` + `ICON_FOLDER_SOLID` consts (near line 85); replace the `.dot` element with a leading workspace-icon span and switch the count glyph by active state (render loop ~156–167)
- Modify: `popup.css` — remove `.dot` rules (94–98), add `.ws-icon`

**Interfaces:**
- Consumes: `ws.icon` (`{ name, paths } | undefined`) from `getState`.
- Produces: each row renders `[leading icon] name … [count] [edit] [trash]`; active rows show the count's folder fully filled.

- [ ] **Step 1: Add the new icon consts**

In `popup.js`, after `ICON_CHECK` (line 85), add:

```js
// Default leading glyph for a workspace with no chosen icon. Hardcoded (not from
// icon-data.json) so a row renders without loading the dataset. Lucide
// "square-dashed" — a quiet placeholder that reads as "no icon set yet".
const ICON_SQUARE_DASHED = ICON_SVG(
  '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/>' +
    '<path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/>' +
    '<path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/>' +
    '<path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>'
); // square-dashed (verify against lucide.dev/icons/square-dashed at the pinned version)

// Active-row count glyph: the whole folder filled solid (vs ICON_FOLDER's
// flap-only fill). Mimics Chrome's active-tab look; this is a fill change, not a
// colour tint, so it stays neutral/green like the inactive glyph.
const ICON_FOLDER_SOLID = ICON_SVG(
  '<path fill="currentColor" stroke="none" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
); // folder, fully solid
```

- [ ] **Step 2: Render the leading icon instead of the dot**

In `popup.js`, in the render loop, replace the dot block (lines 156–157):

```js
    const dot = document.createElement("span");
    dot.className = "dot";
```

with:

```js
    // Leading slot: the workspace's chosen icon, or the default sentinel.
    const wsIcon = document.createElement("span");
    wsIcon.className = "ws-icon";
    wsIcon.innerHTML = ws.icon && ws.icon.paths ? ICON_SVG(ws.icon.paths) : ICON_SQUARE_DASHED;
```

- [ ] **Step 3: Use the solid folder on the active row's count**

In the same loop, change the count glyph line (line 167):

```js
    count.innerHTML = (ws.id === activeWorkspaceId ? ICON_FOLDER_SOLID : ICON_FOLDER) + `<span class="count-n">${n}</span>`;
```

- [ ] **Step 4: Append the leading icon instead of the dot**

Change the final append (line 252):

```js
    li.append(wsIcon, label, right);
```

- [ ] **Step 5: Swap the CSS**

In `popup.css`, replace the `.dot` rules (lines 94–98) and the active-dot rule (line 98):

```css
.dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: transparent; flex: 0 0 auto;
}
.item.active .dot { background: var(--accent); }
```

with:

```css
.ws-icon {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fg); flex: 0 0 auto;
}
.ws-icon svg { width: 16px; height: 16px; }
```

Leave `.item.active .label` (line 99) untouched — the blue bold label stays the primary active cue.

- [ ] **Step 6: Verify in the harness**

Run: `python3 -m http.server 8731` then open `http://localhost:8731/test/harness.html`.
Expected: every workspace row shows a leading square-dashed glyph (or its icon if the stub data sets one); the active row keeps its bold blue name and its count folder is fully filled; non-active rows show the flap-only folder; hovering a row still tints the count green.

If the stub sample data has no `icon` on any workspace and no active row, edit `test/harness.html`'s sample workspaces to add `icon: { name: "rocket", paths: "<path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z\"/><path d=\"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z\"/>" }` to one workspace and confirm it renders. (Harness is gitignored — local edits only.)

- [ ] **Step 7: Commit**

```bash
git add popup.js popup.css
git commit -m "feat: render per-workspace leading icon + solid active count"
```

---

### Task 6: The icon picker overlay + icon-box

Visually verified. The picker is pure presentation in `popup.js`; the dataset is lazy-fetched on first open.

**Files:**
- Modify: `popup.html` — add the picker overlay container before `</body>` (after line 50)
- Modify: `popup.css` — add `.icon-box`, `.icon-picker` overlay, scrim, grid, and loader styles
- Modify: `popup.js` — add `ICON_LOADER` const; the dataset lazy-loader; `makeIconBox()`; `openIconPicker()`

**Interfaces:**
- Produces:
  - `loadIconData() -> Promise<Array<{name,category,tags,paths}>>` — fetches `icon-data.json` once, caches the array for the popup's lifetime.
  - `makeIconBox(initial) -> { el, get, set }` — a clickable square button; `el` to insert, `get()` returns the current `{name,paths}|null`, `set(icon)` updates it. Clicking opens the picker and applies the result.
  - `openIconPicker(current) -> Promise<{name,paths}|null>` — shows the overlay, resolves with the picked icon or `null` on dismiss.

- [ ] **Step 1: Add the overlay markup**

In `popup.html`, before `<script src="popup.js"></script>` (line 51), add:

```html
    <div id="iconPicker" class="icon-picker" hidden>
      <div class="icon-picker-scrim"></div>
      <div class="icon-picker-panel" role="dialog" aria-label="Choose an icon">
        <div class="icon-picker-head">
          <input id="iconSearch" type="text" placeholder="Search icons…" autocomplete="off" />
          <button id="iconPickerClose" class="icon-picker-close" title="Close" aria-label="Close">✕</button>
        </div>
        <div id="iconPickerBody" class="icon-picker-body"></div>
      </div>
    </div>
```

- [ ] **Step 2: Add the styles**

In `popup.css`, append:

```css
/* Icon-box: the clickable square that opens the picker. */
.icon-box {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 32px; height: 32px;
  background: #18181b; color: var(--fg);
  border: 1px solid var(--line); border-radius: 6px; cursor: pointer;
}
.icon-box:hover { border-color: var(--accent); }
.icon-box svg { width: 16px; height: 16px; }

/* Picker overlay: full-width inside the popup, scrim behind. */
.icon-picker { position: fixed; inset: 0; z-index: 10; display: flex; }
.icon-picker-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.icon-picker-panel {
  position: relative; margin: auto; width: calc(100% - 24px); max-height: calc(100% - 24px);
  display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
}
.icon-picker-head { display: flex; gap: 8px; align-items: center; padding: 10px; border-bottom: 1px solid var(--line); }
.icon-picker-head #iconSearch { flex: 1; }
.icon-picker-close {
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  font-size: 16px; padding: 4px 8px; border-radius: 5px;
}
.icon-picker-close:hover { color: var(--fg); background: #2a2a30; }
.icon-picker-body { overflow-y: auto; padding: 10px; }

.icon-picker-cat { margin: 8px 2px 4px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.icon-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.icon-cell {
  display: inline-flex; align-items: center; justify-content: center;
  aspect-ratio: 1; border: 0; background: transparent; color: var(--fg);
  border-radius: 6px; cursor: pointer;
}
.icon-cell:hover { background: #2a2a30; color: var(--accent); }
.icon-cell svg { width: 18px; height: 18px; }

/* Loading / error states inside the picker body. */
.icon-picker-status { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--muted); padding: 32px 0; }
.icon-picker-status svg { width: 20px; height: 20px; }
.icon-spin { animation: icon-spin 0.8s linear infinite; }
@keyframes icon-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Add the loader const + dataset loader**

In `popup.js`, after the `ICON_FOLDER_SOLID` const (Task 5), add:

```js
const ICON_LOADER = ICON_SVG('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'); // loader-circle

// Lazily fetch the committed icon dataset, once, on first picker open. The
// workspace list never loads it (rows render from stored paths / the sentinel).
let _iconData = null;
function loadIconData() {
  if (_iconData) return _iconData;
  _iconData = fetch("icon-data.json").then((r) => {
    if (!r.ok) throw new Error("icon-data fetch failed: " + r.status);
    return r.json();
  });
  return _iconData;
}
```

- [ ] **Step 4: Add the picker + icon-box**

In `popup.js`, before the trailing `syncButtons(); render();` (lines 308–309), add:

```js
// ---------- Icon picker (pure presentation) ----------
const pickerEl = document.getElementById("iconPicker");
const pickerSearch = document.getElementById("iconSearch");
const pickerBody = document.getElementById("iconPickerBody");
const pickerClose = document.getElementById("iconPickerClose");
const pickerScrim = pickerEl.querySelector(".icon-picker-scrim");

let pickerResolve = null; // resolver for the in-flight openIconPicker() promise

function closePicker(result) {
  pickerEl.hidden = true;
  pickerBody.innerHTML = "";
  pickerSearch.value = "";
  const r = pickerResolve;
  pickerResolve = null;
  if (r) r(result);
}

// Render the grid from a dataset, grouped by category when no query, flat when
// searching (search matches name + tags; synonyms surface via Lucide tags).
function renderPickerGrid(data, query) {
  const q = query.trim().toLowerCase();
  pickerBody.innerHTML = "";

  const cell = (icon) => {
    const b = document.createElement("button");
    b.className = "icon-cell";
    b.title = icon.name;
    b.innerHTML = ICON_SVG(icon.paths);
    b.addEventListener("click", () => closePicker({ name: icon.name, paths: icon.paths }));
    return b;
  };

  if (q) {
    const hits = data.filter(
      (i) => i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))
    );
    const grid = document.createElement("div");
    grid.className = "icon-grid";
    for (const i of hits) grid.appendChild(cell(i));
    pickerBody.appendChild(grid);
    return;
  }

  // Grouped: category header + grid, in dataset order (already sorted by category).
  let currentCat = null, grid = null;
  for (const i of data) {
    if (i.category !== currentCat) {
      currentCat = i.category;
      const h = document.createElement("div");
      h.className = "icon-picker-cat";
      h.textContent = currentCat;
      pickerBody.appendChild(h);
      grid = document.createElement("div");
      grid.className = "icon-grid";
      pickerBody.appendChild(grid);
    }
    grid.appendChild(cell(i));
  }
}

// Open the picker; resolves with the chosen { name, paths } or null on dismiss.
function openIconPicker() {
  return new Promise((resolve) => {
    pickerResolve = resolve;
    pickerEl.hidden = false;
    pickerSearch.value = "";
    pickerBody.innerHTML = '<div class="icon-picker-status"><span class="icon-spin">' + ICON_LOADER + "</span> Loading icons…</div>";
    pickerSearch.focus();

    loadIconData().then(
      (data) => {
        if (pickerResolve !== resolve) return; // dismissed before load finished
        renderPickerGrid(data, "");
        pickerSearch.oninput = () => renderPickerGrid(data, pickerSearch.value);
      },
      () => {
        if (pickerResolve !== resolve) return;
        pickerBody.innerHTML = '<div class="icon-picker-status">Couldn\'t load icons.</div>';
      }
    );
  });
}

pickerClose.addEventListener("click", () => closePicker(null));
pickerScrim.addEventListener("click", () => closePicker(null));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !pickerEl.hidden) { e.preventDefault(); closePicker(null); }
});

// A reusable icon-box: square button showing an icon; click opens the picker.
// get()/set() expose the current { name, paths } | null selection.
function makeIconBox(initial) {
  let icon = initial || null;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "icon-box";
  const paint = () => { el.innerHTML = icon && icon.paths ? ICON_SVG(icon.paths) : ICON_SQUARE_DASHED; };
  paint();
  el.addEventListener("click", async (e) => {
    e.stopPropagation();
    const picked = await openIconPicker();
    if (picked) { icon = picked; paint(); el.dispatchEvent(new CustomEvent("iconpick", { detail: picked })); }
  });
  return { el, get: () => icon, set: (next) => { icon = next || null; paint(); } };
}
```

- [ ] **Step 5: Verify the picker in the harness**

Reload `http://localhost:8731/test/harness.html`. In the harness page, temporarily call `openIconPicker()` from the devtools console (or add a temporary button) to open it.
Expected: overlay covers the popup with a scrim; a spinner shows briefly, then a grid of icons grouped by category headers; typing "rocket" filters to rocket-ish icons, typing "bin" or "delete" surfaces trash-type icons; clicking an icon closes the overlay; ✕, scrim click, and Esc all dismiss it. If `icon-data.json` fails to load, the body shows "Couldn't load icons."

Note: the harness serves `icon-data.json` over HTTP, so `fetch("icon-data.json")` resolves relative to the harness URL. If the harness lives under `test/`, confirm the fetch path resolves (the real popup is at the extension root, so the relative path is correct there; in the harness you may need to serve from the repo root, which the documented `python3 -m http.server 8731` from the project root already does).

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: searchable Lucide icon picker overlay + icon-box"
```

---

### Task 7: Wire the icon-box into create, move-new, and rename

Visually verified. Connects the picker to the three contexts and sends the icon to the background.

**Files:**
- Modify: `popup.html` — wrap the create-form name input and the move-new input so an icon-box can sit to their left
- Modify: `popup.css` — a small flex row for `[icon-box] [input]`
- Modify: `popup.js` — mount icon-boxes; hold the create/move-new selections; send `icon`; add the rename-mode icon-box that fires `setIcon`

**Interfaces:**
- Consumes: `makeIconBox` / `openIconPicker` (Task 6); `send` (existing); the `create` / `createEmpty` / `moveTabToNew` / `setIcon` messages (Task 3).

- [ ] **Step 1: Markup — give the inputs an icon-box slot**

In `popup.html`, replace the create-form input (line 10):

```html
      <input id="name" type="text" placeholder="Workspace name" maxlength="40" />
```

with:

```html
      <div class="name-row">
        <span id="nameIconSlot"></span>
        <input id="name" type="text" placeholder="Workspace name" maxlength="40" />
      </div>
```

And the move-new input (line 41):

```html
        <input id="moveNewName" type="text" placeholder="New workspace name" maxlength="40" />
```

with:

```html
        <span id="moveNewIconSlot"></span>
        <input id="moveNewName" type="text" placeholder="New workspace name" maxlength="40" />
```

- [ ] **Step 2: Style the name row**

In `popup.css`, add (near the create-new rules around line 46):

```css
.name-row { display: flex; gap: 6px; align-items: center; }
.name-row #name { flex: 1; }
```

(`.move-new` is already `display: flex` with `gap`, so the move-new icon-box needs no extra rule.)

- [ ] **Step 3: Decide where the boxes are created (ordering note)**

`makeIconBox` (Task 6) is defined near the end of `popup.js`, below the `save` / `moveNewGo` handlers. So the two box instances (`nameIconBox`, `moveNewIconBox`) must be created at the end of the file (Step 6), and the handlers in Steps 4–5 reference those end-of-file consts. JS `const`s are not hoisted, so the handlers run only on user click — by which point the end-of-file consts exist. No code to write in this step; it sets the ordering the next steps rely on.

- [ ] **Step 4: Send the icon on create / start-empty**

In `popup.js`, update the `save` handler (lines 288–294):

```js
saveEl.addEventListener("click", async () => {
  if (saveEl.disabled) return;
  await send({ type: "create", name: nameEl.value, icon: nameIconBox.get() || undefined });
  nameEl.value = "";
  nameIconBox.set(null);
  syncButtons();
  render();
});
```

And the `empty` handler (lines 296–300):

```js
emptyEl.addEventListener("click", async () => {
  if (emptyEl.disabled) return;
  await send({ type: "createEmpty", name: nameEl.value, icon: nameIconBox.get() || undefined });
  window.close();
});
```

- [ ] **Step 5: Send the icon on move-to-new**

Update the `moveNewGo` handler (lines 280–286):

```js
moveNewGo.addEventListener("click", async () => {
  if (moveNewGo.disabled) return;
  await send({ type: "moveTabToNew", name: moveNewName.value.trim(), icon: moveNewIconBox.get() || undefined });
  window.close();
});
```

Also reset the move-new box when the strip re-renders. In `renderMoveStrip` (after line 99, `moveNewGo.disabled = true;`), add:

```js
  if (typeof moveNewIconBox !== "undefined") moveNewIconBox.set(null);
```

- [ ] **Step 6: Create the boxes + add the rename-mode icon-box**

At the end of `popup.js`, just before `syncButtons();` (line 308), add the box creation (now that `makeIconBox` is defined above):

```js
// Mount the two "new workspace" icon-boxes (selection held until submit).
const nameIconBox = makeIconBox(null);
document.getElementById("nameIconSlot").appendChild(nameIconBox.el);
const moveNewIconBox = makeIconBox(null);
document.getElementById("moveNewIconSlot").appendChild(moveNewIconBox.el);
```

Then, in the render loop's inline-rename handler (the `edit.addEventListener` block, lines 194–221), add an icon-box to the left of the rename input and persist picks immediately. After `label.replaceWith(input);` (line 201), insert:

```js
      // Rename mode also exposes the icon: an icon-box left of the input.
      // Picking applies immediately via setIcon, so it persists even if the
      // name edit is cancelled.
      const rowIconBox = makeIconBox(ws.icon || null);
      input.parentNode.insertBefore(rowIconBox.el, input);
      rowIconBox.el.addEventListener("iconpick", async (ev) => {
        await send({ type: "setIcon", id: ws.id, icon: ev.detail });
      });
```

- [ ] **Step 7: Verify in the harness + real Chrome**

Harness (`http://localhost:8731/test/harness.html`):
- The create form shows an icon-box (square-dashed) left of the name field; clicking it opens the picker; picking updates the box.
- Selecting "＋ New workspace…" in the move strip reveals the move-new row with its own icon-box.
- Clicking a row's pencil shows an icon-box left of the rename input, pre-set to that workspace's icon.

Real Chrome (load unpacked, reload the extension card after the `background.js` changes from Task 3):
1. Type a name, pick an icon, click "Save current tabs" → the new row shows that icon as its leading glyph.
2. Pencil-edit an existing row, click its icon-box, pick a different icon → the row's leading icon updates and survives reopening the popup (persisted via `setIcon`).
3. Move a tab to a new workspace with a chosen icon → the new workspace carries it.

- [ ] **Step 8: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: pick per-workspace icons in create, move-new, and rename"
```

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md` — Data model, Message protocol, File map, Run-and-test (generator command), Known limitations

- [ ] **Step 1: Update the Data model section**

In `CLAUDE.md`, in the `chrome.storage.local` block, change the workspace shape to include the optional icon, and add a sentence below it:

```
  workspaces: [
    { id: string (uuid), name: string,
      tabs: [{ url: string, pinned: boolean }],
      icon?: { name: string, paths: string } }   // optional; absent => default
  ],
```

Add below the block: "`icon` is optional. `icon.paths` (the Lucide inner SVG markup) is stored so a row renders without loading `icon-data.json`; absent `icon` renders the `square-dashed` default sentinel."

- [ ] **Step 2: Update the Message protocol section**

Add the `setIcon` entry and note the icon params on the create/move messages:

```
- `create` `{ name, icon? }` -> as before; stores `icon` ({ name, paths }) when valid.
- `createEmpty` `{ name, icon? }` -> as before; stores `icon` when valid.
- `moveTabToNew` `{ name, icon? }` -> as before; seeds the new workspace's `icon`.
- `setIcon` `{ id, icon }` -> sets/clears one workspace's icon (invalid/absent clears).
```

- [ ] **Step 3: Update the File map**

Add entries:

```
- `icon-data.json` — generated, committed Lucide dataset ({ name, category, tags,
  paths }[]). Lazy-fetched by the popup only when the icon picker opens.
- `tools/gen-icon-data.mjs` — dev-only generator for `icon-data.json` from a
  pinned Lucide release. Not shipped, not a runtime dependency.
```

In the `popup.js` description, note: "Also holds the icon picker overlay (pure presentation) and the icon-box used in the create / move-new / rename flows."

- [ ] **Step 4: Add the regen command to Run and test**

Add near the icon raster regen note:

```
Regenerate the icon picker dataset (after a Lucide bump — edit LUCIDE_VERSION in
the script): `node tools/gen-icon-data.mjs`. Commit the updated `icon-data.json`.
```

Add the new test files to the Node tests list:

```
- `tests/icon.test.js` — the normalizeIcon validator.
- `tests/icon-actions.test.js` — icon persistence actions against the chrome fake.
- `tests/icon-data.test.js` — generated dataset sanity (shape + exclusions).
- `tests/fake-chrome.js` — shared in-memory chrome fake (not a test).
```

- [ ] **Step 5: Update Known limitations**

Remove "no icons" from the v1 known-limitations line (it now exists):

```
- No reorder, no sync across machines. (Rename and per-workspace icons exist.)
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-workspace icons in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- Data model `icon?: { name, paths }`, backward-compatible default → Tasks 1, 3, 5 (sentinel render). ✓
- Store `paths` so rows render without the dataset → Task 5 (`ICON_SQUARE_DASHED`, stored-paths render). ✓
- Lazy-loaded committed dataset → Tasks 4 (generate) + 6 (`loadIconData`). ✓ (mechanism refined to `fetch` of `icon-data.json` rather than `import()` — same approved design, avoids ESM/MIME issues; recorded in the plan header and File Structure.)
- Excluded icons filtered at generation → Task 4 (`EXCLUDE`) + `tests/icon-data.test.js`. ✓
- Generator as dev-only script → Task 4. ✓
- Picker overlay: scrim, search-at-top, category grouping, collapse-to-flat on search, loading state, dismiss paths → Task 6. ✓
- Icon-box in create / move-new / rename(immediate `setIcon`) → Task 7. ✓
- Row rendering: leading icon replaces dot; active = bold blue label + solid-fill count; leading icon + count neutral → Task 5. ✓
- Message protocol (`create`/`createEmpty`/`moveTabToNew` carry icon; new `setIcon`; `rename` unchanged) → Task 3. ✓
- Icon validation pure helper → Task 1. ✓
- Tests: pure validator, action tests, generator/dataset check, harness → Tasks 1, 3, 4, 5–7. ✓
- Docs → Task 8. ✓

**Placeholder scan:** No TBD/TODO. The two "verify against Lucide source" notes (square-dashed `d` data in Task 5; package file names in Task 4 Step 2) are concrete values plus a real verification step against an external dependency, not deferred work.

**Type consistency:** `normalizeIcon` / `setWorkspaceIcon` signatures match across Tasks 1, 3, and the tests. `makeIconBox` returns `{ el, get, set }` and fires an `iconpick` CustomEvent — consumed consistently in Task 7. `openIconPicker()` resolves `{name,paths}|null` — consumed by `makeIconBox` and the rename handler. `loadIconData()` returns the dataset array used by `renderPickerGrid`. Icon shape `{ name, paths }` is consistent end to end (record, message, picker, render).

**Note on Task 7 ordering:** Step 3 is intentionally superseded by Step 6 (box creation placed at end-of-file where `makeIconBox` is defined) — the implementer creates the boxes once, in Step 6, and Steps 4–5 reference them. Follow Step 6's placement.
