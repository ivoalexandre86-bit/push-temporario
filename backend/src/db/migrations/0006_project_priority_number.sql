-- Project priority becomes a number (1 = highest priority) instead of
-- Alta/Média/Baixa. Existing values are kept in the same order:
-- ALTA -> 1, MEDIA -> 2, BAIXA -> 3; empty stays empty.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_check;

ALTER TABLE projects ALTER COLUMN priority TYPE INTEGER USING (
  CASE priority WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 WHEN 'BAIXA' THEN 3 ELSE NULL END
);

ALTER TABLE projects ADD CONSTRAINT projects_priority_check
  CHECK (priority IS NULL OR (priority >= 1 AND priority <= 999));
