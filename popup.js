// Spaces — Workspace Swap (popup)

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

const listEl = document.getElementById("list");
const nameEl = document.getElementById("name");
const saveEl = document.getElementById("save");
const emptyEl = document.getElementById("empty");

// Name is mandatory: both create buttons stay disabled until the
// field holds non-whitespace text.
function syncButtons() {
  const ok = nameEl.value.trim().length > 0;
  saveEl.disabled = !ok;
  emptyEl.disabled = !ok;
}

async function render() {
  const { workspaces, activeWorkspaceId } = await send({ type: "getState" });
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

    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "\u2715"; // ✕
    x.title = "Delete workspace";

    // Click the row -> switch (swap tabs). Active row does nothing.
    li.addEventListener("click", async () => {
      if (ws.id === activeWorkspaceId) return;
      await send({ type: "switch", id: ws.id });
      window.close();
    });

    // Delete without triggering the switch.
    x.addEventListener("click", async (e) => {
      e.stopPropagation();
      await send({ type: "delete", id: ws.id });
      render();
    });

    li.append(dot, label, count, x);
    listEl.appendChild(li);
  }
}

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
