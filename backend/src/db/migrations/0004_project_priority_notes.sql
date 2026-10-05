-- Adds an optional priority (Alta/Média/Baixa) and free-text notes to
-- projects, edited inline on the Projetos grid. Additive only: both columns
-- are nullable, so existing rows are untouched.
ALTER TABLE projects
  ADD COLUMN priority TEXT
  CHECK (priority IS NULL OR priority IN ('ALTA','MEDIA','BAIXA'));

ALTER TABLE projects ADD COLUMN notes TEXT;
