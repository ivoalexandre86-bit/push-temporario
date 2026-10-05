-- Records who created each project, so non-admin users can see the projects
-- they created (visibility: created, managed or linked via user_project_scope).
-- Additive: nullable column; existing rows backfilled from the audit log's
-- PROJECT/CREATE events where available.
ALTER TABLE projects ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);

UPDATE projects p
SET created_by_user_id = c.actor_user_id
FROM (
  SELECT DISTINCT ON (entity_id) entity_id, actor_user_id
  FROM audit_log
  WHERE entity_type = 'PROJECT' AND action_type = 'CREATE' AND actor_user_id IS NOT NULL
  ORDER BY entity_id, id
) c
WHERE c.entity_id = p.id::text AND p.created_by_user_id IS NULL;
