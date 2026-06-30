// Spaces — Workspace Swap (popup)

// Dev-only logging: active when loaded unpacked, silent in Web Store builds.
// (Mirrors the helper in background.js; kept inline so there's no shared module
// to load and no build step.)
const SPACES_DEBUG = (() => {
  try {
    return !("update_url" in chrome.runtime.getManifest());
  } catch (_) {
    return false;
  }
})();
function dlog(...args) {
  if (SPACES_DEBUG) console.log("[SPACES]", ...args);
}

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    dlog("sent", msg.type, "->", res);
    return res;
  });
}

const listEl = document.getElementById("list");
const nameEl = document.getElementById("name");
const saveEl = document.getElementById("save");
const emptyEl = document.getElementById("empty");

const moveStrip = document.getElementById("moveStrip");
const moveFav = document.getElementById("moveFav");
const moveIcon = document.getElementById("moveIcon");
const moveLabel = document.getElementById("moveLabel");

// Show the tab's favicon when we have one, falling back to the ↪ glyph.
// A broken favicon URL triggers onerror, which restores the glyph.
function showMoveIcon(favIconUrl) {
  if (favIconUrl) {
    moveFav.src = favIconUrl;
    moveFav.hidden = false;
    moveIcon.hidden = true;
  } else {
    moveFav.removeAttribute("src");
    moveFav.hidden = true;
    moveIcon.hidden = false;
  }
}
moveFav.addEventListener("error", () => {
  moveFav.hidden = true;
  moveIcon.hidden = false;
});
const movePick = document.getElementById("movePick");
const moveNew = document.getElementById("moveNew");
const moveNewName = document.getElementById("moveNewName");
const moveNewGo = document.getElementById("moveNewGo");

const NEW_OPTION = "__new__";

// Which workspace row is showing the inline "Delete?" confirm (or null).
let confirmingId = null;

// Lucide icons (https://lucide.dev, ISC). Inlined as SVG to avoid a build step.
// stroke="currentColor" so they take the button's text color.
const ICON_SVG = (paths) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON_EDIT = ICON_SVG(
  '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'
); // square-pen

const ICON_TRASH = ICON_SVG(
  '<path d="M10 11v6"/><path d="M14 11v6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
); // trash-2

const ICON_FOLDER = ICON_SVG(
  '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>' +
    // Solid tab flap (derived from the folder's own geometry) — the "tab"
    // highlighted. currentColor so it follows the muted/green-on-hover state.
    '<path fill="currentColor" stroke="none" d="M2 6 V5 A2 2 0 0 1 4 3 H7.93 A2 2 0 0 1 9.6 3.9 L10.41 5.1 A2 2 0 0 0 12.1 6 Z"/>'
); // folder — the extension's mark, used as the tab-count glyph

const ICON_CHECK = ICON_SVG('<path d="M20 6 9 17l-5-5"/>'); // check

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

// Name is mandatory: both create buttons stay disabled until the
// field holds non-whitespace text.
function syncButtons() {
  const ok = nameEl.value.trim().length > 0;
  saveEl.disabled = !ok;
  emptyEl.disabled = !ok;
}

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
    showMoveIcon(null);
    moveLabel.textContent = "Can't move this page";
    moveLabel.title = "";
    moveLabel.classList.add("muted-label");
    // Clear stale options so the disabled picker doesn't show old workspaces.
    movePick.innerHTML = "";
    movePick.disabled = true;
    return;
  }
  moveLabel.classList.remove("muted-label");
  movePick.disabled = false;
  showMoveIcon(activeTab.favIconUrl);
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

async function render() {
  const { workspaces, activeWorkspaceId, activeTab } = await send({ type: "getState" });
  // Display order is alphabetical (case-insensitive). Doesn't change stored order.
  workspaces.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  renderMoveStrip(workspaces, activeWorkspaceId, activeTab);
  listEl.innerHTML = "";

  if (!workspaces.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No workspaces yet. Save your current tabs below.";
    listEl.appendChild(li);
    return;
  }

  for (const ws of workspaces) {
    const confirming = ws.id === confirmingId;
    const li = document.createElement("li");
    li.className =
      "item" + (ws.id === activeWorkspaceId ? " active" : "") + (confirming ? " confirming" : "");

    // Leading slot: the workspace's chosen icon, or the default sentinel.
    const wsIcon = document.createElement("span");
    wsIcon.className = "ws-icon";
    wsIcon.innerHTML = ws.icon && ws.icon.paths ? ICON_SVG(ws.icon.paths) : ICON_SQUARE_DASHED;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = ws.name;

    // Tab count shown as the folder mark + the number (no "tabs" word).
    const count = document.createElement("span");
    count.className = "count";
    const n = ws.tabs ? ws.tabs.length : 0;
    count.innerHTML = (ws.id === activeWorkspaceId ? ICON_FOLDER_SOLID : ICON_FOLDER) + `<span class="count-n">${n}</span>`;
    count.title = n === 1 ? "1 tab" : n + " tabs";

    const edit = document.createElement("button");
    edit.className = "edit";
    edit.innerHTML = ICON_EDIT; // square-pen
    edit.title = "Rename workspace";

    const x = document.createElement("button");
    x.className = "x";
    x.innerHTML = confirming ? ICON_CHECK : ICON_TRASH; // tick when confirming
    x.title = confirming ? "Confirm delete" : "Delete workspace";

    // Click the row -> switch (swap tabs). Active row does nothing.
    // While a row is mid-confirm, a row click cancels the confirm instead.
    li.addEventListener("click", async () => {
      if (confirmingId) {
        confirmingId = null;
        render();
        return;
      }
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
        // preventDefault so Escape doesn't close the whole popup and Enter
        // doesn't activate a sibling row button.
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
      });
      input.addEventListener("blur", commit);
    });

    // First trash click arms the confirm; the tick (same button) commits.
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirming) {
        confirmingId = ws.id;
        render();
        return;
      }
      await send({ type: "delete", id: ws.id });
      confirmingId = null;
      render();
    });

    const right = document.createElement("span");
    right.className = "row-right";
    if (confirming) {
      // Confirm state: hide count + edit, show "Delete?" next to the tick.
      const ask = document.createElement("span");
      ask.className = "confirm-text";
      ask.textContent = "Delete?";
      right.append(ask, x);
    } else {
      // Group the count and the action icons together at the right edge.
      const rowIcons = document.createElement("span");
      rowIcons.className = "row-icons";
      rowIcons.append(edit, x);
      right.append(count, rowIcons);
    }

    li.append(wsIcon, label, right);
    listEl.appendChild(li);
  }
}

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
  // Move-to-existing now follows the tab into the target, so close like a switch.
  window.close();
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
  await send({ type: "moveTabToNew", name: moveNewName.value.trim() });
  // Move-to-new follows the tab into the new workspace, so close the popup like
  // a switch does — the window has already changed underneath it.
  window.close();
});

saveEl.addEventListener("click", async () => {
  if (saveEl.disabled) return;
  await send({ type: "create", name: nameEl.value });
  nameEl.value = "";
  syncButtons();
  render();
});

emptyEl.addEventListener("click", async () => {
  if (emptyEl.disabled) return;
  await send({ type: "createEmpty", name: nameEl.value });
  window.close(); // Start empty swaps the window; close the popup like a switch.
});

nameEl.addEventListener("input", syncButtons);

nameEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveEl.click();
});

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

syncButtons();
render();
