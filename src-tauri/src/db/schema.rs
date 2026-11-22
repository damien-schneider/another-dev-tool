pub const SCHEMA_VERSION: i64 = 12;

pub const MIGRATION_1: &str = r"
CREATE TABLE IF NOT EXISTS roots (
    id       INTEGER PRIMARY KEY,
    path     TEXT    NOT NULL UNIQUE,
    enabled  INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id                INTEGER PRIMARY KEY,
    root_id           INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    path              TEXT    NOT NULL UNIQUE,
    rel_path          TEXT    NOT NULL,
    kind              TEXT    NOT NULL,
    project_dir       TEXT,
    size              INTEGER NOT NULL,
    mtime_ns          INTEGER NOT NULL,
    hash              TEXT    NOT NULL,
    is_symlink        INTEGER NOT NULL DEFAULT 0,
    symlink_target    TEXT,
    first_seen_at     INTEGER NOT NULL,
    last_seen_scan_id INTEGER,
    deleted_at        INTEGER
);

CREATE INDEX IF NOT EXISTS files_hash_idx ON files(hash);
CREATE INDEX IF NOT EXISTS files_kind_idx ON files(kind);
CREATE INDEX IF NOT EXISTS files_root_idx ON files(root_id);

CREATE TABLE IF NOT EXISTS scans (
    id          INTEGER PRIMARY KEY,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    status      TEXT    NOT NULL,
    seen        INTEGER NOT NULL DEFAULT 0,
    hashed      INTEGER NOT NULL DEFAULT 0,
    added       INTEGER NOT NULL DEFAULT 0,
    changed     INTEGER NOT NULL DEFAULT 0,
    removed     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_groups (
    id                INTEGER PRIMARY KEY,
    name              TEXT    NOT NULL,
    canonical_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_members (
    group_id      INTEGER NOT NULL REFERENCES sync_groups(id) ON DELETE CASCADE,
    file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    strategy      TEXT    NOT NULL,
    baseline_hash TEXT,
    PRIMARY KEY (group_id, file_id)
);

CREATE TABLE IF NOT EXISTS backups (
    id            INTEGER PRIMARY KEY,
    file_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
    original_path TEXT    NOT NULL,
    backup_path   TEXT    NOT NULL,
    hash          TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

pub const MIGRATION_2: &str = r"
CREATE TABLE IF NOT EXISTS prompt_history (
    id               INTEGER PRIMARY KEY,
    content          TEXT    NOT NULL,
    destination_path TEXT,
    created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS prompt_history_created_at_idx
ON prompt_history(created_at DESC);
";

pub const MIGRATION_3: &str = r"
CREATE TABLE IF NOT EXISTS favorite_projects (
    path       TEXT    PRIMARY KEY,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS favorite_projects_created_at_idx
ON favorite_projects(created_at DESC);
";

pub const MIGRATION_4: &str = r"
CREATE TABLE IF NOT EXISTS prompt_attachments (
    id           INTEGER PRIMARY KEY,
    prompt_id    INTEGER NOT NULL REFERENCES prompt_history(id) ON DELETE CASCADE,
    path         TEXT    NOT NULL UNIQUE,
    mime_type    TEXT    NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS prompt_attachments_prompt_idx
ON prompt_attachments(prompt_id, id);
";

pub const MIGRATION_5: &str = r"
ALTER TABLE files ADD COLUMN name TEXT;

CREATE INDEX IF NOT EXISTS files_name_idx ON files(name);

CREATE TABLE IF NOT EXISTS file_refs (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name    TEXT    NOT NULL,
    PRIMARY KEY (file_id, name)
);

CREATE INDEX IF NOT EXISTS file_refs_name_idx ON file_refs(name);
";

pub const MIGRATION_6: &str = r"
ALTER TABLE files ADD COLUMN refs_hash TEXT;
";

/// `description_hash` plays the role `refs_hash` plays for references: NULL until the
/// file is read once, which is what lets the next scan backfill existing rows.
pub const MIGRATION_7: &str = r"
UPDATE files SET kind = 'skill' WHERE kind = 'claude-skill';

ALTER TABLE files ADD COLUMN real_path TEXT;
ALTER TABLE files ADD COLUMN description TEXT;
ALTER TABLE files ADD COLUMN description_hash TEXT;

CREATE INDEX IF NOT EXISTS files_real_path_idx ON files(real_path);

CREATE TABLE IF NOT EXISTS file_aliases (
    path              TEXT    PRIMARY KEY,
    file_id           INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    root_id           INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    last_seen_scan_id INTEGER
);

CREATE INDEX IF NOT EXISTS file_aliases_file_idx ON file_aliases(file_id);
CREATE INDEX IF NOT EXISTS file_aliases_root_idx ON file_aliases(root_id);
";

/// `started` says whether Claude Code already holds the session, so the next
/// turn resumes it instead of opening a new one under the same id.
pub const MIGRATION_8: &str = r"
CREATE TABLE IF NOT EXISTS agent_conversations (
    id         TEXT    PRIMARY KEY,
    file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    started    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_conversations_file_idx
ON agent_conversations(file_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
    id              INTEGER PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,
    text            TEXT    NOT NULL,
    images          TEXT    NOT NULL DEFAULT '[]',
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx
ON agent_messages(conversation_id, id);
";

pub const MIGRATION_9: &str = r"
ALTER TABLE agent_messages ADD COLUMN parts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_messages ADD COLUMN meta TEXT;
";

/// `finding` is the JSON the Patterns view shows; dismissed rows stay so the next run is told
/// never to propose them again.
pub const MIGRATION_10: &str = r"
CREATE TABLE IF NOT EXISTS patterns (
    id           INTEGER PRIMARY KEY,
    finding      TEXT    NOT NULL,
    rank         INTEGER NOT NULL,
    found_at     INTEGER NOT NULL,
    dismissed_at INTEGER
);
";

/// Filled by the next scan, which rewrites every walked row.
pub const MIGRATION_11: &str = r"
ALTER TABLE files ADD COLUMN repository_dir TEXT;
";

/// Explanations belong to a folder, not an indexed file: any project can be explained, and
/// its conversations survive the folder leaving the library.
pub const MIGRATION_12: &str = r"
CREATE TABLE IF NOT EXISTS explain_conversations (
    id          TEXT    PRIMARY KEY,
    project_dir TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    started     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS explain_conversations_project_idx
ON explain_conversations(project_dir, updated_at DESC);

CREATE TABLE IF NOT EXISTS explain_messages (
    id              INTEGER PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES explain_conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,
    text            TEXT    NOT NULL,
    parts           TEXT    NOT NULL DEFAULT '[]',
    meta            TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS explain_messages_conversation_idx
ON explain_messages(conversation_id, id);
";
