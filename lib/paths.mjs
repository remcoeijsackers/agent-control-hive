// Resource names for claims and work logs. A resource is a repository path (src/auth/, src/auth/login.ts) or a named
// thing (port:5173, db:staging). Two resources overlap when one is the other or lies below it.

/** Canonical form: forward slashes, no ./ or leading /, no duplicate or trailing slashes, no "..". */
export function normalizeResource(raw) {
  let s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) throw new Error("resource is required");
  if (s.length > 400) throw new Error("resource is too long (max 400 characters)");
  if (/[\0\r\n]/.test(s)) throw new Error("resource may not contain line breaks");
  s = s.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const parts = s.split("/");
  if (parts.some((p) => p === "..")) throw new Error('resource may not contain ".."');
  s = parts.filter((p) => p !== ".").join("/");
  if (!s) return "*"; // "/" or "." means the whole project
  return s;
}

/** True when a and b (normalized) are the same or one contains the other. "*" covers everything. */
export function overlaps(a, b) {
  if (a === "*" || b === "*" || a === b) return true;
  return a.startsWith(b + "/") || b.startsWith(a + "/");
}

/** Project names are compared case-insensitively and without surrounding spaces. */
export const normalizeProject = (p) => String(p ?? "").trim().toLowerCase().slice(0, 120);
