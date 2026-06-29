// Integration tests for the move ACTIONS against an in-memory chrome fake.
// The pure-helper tests (move.test.js) can't cover the chrome.* control flow
// (window reshaping, follow-the-tab, source save), so these do — deterministically,
// without a real browser.

const { test } = require("node:test");
const assert = require("node:assert");

// background.js registers listeners at load; give it stubs so require() succeeds.
const noopListener = { addListener() {} };
globalThis.chrome = {
  tabs: { onCreated: noopListener, onRemoved: noopListener, onMoved: noopListener, onUpdated: noopListener },
  runtime: { onMessage: noopListener },
};

const { moveActiveTab, moveActiveTabToNew } = require("../background.js");

// --- in-memory chrome fake (deep-copies on get/set like real storage) ---
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
    // single-window model: lastFocusedWindow matches everything
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
        tabStore = tabStore.filter((t) => !arr.includes(t.id));
        return Promise.resolve();
      },
      onCreated: noopListener, onRemoved: noopListener, onMoved: noopListener, onUpdated: noopListener,
    },
    runtime: { onMessage: noopListener },
    _peek: { local: () => localStore, session: () => sessionStore, tabs: () => tabStore },
  };
}

const winTabs = () => [
  { id: 1, windowId: 1, url: "https://a.com/", active: false, pinned: false },
  { id: 2, windowId: 1, url: "https://b.com/", active: true, pinned: false }, // the active/moved tab
  { id: 3, windowId: 1, url: "https://c.com/", active: false, pinned: false },
];

test("moveActiveTabToNew follows the tab: new workspace active, source loses the tab, only the moved tab stays open", async () => {
  const fake = makeChrome({
    local: { workspaces: [{ id: "src", name: "Src", tabs: [] }], activeWorkspaceId: "src" },
    tabs: winTabs(),
  });
  globalThis.chrome = fake;

  await moveActiveTabToNew("New");

  const local = fake._peek.local();
  const created = local.workspaces.find((w) => w.name === "New");

  assert.ok(created, "a workspace named New exists");
  assert.strictEqual(local.activeWorkspaceId, created.id, "followed: new workspace is active");
  assert.deepStrictEqual(created.tabs, [{ url: "https://b.com/", pinned: false }], "new workspace holds the moved tab");

  const src = local.workspaces.find((w) => w.id === "src");
  assert.deepStrictEqual(
    src.tabs,
    [{ url: "https://a.com/", pinned: false }, { url: "https://c.com/", pinned: false }],
    "source saved WITHOUT the moved tab"
  );

  const remaining = fake._peek.tabs();
  assert.deepStrictEqual(remaining.map((t) => t.id), [2], "only the moved tab stays open (others closed, window not empty)");
  assert.strictEqual(fake._peek.session().swapping, false, "swapping guard released");
});

test("moveActiveTabToNew in Default state (no active source) still creates and follows", async () => {
  const fake = makeChrome({
    local: { workspaces: [], activeWorkspaceId: null },
    tabs: winTabs(),
  });
  globalThis.chrome = fake;

  await moveActiveTabToNew("Fresh");

  const local = fake._peek.local();
  const created = local.workspaces.find((w) => w.name === "Fresh");
  assert.ok(created);
  assert.strictEqual(local.activeWorkspaceId, created.id);
  assert.deepStrictEqual(created.tabs, [{ url: "https://b.com/", pinned: false }]);
  assert.deepStrictEqual(fake._peek.tabs().map((t) => t.id), [2], "others closed, moved tab stays");
});

test("moveActiveTab (existing) stashes into target and stays put", async () => {
  const fake = makeChrome({
    local: {
      workspaces: [{ id: "src", name: "Src", tabs: [] }, { id: "dst", name: "Dst", tabs: [{ url: "https://x.com/", pinned: false }] }],
      activeWorkspaceId: "src",
    },
    tabs: winTabs(),
  });
  globalThis.chrome = fake;

  await moveActiveTab("dst");

  const local = fake._peek.local();
  assert.strictEqual(local.activeWorkspaceId, "src", "move-to-existing stays put");
  const dst = local.workspaces.find((w) => w.id === "dst");
  assert.deepStrictEqual(
    dst.tabs,
    [{ url: "https://x.com/", pinned: false }, { url: "https://b.com/", pinned: false }],
    "moved tab appended to target"
  );
  assert.deepStrictEqual(fake._peek.tabs().map((t) => t.id), [1, 3], "moved tab closed from the window");
});

test("moveActiveTab rejects a non-http(s) active tab", async () => {
  const fake = makeChrome({
    local: { workspaces: [{ id: "dst", name: "Dst", tabs: [] }], activeWorkspaceId: null },
    tabs: [{ id: 1, windowId: 1, url: "chrome://extensions", active: true, pinned: false }],
  });
  globalThis.chrome = fake;
  await assert.rejects(() => moveActiveTab("dst"), /can't be moved/i);
});
