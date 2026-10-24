// Text helpers: tokenising, light stemming, fingerprints and a guard against storing secrets.
// Everything here is pure, so it is easy to test and has no dependencies.
import { createHash } from "node:crypto";

// Small English + Dutch stopword list: enough to keep ranking on the words that matter.
const STOP = new Set(`a an and are as at be but by can do does for from has have how i if in into is it its of on or our
should so that the their then there these this to use used uses using was we were what when where which who why will with
you your not no all any also only just than too very via per
de het een en of in op te van voor met aan bij door dat die dit er is zijn was waren wordt worden niet geen ook als om naar
uit over maar dan nog wel je jij we wij ze zij hij u ons onze hun mijn`.split(/\s+/));

/** Lowercase, strip accents. */
export const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A light suffix stemmer that is good enough for matching "migrations" to "migration" and "caching" to "cache". */
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  let s = w, verb = false;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("ing") && s.length > 5) { s = s.slice(0, -3); verb = true; }
  else if (s.endsWith("ed") && s.length > 4) { s = s.slice(0, -2); verb = true; }
  else if (s.endsWith("en") && s.length > 6) s = s.slice(0, -2);
  else if (s.endsWith("s") && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (verb && /([b-df-hj-kmnp-rtv-y])\1$/.test(s)) s = s.slice(0, -1); // running → run, stopped → stop
  if (s.length > 4 && s.endsWith("e")) s = s.slice(0, -1); // cache, caches, cached, caching → cach
  return s;
}

/** Words of a text (folded, stopwords removed, stemmed). Paths and identifiers are split on punctuation too. */
export function tokens(s) {
  const out = [];
  for (const raw of fold(s).split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** The searchable term column: unique terms with a leading and trailing space, so LIKE '% term%' matches word starts. */
export const termString = (...parts) => ` ${[...new Set(parts.flatMap((p) => tokens(p)))].join(" ")} `;

/** Same text modulo case, accents, punctuation and spacing gives the same fingerprint. */
export const fingerprint = (text) => createHash("sha256").update(fold(text).replace(/[^a-z0-9]+/g, " ").trim()).digest("hex").slice(0, 32);

/** Jaccard overlap of two term sets. */
export function overlap(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

/** "a, b ,c" → ["a","b","c"] (trimmed, de-duplicated, empty parts dropped). */
export const list = (s, max = 30) => [...new Set(String(s ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, max);

// Patterns of credentials that should never end up in shared memory. Deliberately broad: a false alarm costs the agent
// one rephrase, a stored token is shown to every later agent.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "a GitHub token"],
  [/\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}\b/, "an API key"],
  [/\b(?:xox[abprs]|xapp)-[A-Za-z0-9-]{10,}\b/, "a Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "a JWT"],
  [/\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i, "a password or key assignment"],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, "a URL with a password"],
];

/** Returns what kind of secret the text seems to contain, or null. Long random-looking strings count too. */
export function secretIn(text) {
  const s = String(text ?? "");
  for (const [re, what] of SECRET_PATTERNS) if (re.test(s)) return what;
  for (const w of s.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? []) {
    if (/^[0-9a-f]{40}$/i.test(w) || /^[0-9a-f]{64}$/i.test(w)) continue; // git commit and sha256 hashes are fine
    if (/[a-z]/.test(w) && /[A-Z]/.test(w) && /\d/.test(w) && entropy(w) > 4.2) return "a long random string (a key or token?)";
  }
  return null;
}
function entropy(w) {
  const f = new Map();
  for (const c of w) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) { const p = n / w.length; h -= p * Math.log2(p); }
  return h;
}

/** Cuts a string to n characters with an ellipsis. */
export const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
