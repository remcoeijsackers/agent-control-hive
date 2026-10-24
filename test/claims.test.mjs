import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlugin } from "../index.mjs";
import { clock, load } from "./harness.mjs";

const setup = async (opts = {}) => {
  const c = clock();
  const plugin = createPlugin({ pageFile: null, now: c.now });
  return { h: await load(plugin, opts), c, hive: plugin.hive };
};
const A = { taskId: "task-a" }, B = { taskId: "task-b" };

test("a folder claim blocks edits below it for other tasks, not for the holder", async () => {
  const { h } = await setup();
  const a = await h.tool("claim", { resource: "src/auth/", purpose: "rewrite login" }, A);
  assert.equal(a.granted, true);
  const b = await h.tool("claim", { resource: "./src/auth/login.ts", purpose: "fix typo" }, B);
  assert.equal(b.granted, false);
  assert.equal(b.conflicts[0].resource, "src/auth");
  assert.equal(b.conflicts[0].purpose, "rewrite login");
  assert.match(b.advice, /narrower path/);
  assert.equal((await h.tool("claim", { resource: "src/auth/login.ts", purpose: "same task, finer" }, A)).granted, true);
  assert.equal((await h.tool("claim", { resource: "src/authz/policy.ts", purpose: "unrelated" }, B)).granted, true);
});

test("shared claims coexist, an exclusive one waits for them", async () => {
  const { h } = await setup();
  assert.equal((await h.tool("claim", { resource: "db:staging", purpose: "read schema", mode: "shared" }, A)).granted, true);
  const second = await h.tool("claim", { resource: "db:staging", purpose: "read too", mode: "shared" }, B);
  assert.equal(second.granted, true);
  assert.equal(second.alsoReading.length, 1);
  const ex = await h.tool("claim", { resource: "db:staging", purpose: "run a migration" }, { taskId: "task-c" });
  assert.equal(ex.granted, false);
  assert.equal(ex.conflicts.length, 2);
  await assert.rejects(h.tool("claim", { resource: "x", purpose: "p", mode: "sometimes" }, A), /exclusive or shared/);
});

test("claims only collide within the same project", async () => {
  const { h } = await setup();
  await h.tool("claim", { resource: "src/index.ts", purpose: "p", project: "Shop" }, A);
  assert.equal((await h.tool("claim", { resource: "src/index.ts", purpose: "p", project: "blog" }, B)).granted, true);
  assert.equal((await h.tool("claim", { resource: "src/index.ts", purpose: "p", project: "shop " }, B)).granted, false);
  assert.equal((await h.tool("claims", { project: "shop" })).claims.length, 1);
  assert.equal((await h.tool("claims", {})).claims.length, 2);
});

test("claiming again renews; claims expire; the length is capped by settings", async () => {
  const { h, c } = await setup({ settings: { "ws-a": { defaultClaimMinutes: 30, maxClaimMinutes: 60 } } });
  const first = await h.tool("claim", { resource: "README.md", purpose: "docs" }, A);
  assert.equal(first.expiresInMinutes, 30);
  c.advance(20);
  const again = await h.tool("claim", { resource: "README.md", purpose: "docs, longer", minutes: 600 }, A);
  assert.equal(again.renewed, true);
  assert.equal(again.id, first.id);
  assert.equal(again.expiresInMinutes, 60);
  c.advance(61);
  assert.equal((await h.tool("claim", { resource: "README.md", purpose: "mine now" }, B)).granted, true);
});

test("release one or all; releasing what you do not hold says so", async () => {
  const { h } = await setup();
  await h.tool("claim", { resource: "a.ts", purpose: "p" }, A);
  await h.tool("claim", { resource: "b.ts", purpose: "p" }, A);
  const none = await h.tool("release", { resource: "c.ts" }, A);
  assert.equal(none.released, 0);
  assert.equal(none.yours.length, 2);
  assert.equal((await h.tool("release", { resource: "a.ts" }, A)).released, 1);
  assert.equal((await h.tool("release", {}, A)).released, 1);
  assert.equal((await h.tool("claims", {})).claims.length, 0);
  await assert.rejects(h.tool("claim", { resource: "a.ts", purpose: "p" }, { taskId: null }), /belong to a task/);
});

test("a task that ends releases its claims; review keeps them unless configured", async () => {
  const { h } = await setup({ settings: { "ws-b": { releaseClaimsOnReview: true } } });
  await h.tool("claim", { resource: "src/", purpose: "big refactor" }, A);
  await h.emit("task.status", { taskId: "task-a", data: { from: "running", to: "review" } });
  assert.equal((await h.tool("claims", {})).claims.length, 1);
  await h.emit("task.status", { taskId: "task-a", data: { from: "review", to: "done" } });
  assert.equal((await h.tool("claims", {})).claims.length, 0);
  await h.tool("claim", { resource: "src/", purpose: "p" }, { ws: "ws-b", taskId: "task-x" });
  await h.emit("task.status", { taskId: "task-x", data: { from: "running", to: "review" } }, "ws-b");
  assert.equal((await h.tool("claims", {}, { ws: "ws-b" })).claims.length, 0);
});

test("the dashboard can force-release a stuck claim; stats count prevented collisions", async () => {
  const { h } = await setup();
  const a = await h.tool("claim", { resource: "package.json", purpose: "bump deps" }, A);
  await h.tool("claim", { resource: "package.json", purpose: "add script" }, B);
  const listed = await h.route("GET", "/claims");
  assert.equal(listed.claims[0].id, a.id);
  await h.route("DELETE", `/claims/${a.id}`);
  assert.equal((await h.route("GET", "/claims")).claims.length, 0);
  const s = await h.route("GET", "/stats");
  assert.equal(s.collisionsPreventedLast7Days, 1);
  await assert.rejects(h.route("DELETE", "/claims/99"), /No claim #99/);
});

test("conflicts name the task code once Hive has seen it", async () => {
  const { h } = await setup();
  await h.emit("task.created", { taskId: "task-a", summary: "Task AC-42 created" });
  await h.tool("claim", { resource: "src/x.ts", purpose: "p" }, A);
  const b = await h.tool("claim", { resource: "src/x.ts", purpose: "p" }, B);
  assert.equal(b.conflicts[0].by, "AC-42");
  assert.equal((await h.tool("claim", { resource: "src/y.ts", purpose: "p" }, { taskId: "abcdef1234567890" })).granted, true);
  assert.equal((await h.tool("claims", { resource: "src/y.ts" })).claims[0].by, "task abcdef12");
});

test("work log and history: who touched a file and why", async () => {
  const { h } = await setup();
  await h.emit("task.created", { taskId: "task-a", summary: "Task AC-7 created" });
  await h.tool("log_work", { summary: "Moved session refresh into the auth middleware.", files: "src/auth/middleware.ts, src/auth/session.ts" }, A);
  await h.tool("log_work", { summary: "Added rate limiting to the public API.", files: "src/api/limits.ts" }, B);
  await h.tool("remember", { text: "Session cookies must stay SameSite=Strict.", kind: "gotcha", files: "src/auth/session.ts" }, B);
  const hist = await h.tool("history", { path: "src/auth" });
  assert.equal(hist.entries.length, 2);
  assert.equal(hist.entries[0].kind, "gotcha");
  assert.equal(hist.entries[1].by, "AC-7");
  const all = await h.tool("history", {});
  assert.equal(all.entries.length, 2);
  assert.ok(all.entries.every((e) => e.kind === "worklog"));
  await assert.rejects(h.tool("log_work", { summary: "short" }), /summary is required/);
});
