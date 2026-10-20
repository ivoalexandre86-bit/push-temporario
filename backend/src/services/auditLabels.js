// pt-BR labels for audit_log codes, used by the audit export. Keep in sync
// with frontend/src/utils/auditLabels.js (the audit screen).

const ENTITY_LABELS = {
  ACTION: 'Ação',
  PROJECT: 'Projeto',
  AREA: 'Área/Processo',
  PERSON: 'Responsável',
  USER: 'Usuário',
  TIME_ENTRY: 'Lançamento de horas',
  AUTH: 'Acesso (login)',
  EXPORT: 'Exportação',
  IMPORT: 'Importação',
  REGION: 'Regional',
  REGION_CONTACT: 'Contato da regional',
  BRANCH: 'Filial',
  CARRIER: 'Transportador',
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
  role: 'Papel', projectScope: 'Projetos com acesso', areaScope: 'Áreas com acesso', projectPeople: 'Responsáveis do projeto', projectAreas: 'Áreas/processos do projeto', approval_status: 'Situação da aprovação',
};


// Cadastros de logística (Regionais, Filiais, Transportadores)
const LOGISTICS_FIELD_LABELS = {
  department: 'Departamento',
  email: 'Contato — E-mail',
  phone: 'Contato — Tel. comercial',
  voice_channel: 'Contato — Canal de voz',
  mobile: 'Contato — Celular',
  complex: 'Complexo',
  state: 'UF',
  company: 'Empresa',
  branch_code: 'Filial (código)',
  branch_name: 'Nome da Filial',
  cnpj: 'CNPJ',
  address: 'Endereço',
  zip_code: 'CEP',
  unit_manager_name: 'Gerente Unidade — Nome',
  unit_manager_email: 'Gerente Unidade — E-mail',
  unit_manager_phone: 'Gerente Unidade — Tel. comercial',
  unit_manager_voice: 'Gerente Unidade — Canal de voz',
  unit_manager_mobile: 'Gerente Unidade — Celular',
  logistics_coord_name: 'Coordenador Logística — Nome',
  logistics_coord_email: 'Coordenador Logística — E-mail',
  logistics_coord_phone: 'Coordenador Logística — Tel. comercial',
  logistics_coord_voice: 'Coordenador Logística — Canal de voz',
  logistics_coord_mobile: 'Coordenador Logística — Celular',
  assistant_coord_name: 'Assistente Coordenador — Nome',
  assistant_coord_email: 'Assistente Coordenador — E-mail',
  assistant_coord_phone: 'Assistente Coordenador — Tel. comercial',
  assistant_coord_voice: 'Assistente Coordenador — Canal de voz',
  assistant_coord_mobile: 'Assistente Coordenador — Celular',
  carrier_name: 'Transportadora',
  manager_name: 'Gerente transportadora — Nome',
  manager_email: 'Gerente transportadora — E-mail',
  manager_mobile: 'Gerente transportadora — Celular',
  scheduler_name: 'Programador transportadora — Nome',
  scheduler_email: 'Programador transportadora — E-mail',
  scheduler_mobile: 'Programador transportadora — Celular',
  unit_contact_name: 'Contato Unidade — Nome',
  unit_contact_email: 'Contato Unidade — E-mail',
  unit_contact_phone: 'Contato Unidade — Tel. comercial',
  unit_contact_voice: 'Contato Unidade — Canal de voz',
  unit_contact_mobile: 'Contato Unidade — Celular',
  region_id: 'Regional',
  branch_id: 'Filial vinculada',
};

const entityLabel = (code) => ENTITY_LABELS[code] || code || '';
const actionLabel = (code) => ACTION_LABELS[code] || code || '';
const fieldLabel = (code) => FIELD_LABELS[code] || LOGISTICS_FIELD_LABELS[code] || code || '';

module.exports = { ENTITY_LABELS, ACTION_LABELS, FIELD_LABELS, entityLabel, actionLabel, fieldLabel };
