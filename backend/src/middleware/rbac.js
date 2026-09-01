const db = require('../db/connection');
const { GLOBAL_SCOPE_ROLES } = require('../permissions');

const permCache = new Map();
async function roleHasPermission(roleKey, permissionKey) {
  let set = permCache.get(roleKey);
  if (!set) {
    const rows = await db.all(
      `SELECT p.key FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN roles r ON r.id = rp.role_id
       WHERE r.key = ?`,
      roleKey
    );
    set = new Set(rows.map((r) => r.key));
    permCache.set(roleKey, set);
  }
  return set.has(permissionKey);
}

/** Express middleware factory: 403s unless req.user's role grants `permissionKey`. */
function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Sessão não encontrada.' });
    }
    if (!(await roleHasPermission(req.user.role_key, permissionKey))) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Você não tem permissão para executar esta ação.',
      });
    }
    next();
  };
}

/** True when the user's role is exempt from project/area scoping (Admin, Auditor). */
function hasGlobalScope(user) {
  return GLOBAL_SCOPE_ROLES.has(user.role_key);
}

/** Returns the set of project IDs a user is allowed to see, or null meaning "all". */
async function allowedProjectIds(user) {
  if (hasGlobalScope(user)) return null;
  const rows = await db.all('SELECT project_id FROM user_project_scope WHERE user_id = ?', user.id);
  return rows.map((r) => r.project_id);
}

/** Returns the set of area IDs a user is allowed to see, or null meaning "all" (no restriction configured). */
async function allowedAreaIds(user) {
  if (hasGlobalScope(user)) return null;
  const rows = (await db.all('SELECT area_id FROM user_area_scope WHERE user_id = ?', user.id)).map((r) => r.area_id);
  return rows.length ? rows : null; // empty area scope = not restricted by area (project scope still applies)
}

/** Throws-free check used by route handlers before returning/mutating a single action. */
async function canAccessProject(user, projectId) {
  const ids = await allowedProjectIds(user);
  if (ids === null) return true;
  return ids.includes(projectId);
}

module.exports = {
  requirePermission,
  roleHasPermission,
  hasGlobalScope,
  allowedProjectIds,
  allowedAreaIds,
  canAccessProject,
};
