# Move Tab to Workspace + Inline Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move the working window's active tab into another workspace (existing or new) from the popup, and rename a workspace inline via a pencil icon.

**Architecture:** All decision logic stays in `background.js` behind new message types (`moveTab`, `moveTabToNew`), with the active tab folded into the existing `getState` response. The popup gains a "move strip" with a native `<select>` picker and inline rename inputs — render-and-send only, no logic. A small pure-logic helper (`buildMovedState`) is extracted so the move core is unit-testable under plain `node` without Chrome APIs.

**Tech Stack:** Vanilla JS, Chrome Manifest V3 (service worker + popup), `chrome.storage.local`/`session`, `chrome.tabs`. No build step, no dependencies. Tests run with Node's built-in `node:test` and `node:assert` (no install).

## Global Constraints

- Manifest V3. Service worker background, not a persistent page.
- Vanilla JS. No build step, no bundler, no dependencies, no framework. No TypeScript.
- Permissions: `tabs`, `storage` only. Do not add more.
- Keep the popup dumb — all decisions live in `background.js`.
- Only http/https tabs are trackable (`isTrackableUrl`).
- Target window is the last focused normal window via `getCurrentWindowId()` — never the popup window.
- All persistent state goes through `getState` / `setState`.
- Invariants that must not break: (1) never let the window reach zero tabs; (4) Default (`activeWorkspaceId === null`) never closes/tracks; (5) only http/https tracked; (6) target is the working window; (7) state only via getState/setState.

---

### Task 1: Extract `buildMovedState` pure helper + unit test

Pulls the "where does the moved tab land in state" decision into a pure function so it can be tested without Chrome APIs. This function does NOT touch tabs or storage — it only transforms a state object.

**Files:**
- Modify: `background.js` (add the helper near the other state helpers, ~line 55)
- Create: `tests/move.test.js`
- Create: `tests/helpers.js` (shared loader that evaluates the pure helpers from `background.js`)

**Interfaces:**
- Produces:
  - `buildMovedState(state, targetId, tab)` → returns a **new** `{ workspaces, activeWorkspaceId }` where `tab` (`{ url, pinned }`) is appended to the workspace whose `id === targetId`. Throws `Error("target not found")` if no such workspace. Does not mutate the input `state`.
  - `buildNewWorkspaceState(state, name, tab, id)` → returns a new state with a workspace `{ id, name, tabs: [tab] }` appended. `activeWorkspaceId` is unchanged. Caller supplies `id` (so the helper stays pure / testable).

The helpers must be usable both inside the service worker and from Node. Use a guarded export at the end of `background.js`:

```js
// Exported for unit tests (Node). Harmless no-op in the service worker.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildMovedState, buildNewWorkspaceState };
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/move.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildMovedState, buildNewWorkspaceState } = require("../background.js");

const tab = { url: "https://example.com/", pinned: false };

test("buildMovedState appends tab to the target workspace", () => {
  const state = {
    workspaces: [
      { id: "a", name: "A", tabs: [{ url: "https://a.com/", pinned: false }] },
      { id: "b", name: "B", tabs: [] }
    ],
    activeWorkspaceId: "a"
  };
  const next = buildMovedState(state, "b", tab);
  assert.deepStrictEqual(next.workspaces[1].tabs, [tab]);
  // source untouched by this helper (closing the live tab handles source re-sync)
  assert.strictEqual(next.workspaces[0].tabs.length, 1);
  // input not mutated
  assert.strictEqual(state.workspaces[1].tabs.length, 0);
});

test("buildMovedState throws when target is missing", () => {
  const state = { workspaces: [], activeWorkspaceId: null };
  assert.throws(() => buildMovedState(state, "nope", tab), /target not found/);
});

test("buildNewWorkspaceState appends a new workspace seeded with the tab", () => {
  const state = { workspaces: [], activeWorkspaceId: null };
  const next = buildNewWorkspaceState(state, "C", tab, "fixed-id");
  assert.strictEqual(next.workspaces.length, 1);
  assert.deepStrictEqual(next.workspaces[0], { id: "fixed-id", name: "C", tabs: [tab] });
  assert.strictEqual(next.activeWorkspaceId, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `buildMovedState is not a function` / cannot find export (helpers not defined yet).

- [ ] **Step 3: Write minimal implementation**

In `background.js`, after `snapshotInto` (~line 55), add:

```js
// ---------- Pure move helpers (unit-tested in Node) ----------
// These transform a state object only. They never touch chrome.tabs/storage,
// so they stay testable without the Chrome runtime. Callers persist the result.

function buildMovedState(state, targetId, tab) {
  const workspaces = state.workspaces.map((w) =>
    w.id === targetId ? { ...w, tabs: [...(w.tabs || []), tab] } : w
  );
  if (!state.workspaces.some((w) => w.id === targetId)) {
    throw new Error("target not found");
  }
  return { ...state, workspaces };
}

function buildNewWorkspaceState(state, name, tab, id) {
  const ws = { id, name, tabs: [tab] };
  return { ...state, workspaces: [...state.workspaces, ws] };
}
```

At the very end of `background.js`, add the guarded export from the Interfaces block above.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS — 3 tests pass.

Note: requiring `background.js` in Node runs its top-level `chrome.*` listener
registrations. If `node --test` errors on `chrome is not defined`, guard the
runtime wiring by defining a minimal stub at the top of the test file BEFORE the
require, OR confirm the listeners are only referenced inside functions. If a stub
is needed, prepend to `tests/move.test.js`:

```js
globalThis.chrome = {
  tabs: { onCreated: { addListener() {} }, onRemoved: { addListener() {} }, onMoved: { addListener() {} }, onUpdated: { addListener() {} } },
  runtime: { onMessage: { addListener() {} } }
};
```

Place this stub at the top of the file, above the `require`. Re-run and expect PASS.

- [ ] **Step 5: Commit**

```bash
git add background.js tests/move.test.js
git commit -m "feat: add pure move-state helpers with node tests"
```

---

### Task 2: Fold active tab into `getState`

The popup needs the working window's active tab to render the move strip. Fold it into the existing `getState` response so there is no extra round-trip.

**Files:**
- Modify: `background.js` — the `getState` message case (~line 192) and a new `readActiveTab()` helper

**Interfaces:**
- Consumes: `getCurrentWindowId()`, `isTrackableUrl(url)` (existing).
- Produces:
  - `readActiveTab()` → `Promise<{ url, title, favIconUrl, trackable } | null>`. Resolves the working window's active tab; `trackable` is `isTrackableUrl(url)`. Returns `null` if no active tab can be read.
  - `getState` message response gains an `activeTab` field (the above, or `null`).

Note: the persistent `getState()` function (line 10) is unchanged — only the **message handler's** response is enriched, so live tracking and the swap keep using the lean state. Do not add `activeTab` to the stored state.

- [ ] **Step 1: Add `readActiveTab()` helper**

In `background.js`, near `getCurrentWindowId` (~line 32), add:

```js
// Read the working window's active tab as a render-only summary for the popup.
async function readActiveTab() {
  const winId = await getCurrentWindowId();
  if (winId == null) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  if (!tab) return null;
  return {
    url: tab.url || "",
    title: tab.title || "",
    favIconUrl: tab.favIconUrl || "",
    trackable: isTrackableUrl(tab.url)
  };
}
```

- [ ] **Step 2: Enrich the `getState` message response**

Replace the `getState` case in the message router (~line 192-194):

```js
        case "getState": {
          const state = await getState();
          const activeTab = await readActiveTab();
          sendResponse({ ...state, activeTab });
          break;
        }
```

- [ ] **Step 3: Manually verify in Chrome**

Reload the extension at `chrome://extensions`. Open the popup on an http(s) page, open the popup's devtools console, run:

```js
chrome.runtime.sendMessage({ type: "getState" }, (r) => console.log(r.activeTab));
```

Expected: an object with the current tab's `url`/`title` and `trackable: true`. On a `chrome://` page, `trackable: false`.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: include active tab in getState response"
```

---

### Task 3: `moveTab` and `moveTabToNew` background actions

Wire the pure helpers into real actions that resolve the active tab, guard edge cases, persist, and close the moved tab.

**Files:**
- Modify: `background.js` — add two action functions (after `switchWorkspace`, ~line 185) and two message cases (~line 201)

**Interfaces:**
- Consumes: `getCurrentWindowId()`, `isTrackableUrl()`, `getState()`, `setState()`, `cleanName()`, `buildMovedState()`, `buildNewWorkspaceState()`, `readActiveTab()`.
- Produces:
  - `moveActiveTab(targetId)` → moves the working window's active tab into workspace `targetId`. Throws on: non-trackable tab, missing target, or `targetId === activeWorkspaceId`.
  - `moveActiveTabToNew(name)` → creates `{ id, name, tabs:[tab] }`, persists, closes the tab. Returns the new workspace. Throws on blank name or non-trackable tab.
  - Message types `moveTab { targetId }` → `{ ok: true }`, `moveTabToNew { name }` → `{ ok: true, ws }`.

- [ ] **Step 1: Add a shared resolve+close helper and the two actions**

In `background.js` after `switchWorkspace` (~line 185), add:

```js
// ---------- Move current tab (spec: Move tab to workspace) ----------

// Resolve the working window's active tab as a saveable { url, pinned }.
// Throws if it is not http/https — chrome:// pages can't be reopened later.
async function resolveActiveSaveableTab(winId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  if (!tab) throw new Error("No active tab");
  if (!isTrackableUrl(tab.url)) throw new Error("This page can't be moved");
  return { tab, saveable: { url: tab.url, pinned: !!tab.pinned } };
}

// Open a blank tab first if this is the only tab, so the window never empties
// (invariant 1), then close the moved tab.
async function closeMovedTab(winId, tabId) {
  const remaining = await chrome.tabs.query({ windowId: winId });
  if (remaining.length <= 1) {
    await chrome.tabs.create({ windowId: winId });
  }
  await chrome.tabs.remove(tabId);
}

async function moveActiveTab(targetId) {
  const winId = await getCurrentWindowId();
  if (winId == null) throw new Error("No working window");
  const state = await getState();
  if (targetId === state.activeWorkspaceId) {
    throw new Error("Tab is already in this workspace");
  }
  const { tab, saveable } = await resolveActiveSaveableTab(winId);
  const next = buildMovedState(state, targetId, saveable); // throws if target missing
  await setState(next);
  // Closing the tab lets normal live-sync drop it from the source workspace.
  await closeMovedTab(winId, tab.id);
}

async function moveActiveTabToNew(name) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const winId = await getCurrentWindowId();
  if (winId == null) throw new Error("No working window");
  const state = await getState();
  const { tab, saveable } = await resolveActiveSaveableTab(winId);
  const id = crypto.randomUUID();
  const next = buildNewWorkspaceState(state, clean, saveable, id);
  await setState(next);
  await closeMovedTab(winId, tab.id);
  return next.workspaces.find((w) => w.id === id);
}
```

- [ ] **Step 2: Add the message cases**

In the message router, after the `switch` case (~line 204), add:

```js
        case "moveTab":
          await moveActiveTab(msg.targetId);
          sendResponse({ ok: true });
          break;
        case "moveTabToNew":
          sendResponse({ ok: true, ws: await moveActiveTabToNew(msg.name) });
          break;
```

- [ ] **Step 3: Manually verify the happy path in Chrome**

Reload the extension. Set up workspace A (active, 3 tabs incl. a github.com tab) and workspace B (saved). From the popup console on the active window:

```js
// find B's id first
chrome.runtime.sendMessage({ type: "getState" }, (s) => {
  const b = s.workspaces.find(w => w.name === "B");
  chrome.runtime.sendMessage({ type: "moveTab", targetId: b.id }, console.log);
});
```

Expected: `{ ok: true }`; the active tab closes; re-running `getState` shows B's tab count up by one and A's down by one (after the ~400ms sync).

- [ ] **Step 4: Verify the guards**

- On a `chrome://extensions` tab as active: `moveTab` → response `{ ok:false, error: "...This page can't be moved" }`.
- `moveTab` with `targetId` equal to the active workspace → `{ ok:false, error: "...already in this workspace" }`.
- With a single tab open, `moveTab` → window keeps one blank tab, moved URL lands in target.

- [ ] **Step 5: Commit**

```bash
git add background.js
git commit -m "feat: moveTab and moveTabToNew background actions"
```

---

### Task 4: Move strip UI in the popup

Add the move strip (active tab + `<select>` picker + inline new-workspace input) under the header. Render-and-send only.

**Files:**
- Modify: `popup.html` (add the strip markup after the `.head`, before the list)
- Modify: `popup.js` (render the strip, wire the picker and inline new input)
- Modify: `popup.css` (strip styling)

**Interfaces:**
- Consumes: `getState` response `{ workspaces, activeWorkspaceId, activeTab }`; messages `moveTab { targetId }`, `moveTabToNew { name }`.

- [ ] **Step 1: Add the strip markup**

In `popup.html`, after `<div class="head">Workspaces</div>` (line 8) and before `<ul id="list">`:

```html
    <div id="moveStrip" class="move-strip" hidden>
      <span class="move-icon">&#8618;</span>
      <span id="moveLabel" class="move-label"></span>
      <select id="movePick" class="move-pick">
        <option value="" disabled selected>Move to&hellip;</option>
      </select>
      <span id="moveNew" class="move-new" hidden>
        <input id="moveNewName" type="text" placeholder="New name" maxlength="40" />
        <button id="moveNewGo" class="primary" disabled>Move</button>
      </span>
    </div>
```

- [ ] **Step 2: Render the strip from state**

In `popup.js`, add element refs near the top (after line 10):

```js
const moveStrip = document.getElementById("moveStrip");
const moveLabel = document.getElementById("moveLabel");
const movePick = document.getElementById("movePick");
const moveNew = document.getElementById("moveNew");
const moveNewName = document.getElementById("moveNewName");
const moveNewGo = document.getElementById("moveNewGo");

const NEW_OPTION = "__new__";
```

Add a render function and call it from `render()`. Inside `render()`, after destructuring the response, capture `activeTab`:

```js
async function render() {
  const { workspaces, activeWorkspaceId, activeTab } = await send({ type: "getState" });
  renderMoveStrip(workspaces, activeWorkspaceId, activeTab);
  listEl.innerHTML = "";
  // ...existing list rendering unchanged...
```

Then add the function:

```js
function renderMoveStrip(workspaces, activeWorkspaceId, activeTab) {
  // Reset the inline new-name sub-input each render.
  moveNew.hidden = true;
  moveNewName.value = "";
  moveNewGo.disabled = true;

  if (!activeTab) {
    moveStrip.hidden = true;
    return;
  }
  moveStrip.hidden = false;

  if (!activeTab.trackable) {
    moveLabel.textContent = "Can't move this page";
    moveLabel.classList.add("muted-label");
    movePick.disabled = true;
    return;
  }
  moveLabel.classList.remove("muted-label");
  movePick.disabled = false;
  moveLabel.textContent = activeTab.title || activeTab.url;
  moveLabel.title = activeTab.url;

  // Rebuild options: placeholder, each non-active workspace, then New.
  movePick.innerHTML = "";
  const ph = new Option("Move to…", "", true, true);
  ph.disabled = true;
  movePick.add(ph);
  for (const ws of workspaces) {
    if (ws.id === activeWorkspaceId) continue;
    movePick.add(new Option(ws.name, ws.id));
  }
  movePick.add(new Option("＋ New workspace…", NEW_OPTION));
}
```

- [ ] **Step 3: Wire the picker and inline new input**

In `popup.js`, after the `render()` definition and before `saveEl` listeners, add:

```js
movePick.addEventListener("change", async () => {
  const val = movePick.value;
  if (!val) return;
  if (val === NEW_OPTION) {
    moveNew.hidden = false;
    moveNewName.focus();
    movePick.value = ""; // reset so re-selecting New later still fires change
    return;
  }
  await send({ type: "moveTab", targetId: val });
  render();
});

moveNewName.addEventListener("input", () => {
  moveNewGo.disabled = moveNewName.value.trim().length === 0;
});

moveNewName.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !moveNewGo.disabled) moveNewGo.click();
  if (e.key === "Escape") { moveNew.hidden = true; moveNewName.value = ""; }
});

moveNewGo.addEventListener("click", async () => {
  if (moveNewGo.disabled) return;
  await send({ type: "moveTabToNew", name: moveNewName.value });
  render();
});
```

- [ ] **Step 4: Style the strip**

In `popup.css`, after the `.head` block (~line 28), add:

```css
.move-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px 8px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 6px;
}
.move-icon { color: var(--muted); flex: 0 0 auto; }
.move-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px;
}
.move-label.muted-label { color: var(--muted); font-style: italic; }
.move-pick {
  flex: 0 0 auto; max-width: 110px;
  background: #18181b; color: var(--fg);
  border: 1px solid var(--line); border-radius: 6px;
  padding: 4px 6px; font: inherit; font-size: 12px;
}
.move-pick:disabled { opacity: 0.4; }
.move-new { display: flex; gap: 4px; align-items: center; flex: 1 1 100%; margin-top: 6px; }
.move-new input { font-size: 12px; padding: 5px 6px; }
.move-new .primary { padding: 5px 8px; font-size: 12px; }
```

- [ ] **Step 5: Manually verify in Chrome**

Reload the extension. On an http(s) page with workspaces A (active) and B:
- Strip shows the page title and a picker. Picker lists B and "＋ New workspace…", not A.
- Pick B → tab moves, popup re-renders with updated counts.
- Pick "＋ New workspace…" → name input appears; type "C", Enter → tab moves into new C; popup shows C.
- On a chrome:// page → strip shows "Can't move this page", picker disabled.

- [ ] **Step 6: Commit**

```bash
git add popup.html popup.js popup.css
git commit -m "feat: move-tab strip in popup"
```

---

### Task 5: Inline rename + hover-revealed icons

Add a pencil (✎) before the ✕ on each row; clicking it edits the name in place. Reveal both icons on hover; keep them visible on the active row.

**Files:**
- Modify: `popup.js` — per-row rendering in `render()` (~line 48-67)
- Modify: `popup.css` — `.x` block and a new `.edit` block (~line 52-56)

**Interfaces:**
- Consumes: existing `rename { id, name }` message + `renameWorkspace` handler (blank name keeps old name).

- [ ] **Step 1: Render the pencil and inline-edit logic**

In `popup.js` `render()`, inside the `for (const ws ...)` loop, replace the delete-button creation and append (lines ~48-67) with:

```js
    const edit = document.createElement("button");
    edit.className = "edit";
    edit.textContent = "✎"; // ✎
    edit.title = "Rename workspace";

    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "✕"; // ✕
    x.title = "Delete workspace";

    // Click the row -> switch (swap tabs). Active row does nothing.
    li.addEventListener("click", async () => {
      if (ws.id === activeWorkspaceId) return;
      await send({ type: "switch", id: ws.id });
      window.close();
    });

    // Inline rename: swap the label for an input in place.
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.className = "rename-input";
      input.value = ws.name;
      input.maxLength = 40;
      label.replaceWith(input);
      input.focus();
      input.select();

      let done = false;
      const commit = async () => {
        if (done) return;
        done = true;
        await send({ type: "rename", id: ws.id, name: input.value });
        render();
      };
      const cancel = () => { if (!done) { done = true; render(); } };

      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") cancel();
      });
      input.addEventListener("blur", commit);
    });

    // Delete without triggering the switch.
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      await send({ type: "delete", id: ws.id });
      render();
    });

    li.append(dot, label, count, edit, x);
    listEl.appendChild(li);
```

- [ ] **Step 2: Style hover-revealed icons + rename input**

In `popup.css`, replace the `.x` block (lines ~52-56) with:

```css
.edit, .x {
  border: 0; background: transparent; color: var(--muted);
  cursor: pointer; padding: 2px 6px; border-radius: 5px; font-size: 14px;
  opacity: 0; transition: opacity 0.1s;
}
.item:hover .edit, .item:hover .x,
.item.active .edit, .item.active .x { opacity: 1; }
.edit:hover { color: var(--accent); background: #23272f; }
.x:hover { color: var(--danger); background: #2f2326; }

.rename-input {
  flex: 1; min-width: 0;
  background: #18181b; color: var(--fg);
  border: 1px solid var(--accent); border-radius: 5px;
  padding: 4px 6px; font: inherit;
}
```

- [ ] **Step 3: Manually verify in Chrome**

Reload the extension. Open the popup with a couple of workspaces:
- Icons are hidden at rest on non-active rows, visible on hover, and always visible on the active row.
- ✎ → input appears with text selected. Type a new name, Enter → renamed. ✎ → Esc → unchanged. ✎ → clear all → Enter → reverts to old name (handler keeps it).
- Clicking ✎ does not switch workspaces.

- [ ] **Step 4: Commit**

```bash
git add popup.js popup.css
git commit -m "feat: inline rename with hover-revealed row icons"
```

---

### Task 6: Update docs (README + CLAUDE.md)

Document the new messages, the move feature, and the manual smoke steps.

**Files:**
- Modify: `README.md` (usage notes for move + rename)
- Modify: `CLAUDE.md` (message protocol list, data-flow note)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update CLAUDE.md message protocol**

In `CLAUDE.md`, in the "Message protocol" list, add after the `switch` line:

```
- `moveTab` `{ targetId }` -> moves the working window's active tab into an
  existing workspace (stash + close the live tab). No swap. Rejects non-http/https
  tabs and the active workspace as target.
- `moveTabToNew` `{ name }` -> creates a new workspace seeded with the active tab,
  then stashes it. No swap. Stays in the current workspace.
```

And update the `getState` line to note the added field:

```
- `getState` -> returns `{ workspaces, activeWorkspaceId, activeTab }` where
  `activeTab` is `{ url, title, favIconUrl, trackable } | null` for the move strip.
```

- [ ] **Step 2: Update README usage**

In `README.md`, add a short "Move a tab" and "Rename" section describing: open the popup, use the move strip's picker to send the current tab to another (or new) workspace; click the pencil on a row to rename. Add the manual smoke steps from the spec's Testing section.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document move-tab and rename features"
```

---

## Self-Review notes

- **Spec coverage:** Feature 1 (moveTab/moveTabToNew, guards, Default state) → Tasks 1+3. Active tab in getState → Task 2. Move strip Option A → Task 4. Inline rename + hover icons → Task 5. Invariants 1/4/5/6/7 → enforced in Task 3 (`closeMovedTab`, trackable guard, `getCurrentWindowId`, `setState`) and validated in Task 3 Step 4. Testing → Node unit test (Task 1) + manual smoke (Tasks 3–5) + README (Task 6).
- **Type consistency:** `buildMovedState`/`buildNewWorkspaceState` signatures match between Task 1 (definition) and Task 3 (use). `activeTab` shape `{ url, title, favIconUrl, trackable }` consistent between Task 2 and Task 4. `NEW_OPTION` sentinel only used within Task 4. Message names `moveTab`/`moveTabToNew` consistent across Tasks 3, 4, 6.
- **Permissions:** no new permission added — only `tabs` + `storage` used.
