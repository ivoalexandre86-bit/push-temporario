// Catálogo de campos dos cadastros de logística, definido a partir dos
// cabeçalhos REAIS da planilha "Contatos Logística.xlsx". É a única fonte
// de verdade para: colunas do banco, rótulos em português, mapeamento
// automático de colunas na importação e exportação para Excel.
//
// aliases: cabeçalhos normalizados (headerKey: só letras/dígitos, sem
// acento) que mapeiam automaticamente para o campo. Um alias com
// `occurrence` só casa com a N-ésima coluna de mesmo cabeçalho — a aba
// "TRANSPORTADOR" repete "Email" e "Celular" para três contatos diferentes,
// e a aba "REGIONAIS" repete "Regional" (nome da regional e nome da pessoa).
//
// kind: text | email | cnpj | zip | uf | phone
// "Observações" é o único campo que não existe na planilha (texto livre,
// opcional, para uso no sistema).
// Nenhum campo é obrigatório por suposição: os únicos obrigatórios são os
// que identificam o registro (sem eles não há como evitar duplicidade).

// header: cabeçalho usado na exportação, igual ao da planilha original, para
// que um arquivo exportado possa ser reimportado com o mapeamento automático.
const g = (group, key, column, label, header, aliases, kind = 'text') => ({
  key, column, label, header, group, aliases, kind,
});

const UNIT_FIELDS = [
  { key: 'complex', header: 'Complexo', column: 'complex', label: 'Complexo', group: 'Unidade', aliases: ['complexo'] },
  { key: 'state', header: 'UF', column: 'state', label: 'UF', group: 'Unidade', aliases: ['uf', 'estado'], kind: 'uf' },
  { key: 'company', header: 'Empresa', column: 'company', label: 'Empresa', group: 'Unidade', aliases: ['empresa'] },
  { key: 'branchCode', header: 'Filial', column: 'branch_code', label: 'Filial (código)', group: 'Unidade', aliases: ['filial', 'codigofilial', 'codfilial'] },
  { key: 'branchName', header: 'Nome da Filial', column: 'branch_name', label: 'Nome da Filial', group: 'Unidade', aliases: ['nomedafilial', 'nomefilial', 'unidade'] },
  { key: 'cnpj', header: 'CNPJ', column: 'cnpj', label: 'CNPJ', group: 'Unidade', aliases: ['cnpj'], kind: 'cnpj' },
  { key: 'address', header: 'Endereco', column: 'address', label: 'Endereço', group: 'Unidade', aliases: ['endereco'] },
  { key: 'zipCode', header: 'CEP', column: 'zip_code', label: 'CEP', group: 'Unidade', aliases: ['cep'], kind: 'zip' },
];

const REGION_FIELD = {
  key: 'region', header: 'Regional', column: null, label: 'Regional', group: 'Regional', aliases: [{ key: 'regional', occurrence: 1 }], required: true, kind: 'region',
};

const contactGroup = (group, prefix, columnPrefix, suffixHeader) => [
  g(group, `${prefix}Name`, `${columnPrefix}_name`, `${group} — Nome`, group, [suffixHeader]),
  g(group, `${prefix}Email`, `${columnPrefix}_email`, `${group} — E-mail`, `Email (${group})`, [`email${suffixHeader}`], 'email'),
  g(group, `${prefix}Phone`, `${columnPrefix}_phone`, `${group} — Tel. comercial`, `Tel Comercial (${group})`, [`telcomercial${suffixHeader}`, `telefone${suffixHeader}`], 'phone'),
  g(group, `${prefix}Voice`, `${columnPrefix}_voice`, `${group} — Canal de voz`, `Canal de Voz (${group})`, [`canaldevoz${suffixHeader}`], 'phone'),
  g(group, `${prefix}Mobile`, `${columnPrefix}_mobile`, `${group} — Celular`, `Celular (${group})`, [`celular${suffixHeader}`], 'phone'),
];

const TARGETS = {
  // Aba "REGIONAIS": uma linha por regional + departamento (Regionais, Programador...)
  REGIONS: {
    key: 'REGIONS',
    label: 'Regionais e contatos',
    description: 'Cadastra as regionais e o contato de cada departamento (Regionais, Programador...).',
    entityType: 'REGION_CONTACT',
    fields: [
      REGION_FIELD,
      { key: 'department', header: 'Departamento', column: 'department', label: 'Departamento', group: 'Contato', aliases: ['departamento', 'depto', 'area'] },
      { key: 'name', header: 'Regional', column: 'name', label: 'Contato — Nome', group: 'Contato', aliases: [{ key: 'regional', occurrence: 2 }, 'nome', 'contato', 'responsavel'] },
      { key: 'email', header: 'Email', column: 'email', label: 'Contato — E-mail', group: 'Contato', aliases: ['email', 'e-mail'], kind: 'email' },
      { key: 'phone', header: 'Tel Comercial', column: 'phone', label: 'Contato — Tel. comercial', group: 'Contato', aliases: ['telcomercial', 'telefone'], kind: 'phone' },
      { key: 'voiceChannel', header: 'Canal de Voz', column: 'voice_channel', label: 'Contato — Canal de voz', group: 'Contato', aliases: ['canaldevoz'], kind: 'phone' },
      { key: 'mobile', header: 'Celular', column: 'mobile', label: 'Contato — Celular', group: 'Contato', aliases: ['celular'], kind: 'phone' },
    ],
  },

  // Aba "Regionais " (com espaço no fim): na prática, as filiais/unidades de cada regional.
  BRANCHES: {
    key: 'BRANCHES',
    label: 'Filiais (unidades)',
    description: 'Cadastra as filiais/unidades de cada regional, com gerente, coordenador e assistente.',
    entityType: 'BRANCH',
    table: 'branches',
    fields: [
      REGION_FIELD,
      ...UNIT_FIELDS.map((f) => (f.key === 'branchName' ? { ...f, required: true } : f)),
      ...contactGroup('Gerente Unidade', 'unitManager', 'unit_manager', 'gerenteunidade'),
      ...contactGroup('Coordenador Logística', 'logisticsCoord', 'logistics_coord', 'coordenadorlogistica'),
      ...contactGroup('Assistente Coordenador', 'assistantCoord', 'assistant_coord', 'assistentecoordenador'),
      { key: 'notes', header: 'Observações', column: 'notes', label: 'Observações', group: 'Outros', aliases: ['observacoes', 'observacao', 'obs'] },
    ],
  },

  // Aba "TRANSPORTADOR": transportadora que atende uma unidade.
  CARRIERS: {
    key: 'CARRIERS',
    label: 'Transportadores',
    description: 'Cadastra a transportadora que atende cada unidade, com gerente, programador e contato da unidade.',
    entityType: 'CARRIER',
    table: 'carriers',
    fields: [
      REGION_FIELD,
      ...UNIT_FIELDS,
      { key: 'carrierName', header: 'Transportadora', column: 'carrier_name', label: 'Transportadora', group: 'Transportadora', aliases: ['transportadora', 'transportador', 'nometransportadora'], required: true },
      { key: 'managerName', header: 'Gerente transportadora', column: 'manager_name', label: 'Gerente transportadora — Nome', group: 'Gerente transportadora', aliases: ['gerentetransportadora'] },
      { key: 'managerEmail', header: 'Email', column: 'manager_email', label: 'Gerente transportadora — E-mail', group: 'Gerente transportadora', aliases: [{ key: 'email', occurrence: 1 }, 'emailgerentetransportadora'], kind: 'email' },
      { key: 'managerMobile', header: 'Celular', column: 'manager_mobile', label: 'Gerente transportadora — Celular', group: 'Gerente transportadora', aliases: [{ key: 'celular', occurrence: 1 }, 'celulargerentetransportadora'], kind: 'phone' },
      { key: 'schedulerName', header: 'Programador transportadora', column: 'scheduler_name', label: 'Programador transportadora — Nome', group: 'Programador transportadora', aliases: ['programadortransportadora'] },
      { key: 'schedulerEmail', header: 'Email', column: 'scheduler_email', label: 'Programador transportadora — E-mail', group: 'Programador transportadora', aliases: [{ key: 'email', occurrence: 2 }, 'emailprogramadortransportadora'], kind: 'email' },
      { key: 'schedulerMobile', header: 'Celular', column: 'scheduler_mobile', label: 'Programador transportadora — Celular', group: 'Programador transportadora', aliases: [{ key: 'celular', occurrence: 2 }, 'celularprogramadortransportadora'], kind: 'phone' },
      { key: 'unitContactName', header: 'Contato Unidade', column: 'unit_contact_name', label: 'Contato Unidade — Nome', group: 'Contato Unidade', aliases: ['contatounidade'] },
      { key: 'unitContactEmail', header: 'Email', column: 'unit_contact_email', label: 'Contato Unidade — E-mail', group: 'Contato Unidade', aliases: [{ key: 'email', occurrence: 3 }, 'emailcontatounidade'], kind: 'email' },
      { key: 'unitContactPhone', header: 'Tel Comercial', column: 'unit_contact_phone', label: 'Contato Unidade — Tel. comercial', group: 'Contato Unidade', aliases: ['telcomercial', 'telcomercialcontatounidade'], kind: 'phone' },
      { key: 'unitContactVoice', header: 'Canal de Voz', column: 'unit_contact_voice', label: 'Contato Unidade — Canal de voz', group: 'Contato Unidade', aliases: ['canaldevoz', 'canaldevozcontatounidade'], kind: 'phone' },
      { key: 'unitContactMobile', header: 'Celular', column: 'unit_contact_mobile', label: 'Contato Unidade — Celular', group: 'Contato Unidade', aliases: [{ key: 'celular', occurrence: 3 }, 'celularcontatounidade'], kind: 'phone' },
      { key: 'notes', header: 'Observações', column: 'notes', label: 'Observações', group: 'Outros', aliases: ['observacoes', 'observacao', 'obs'] },
    ],
  },
};

/** Fields stored in a table column (everything except the region lookup). */
const dataFields = (targetKey) => TARGETS[targetKey].fields.filter((f) => f.column);

/** Field metadata safe to send to the browser (no DB column names). */
function publicTargets() {
  return Object.values(TARGETS).map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    fields: t.fields.map((f) => ({ key: f.key, label: f.label, group: f.group, required: !!f.required, kind: f.kind || 'text' })),
  }));
}

module.exports = { TARGETS, dataFields, publicTargets };
