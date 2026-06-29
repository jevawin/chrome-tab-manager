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

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = ws.name;

    // Tab count shown as the folder mark + the number (no "tabs" word).
    const count = document.createElement("span");
    count.className = "count";
    const n = ws.tabs ? ws.tabs.length : 0;
    count.innerHTML = ICON_FOLDER + `<span class="count-n">${n}</span>`;
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

    li.append(dot, label, right);
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

syncButtons();
render();
