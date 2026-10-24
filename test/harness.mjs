// A stand-in for Agent Control's plugin runtime (SDK v1), close enough to catch what the real one would refuse:
// the manifest must declare every route, tool and event; SQL runs through SQLite's authorizer and may only touch
// the plugin's own tables; migrations run in order with {{table}} expansion. No Agent Control checkout needed.
import { DatabaseSync, constants as C } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const prefix = `plugin_${manifest.id.replace(/-/g, "_")}__`;

const expand = (sql) => sql.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_m, t) => {
  if (!manifest.tables.includes(t)) throw new Error(`Table "${t}" is not declared under tables in manifest.json`);
  return prefix + t;
});

function authorizer(ddl) {
  const own = (n) => typeof n === "string" && n.startsWith(prefix);
  const internal = (n) => ddl && (n === "sqlite_master" || n === "sqlite_sequence");
  return (action, a1, a2, dbName) => {
    if (dbName && dbName !== "main") return C.SQLITE_DENY;
    switch (action) {
      case C.SQLITE_SELECT: case C.SQLITE_RECURSIVE: case C.SQLITE_FUNCTION: return C.SQLITE_OK;
      case C.SQLITE_READ: return a1 === "" || own(a1) || internal(a1) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_INSERT: case C.SQLITE_UPDATE: case C.SQLITE_DELETE: return own(a1) || internal(a1) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_CREATE_TABLE: case C.SQLITE_DROP_TABLE: return ddl && (own(a1) || internal(a1)) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_CREATE_INDEX: case C.SQLITE_DROP_INDEX: return ddl && own(a1) && own(a2) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_REINDEX: return ddl && own(a1) ? C.SQLITE_OK : C.SQLITE_DENY;
      case C.SQLITE_ALTER_TABLE: return ddl && own(a2) ? C.SQLITE_OK : C.SQLITE_DENY;
      default: return C.SQLITE_DENY;
    }
  };
}

/**
 * Loads the plugin into a fake runtime. Returns helpers to call tools and routes and to emit events, like
 * Agent Control does: tool(name, args, {ws, taskId}), route(method, path, {ws, query, body}), emit(kind, event, ws).
 */
export async function load(plugin, { settings = {} } = {}) {
  const db = new DatabaseSync(":memory:");
  const guarded = (ddl, fn) => { db.setAuthorizer(authorizer(ddl)); try { return fn(); } finally { db.setAuthorizer(null); } };
  for (const f of readdirSync(join(ROOT, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    guarded(true, () => db.exec(expand(readFileSync(join(ROOT, "migrations", f), "utf8"))));
  }
  const routes = [], tools = new Map(), events = new Map(), logs = [];
  const prep = (sql) => guarded(false, () => db.prepare(expand(sql)));
  const ctx = {
    id: manifest.id, manifest,
    log: { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), error: (m) => logs.push(["error", m]) },
    db: {
      run: (s, ...a) => { const r = prep(s).run(...a); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
      all: (s, ...a) => prep(s).all(...a),
      get: (s, ...a) => prep(s).get(...a),
    },
    routes: { handle(method, path, handler) {
      if (!manifest.routes.some((r) => r.method === method && r.path === path)) throw new Error(`Route ${method} ${path} is not declared in manifest.json`);
      routes.push({ method, segs: path.split("/").filter(Boolean), handler });
    } },
    tools: { register(name, handler) {
      if (!manifest.tools.some((t) => t.name === name)) throw new Error(`Tool ${name} is not declared in manifest.json`);
      tools.set(name, handler);
    } },
    events: { on(kind, handler) {
      if (!manifest.events.includes(kind)) throw new Error(`Event ${kind} is not declared in manifest.json`);
      events.set(kind, [...(events.get(kind) ?? []), handler]);
    } },
    settings: { get: (ws) => settings[ws] ?? {} },
    secrets: { get: () => null },
  };
  await plugin.onLoad(ctx);
  // Results go through JSON like they do in Agent Control (tool results and route responses are serialised).
  const roundtrip = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    db, ctx, logs, tools, routes, settings,
    async tool(name, args = {}, { ws = "ws-a", taskId = "task-1" } = {}) {
      const h = tools.get(name);
      if (!h) throw new Error(`No tool ${name}`);
      for (const [k, p] of Object.entries(manifest.tools.find((t) => t.name === name).params)) {
        if (!p.optional && args[k] === undefined) throw new Error(`missing required param ${k}`);
      }
      return roundtrip(await h(args, { workspaceId: ws, taskId }));
    },
    async route(method, path, { ws = "ws-a", query = {}, body } = {}) {
      const segs = path.split("/").filter(Boolean);
      for (const r of routes) {
        if (r.method !== method || r.segs.length !== segs.length) continue;
        const params = {};
        if (!r.segs.every((s, i) => (s.startsWith(":") ? ((params[s.slice(1)] = segs[i]), true) : s === segs[i]))) continue;
        return roundtrip(await r.handler({ params, query, body, workspaceId: ws }));
      }
      throw new Error(`No route ${method} ${path}`);
    },
    async emit(kind, event, ws = "ws-a") {
      for (const h of events.get(kind) ?? []) await h({ kind, summary: "", data: {}, taskId: null, runId: null, ...event }, { workspaceId: ws });
    },
    async unload() { await plugin.onUnload?.(); db.close(); },
  };
}

/** A clock you can move: { now: () => Date, advance(minutes) }. */
export function clock(start = "2026-10-24T09:00:00.000Z") {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (min) => { t += min * 60_000; }, days: (d) => { t += d * 86_400_000; } };
}
