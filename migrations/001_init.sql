-- Hive v1 schema. Double-brace table names expand to the plugin's own tables (plugin_hive__memories, ...).
-- Times are ISO 8601 UTC strings, so they compare correctly as text.

CREATE TABLE {{memories}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  topic TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  confirmations INTEGER NOT NULL DEFAULT 0,
  disputes INTEGER NOT NULL DEFAULT 0,
  dispute_note TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'agent',
  task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  archived_at TEXT,
  archive_reason TEXT
);
CREATE INDEX {{memories}}_live ON {{memories}} (workspace_id, archived_at, kind);
CREATE INDEX {{memories}}_fp ON {{memories}} (workspace_id, fingerprint);

CREATE TABLE {{claims}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  resource TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'exclusive',
  purpose TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  release_reason TEXT
);
CREATE INDEX {{claims}}_live ON {{claims}} (workspace_id, released_at, expires_at);
CREATE INDEX {{claims}}_task ON {{claims}} (task_id, released_at);

-- No TEXT PRIMARY KEY: its automatic sqlite_autoindex_* index is outside the plugin's names and the sandbox refuses it.
-- An explicit UNIQUE index gives the same upsert target.
CREATE TABLE {{tasks}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  code TEXT,
  status TEXT,
  run_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX {{tasks}}_task ON {{tasks}} (task_id);

CREATE TABLE {{activity}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  at TEXT NOT NULL,
  task_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX {{activity}}_ws ON {{activity}} (workspace_id, id);

-- Workspaces Hive is turned on in (kept from onEnable/onDisable), so the page only carries their data.
CREATE TABLE {{workspaces}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX {{workspaces}}_ws ON {{workspaces}} (workspace_id);
