// pt-BR labels for audit_log codes (entity_type, action_type, field_name and
// JSON payload keys). Keep in sync with backend/src/services/auditLabels.js,
// used by the audit export.
import { STATUS_META, PROJECT_STATUS_META, PROJECT_PRIORITY_META, ROLE_LABELS } from './constants';

export const AUDIT_ENTITY_LABELS = {
  ACTION: 'Ação',
  PROJECT: 'Projeto',
  AREA: 'Área/Processo',
  USER: 'Usuário',
  TIME_ENTRY: 'Lançamento de horas',
  AUTH: 'Acesso (login)',
  EXPORT: 'Exportação',
  IMPORT: 'Importação',
};

export const AUDIT_ACTION_LABELS = {
  CREATE: 'Criação',
  UPDATE: 'Alteração',
  DELETE: 'Exclusão',
  STATUS_CHANGE: 'Mudança de status',
  STATUS_CHANGE_REASON: 'Motivo da mudança de status',
  COMMENT: 'Comentário',
  ATTACHMENT_ADDED: 'Anexo adicionado',
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  LOGIN_FAILED: 'Falha de login',
  LOGIN_BLOCKED_DEMO: 'Login bloqueado (conta de demonstração)',
  PASSWORD_CHANGE: 'Troca de senha',
  PASSWORD_RESET: 'Senha redefinida',
  PASSWORD_RESET_REQUESTED: 'Redefinição de senha solicitada',
  PASSWORD_RESET_BY_ADMIN: 'Senha redefinida pelo administrador',
  EXPORT: 'Exportação de dados',
  IMPORT: 'Importação de dados',
};

export const AUDIT_FIELD_LABELS = {
  // actions
  project_id: 'Projeto', projectId: 'Projeto',
  area_id: 'Área/Processo', areaId: 'Área/Processo',
  ref_month: 'Mês de referência', refMonth: 'Mês de referência',
  description: 'Descrição',
  responsible_name: 'Responsável', responsibleName: 'Responsável',
  assignee_user_id: 'Responsável (usuário)', assigneeUserId: 'Responsável (usuário)',
  unassigned: 'Sem responsável',
  planned_hours: 'Horas planejadas', plannedHours: 'Horas planejadas',
  start_date: 'Data de início', startDate: 'Data de início',
  due_date: 'Prazo', dueDate: 'Prazo',
  completion_date: 'Data de conclusão', completionDate: 'Data de conclusão',
  status: 'Status',
  observations: 'Observações',
  cancellation_reason: 'Motivo do cancelamento', cancellationReason: 'Motivo do cancelamento',
  legacy_hours_confirmed: 'Horas legadas confirmadas',
  // projects / areas / users
  name: 'Nome',
  active: 'Ativo',
  priority: 'Prioridade',
  notes: 'Observação',
  manager_user_id: 'Gerente do projeto', managerUserId: 'Gerente do projeto',
  role: 'Papel',
  projectScope: 'Projetos com acesso',
  areaScope: 'Áreas com acesso',
  // time entries
  hours: 'Horas',
  type: 'Tipo',
  note: 'Nota',
  entryDate: 'Data do lançamento', entry_date: 'Data do lançamento',
  actionId: 'Ação',
  approval_status: 'Situação da aprovação',
  // exports
  format: 'Formato',
  filters: 'Filtros',
};

const VALUE_LABELS = {
  type: { PLANNED: 'Planejado', ACTUAL: 'Real' },
  approval_status: { PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Rejeitado' },
  role: ROLE_LABELS,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function auditEntityLabel(code) {
  return AUDIT_ENTITY_LABELS[code] || code;
}

export function auditActionLabel(code) {
  return AUDIT_ACTION_LABELS[code] || code;
}

export function auditFieldLabel(code) {
  return code ? (AUDIT_FIELD_LABELS[code] || code) : '';
}

/** Human-readable scalar value (status codes, booleans, dates) for a given field. */
export function formatAuditScalar(value, field) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  const str = String(value);
  if (field === 'status') return STATUS_META[str]?.label || PROJECT_STATUS_META[str]?.label || str;
  if (field === 'priority') return PROJECT_PRIORITY_META[str]?.label || str;
  if (VALUE_LABELS[field]?.[str]) return VALUE_LABELS[field][str];
  if (['active', 'legacy_hours_confirmed', 'unassigned'].includes(field) && ['0', '1', 'true', 'false'].includes(str)) {
    return str === '1' || str === 'true' ? 'Sim' : 'Não';
  }
  if (DATE_RE.test(str)) {
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }
  if (DATETIME_RE.test(str)) {
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) return dt.toLocaleString('pt-BR');
  }
  return str;
}

/** Parses a stored audit value; returns the object/array for JSON payloads, or null. */
export function parseAuditJson(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(t);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
