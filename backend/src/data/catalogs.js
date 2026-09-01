// Canonical catalogs preserved from the original PROJETOS.xlsx workbook.
// These are seeded as active catalog entries (is_imported = 1) regardless of
// whether every value appears in the initial 401 imported action rows, so
// administrators immediately see the full, original catalog and can extend
// it later without recreating missing values.

const PROJECTS = [
  'Agendamento Portos', 'Ar Condicionado', 'Barcaça', 'CFTV Terminal', 'Câmeras Frota ME',
  'Integração Frete Planta Porto', 'Lead Time ME', 'Luizito', 'Mobiletec', 'Monitoramento',
  'Newco Bebedouro', 'Newco Campinas', 'Reforma', 'RoadLog', 'SOX - BALSA', 'TVs Video Wall',
  'Transporte', 'WallDash',
];

const AREAS = [
  'API', 'API IMBITUBA', 'API JBST', 'API SALVADOR', 'API BTP SANTOS', 'API DPW SANTOS',
  'API EVO', 'API ITAPOA', 'API PORTONAVE', 'API TCP', 'API TCP PARANAGUÁ', 'API TECON RIO GRANDE',
  'APP', 'Administração', 'Agendamento', 'Com OC', 'Controles', 'Crud', 'Customer Service',
  'Demandas', 'Desenvolvimento', 'Detention', 'Disponibilidade', 'Engenharia', 'Erros', 'Geral',
  'Gestão Projeto', 'Gestão de Pátio', 'Gráfico', 'IA', 'Integração SRP', 'Mapa',
  'Newco Bebedouro', 'Newco Campinas', 'Operação Seara', 'Planejamento', 'Sem OC', 'TI',
  'Tecon Santa Clara', 'Todas', 'Transporte', 'Transporte ME', 'Tração', 'WallDash', 'Web',
];

const STATUSES = ['ANDAMENTO', 'CANCELADO', 'CONCLUÍDO', 'EM ESTUDO'];

module.exports = { PROJECTS, AREAS, STATUSES };
