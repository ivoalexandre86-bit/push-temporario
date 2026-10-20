const request = require('supertest');
const ExcelJS = require('exceljs');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createUser } = require('./helpers');

// Synthetic workbook with the SAME sheet names and headers as the real
// "Contatos Logística.xlsx" (the real file holds personal contact data and is
// never committed), reproducing its data quirks: trailing space in a sheet
// name, repeated headers, a duplicated branch row, an invalid CNPJ, a CEP
// stored as a number, "NA" placeholders and a carrier whose unit is not in
// the branches sheet.
const BRANCH_HEADERS = ['Regional', 'Complexo', 'UF', 'Empresa', 'Filial', 'Nome da Filial', 'CNPJ', 'Endereco', 'CEP',
  'Gerente Unidade', 'Email (Gerente Unidade)', 'Tel Comercial(Gerente Unidade)', 'Canal de Voz (Gerente Unidade)', 'Celular(Gerente Unidade)',
  'Coordenador Logística', 'Email(Coordenador Logística)', 'Tel Comercial(Coordenador Logística)', 'Canal de Voz(Coordenador Logística)', 'Celular(Coordenador Logística)',
  'Assistente Coordenador', 'Email (Assistente Coordenador)', 'Tel Comercial(Assistente Coordenador)', 'Canal de Voz(Assistente Coordenador)', 'Celular(Assistente Coordenador)'];
const CARRIER_HEADERS = ['Regional', 'Complexo', 'UF', 'Empresa', 'Filial', 'Nome da Filial', 'CNPJ', 'Endereco', 'CEP', 'Transportadora',
  'Gerente transportadora', 'Email', 'Celular', 'Programador transportadora', 'Email', 'Celular', 'Contato Unidade', 'Email', 'Tel Comercial', 'Canal de Voz', 'Celular'];
const REGION_HEADERS = ['Departamento', 'Regional', 'Regional', 'Email', 'Tel Comercial', 'Canal de Voz', 'Celular'];

// Valid CNPJs (check digits computed): 11.222.333/0001-81, 11.444.777/0001-61
const CNPJ_A = '11.222.333/0001-81';
const CNPJ_B = '11.444.777/0001-61';

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const branches = wb.addWorksheet('Regionais ');
  branches.addRow(BRANCH_HEADERS);
  branches.addRow(['Sul', 'Alfa', 'SC', 30, 101, 'ALFA - AB. AVES', CNPJ_A, 'Rua A, 1', '89000-000',
    'Ana Gerente', 'ana@exemplo.com.br', '(47) 3000-0000', 'NA', '(47) 99999-0000', ...Array(10).fill(null)]);
  // Same CNPJ + filial: duplicate row that fills the empty coordinator name
  branches.addRow(['Sul', 'Alfa', 'SC', 30, 101, 'ALFA - AB. AVES.', CNPJ_A, 'Rua A, 1', '89000-000',
    null, null, null, null, null, 'Carlos Coord', 'carlos@exemplo.com.br', ...Array(8).fill(null)]);
  // Invalid CNPJ, CEP as number (leading zero lost), unknown region
  branches.addRow(['Norte', 'Beta', 'SP', 30, 202, 'BETA - CD', '1234567/0001-00', 'Rua B, 2', 5322900, ...Array(15).fill(null)]);
  branches.addRow(['Sul', 'Gama', 'RD', 36, 303, 'GAMA - IND', CNPJ_B, 'Rua C, 3', '88000-000', ...Array(15).fill(null)]);

  const carriers = wb.addWorksheet('TRANSPORTADOR');
  carriers.addRow(CARRIER_HEADERS);
  carriers.addRow(['Sul', 'Alfa', 'SC', 30, 101, 'ALFA - AB. AVES', CNPJ_A, 'Rua A, 1', '89000-000', 'TRANSX',
    'Gil Gerente', 'gil@transx.com.br', '47 90000 0000', 'Pri Prog', 'pri@transx.com.br', '47 91111 1111',
    'Uli Unidade', 'uli@exemplo.com.br', '47 3222 2222', null, '47 92222 2222']);
  carriers.addRow(['Sul', 'Fora', 'RS', '-', 999, 'UNIDADE FORA DO CADASTRO', '99.888.777/0001-00', 'Rua Z', '95000-000', 'TRANSY',
    'Hugo', 'hugo@transy.com.br', null, 'Ivo', 'ivo@transy.com.br', null, 'Joana', 'joana@exemplo.com.br', 'Não tem', null, null]);

  const regions = wb.addWorksheet('REGIONAIS');
  regions.addRow(REGION_HEADERS);
  regions.addRow(['Regionais', 'Sul', 'Rita Regional', 'rita@exemplo.com.br', null, null, null]);
  regions.addRow(['Programador', 'Sul', 'Paulo Programador', 'paulo@exemplo.com.br', null, null, null]);
  regions.addRow(['Regionais', 'Centro', 'Clara Centro', 'clara@exemplo.com.br', null, null, null]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

let app, db, adminCookie, viewerCookie, file;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie: adminCookie } = await login(app, 'admin@projetos.local', 'Test@1234'));
  await createUser(db, { name: 'Leitor Logística', email: 'leitor.log@projetos.local', roleKey: 'VIEWER' });
  ({ cookie: viewerCookie } = await login(app, 'leitor.log@projetos.local', 'Test@1234'));
  file = await buildWorkbook();
});

afterAll(async () => {
  await closeTestDb();
});

const post = (path, cookie = adminCookie) => withAuth(request(app).post(`/api/logistics${path}`), cookie);
const get = (path, cookie = adminCookie) => withAuth(request(app).get(`/api/logistics${path}`), cookie);

async function analyze() {
  const res = await post('/import/analyze').attach('file', file, 'Contatos Logística.xlsx');
  expect(res.status).toBe(200);
  return res.body;
}

function planRequest(path, { sheetName, target, mapping, options = {}, extra = {} }) {
  let req = post(path).attach('file', file, 'Contatos Logística.xlsx')
    .field('sheetName', sheetName).field('target', target)
    .field('mapping', JSON.stringify(mapping)).field('options', JSON.stringify(options));
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return req;
}

async function importSheet(sheetName, options = {}) {
  const { sheets } = await analyze();
  const sheet = sheets.find((s) => s.name === sheetName);
  const args = { sheetName, target: sheet.suggestedTarget, mapping: sheet.mappings[sheet.suggestedTarget], options };
  const preview = await planRequest('/import/preview', args);
  expect(preview.status).toBe(200);
  const commit = await planRequest('/import/commit', { ...args, extra: { planHash: preview.body.planHash, confirmUpdates: 'true' } });
  expect(commit.status).toBe(200);
  return { preview: preview.body, commit: commit.body };
}

describe('Importação: análise da planilha', () => {
  it('reconhece as três abas, sugere o destino e mapeia todas as colunas (inclusive cabeçalhos repetidos)', async () => {
    const { sheets } = await analyze();
    const byName = Object.fromEntries(sheets.map((s) => [s.name, s]));
    expect(byName['Regionais '].suggestedTarget).toBe('BRANCHES');
    expect(byName.TRANSPORTADOR.suggestedTarget).toBe('CARRIERS');
    expect(byName.REGIONAIS.suggestedTarget).toBe('REGIONS');
    expect(Object.keys(byName['Regionais '].mappings.BRANCHES)).toHaveLength(24);
    expect(Object.keys(byName.TRANSPORTADOR.mappings.CARRIERS)).toHaveLength(21);
    expect(byName['Regionais '].columns).toHaveLength(24);
    // The three "Email" columns go to the three different contacts, in order
    const m = byName.TRANSPORTADOR.mappings.CARRIERS;
    expect([m.managerEmail, m.schedulerEmail, m.unitContactEmail]).toEqual([12, 15, 18]);
    // "Regional" twice: region name, then the contact's name
    expect(byName.REGIONAIS.mappings.REGIONS.region).toBe(2);
    expect(byName.REGIONAIS.mappings.REGIONS.name).toBe(3);
  });

  it('recusa arquivo que não é .xlsx e não deixa um visualizador importar', async () => {
    const bad = await post('/import/analyze').attach('file', Buffer.from('a;b'), 'dados.csv');
    expect(bad.status).toBe(400);
    const viewer = await post('/import/analyze', viewerCookie).attach('file', file, 'x.xlsx');
    expect(viewer.status).toBe(403);
  });
});

describe('Importação: regionais, filiais e transportadores', () => {
  it('importa a aba REGIONAIS criando regionais e contatos por departamento', async () => {
    const { preview, commit } = await importSheet('REGIONAIS');
    expect(preview.summary.INSERT).toBe(3);
    expect(preview.summary.newRegions.sort()).toEqual(['Centro', 'Sul']);
    expect(commit.inserted).toBe(3);
    const regions = await get('/regions');
    const sul = regions.body.items.find((r) => r.name === 'Sul');
    expect(sul.contacts.map((c) => c.department).sort()).toEqual(['Programador', 'Regionais']);
  });

  it('pré-visualiza filiais: duplicada mesclada, regional inexistente rejeitada, avisos de CNPJ/CEP/UF/NA', async () => {
    const { sheets } = await analyze();
    const sheet = sheets.find((s) => s.name === 'Regionais ');
    const res = await planRequest('/import/preview', { sheetName: sheet.name, target: 'BRANCHES', mapping: sheet.mappings.BRANCHES });
    expect(res.status).toBe(200);
    const rows = Object.fromEntries(res.body.rows.map((r) => [r.rowNumber, r]));
    expect(rows[2].status).toBe('INSERT');
    expect(rows[2].values.logisticsCoordName).toBe('Carlos Coord'); // merged from row 3
    expect(rows[2].values.unitManagerVoice).toBeNull(); // "NA" -> empty
    expect(rows[2].warnings.join(' ')).toMatch(/NA/);
    expect(rows[3].status).toBe('DUPLICATE');
    expect(rows[3].duplicateOf).toBe(2);
    expect(rows[4].status).toBe('REJECTED');
    expect(rows[4].errors.join(' ')).toMatch(/Regional "Norte" não cadastrada/);
    expect(rows[5].warnings.join(' ')).toMatch(/UF "RD"/);
  });

  it('com "cadastrar regionais", grava filiais, restaura o CEP e sinaliza o CNPJ inválido', async () => {
    const { preview, commit } = await importSheet('Regionais ', { createMissingRegions: true });
    expect(preview.summary.newRegions).toEqual(['Norte']);
    const beta = preview.rows.find((r) => r.rowNumber === 4);
    expect(beta.values.zipCode).toBe('05322-900');
    expect(beta.warnings.join(' ')).toMatch(/CNPJ .* inválido/);
    expect(commit.inserted).toBe(3);
    expect(commit.skipped).toBe(1);
    const list = await get('/branches');
    expect(list.body.items).toHaveLength(3);
  });

  it('transportadores: vincula à filial pelo CNPJ + código e mantém a unidade sem cadastro', async () => {
    const { preview } = await importSheet('TRANSPORTADOR', { createMissingRegions: true });
    expect(preview.summary.INSERT).toBe(2);
    const list = await get('/carriers');
    const x = list.body.items.find((c) => c.carrierName === 'TRANSX');
    const y = list.body.items.find((c) => c.carrierName === 'TRANSY');
    expect(x.branchId).toBeTruthy();
    expect(x.schedulerEmail).toBe('pri@transx.com.br');
    expect(y.branchId).toBeNull();
    expect(y.unitContactPhone).toBeNull(); // "Não tem"
    const region = (await get('/regions')).body.items.find((r) => r.name === 'Sul');
    const detail = await get(`/regions/${region.id}`);
    expect(detail.body.carriers.map((c) => c.carrierName).sort()).toEqual(['TRANSX', 'TRANSY']);
  });

  it('reimportar sem atualizar não duplica nada', async () => {
    const { preview, commit } = await importSheet('Regionais ', { createMissingRegions: true });
    expect(preview.summary.INSERT).toBe(0);
    expect(preview.summary.SKIPPED_EXISTS).toBe(3);
    expect(commit.inserted).toBe(0);
    expect((await get('/branches')).body.items).toHaveLength(3);
  });

  it('atualização exige confirmação, não apaga com célula vazia e é recusada se os dados mudarem após a prévia', async () => {
    const branch = (await get('/branches')).body.items.find((b) => b.branchCode === '101');
    await withAuth(request(app).patch(`/api/logistics/branches/${branch.id}`), adminCookie).send({ address: 'Endereço alterado', notes: 'manter' });

    const { sheets } = await analyze();
    const sheet = sheets.find((s) => s.name === 'Regionais ');
    const args = { sheetName: sheet.name, target: 'BRANCHES', mapping: sheet.mappings.BRANCHES, options: { mode: 'UPSERT', createMissingRegions: true } };
    const preview = await planRequest('/import/preview', args);
    const row = preview.body.rows.find((r) => r.rowNumber === 2);
    expect(row.status).toBe('UPDATE');
    expect(row.changes.map((c) => c.field)).toEqual(['address']);

    const noConfirm = await planRequest('/import/commit', { ...args, extra: { planHash: preview.body.planHash } });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body.error).toBe('CONFIRMATION_REQUIRED');

    await withAuth(request(app).patch(`/api/logistics/branches/${branch.id}`), adminCookie).send({ address: 'Outro endereço' });
    const stale = await planRequest('/import/commit', { ...args, extra: { planHash: preview.body.planHash, confirmUpdates: 'true' } });
    expect(stale.status).toBe(409);

    const fresh = await planRequest('/import/preview', args);
    const ok = await planRequest('/import/commit', { ...args, extra: { planHash: fresh.body.planHash, confirmUpdates: 'true' } });
    expect(ok.status).toBe(200);
    expect(ok.body.updated).toBe(1);
    const after = (await get(`/branches/${branch.id}`)).body;
    expect(after.address).toBe('Rua A, 1');
    expect(after.notes).toBe('manter');
    expect(after.logisticsCoordName).toBe('Carlos Coord');
  });

  it('registra o histórico de importações e os eventos de auditoria', async () => {
    const history = await get('/import/history');
    expect(history.body.items.length).toBeGreaterThanOrEqual(5);
    expect(history.body.items[0]).toMatchObject({ target: 'BRANCHES', updatedRows: 1 });
    const audit = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'BRANCH' AND action_type = 'CREATE'");
    expect(audit.n).toBe(3);
  });
});

describe('Cadastro manual', () => {
  it('cria, edita e exclui uma regional; recusa nome duplicado (sem acento/maiúsculas)', async () => {
    const created = await post('/regions').send({ name: 'São Paulo Interior' });
    expect(created.status).toBe(201);
    const dup = await post('/regions').send({ name: '  sao paulo  interior ' });
    expect(dup.status).toBe(409);
    const patch = await withAuth(request(app).patch(`/api/logistics/regions/${created.body.id}`), adminCookie).send({ name: 'SP Interior' });
    expect(patch.status).toBe(200);
    const del = await withAuth(request(app).delete(`/api/logistics/regions/${created.body.id}`), adminCookie);
    expect(del.status).toBe(204);
  });

  it('valida campos na criação de filial e impede duplicidade por CNPJ + código', async () => {
    const sul = (await get('/regions')).body.items.find((r) => r.name === 'Sul');
    const bad = await post('/branches').send({ regionId: sul.id, branchName: 'Nova', cnpj: '12.345.678/0001-00', state: 'XX', unitManagerEmail: 'sem-arroba' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d) => d.path).sort()).toEqual(['cnpj', 'state', 'unitManagerEmail']);
    const missing = await post('/branches').send({ regionId: sul.id });
    expect(missing.status).toBe(400);
    const dup = await post('/branches').send({ regionId: sul.id, branchName: 'Outra', cnpj: '11222333000181', branchCode: '101' });
    expect(dup.status).toBe(409);
    const ok = await post('/branches').send({ regionId: sul.id, branchName: 'Delta', cnpj: '11222333000181', branchCode: '404', zipCode: '89000000' });
    expect(ok.status).toBe(201);
    const saved = (await get(`/branches/${ok.body.id}`)).body;
    expect(saved.cnpj).toBe(CNPJ_A);
    expect(saved.zipCode).toBe('89000-000');
  });

  it('mantém a integridade: não exclui filial/regional com vínculos e informa o motivo na exclusão em lote', async () => {
    const branches = (await get('/branches')).body.items;
    const alfa = branches.find((b) => b.branchCode === '101');
    const del = await withAuth(request(app).delete(`/api/logistics/branches/${alfa.id}`), adminCookie);
    expect(del.status).toBe(409);
    const sul = (await get('/regions')).body.items.find((r) => r.name === 'Sul');
    const centro = (await get('/regions')).body.items.find((r) => r.name === 'Centro');
    const bulk = await post('/regions/bulk-delete').send({ ids: [sul.id, centro.id] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.deleted).toEqual([centro.id]);
    expect(bulk.body.blocked[0].id).toBe(sul.id);
  });

  it('transportador: exige transportadora, aceita filial da mesma regional e recusa de outra', async () => {
    const regions = (await get('/regions')).body.items;
    const sul = regions.find((r) => r.name === 'Sul');
    const norte = regions.find((r) => r.name === 'Norte');
    const alfa = (await get('/branches')).body.items.find((b) => b.branchCode === '101');
    const noName = await post('/carriers').send({ regionId: sul.id, branchId: alfa.id });
    expect(noName.status).toBe(400);
    const wrongRegion = await post('/carriers').send({ regionId: norte.id, branchId: alfa.id, carrierName: 'TRANSZ' });
    expect(wrongRegion.status).toBe(400);
    const ok = await post('/carriers').send({ regionId: sul.id, branchId: alfa.id, carrierName: 'TRANSZ', branchName: alfa.branchName, cnpj: alfa.cnpj, branchCode: alfa.branchCode });
    expect(ok.status).toBe(201);
    const filtered = await get(`/carriers?branchId=${alfa.id}`);
    expect(filtered.body.items.map((c) => c.carrierName).sort()).toEqual(['TRANSX', 'TRANSZ']);
  });

  it('visualizador consulta e exporta, mas não altera', async () => {
    const list = await get('/carriers', viewerCookie);
    expect(list.status).toBe(200);
    const create = await post('/regions', viewerCookie).send({ name: 'Nao Pode' });
    expect(create.status).toBe(403);
    const exp = await get('/carriers/export?format=xlsx', viewerCookie).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(exp.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exp.body);
    const header = wb.getWorksheet('TRANSPORTADOR').getRow(1).values.slice(1);
    expect(header.slice(0, 21)).toEqual(CARRIER_HEADERS);
  });
});
