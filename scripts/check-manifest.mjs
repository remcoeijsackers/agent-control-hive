// Checks manifest.json against the plugin SDK v1 rules without an Agent Control checkout, plus the folder rules
// install enforces (entry file, nav pages, no symlinks, migrations only use declared tables). Exit code 1 on problems.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };

const RESERVED_IDS = ["core", "agent-control", "plugins", "mail", "propose", "outbox", "status", "admin", "api", "system", "integrations", "nav", "ui"];
const RESERVED_SEGS = ["workspaces", "secrets", "settings", "ui", "enable", "logs"];
const PERMS = ["db", "routes", "tools", "events", "settings", "secrets"];
const EVENTS = ["task.created", "task.status", "run.status", "board.message"];
const ident = /^[a-z][a-z0-9_]{0,30}$/;

need(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(m.id) && !m.id.includes("--") && !RESERVED_IDS.includes(m.id), `id "${m.id}" is not a valid plugin id`);
need(typeof m.name === "string" && m.name.length >= 1 && m.name.length <= 80, "name: 1-80 characters");
need(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m.version), "version must be semver");
need(m.sdk === 1, "sdk must be 1");
need(typeof m.description === "string" && m.description.length >= 1 && m.description.length <= 600, "description: 1-600 characters");
need(!m.author || m.author.length <= 120, "author: at most 120 characters");
need((m.permissions ?? []).every((p) => PERMS.includes(p)), "unknown permission");
const has = (p) => (m.permissions ?? []).includes(p);
for (const [field, perm] of [["tables", "db"], ["routes", "routes"], ["tools", "tools"], ["events", "events"], ["settings", "settings"], ["secrets", "secrets"]]) {
  if ((m[field] ?? []).length) need(has(perm), `declares ${field} but lacks permission "${perm}"`);
}
need((m.tables ?? []).length <= 20 && (m.tables ?? []).every((t) => ident.test(t)), "tables: at most 20, lowercase identifiers");
need((m.tools ?? []).length <= 20, "tools: at most 20");
for (const t of m.tools ?? []) {
  need(ident.test(t.name), `tool name ${t.name}`);
  need(t.description?.length >= 1 && t.description.length <= 500, `tool ${t.name}: description 1-500 characters (has ${t.description?.length})`);
  for (const [k, p] of Object.entries(t.params ?? {})) {
    need(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k), `tool ${t.name}: param name ${k}`);
    need(["string", "number", "boolean", undefined].includes(p.type), `tool ${t.name}.${k}: type`);
    need(!p.description || p.description.length <= 300, `tool ${t.name}.${k}: description at most 300 characters`);
  }
}
need((m.routes ?? []).length <= 40, "routes: at most 40");
for (const r of m.routes ?? []) {
  need(["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method), `route ${r.method} ${r.path}: method`);
  need(/^\/[a-zA-Z0-9_\-/:]*$/.test(r.path) && !RESERVED_SEGS.includes(r.path.split("/")[1] ?? ""), `route ${r.path}: path`);
}
need((m.events ?? []).every((e) => EVENTS.includes(e)), "unknown event");
need((m.settings ?? []).length <= 40, "settings: at most 40");
for (const s of m.settings ?? []) {
  need(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(s.key), `setting key ${s.key}`);
  need(["string", "url", "number", "boolean", "select", "list"].includes(s.type ?? "string"), `setting ${s.key}: type`);
  need(s.label?.length >= 1 && s.label.length <= 120, `setting ${s.key}: label`);
  need(!s.help || s.help.length <= 400, `setting ${s.key}: help at most 400 characters`);
}
need((m.nav ?? []).length <= 5, "nav: at most 5");

// Folder rules checked at install time.
need(existsSync(join(root, m.main ?? "index.mjs")), `entry file ${m.main} not found`);
for (const n of m.nav ?? []) need(existsSync(join(root, "ui", n.page ?? "index.html")), `nav page ui/${n.page} not found`);
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    if (f === ".git" || f === "node_modules") continue;
    const p = join(dir, f), st = lstatSync(p);
    if (st.isSymbolicLink()) problems.push(`symlink ${p} (not allowed in a plugin folder)`);
    else if (st.isDirectory()) walk(p);
  }
})(root);
for (const f of readdirSync(join(root, "migrations")).filter((x) => x.endsWith(".sql"))) {
  const sql = readFileSync(join(root, "migrations", f), "utf8").replace(/--[^\n]*/g, "");
  for (const [, t] of sql.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)) need((m.tables ?? []).includes(t), `${f}: table "${t}" is not declared`);
  need(!/\bTEXT\s+PRIMARY\s+KEY\b|\bUNIQUE\s*\(/i.test(sql), `${f}: TEXT PRIMARY KEY / inline UNIQUE create sqlite_autoindex_* indexes, which the plugin sandbox refuses; use a named CREATE UNIQUE INDEX`);
}

if (problems.length) {
  console.error(`manifest check failed:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`manifest ok: ${m.id} ${m.version}, ${m.tools.length} tools, ${m.routes.length} routes, ${m.events.length} events, ${m.tables.length} tables`);
