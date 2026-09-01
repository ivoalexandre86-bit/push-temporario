-- ============================================================================
-- Migration 0001: Initial schema (PostgreSQL)
-- Project & Action Management System
-- Ported from the original SQLite/better-sqlite3 schema: AUTOINCREMENT ->
-- SERIAL, strftime(...) defaults -> to_char(now() at time zone 'utc', ...),
-- boolean flags kept as INTEGER (0/1) to match the existing application code
-- unchanged, REAL -> DOUBLE PRECISION for hour fields (avoid float4 rounding).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles & Permissions
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,      -- ADMIN, PROJECT_MANAGER, CONTRIBUTOR, VIEWER, AUDITOR
  name        TEXT NOT NULL,             -- Portuguese display name
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,      -- e.g. actions.edit_any
  description TEXT
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT,                 -- NULL when sso_subject is set (SSO-only account)
  sso_subject         TEXT UNIQUE,          -- external SSO identifier (future use)
  role_id             INTEGER NOT NULL REFERENCES roles(id),
  active              INTEGER NOT NULL DEFAULT 1,  -- 0/1 boolean
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at          TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_active ON users(active);

CREATE TABLE password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_prt_user ON password_reset_tokens(user_id);

CREATE TABLE sessions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  user_agent        TEXT,
  ip_address        TEXT,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Projects & Areas (imported catalogs, admin-manageable afterwards)
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  active        INTEGER NOT NULL DEFAULT 1,
  description   TEXT,
  manager_user_id INTEGER REFERENCES users(id),
  is_imported   INTEGER NOT NULL DEFAULT 0,   -- came from original workbook catalog
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

CREATE TABLE areas (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  active        INTEGER NOT NULL DEFAULT 1,
  project_id    INTEGER REFERENCES projects(id),  -- optional relationship
  is_imported   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- Project- and area-level access scope for non-global roles
CREATE TABLE user_project_scope (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE user_area_scope (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id     INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, area_id)
);

-- ---------------------------------------------------------------------------
-- People (free-text "QUEM" responsible catalog, auto-populated from import,
-- independently of system user accounts; a person MAY later be linked to a
-- user account for "assigned to me" style permissions)
-- ---------------------------------------------------------------------------
CREATE TABLE people (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- ---------------------------------------------------------------------------
-- Actions (the core "Plano de Ação" record)
-- ---------------------------------------------------------------------------
CREATE TABLE actions (
  uuid                  TEXT PRIMARY KEY,             -- internal surrogate key
  business_id           INTEGER NOT NULL UNIQUE,      -- immutable spreadsheet ID (never reused)
  project_id            INTEGER NOT NULL REFERENCES projects(id),
  ref_month             TEXT NOT NULL,                 -- normalized YYYY-MM-01
  ref_month_raw         TEXT,                           -- original imported value (e.g. "jul-26")
  area_id               INTEGER NOT NULL REFERENCES areas(id),
  description           TEXT NOT NULL,                  -- AÇÃO (multiline)
  responsible_name      TEXT,                            -- QUEM (free text, may be empty/"unassigned")
  person_id             INTEGER REFERENCES people(id),
  assignee_user_id      INTEGER REFERENCES users(id),   -- optional link to a system account
  planned_hours         DOUBLE PRECISION,
  actual_hours_legacy   DOUBLE PRECISION,               -- imported "Tempo (h)" - preserved as-is
  legacy_hours_confirmed INTEGER NOT NULL DEFAULT 0,     -- 1 once an admin confirms it as the actual-hours baseline
  start_date            TEXT,                            -- INÍCIO
  due_date              TEXT,                            -- planned deadline (new field, editable)
  completion_date       TEXT,                            -- FIM (imported end/completion date)
  status                TEXT NOT NULL CHECK (status IN ('ANDAMENTO','CANCELADO','CONCLUÍDO','EM ESTUDO')),
  observations          TEXT,                            -- OBSERVAÇÕES (multiline)
  cancellation_reason   TEXT,
  import_exceptions     TEXT,                            -- JSON array of exception codes, or NULL
  source                TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('IMPORT','MANUAL')),
  created_by            INTEGER REFERENCES users(id),
  updated_by            INTEGER REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at            TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  deleted_at            TEXT                             -- soft delete
);
CREATE INDEX idx_actions_project ON actions(project_id);
CREATE INDEX idx_actions_area ON actions(area_id);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_ref_month ON actions(ref_month);
CREATE INDEX idx_actions_due_date ON actions(due_date);
CREATE INDEX idx_actions_completion_date ON actions(completion_date);
CREATE INDEX idx_actions_assignee ON actions(assignee_user_id);
CREATE INDEX idx_actions_deleted ON actions(deleted_at);

-- ---------------------------------------------------------------------------
-- Time entries (planned / actual hours ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE time_entries (
  id                SERIAL PRIMARY KEY,
  action_uuid       TEXT NOT NULL REFERENCES actions(uuid) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id),
  entry_date        TEXT NOT NULL,
  hours             DOUBLE PRECISION NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('PLANNED','ACTUAL')),
  note              TEXT,
  approval_status   TEXT NOT NULL DEFAULT 'APPROVED' CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
  is_legacy_import  INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_time_entries_action ON time_entries(action_uuid);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_date ON time_entries(entry_date);
CREATE INDEX idx_time_entries_type ON time_entries(type);

-- ---------------------------------------------------------------------------
-- Comments & Attachments
-- ---------------------------------------------------------------------------
CREATE TABLE comments (
  id           SERIAL PRIMARY KEY,
  action_uuid  TEXT NOT NULL REFERENCES actions(uuid) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  updated_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_comments_action ON comments(action_uuid);

CREATE TABLE attachments (
  id             SERIAL PRIMARY KEY,
  action_uuid    TEXT NOT NULL REFERENCES actions(uuid) ON DELETE CASCADE,
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime_type      TEXT,
  size_bytes     INTEGER,
  uploaded_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_attachments_action ON attachments(action_uuid);

-- ---------------------------------------------------------------------------
-- Audit log (immutable - no UPDATE/DELETE routes ever touch this table)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id                SERIAL PRIMARY KEY,
  entity_type       TEXT NOT NULL,      -- 'ACTION','USER','PROJECT','AREA','TIME_ENTRY','AUTH', ...
  entity_id         TEXT NOT NULL,      -- uuid or numeric id as text
  business_id       INTEGER,            -- action business id, when applicable (fast lookup)
  project_id        INTEGER REFERENCES projects(id),
  action_type       TEXT NOT NULL,      -- CREATE, UPDATE, DELETE, STATUS_CHANGE, LOGIN, LOGOUT, IMPORT, EXPORT, ...
  field_name        TEXT,
  old_value         TEXT,
  new_value         TEXT,
  actor_user_id     INTEGER REFERENCES users(id),
  actor_name        TEXT NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_business ON audit_log(business_id);
CREATE INDEX idx_audit_project ON audit_log(project_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Import batches (import audit summary)
-- ---------------------------------------------------------------------------
CREATE TABLE import_batches (
  id             SERIAL PRIMARY KEY,
  source_file    TEXT NOT NULL,
  imported_by    INTEGER REFERENCES users(id),
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  total_rows     INTEGER NOT NULL DEFAULT 0,
  inserted_rows  INTEGER NOT NULL DEFAULT 0,
  rejected_rows  INTEGER NOT NULL DEFAULT 0,
  exception_rows INTEGER NOT NULL DEFAULT 0,
  summary_json   TEXT
);

-- ---------------------------------------------------------------------------
-- Saved views (per-user filter + column presets)
-- ---------------------------------------------------------------------------
CREATE TABLE saved_views (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  columns_json TEXT,
  is_shared    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE UNIQUE INDEX idx_saved_views_user_name ON saved_views(user_id, name);
-- Note: schema_migrations itself is created by the migration runner (db/migrate.js)
-- before any migration file is applied.
