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
        // Mimic Chrome: if the active tab was closed, activate a neighbour.
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
