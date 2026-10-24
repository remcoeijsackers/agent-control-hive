import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlugin } from "../index.mjs";
import { renderPage } from "../lib/page.mjs";
import { clock, load, manifest } from "./harness.mjs";

test("every declared tool, route and event is registered", async () => {
  const h = await load(createPlugin({ pageFile: null }));
  assert.deepEqual([...h.tools.keys()].sort(), manifest.tools.map((t) => t.name).sort());
  assert.equal(h.routes.length, manifest.routes.length);
  await h.unload();
});

test("team-board decisions become memories (and can be turned off)", async () => {
  const c = clock();
  const plugin = createPlugin({ pageFile: null, now: c.now });
  const h = await load(plugin, { settings: { "ws-b": { autoCaptureDecisions: false } } });
  const msg = (kind, text) => ({ taskId: "task-a", summary: `Overleg — Claude (${kind}): ${text}` });
  await h.emit("board.message", msg("decision", "We keep the REST API and add GraphQL later."));
  await h.emit("board.message", msg("proposal", "Maybe switch to GraphQL now?"));
  await h.emit("board.message", msg("decision", "x".repeat(10) + " token = abcdefghijklmnop"));
  const r = await h.tool("recall", { query: "graphql rest api" });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].kind, "decision");
  assert.equal(r.results[0].source, "board");
  assert.deepEqual(r.results[0].tags, ["board", "claude"]);
  await h.emit("board.message", msg("decision", "Workspace B decides something important."), "ws-b");
  assert.equal((await h.route("GET", "/stats", { ws: "ws-b" })).memories, 0);
  const long = "y ".repeat(80).trim() + " end";
  await h.emit("board.message", msg("decision", long.slice(0, 160)));
  const last = (await h.route("GET", "/memories")).memories[0];
  assert.match(last.text, /…$/);
});

test("task and run events build the task timeline", async () => {
  const h = await load(createPlugin({ pageFile: null }));
  await h.emit("task.created", { taskId: "t1", summary: "Task AC-1 created" });
  await h.emit("run.status", { taskId: "t1", data: { from: "starting", to: "running" } });
  await h.emit("task.status", { taskId: "t1", data: { from: "draft", to: "running" } });
  await h.emit("task.created", { taskId: null, summary: "no task" });
  const row = h.db.prepare("SELECT code, status, run_status FROM plugin_hive__tasks WHERE task_id = 't1'").get();
  assert.deepEqual({ ...row }, { code: "AC-1", status: "running", run_status: "running" });
  assert.equal((await h.route("GET", "/stats")).tasksSeen, 1);
});

test("the page is written for enabled workspaces only and escapes stored text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-page-"));
  const pageFile = join(dir, "index.html");
  const plugin = createPlugin({ pageFile });
  const h = await load(plugin);
  assert.ok(existsSync(pageFile));
  await plugin.onEnable({ workspaceId: "ws-a" });
  await h.tool("remember", { text: "</script><script>alert(1)</script> is not markup here." });
  await h.tool("remember", { text: "Workspace B has its own private notes." }, { ws: "ws-b" });
  plugin.hive.onChange("ws-a");
  await new Promise((r) => setTimeout(r, 1700));
  const html = readFileSync(pageFile, "utf8");
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script>\\u003cscript>alert(1)"));
  assert.ok(!html.includes("Workspace B has its own private notes"));
  const data = JSON.parse(/<script id="hive-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual(Object.keys(data.workspaces), ["ws-a"]);
  assert.equal(data.workspaces["ws-a"].memories.length, 1);
  await plugin.onDisable({ workspaceId: "ws-a" });
  assert.deepEqual(Object.keys(JSON.parse(/<script id="hive-data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(pageFile, "utf8"))[1]).workspaces), []);
  await h.unload();
});

test("renderPage survives the line separators that break inline scripts", () => {
  const html = renderPage({ generatedAt: new Date().toISOString(), workspaces: { w: { text: "a\u2028b\u2029c" } } });
  assert.ok(!html.includes("\u2028") && !html.includes("\u2029"));
});
