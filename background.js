// Spaces — Workspace Swap
// Background service worker (MV3).
// Owns all state, live tab tracking, and the swap.

// ---------- State helpers ----------
// Persistent data lives in chrome.storage.local.
// The transient "swapping" guard lives in chrome.storage.session
// so it is cleared on browser restart and never sticks.

async function getState() {
  const s = await chrome.storage.local.get({ workspaces: [], activeWorkspaceId: null });
  return s;
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function isSwapping() {
  const s = await chrome.storage.session.get({ swapping: false });
  return s.swapping;
}

async function setSwapping(v) {
  await chrome.storage.session.set({ swapping: v });
}

// Get the window the user is actually working in (not the popup).
async function getCurrentWindowId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? tab.windowId : null;
}

function isTrackableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// Read the current window's tabs as a saveable list.
async function readWindowTabs(winId) {
  const tabs = await chrome.tabs.query({ windowId: winId });
  return tabs
    .filter((t) => isTrackableUrl(t.url))
    .map((t) => ({ url: t.url, pinned: !!t.pinned }));
}

// Save the current window's tabs into a given workspace.
async function snapshotInto(wsId, winId) {
  if (!wsId || winId == null) return;
  const saved = await readWindowTabs(winId);
  const { workspaces } = await getState();
  const ws = workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  ws.tabs = saved;
  await setState({ workspaces });
}

// ---------- Pure move helpers (unit-tested in Node) ----------
// These transform a state object only. They never touch chrome.tabs/storage,
// so they stay testable without the Chrome runtime. Callers persist the result.

function buildMovedState(state, targetId, tab) {
  if (!state.workspaces.some((w) => w.id === targetId)) {
    throw new Error("target not found");
  }
  return {
    ...state,
    workspaces: state.workspaces.map((w) =>
      w.id === targetId ? { ...w, tabs: [...(w.tabs || []), tab] } : w
    ),
  };
}

function buildNewWorkspaceState(state, name, tab, id) {
  const ws = { id, name, tabs: [tab] };
  return { ...state, workspaces: [...state.workspaces, ws] };
}

// ---------- Live tracking (spec 3) ----------
// On any tab change, snapshot the current window into the active workspace.
// Muted while swapping, and when no workspace is active (Default state).

let debounceTimer = null;
function scheduleSync() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, 400);
}

async function syncNow() {
  debounceTimer = null;
  if (await isSwapping()) return;
  const { activeWorkspaceId } = await getState();
  if (!activeWorkspaceId) return; // Default (null) state: nothing to track
  const winId = await getCurrentWindowId();
  await snapshotInto(activeWorkspaceId, winId);
}

chrome.tabs.onCreated.addListener(scheduleSync);
chrome.tabs.onRemoved.addListener(scheduleSync);
chrome.tabs.onMoved.addListener(scheduleSync);
chrome.tabs.onUpdated.addListener((id, info) => {
  // Only react to URL changes or a finished load, not every keystroke event.
  if (info.url || info.status === "complete") scheduleSync();
});

// ---------- Actions ----------

// Name is mandatory. Returns a trimmed name or null if blank.
function cleanName(name) {
  const n = (name || "").trim();
  return n.length ? n : null;
}

// "Save current tabs": adopt the current window as a new workspace.
// Does NOT swap — the open tabs stay, now tracked under the new name.
async function createWorkspace(name) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const winId = await getCurrentWindowId();
  const tabs = await readWindowTabs(winId);
  const ws = {
    id: crypto.randomUUID(),
    name: clean,
    tabs
  };
  const state = await getState();
  state.workspaces.push(ws);
  state.activeWorkspaceId = ws.id; // creating one drops you into it
  await setState(state);
  return ws;
}

// "Start empty": create an empty workspace, then swap into it.
// The swap closes the current tabs and opens one blank tab, so the
// user lands in a fresh, tracked space. All swap invariants are
// inherited from switchWorkspace (save outgoing, guard, open-before-close).
async function createEmptyWorkspace(name) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const ws = {
    id: crypto.randomUUID(),
    name: clean,
    tabs: []
  };
  const state = await getState();
  state.workspaces.push(ws);
  await setState(state);
  await switchWorkspace(ws.id);
  return ws;
}

async function deleteWorkspace(id) {
  const state = await getState();
  state.workspaces = state.workspaces.filter((w) => w.id !== id);
  if (state.activeWorkspaceId === id) state.activeWorkspaceId = null;
  await setState(state);
}

async function renameWorkspace(id, name) {
  const state = await getState();
  const ws = state.workspaces.find((w) => w.id === id);
  if (ws) ws.name = (name && name.trim()) || ws.name;
  await setState(state);
}

// The swap (spec 4). Open new tabs, then close old. Guarded so the
// close events do not wipe the workspace we are leaving.
async function switchWorkspace(targetId) {
  const winId = await getCurrentWindowId();
  if (winId == null) return;

  const state = await getState();
  const target = state.workspaces.find((w) => w.id === targetId);
  if (!target) return;

  // 1. Save the workspace we are leaving, while its tabs are still open.
  if (state.activeWorkspaceId && state.activeWorkspaceId !== targetId) {
    await snapshotInto(state.activeWorkspaceId, winId);
  }

  // 2. Mute live tracking for the duration of the swap.
  await setSwapping(true);
  try {
    // 3. Capture the tabs to close BEFORE opening anything new.
    const oldTabs = await chrome.tabs.query({ windowId: winId });
    const oldIds = oldTabs.map((t) => t.id);

    // 4. Open the target workspace's tabs first (so the window never empties).
    const urls = target.tabs || [];
    if (urls.length === 0) {
      await chrome.tabs.create({ windowId: winId }); // one blank tab
    } else {
      for (const t of urls) {
        await chrome.tabs.create({ windowId: winId, url: t.url, pinned: t.pinned });
      }
    }

    // 5. Close the old tabs.
    if (oldIds.length) await chrome.tabs.remove(oldIds);

    // 6. Mark the target active.
    await setState({ activeWorkspaceId: targetId });
  } finally {
    // 7. Always release the guard, even if something above threw.
    await setSwapping(false);
  }
}

// ---------- Message router (popup -> background) ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "getState":
          sendResponse(await getState());
          break;
        case "create":
          sendResponse({ ok: true, ws: await createWorkspace(msg.name) });
          break;
        case "createEmpty":
          sendResponse({ ok: true, ws: await createEmptyWorkspace(msg.name) });
          break;
        case "switch":
          await switchWorkspace(msg.id);
          sendResponse({ ok: true });
          break;
        case "delete":
          await deleteWorkspace(msg.id);
          sendResponse({ ok: true });
          break;
        case "rename":
          await renameWorkspace(msg.id, msg.name);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep the channel open for the async work
});

// Exported for unit tests (Node). Harmless no-op in the service worker.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildMovedState, buildNewWorkspaceState };
}
