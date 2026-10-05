-- Adds a workflow status to projects (Melhoria 9), independent from the
-- per-action status. Defaults every existing project to 'ANDAMENTO' so this
-- is a safe, backward-compatible migration.
ALTER TABLE projects
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ANDAMENTO'
  CHECK (status IN ('ANDAMENTO','CONCLUÍDO','CANCELADO','PARADO'));

CREATE INDEX idx_projects_status ON projects(status);
