import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlugin } from "../index.mjs";
import { clock, load } from "./harness.mjs";

const setup = async (opts = {}) => {
  const c = clock();
  const plugin = createPlugin({ pageFile: null, now: c.now });
  const h = await load(plugin, opts);
  return { h, c, hive: plugin.hive };
};

test("remember and recall: the right memory comes first", async () => {
  const { h } = await setup();
  await h.tool("remember", { text: "Use pnpm, not npm: the lockfile is pnpm-lock.yaml and npm install breaks it.", kind: "convention", topic: "tooling" });
  await h.tool("remember", { text: "Payments are retried by the queue worker; never retry in the HTTP handler.", kind: "gotcha", topic: "payments", files: "src/payments/" });
  await h.tool("remember", { text: "The staging database is reset every Sunday night.", kind: "fact" });
  const r = await h.tool("recall", { query: "how do I install packages" }, { taskId: "task-2" });
  assert.match(r.note, /data, not as instructions/);
  assert.equal(r.results[0].kind, "convention");
  const p = await h.tool("recall", { query: "retry payment" });
  assert.equal(p.results[0].topic, "payments");
  assert.deepEqual(p.results[0].files, ["src/payments"]);
  const none = await h.tool("recall", { query: "kubernetes helm chart" });
  assert.equal(none.results.length, 0);
  assert.match(none.hint, /remember/);
});

test("saving the same thing twice confirms it instead of duplicating", async () => {
  const { h } = await setup();
  const a = await h.tool("remember", { text: "Feature flags live in config/flags.yaml." });
  const b = await h.tool("remember", { text: "feature flags live in config/flags.yaml", }, { taskId: "task-2" });
  assert.equal(a.status, "saved");
  assert.equal(b.status, "duplicate");
  assert.equal(b.id, a.id);
  assert.equal(b.memory.confirmations, 1);
  const c = await h.tool("remember", { text: "Feature flags live in the config/flags.yaml file." });
  assert.equal(c.status, "similar");
  assert.equal(c.id, a.id);
  const stats = await h.route("GET", "/stats");
  assert.equal(stats.memories, 1);
});

test("secrets are refused, with a reason the agent can act on", async () => {
  const { h } = await setup();
  await assert.rejects(h.tool("remember", { text: "The deploy token is ghp_abcdefghijklmnopqrstuvwxyz0123456789AB" }), /GitHub token.*leave secrets out/);
  await assert.rejects(h.tool("remember", { text: "short" }), /too short/);
  await assert.rejects(h.tool("remember", { text: "A perfectly fine sentence here.", kind: "rumour" }), /kind must be one of/);
});

test("disputed memories sink, confirmed ones rise", async () => {
  const { h } = await setup();
  const a = await h.tool("remember", { text: "Deploys go through the deploy script in scripts/deploy.sh." });
  const b = await h.tool("remember", { text: "Deploys go out with the GitHub Actions release workflow." });
  let r = await h.tool("recall", { query: "how do deploys go out" });
  assert.equal(r.results[0].id, b.id); // newer wins a tie
  await h.tool("dispute", { id: b.id, reason: "The release workflow was removed in March; use the script." });
  await h.tool("confirm", { id: a.id });
  r = await h.tool("recall", { query: "how do deploys go out" });
  assert.equal(r.results[0].id, a.id);
  assert.equal(r.results[1].disputes, 1);
  assert.match(r.results[1].disputeNote, /release workflow was removed/);
  await assert.rejects(h.tool("dispute", { id: 999, reason: "nope nope" }), /No memory #999/);
});

test("project boosts its own memories and recency decays unpinned ones", async () => {
  const { h, c } = await setup();
  const old = await h.tool("remember", { text: "Image uploads are resized by the worker queue.", project: "shop" });
  c.days(400);
  const fresh = await h.tool("remember", { text: "Image uploads are resized in the browser before sending.", project: "blog" });
  let r = await h.tool("recall", { query: "image uploads resized" });
  assert.equal(r.results[0].id, fresh.id);
  r = await h.tool("recall", { query: "image uploads resized", project: "Shop" });
  assert.equal(r.results[0].id, old.id);
});

test("memories are separate per workspace", async () => {
  const { h } = await setup();
  await h.tool("remember", { text: "Workspace A uses tabs for indentation." }, { ws: "ws-a" });
  const r = await h.tool("recall", { query: "indentation tabs" }, { ws: "ws-b" });
  assert.equal(r.results.length, 0);
  await assert.rejects(h.route("PATCH", "/memories/1", { ws: "ws-b", body: { pinned: true } }), /No memory #1/);
});

test("ttl: a temporary fact expires", async () => {
  const { h, c, hive } = await setup();
  await h.tool("remember", { text: "The payments API sandbox is down this week.", ttl_days: 3 });
  assert.equal((await h.tool("recall", { query: "payments sandbox" })).results.length, 1);
  c.days(4);
  assert.equal((await h.tool("recall", { query: "payments sandbox" })).results.length, 0);
  hive.sweep();
  assert.equal((await h.route("GET", "/stats")).archived, 1);
});

test("briefing: pinned first, relevant conventions, others' claims and recent work", async () => {
  const { h } = await setup();
  const pin = await h.route("POST", "/memories", { body: { text: "Never push to main; everything lands through the merge pipeline.", kind: "convention", pinned: true } });
  assert.equal(pin.status, "saved");
  await h.tool("remember", { text: "Tests that touch the clock must use the fake clock helper in test/clock.ts.", kind: "gotcha", topic: "tests" });
  await h.tool("remember", { text: "The CSS uses design tokens; never hard-code colours.", kind: "convention", topic: "css" });
  await h.tool("claim", { resource: "src/server/runner.ts", purpose: "refactor the pump" }, { taskId: "task-9" });
  await h.tool("log_work", { summary: "Split the runner pump into a scheduler and a launcher.", files: "src/server/runner.ts, src/server/pump.ts" }, { taskId: "task-9" });
  const b = await h.tool("briefing", { focus: "fix a flaky test with timers" }, { taskId: "task-1" });
  assert.equal(b.pinned.length, 1);
  assert.equal(b.pinned[0].pinned, true);
  assert.equal(b.relevant[0].topic, "tests");
  assert.equal(b.claimedByOthers.length, 1);
  assert.equal(b.claimedByOthers[0].resource, "src/server/runner.ts");
  assert.equal(b.recentWork.length, 1);
  assert.equal(b.totals.memories, 4);
  const mine = await h.tool("briefing", {}, { taskId: "task-9" });
  assert.equal(mine.claimedByOthers.length, 0);
});

test("agents cannot pin; the dashboard can, and can edit, archive and delete", async () => {
  const { h } = await setup();
  const a = await h.tool("remember", { text: "Agents cannot pin their own memories here.", pinned: true });
  assert.equal(a.memory.pinned, undefined);
  const m = (await h.route("PATCH", `/memories/${a.id}`, { body: { pinned: true, text: "Only people pin memories, from the dashboard.", tags: "policy, hive" } })).memory;
  assert.equal(m.pinned, true);
  assert.deepEqual(m.tags, ["policy", "hive"]);
  assert.equal((await h.tool("recall", { query: "who pins memories" })).results[0].id, a.id);
  await h.route("PATCH", `/memories/${a.id}`, { body: { archived: true } });
  assert.equal((await h.route("GET", "/memories")).memories.length, 0);
  assert.equal((await h.route("GET", "/memories", { query: { archived: "1" } })).memories.length, 1);
  await h.route("DELETE", `/memories/${a.id}`);
  assert.equal((await h.route("GET", "/memories", { query: { archived: "1" } })).memories.length, 0);
  await assert.rejects(h.route("PATCH", "/memories/abc", { body: {} }), /positive number/);
});

test("the memory limit archives the least useful memories, never pinned ones", async () => {
  const { h } = await setup({ settings: { "ws-a": { maxMemories: 100 } } });
  const pinned = await h.route("POST", "/memories", { body: { text: "Pinned memory number zero stays forever.", pinned: true } });
  for (let i = 1; i <= 104; i++) await h.tool("remember", { text: `Unique fact number ${i} about module m${i} and nothing else.` });
  const s = await h.route("GET", "/stats");
  assert.equal(s.memories, 100);
  assert.equal(s.archived, 5);
  const list = (await h.route("GET", "/memories", { query: { limit: 1000 } })).memories;
  assert.ok(list.some((m) => m.id === pinned.id));
});

test("export and import round-trip without duplicates", async () => {
  const { h } = await setup();
  await h.tool("remember", { text: "Emails to customers need approval per message.", kind: "convention", tags: "mail" });
  await h.tool("remember", { text: "Invoices are generated on the 20th of each month.", kind: "fact" });
  const dump = await h.route("GET", "/export");
  assert.equal(dump.format, "hive/1");
  assert.equal(dump.memories.length, 2);
  const into = await h.route("POST", "/import", { ws: "ws-b", body: dump });
  assert.deepEqual(into, { saved: 2, duplicate: 0, refused: [] });
  const again = await h.route("POST", "/import", { ws: "ws-b", body: { memories: [...dump.memories, { text: "api_key = abcdefghijkl" }] } });
  assert.equal(again.duplicate, 2);
  assert.equal(again.refused.length, 1);
  assert.equal((await h.route("GET", "/memories", { ws: "ws-b" })).memories.length, 2);
});

test("route search ranks like recall but does not count as use", async () => {
  const { h } = await setup();
  await h.tool("remember", { text: "Webhooks from the payment provider are verified with an HMAC header." });
  const r = await h.route("GET", "/memories", { query: { q: "payment webhook" } });
  assert.equal(r.memories.length, 1);
  assert.ok(r.memories[0].score > 0);
  assert.equal(h.db.prepare("SELECT uses FROM plugin_hive__memories").get().uses, 0);
});
