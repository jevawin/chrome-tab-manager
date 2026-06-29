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
  // Idempotent: the tab may already be gone (e.g. the user closed it between
  // saving state and this call). The end state — tab closed — is what we want,
  // so a "No tab with id" rejection is not an error.
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    if (!/No tab with id/i.test(String(e))) throw e;
  }
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

// Move the active tab into a brand-new workspace AND follow it there: the new
// workspace becomes active and the window is left showing just that tab. Unlike
// a swap, the moved tab is never closed/reopened — it stays open as-is (no flash,
// keeps its scroll/form state); we only close the other tabs around it.
async function moveActiveTabToNew(name) {
  const clean = cleanName(name);
  if (!clean) throw new Error("Name is required");
  const winId = await getCurrentWindowId();
  if (winId == null) throw new Error("No working window");
  const state = await getState();
  const { tab, saveable } = await resolveActiveSaveableTab(winId);
  const id = crypto.randomUUID();

  // Mute live tracking while we reshape the window (same reason as the swap).
  await setSwapping(true);
  try {
    // Save the workspace we're leaving WITHOUT the moved tab, so it doesn't
    // keep a copy. Skipped in Default state (no active source — invariant 4).
    if (state.activeWorkspaceId) {
      const src = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
      if (src) {
        const winTabs = await chrome.tabs.query({ windowId: winId });
        src.tabs = winTabs
          .filter((t) => t.id !== tab.id && isTrackableUrl(t.url))
          .map((t) => ({ url: t.url, pinned: !!t.pinned }));
      }
    }
    // Add the new workspace seeded with the moved tab and make it active.
    state.workspaces.push({ id, name: clean, tabs: [saveable] });
    state.activeWorkspaceId = id;
    await setState(state);

    // Keep the moved tab open; close everything else. The moved tab remains, so
    // the window never empties (invariant 1).
    const others = (await chrome.tabs.query({ windowId: winId }))
      .map((t) => t.id)
      .filter((tid) => tid !== tab.id);
    if (others.length) await chrome.tabs.remove(others);
  } finally {
    await setSwapping(false);
  }
  return state.workspaces.find((w) => w.id === id);
}

// ---------- Message router (popup -> background) ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "getState": {
          const state = await getState();
          const activeTab = await readActiveTab();
          sendResponse({ ...state, activeTab });
          break;
        }
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
        case "moveTab":
          await moveActiveTab(msg.targetId);
          sendResponse({ ok: true });
          break;
        case "moveTabToNew":
          sendResponse({ ok: true, ws: await moveActiveTabToNew(msg.name) });
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
  module.exports = { buildMovedState, moveActiveTab, moveActiveTabToNew };
}
