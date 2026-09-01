// Central permission catalog and role -> permission matrix.
// Used both by the DB seed (to populate roles/permissions/role_permissions)
// and by the RBAC middleware at request time.

const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  PROJECTS_MANAGE: 'projects.manage',
  AREAS_MANAGE: 'areas.manage',

  ACTIONS_VIEW: 'actions.view',
  ACTIONS_CREATE: 'actions.create',
  ACTIONS_EDIT_ANY: 'actions.edit_any',
  ACTIONS_EDIT_ASSIGNED: 'actions.edit_assigned',
  ACTIONS_DELETE: 'actions.delete',

  HOURS_EDIT: 'hours.edit',
  HOURS_APPROVE: 'hours.approve',

  COMMENTS_CREATE: 'comments.create',
  ATTACHMENTS_CREATE: 'attachments.create',

  AUDIT_VIEW: 'audit.view',
  REPORTS_EXPORT: 'reports.export',
  DASHBOARD_VIEW: 'dashboard.view',
  IMPORT_RUN: 'import.run',
};

const ROLES = {
  ADMIN: 'ADMIN',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  CONTRIBUTOR: 'CONTRIBUTOR',
  VIEWER: 'VIEWER',
  AUDITOR: 'AUDITOR',
};

const ROLE_LABELS_PT = {
  ADMIN: 'Administrador',
  PROJECT_MANAGER: 'Gerente de Projeto',
  CONTRIBUTOR: 'Colaborador',
  VIEWER: 'Visualizador',
  AUDITOR: 'Auditor',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// Roles that are NOT restricted by project/area scope tables (see rbac.js)
const GLOBAL_SCOPE_ROLES = new Set([ROLES.ADMIN, ROLES.AUDITOR]);

const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: ALL_PERMISSIONS,
  [ROLES.PROJECT_MANAGER]: [
    PERMISSIONS.ACTIONS_VIEW,
    PERMISSIONS.ACTIONS_CREATE,
    PERMISSIONS.ACTIONS_EDIT_ANY,
    PERMISSIONS.HOURS_EDIT,
    PERMISSIONS.HOURS_APPROVE,
    PERMISSIONS.COMMENTS_CREATE,
    PERMISSIONS.ATTACHMENTS_CREATE,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.AREAS_MANAGE,
  ],
  [ROLES.CONTRIBUTOR]: [
    PERMISSIONS.ACTIONS_VIEW,
    PERMISSIONS.ACTIONS_EDIT_ASSIGNED,
    PERMISSIONS.HOURS_EDIT,
    PERMISSIONS.COMMENTS_CREATE,
    PERMISSIONS.ATTACHMENTS_CREATE,
    PERMISSIONS.DASHBOARD_VIEW,
  ],
  [ROLES.VIEWER]: [
    PERMISSIONS.ACTIONS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ],
  [ROLES.AUDITOR]: [
    PERMISSIONS.ACTIONS_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ],
};

module.exports = {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS_PT,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  GLOBAL_SCOPE_ROLES,
};
