import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, overlap, secretIn, stem, termString, tokens } from "../lib/text.mjs";
import { normalizeResource, overlaps, normalizeProject } from "../lib/paths.mjs";

test("stemming folds common word forms together", () => {
  for (const group of [["cache", "caches", "cached", "caching"], ["migration", "migrations"], ["deploy", "deploys", "deployed", "deploying"], ["run", "running"], ["stop", "stopped"], ["test", "tests", "tested", "testing"]]) {
    assert.equal(new Set(group.map(stem)).size, 1, `${group.join(", ")} → ${group.map(stem).join(", ")}`);
  }
  assert.equal(stem("pass"), stem("passing"));
});

test("tokens drop stopwords, fold accents and split identifiers and paths", () => {
  assert.deepEqual(tokens("The café uses src/auth/loginForm.tsx"), ["cafe", "src", "auth", "loginform", "tsx"]);
  assert.deepEqual(tokens("Gebruik de nieuwe API niet"), ["gebruik", "nieuw", "api"]);
});

test("termString has unique terms with spaces around them", () => {
  assert.equal(termString("cache cache", "Caching"), " cach ");
});

test("fingerprint ignores case, accents, punctuation and spacing", () => {
  assert.equal(fingerprint("Use pnpm,  not npm!"), fingerprint("use PNPM not npm"));
  assert.notEqual(fingerprint("use pnpm"), fingerprint("use npm"));
});

test("overlap is Jaccard", () => {
  assert.equal(overlap(["a", "b"], ["a", "b"]), 1);
  assert.equal(overlap(["a", "b"], ["b", "c"]), 1 / 3);
  assert.equal(overlap([], ["a"]), 0);
});

test("secretIn catches credentials and leaves ordinary text alone", () => {
  for (const s of [
    "the key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB",
    "AKIAABCDEFGHIJKLMNOP is the deploy key",
    "password: hunter2hunter2",
    "connect to postgres://admin:s3cret@db.internal:5432/app",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "use aB3dE5gH7jK9mN1pQ3rS5tU7vW9xY1zA2bC4 as the value",
  ]) assert.ok(secretIn(s), s);
  for (const s of [
    "Run npm test before you push; the CI uses Node 24.",
    "Commit 3f2a9c1e4b5d6a7f8e9d0c1b2a3f4e5d6c7b8a9f fixed the cache.",
    "The password reset flow lives in src/auth/reset.ts",
    "See https://example.com/docs/setup for the token format",
  ]) assert.equal(secretIn(s), null, s);
});

test("resources normalise and overlap on path segments only", () => {
  assert.equal(normalizeResource("./src//auth/"), "src/auth");
  assert.equal(normalizeResource("\\src\\auth\\login.ts"), "src/auth/login.ts");
  assert.equal(normalizeResource("/"), "*");
  assert.equal(normalizeResource("port:5173"), "port:5173");
  assert.throws(() => normalizeResource("src/../etc"), /\.\./);
  assert.throws(() => normalizeResource("  "), /required/);
  assert.ok(overlaps("src/auth", "src/auth/login.ts"));
  assert.ok(overlaps("src/auth/login.ts", "src/auth"));
  assert.ok(overlaps("*", "anything"));
  assert.ok(!overlaps("src/auth", "src/authz"));
  assert.ok(!overlaps("src/auth/a.ts", "src/auth/b.ts"));
  assert.equal(normalizeProject("  WebShop "), "webshop");
});
