// Spaces — Workspace Swap (popup)

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

const listEl = document.getElementById("list");
const nameEl = document.getElementById("name");
const saveEl = document.getElementById("save");
const emptyEl = document.getElementById("empty");

const moveStrip = document.getElementById("moveStrip");
const moveLabel = document.getElementById("moveLabel");
const movePick = document.getElementById("movePick");
const moveNew = document.getElementById("moveNew");
const moveNewName = document.getElementById("moveNewName");
const moveNewGo = document.getElementById("moveNewGo");

const NEW_OPTION = "__new__";

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
    const li = document.createElement("li");
    li.className = "item" + (ws.id === activeWorkspaceId ? " active" : "");

    const dot = document.createElement("span");
    dot.className = "dot";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = ws.name;

    const count = document.createElement("span");
    count.className = "count";
    const n = ws.tabs ? ws.tabs.length : 0;
    count.textContent = n === 1 ? "1 tab" : n + " tabs";

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
        // preventDefault so Escape doesn't close the whole popup and Enter
        // doesn't activate a sibling row button.
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
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
  await send({ type: "moveTabToNew", name: moveNewName.value.trim() });
  render();
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
