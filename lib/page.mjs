// The Hive page. Plugin pages run in a sandboxed iframe without same-origin, so they cannot call the API. Instead the
// plugin rewrites this one self-contained HTML file (data inlined as JSON) whenever something changes; the page picks
// the workspace from its own ?workspaceId= and renders with textContent only, so stored text can never become markup.
import { renameSync, writeFileSync } from "node:fs";

const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function renderPage(data) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hive</title>
<style>
:root{--bg:#f7f6fb;--panel:#fff;--ink:#1d1a26;--muted:#6b6680;--line:#e4e1ee;--accent:#7c5cff;--accent-soft:#efeaff;--warn:#b45309;--warn-soft:#fff4e5;--ok:#047857;--ok-soft:#e7f8f1;--bad:#b91c1c;--bad-soft:#fdecec}
@media (prefers-color-scheme:dark){:root{--bg:#0d0c12;--panel:#16141f;--ink:#ece9f6;--muted:#9a94b3;--line:#2a2638;--accent:#a48bff;--accent-soft:#241d3d;--warn:#fbbf24;--warn-soft:#2d2210;--ok:#34d399;--ok-soft:#0f2a20;--bad:#f87171;--bad-soft:#2f1414}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{padding:14px 16px 24px;max-width:1100px;margin:0 auto}
header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}h1{font-size:18px;margin:0}.muted{color:var(--muted)}.small{font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:12px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.card b{display:block;font-size:20px}
nav{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:8px 0 12px;flex-wrap:wrap}
nav button{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);padding:8px 10px;font:inherit;cursor:pointer}
nav button[aria-selected=true]{color:var(--ink);border-color:var(--accent)}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
input,select{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 9px}input{flex:1;min-width:180px}
.list{display:flex;flex-direction:column;gap:8px}.item{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.item.disputed{border-color:var(--warn);background:var(--warn-soft)}.text{white-space:pre-wrap;word-break:break-word}
.meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--muted);align-items:center}
.chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:12px;background:var(--accent-soft);color:var(--accent)}
.chip.warn{background:var(--warn-soft);color:var(--warn)}.chip.ok{background:var(--ok-soft);color:var(--ok)}.chip.bad{background:var(--bad-soft);color:var(--bad)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.empty{padding:22px;text-align:center;color:var(--muted);background:var(--panel);border:1px dashed var(--line);border-radius:10px}
.scroll{overflow-x:auto}
</style></head>
<body><main>
<header><h1>Hive</h1><span class="muted small" id="sub"></span></header>
<div class="cards" id="cards"></div>
<nav role="tablist" id="tabs"></nav>
<section id="view"></section>
</main>
<script id="hive-data" type="application/json">${json(data)}</script>
<script>
(function () {
  var all = JSON.parse(document.getElementById("hive-data").textContent);
  var ws = new URLSearchParams(location.search).get("workspaceId") || "";
  var d = all.workspaces[ws];
  var $ = function (tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };
  var ago = function (iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago"; var h = Math.round(m / 60); if (h < 48) return h + " h ago"; return Math.round(h / 24) + " days ago";
  };
  var sub = document.getElementById("sub");
  sub.textContent = "Shared memory and claims for this workspace · updated " + ago(all.generatedAt);
  if (!d) {
    document.getElementById("view").appendChild($("div", { class: "empty", text: "Nothing here yet. As soon as an agent in this workspace uses Hive (briefing, remember, claim), it shows up here." }));
    return;
  }
  var s = d.stats;
  [["Memories", s.memories], ["Pinned", s.pinned], ["Disputed", s.disputed], ["Active claims", s.activeClaims], ["Collisions prevented (7 d)", s.collisionsPreventedLast7Days], ["Recalls (7 d)", s.recalledLast7Days]]
    .forEach(function (c) { document.getElementById("cards").appendChild($("div", { class: "card" }, [$("b", { text: String(c[1]) }), $("span", { class: "muted small", text: c[0] })])); });

  var tabs = [["memories", "Memories"], ["claims", "Claims (" + d.claims.length + ")"], ["activity", "Activity"], ["tasks", "Tasks"]];
  var current = (location.hash || "#memories").slice(1);
  var nav = document.getElementById("tabs"), view = document.getElementById("view");
  function show(id) {
    current = id;
    Array.prototype.forEach.call(nav.children, function (b) { b.setAttribute("aria-selected", String(b.dataset.id === id)); });
    view.textContent = "";
    ({ memories: memories, claims: claims, activity: activity, tasks: tasks })[id]();
  }
  tabs.forEach(function (t) { var b = $("button", { role: "tab", text: t[1] }); b.dataset.id = t[0]; b.onclick = function () { show(t[0]); }; nav.appendChild(b); });

  function memories() {
    var q = $("input", { type: "search", placeholder: "Search memories", "aria-label": "Search memories" });
    var kind = $("select", { "aria-label": "Kind" }, [$("option", { value: "", text: "All kinds" })].concat(["lesson", "convention", "decision", "gotcha", "fact", "worklog"].map(function (k) { return $("option", { value: k, text: k }); })));
    var only = $("select", { "aria-label": "Filter" }, [$("option", { value: "", text: "Everything" }), $("option", { value: "disputed", text: "Disputed only" }), $("option", { value: "pinned", text: "Pinned only" })]);
    var box = $("div", { class: "list" });
    view.appendChild($("div", { class: "tools" }, [q, kind, only]));
    view.appendChild(box);
    function draw() {
      box.textContent = "";
      var words = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
      var rows = d.memories.filter(function (m) {
        if (kind.value && m.kind !== kind.value) return false;
        if (only.value === "disputed" && !m.disputes) return false;
        if (only.value === "pinned" && !m.pinned) return false;
        var hay = [m.text, m.topic, m.project, (m.tags || []).join(" "), (m.files || []).join(" ")].join(" ").toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
      if (!rows.length) { box.appendChild($("div", { class: "empty", text: d.memories.length ? "No memories match." : "No memories yet. Agents save them with the remember tool." })); return; }
      rows.slice(0, 300).forEach(function (m) {
        var meta = [$("span", { class: "chip", text: m.kind }), m.pinned ? $("span", { class: "chip ok", text: "pinned" }) : null, m.disputes ? $("span", { class: "chip warn", text: "disputed ×" + m.disputes }) : null,
          m.confirmations ? $("span", { class: "chip ok", text: "confirmed ×" + m.confirmations }) : null, m.project ? $("span", { text: "project " + m.project }) : null, m.topic ? $("span", { text: "· " + m.topic }) : null,
          $("span", { text: "· #" + m.id + " by " + m.by + " · " + ago(m.createdAt) + (m.uses ? " · used " + m.uses + "×" : "") })];
        var kids = [$("div", { class: "text", text: m.text }), $("div", { class: "meta" }, meta)];
        if (m.files) kids.push($("div", { class: "meta" }, m.files.map(function (f) { return $("code", { text: f }); })));
        if (m.disputeNote) kids.push($("div", { class: "meta", text: "Dispute: " + m.disputeNote }));
        box.appendChild($("div", { class: "item" + (m.disputes ? " disputed" : "") }, kids));
      });
    }
    q.oninput = kind.onchange = only.onchange = draw;
    draw();
    view.appendChild($("p", { class: "muted small", text: "Pin, edit, archive or clear a dispute through the plugin API: PATCH /api/plugins/hive/memories/<id>?workspaceId=… with { pinned, text, archived, clearDisputes }." }));
  }
  function table(head, rows) {
    return $("div", { class: "scroll" }, [$("table", {}, [$("thead", {}, [$("tr", {}, head.map(function (h) { return $("th", { text: h }); }))]), $("tbody", {}, rows)])]);
  }
  function claims() {
    if (!d.claims.length) { view.appendChild($("div", { class: "empty", text: "No active claims. Agents claim files with the claim tool before they change them." })); return; }
    view.appendChild(table(["Resource", "Mode", "By", "Purpose", "Ends in"], d.claims.map(function (c) {
      return $("tr", {}, [$("td", {}, [$("code", { text: (c.project ? c.project + ": " : "") + c.resource })]), $("td", {}, [$("span", { class: "chip" + (c.mode === "exclusive" ? "" : " ok"), text: c.mode })]),
        $("td", { text: c.by }), $("td", { text: c.purpose }), $("td", { text: c.expiresInMinutes + " min" })]);
    })));
    view.appendChild($("p", { class: "muted small", text: "Release a stuck claim with DELETE /api/plugins/hive/claims/<id>?workspaceId=…  Claims also end when their task is done, failed or cancelled, or when they expire." }));
  }
  var tone = { "claim.denied": "warn", "memory.disputed": "warn", "claim.granted": "ok", "memory.saved": "ok" };
  function activity() {
    if (!d.activity.length) { view.appendChild($("div", { class: "empty", text: "No activity yet." })); return; }
    view.appendChild(table(["When", "Who", "What", ""], d.activity.map(function (a) {
      return $("tr", {}, [$("td", { class: "muted", text: ago(a.at) }), $("td", { text: a.by }), $("td", {}, [$("span", { class: "chip " + (tone[a.action] || ""), text: a.action })]), $("td", { text: a.detail })]);
    })));
  }
  function tasks() {
    if (!d.tasks.length) { view.appendChild($("div", { class: "empty", text: "No tasks seen yet." })); return; }
    view.appendChild(table(["Task", "Status", "Last run", "Updated"], d.tasks.map(function (t) {
      return $("tr", {}, [$("td", { text: t.task }), $("td", { text: t.status || "" }), $("td", { text: t.run || "" }), $("td", { class: "muted", text: ago(t.updatedAt) })]);
    })));
  }
  show(tabs.some(function (t) { return t[0] === current; }) ? current : "memories");
})();
</script>
</body></html>
`;
}

/** Writes the page atomically (temp file + rename), so the iframe never reads half a file. */
export function writePage(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, renderPage(data));
  renameSync(tmp, file);
}
