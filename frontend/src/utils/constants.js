export const STATUSES = ['ANDAMENTO', 'EM ESTUDO', 'CONCLUÍDO', 'CANCELADO'];

export const STATUS_META = {
  ANDAMENTO: { label: 'Andamento', bg: 'var(--status-andamento-bg)', fg: 'var(--status-andamento-fg)' },
  'EM ESTUDO': { label: 'Em Estudo', bg: 'var(--status-emestudo-bg)', fg: 'var(--status-emestudo-fg)' },
  'CONCLUÍDO': { label: 'Concluído', bg: 'var(--status-concluido-bg)', fg: 'var(--status-concluido-fg)' },
  CANCELADO: { label: 'Cancelado', bg: 'var(--status-cancelado-bg)', fg: 'var(--status-cancelado-fg)' },
};

export const FLAG_LABELS = {
  OVERDUE: 'Atrasada',
  DUE_SOON: 'Vence em breve',
  MISSING_ASSIGNEE: 'Sem responsável',
  MISSING_PLANNED_HOURS: 'Sem horas planejadas',
  NEGATIVE_VARIANCE: 'Horas acima do planejado',
  MISSING_COMPLETION_DATE: 'Concluída sem data de fim',
  MISSING_CANCELLATION_REASON: 'Cancelada sem motivo',
};

export const IMPORT_EXCEPTION_LABELS = {
  LEGACY_HOURS_REVIEW: 'Horas importadas (legado) pendentes de confirmação',
  NEGATIVE_LEGACY_HOURS: 'Horas importadas negativas (valor original preservado)',
  MISSING_COMPLETION_DATE: 'Status Concluído sem data de conclusão na planilha original',
  FREE_TEXT_MONTH_FORMAT: 'Mês de referência importado em formato de texto livre',
  FREE_TEXT_START_DATE_FORMAT: 'Data de início importada em formato de texto livre',
  FREE_TEXT_COMPLETION_DATE_FORMAT: 'Data de fim importada em formato de texto livre',
};

export const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
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
};

export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  PROJECT_MANAGER: 'Gerente de Projeto',
  CONTRIBUTOR: 'Colaborador',
  VIEWER: 'Visualizador',
  AUDITOR: 'Auditor',
};

export const CHART_COLORS = ['#1d4ed8', '#15803d', '#b45309', '#b91c1c', '#7c3aed', '#0891b2', '#c2410c', '#4d7c0f'];

export const PROJECT_STATUSES = ['ANDAMENTO', 'CONCLUÍDO', 'PARADO', 'CANCELADO'];

export const PROJECT_STATUS_META = {
  ANDAMENTO: { label: 'Em andamento', bg: 'var(--status-andamento-bg)', fg: 'var(--status-andamento-fg)' },
  'CONCLUÍDO': { label: 'Concluído', bg: 'var(--status-concluido-bg)', fg: 'var(--status-concluido-fg)' },
  PARADO: { label: 'Parado', bg: 'var(--status-emestudo-bg)', fg: 'var(--status-emestudo-fg)' },
  CANCELADO: { label: 'Cancelado', bg: 'var(--status-cancelado-bg)', fg: 'var(--status-cancelado-fg)' },
};

export const PROJECT_PRIORITIES = ['ALTA', 'MEDIA', 'BAIXA'];

export const PROJECT_PRIORITY_META = {
  ALTA: { label: 'Alta', className: 'text-red-700' },
  MEDIA: { label: 'Média', className: 'text-amber-700' },
  BAIXA: { label: 'Baixa', className: 'text-gray-600' },
};


// Accent colors for the dark data grids (row border, dots and pills).
export const GRID_STATUS_COLORS = {
  ANDAMENTO: '#60a5fa',
  'EM ESTUDO': '#fbbf24',
  PARADO: '#fbbf24',
  'CONCLUÍDO': '#4ade80',
  CANCELADO: '#f87171',
};

export const GRID_PRIORITY_COLORS = {
  ALTA: '#f87171',
  MEDIA: '#fbbf24',
  BAIXA: '#94a3b8',
};

/** Translucent pill background for an accent color (#rrggbb). */
export function pillStyle(color) {
  const c = color || '#94a3b8';
  return { color: c, background: `${c}1f`, borderColor: `${c}55` };
}
