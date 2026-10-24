// Hive: shared memory and coordination for agent teams (Agent Control plugin, SDK v1).
// Wires the core in lib/hive.mjs to agent tools, routes, events and the page. See README.md.
import { fileURLToPath } from "node:url";
import { Hive } from "./lib/hive.mjs";
import { writePage } from "./lib/page.mjs";

const SWEEP_MS = 60_000;
const PAGE_DEBOUNCE_MS = 1_500;

/** Builds the plugin object. `pageFile: null` turns the generated page off (tests). */
export function createPlugin({ pageFile = fileURLToPath(new URL("./ui/index.html", import.meta.url)), now } = {}) {
  let hive = null, ctx = null, sweepTimer = null, pageTimer = null;

  const renderNow = () => {
    if (pageTimer) clearTimeout(pageTimer);
    pageTimer = null;
    if (!pageFile || !hive) return;
    try {
      const workspaces = {};
      for (const ws of hive.enabledWorkspaces()) workspaces[ws] = hive.snapshot(ws);
      writePage(pageFile, { generatedAt: hive.now(), workspaces });
    } catch (e) { ctx?.log.warn(`page not updated: ${e.message}`); }
  };
  const schedulePage = () => {
    if (!pageFile || pageTimer) return;
    pageTimer = setTimeout(renderNow, PAGE_DEBOUNCE_MS);
    pageTimer.unref?.();
  };

  const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const id = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw new Error("id must be a positive number"); return n; };

  return {
    onLoad(c) {
      ctx = c;
      hive = new Hive(c.db, { settings: (ws) => c.settings.get(ws), onChange: schedulePage, now });
      const tool = (name, fn) => c.tools.register(name, (args, info) => fn(info.workspaceId, args ?? {}, { taskId: info.taskId }));

      tool("briefing", (ws, a, t) => hive.briefing(ws, a, t));
      tool("remember", (ws, a, t) => hive.remember(ws, { ...a, pinned: false }, t));
      tool("recall", (ws, a, t) => hive.recall(ws, a, t));
      tool("confirm", (ws, a, t) => hive.confirm(ws, a.id, t));
      tool("dispute", (ws, a, t) => hive.dispute(ws, a.id, a.reason, t));
      tool("claim", (ws, a, t) => hive.claim(ws, a, t));
      tool("release", (ws, a, t) => hive.release(ws, a, t));
      tool("claims", (ws, a, t) => hive.activeClaims(ws, a, t));
      tool("log_work", (ws, a, t) => hive.logWork(ws, a, t));
      tool("history", (ws, a) => hive.history(ws, a));

      const route = (method, path, fn) => c.routes.handle(method, path, (req) => fn(req.workspaceId, req));
      route("GET", "/memories", (ws, r) => ({ memories: hive.list(ws, r.query) }));
      route("POST", "/memories", (ws, r) => hive.remember(ws, r.body ?? {}, { source: "dashboard" }));
      route("PATCH", "/memories/:id", (ws, r) => ({ memory: hive.update(ws, id(r), r.body ?? {}) }));
      route("DELETE", "/memories/:id", (ws, r) => hive.remove(ws, id(r)));
      route("GET", "/claims", (ws, r) => hive.activeClaims(ws, { project: r.query.project, resource: r.query.resource }));
      route("DELETE", "/claims/:id", (ws, r) => hive.forceRelease(ws, id(r)));
      route("GET", "/activity", (ws, r) => ({ activity: hive.activity(ws, num(r.query.limit)) }));
      route("GET", "/stats", (ws) => hive.stats(ws));
      route("GET", "/export", (ws) => hive.export(ws));
      route("POST", "/import", (ws, r) => hive.import(ws, r.body));

      c.events.on("task.created", (e, info) => hive.onTaskCreated(info.workspaceId, e));
      c.events.on("task.status", (e, info) => hive.onTaskStatus(info.workspaceId, e));
      c.events.on("run.status", (e, info) => hive.onRunStatus(info.workspaceId, e));
      c.events.on("board.message", (e, info) => { hive.onBoardMessage(info.workspaceId, e); });

      sweepTimer = setInterval(() => { try { if (hive.sweep()) schedulePage(); } catch (e) { c.log.warn(`sweep: ${e.message}`); } }, SWEEP_MS);
      sweepTimer.unref?.();
      renderNow();
      c.log.info("Hive loaded");
    },
    onEnable({ workspaceId }) { hive.setEnabled(workspaceId, true); renderNow(); },
    onDisable({ workspaceId }) { hive.setEnabled(workspaceId, false); renderNow(); },
    onUnload() {
      if (sweepTimer) clearInterval(sweepTimer);
      if (pageTimer) clearTimeout(pageTimer);
      sweepTimer = pageTimer = null;
    },
    /** For tests: the core behind the plugin. */
    get hive() { return hive; },
  };
}

export default createPlugin();
