// Regenerate icon-data.json from a pinned Lucide release.
// Run:  node tools/gen-icon-data.mjs
// Dev-only. Not shipped, not a runtime dependency — same spirit as the
// rsvg-convert PNG regeneration documented in CLAUDE.md.

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LUCIDE_VERSION = "0.544.0"; // pin deliberately; bump on purpose
const EXCLUDE = new Set([
  "square-pen", "trash-2", "save", "folder-plus", "list-end", "check", "folder", "square-dashed",
]);

// 1. Pull the pinned package tarball into a temp dir (nothing lands in the repo).
const dir = mkdtempSync(join(tmpdir(), "lucide-"));
execSync(`npm pack lucide-static@${LUCIDE_VERSION}`, { cwd: dir, stdio: "inherit" });
const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
execSync(`tar -xzf ${tgz}`, { cwd: dir });
const pkg = join(dir, "package");

// 2. name -> SVG node array (the core geometry).
const iconNodes = JSON.parse(readFileSync(join(pkg, "icon-nodes.json"), "utf8"));
// name -> search tags (default [] if the package build lacks tags.json).
let tags = {};
try { tags = JSON.parse(readFileSync(join(pkg, "tags.json"), "utf8")); } catch { /* name-only search */ }
// category -> [names]; inverted to name -> category. Optional.
const categoryOf = {};
try {
  const cats = JSON.parse(readFileSync(join(pkg, "categories.json"), "utf8"));
  for (const [cat, names] of Object.entries(cats)) {
    for (const n of names) if (!categoryOf[n]) categoryOf[n] = cat;
  }
} catch { /* leave uncategorised -> "Other" */ }

// 3. Serialise nodes into the inner markup ICON_SVG() wraps.
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const serialize = (nodes) =>
  nodes.map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`
  ).join("");

// 4. Build, dropping the app's own UI icons + the default sentinel.
const out = [];
for (const [name, nodes] of Object.entries(iconNodes)) {
  if (EXCLUDE.has(name)) continue;
  out.push({ name, category: categoryOf[name] || "Other", tags: tags[name] || [], paths: serialize(nodes) });
}
out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

writeFileSync(new URL("../icon-data.json", import.meta.url), JSON.stringify(out));
console.log(`wrote icon-data.json: ${out.length} icons (lucide ${LUCIDE_VERSION})`);
