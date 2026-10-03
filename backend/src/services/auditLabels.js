// pt-BR labels for audit_log codes, used by the audit export. Keep in sync
// with frontend/src/utils/auditLabels.js (the audit screen).

const ENTITY_LABELS = {
  ACTION: 'Ação',
  PROJECT: 'Projeto',
  AREA: 'Área/Processo',
  USER: 'Usuário',
  TIME_ENTRY: 'Lançamento de horas',
  AUTH: 'Acesso (login)',
  EXPORT: 'Exportação',
  IMPORT: 'Importação',
};

const ACTION_LABELS = {
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

const FIELD_LABELS = {
  project_id: 'Projeto', area_id: 'Área/Processo', ref_month: 'Mês de referência', description: 'Descrição',
  responsible_name: 'Responsável', assignee_user_id: 'Responsável (usuário)', planned_hours: 'Horas planejadas',
  start_date: 'Data de início', due_date: 'Prazo', completion_date: 'Data de conclusão', status: 'Status',
  observations: 'Observações', cancellation_reason: 'Motivo do cancelamento', legacy_hours_confirmed: 'Horas legadas confirmadas',
  name: 'Nome', active: 'Ativo', priority: 'Prioridade', notes: 'Observação', manager_user_id: 'Gerente do projeto',
  role: 'Papel', projectScope: 'Projetos com acesso', areaScope: 'Áreas com acesso', approval_status: 'Situação da aprovação',
};

const entityLabel = (code) => ENTITY_LABELS[code] || code || '';
const actionLabel = (code) => ACTION_LABELS[code] || code || '';
const fieldLabel = (code) => FIELD_LABELS[code] || code || '';

module.exports = { ENTITY_LABELS, ACTION_LABELS, FIELD_LABELS, entityLabel, actionLabel, fieldLabel };
