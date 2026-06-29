# Handoff: per-workspace icons

Paste this into a fresh session to kick off the feature.

---

Add **per-workspace icons** to this Chrome extension: each workspace gets an icon
the user picks from a Lucide set, shown in the popup's workspace list.

Read `CLAUDE.md` first (architecture, invariants, data model, message protocol,
file map, test/harness setup). Then brainstorm this with me before any code —
use the brainstorming skill.

A few things to hold onto going in:

- Constraints: MV3, vanilla JS, no build, no dependencies, `tabs`+`storage` only,
  popup stays dumb. Icons are inlined Lucide SVGs via the `ICON_SVG()` helper in
  `popup.js`.
- A picker over many icons wants a real name→path map, not hand-pasted consts —
  figure out the cleanest approach during brainstorming.
- Exclude the icons the UI already uses from the pickable set: square-pen,
  trash-2, save, folder-plus, list-end, check, folder.
- Data model: add an `icon` field to each workspace, backward-compatible (default
  to the folder mark when absent).
- Open design question for brainstorming: where the icon shows (replace the
  leading dot? the folder count-glyph? a new element?) and how it plays with the
  active-dot and green-on-hover count.

Flow: brainstorm → spec → plan → subagent-driven implementation.
