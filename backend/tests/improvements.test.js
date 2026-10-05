const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createProject, createArea, createAction, createUser } = require('./helpers');
const { productionConfigProblems } = require('../src/config');
const { resolvePeriodMonths } = require('../src/services/monthlySeries');

let app, db, adminCookie, adminId;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
  ({ cookie: adminCookie, user: { id: adminId } } = await login(app, 'admin@projetos.local', 'Test@1234'));
});

afterAll(async () => {
  await closeTestDb();
});

/** Runs `fn` with NODE_ENV=production (and optional extra env), restoring afterwards. */
async function asProduction(fn, extraEnv = {}) {
  const saved = { NODE_ENV: process.env.NODE_ENV };
  for (const k of Object.keys(extraEnv)) saved[k] = process.env[k];
  process.env.NODE_ENV = 'production';
  Object.assign(process.env, extraEnv);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('1. Acesso seguro e padrões de produção', () => {
  it('blocks demo accounts in production by default, with a generic message', async () => {
    await asProduction(async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'admin@projetos.local', password: 'Test@1234' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('E-mail ou senha inválidos.');
    });
  });

  it('invalidates existing demo sessions in production', async () => {
    await asProduction(async () => {
      const res = await withAuth(request(app).get('/api/projects'), adminCookie);
      expect(res.status).toBe(401);
    });
  });

  it('allows demo login in production only when ALLOW_DEMO_LOGIN=true', async () => {
    await asProduction(async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'admin@projetos.local', password: 'Test@1234' });
      expect(res.status).toBe(200);
    }, { ALLOW_DEMO_LOGIN: 'true' });
  });

  it('keeps real accounts working in production', async () => {
    await createUser(db, { name: 'Pessoa Real', email: 'pessoa.real@empresa.com', roleKey: 'VIEWER' });
    await asProduction(async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'pessoa.real@empresa.com', password: 'Test@1234' });
      expect(res.status).toBe(200);
    });
  });

  it('only advertises demo accounts outside production (never the password when SEED_DEMO_PASSWORD is set)', async () => {
    const dev = await request(app).get('/api/auth/login-hints');
    expect(dev.body.demoAccounts).toContain('admin@projetos.local');
    expect(dev.body.demoPassword).toBeNull();
    await asProduction(async () => {
      const prod = await request(app).get('/api/auth/login-hints');
      expect(prod.body.demoAccounts).toEqual([]);
      expect(prod.body.demoPassword).toBeUndefined();
    });
  });

  it('reports missing/weak production configuration without echoing secrets', () => {
    expect(productionConfigProblems({ NODE_ENV: 'development' })).toEqual([]);
    const problems = productionConfigProblems({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 'segredo-fraco', ADMIN_MIGRATE_TOKEN: 'tok-xyz' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).not.toMatch(/segredo-fraco|tok-xyz/);
    expect(productionConfigProblems({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(48) })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: 'production' })).toHaveLength(2);
  });

  it('keeps the temporary admin endpoints disabled without a strong ADMIN_MIGRATE_TOKEN', async () => {
    const res = await request(app).post('/api/admin/run-seed').set('Authorization', 'Bearer qualquer');
    expect(res.status).toBe(404);
  });
});

describe('2. Validação de datas das ações', () => {
  let projectId, areaId;
  beforeAll(async () => {
    projectId = await createProject(db, 'Projeto Datas');
    areaId = await createArea(db, 'Área Datas');
  });

  const base = () => ({ projectId, areaId, refMonth: '2026-03', description: 'Ação com datas', responsibleName: 'Fulano', status: 'ANDAMENTO' });

  it('rejects impossible dates with a pt-BR message', async () => {
    const res = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), startDate: '2026-02-30' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Data de início inválida/);
  });

  it('rejects malformed dates and reference months', async () => {
    const bad = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), dueDate: '31/12/2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Prazo inválida|Prazo inv/);
    const month = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), refMonth: '2026-13' });
    expect(month.status).toBe(400);
    expect(month.body.message).toMatch(/Mês de referência inválido/);
  });

  it('enforces chronology between start, due and completion dates', async () => {
    const due = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), startDate: '2026-05-10', dueDate: '2026-05-01' });
    expect(due.status).toBe(400);
    expect(due.body.message).toMatch(/prazo não pode ser anterior à data de início/);

    const done = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), status: 'CONCLUÍDO', startDate: '2026-05-10', completionDate: '2026-05-09' });
    expect(done.status).toBe(400);
    expect(done.body.message).toMatch(/conclusão não pode ser anterior/);
  });

  it('saves valid dates and validates updates against the stored values', async () => {
    const ok = await withAuth(request(app).post('/api/actions'), adminCookie).send({ ...base(), startDate: '2026-05-10', dueDate: '2026-06-30' });
    expect(ok.status).toBe(201);
    const patch = await withAuth(request(app).patch(`/api/actions/${ok.body.uuid}`), adminCookie).send({ dueDate: '2026-05-01' });
    expect(patch.status).toBe(400);
    const stored = await db.get('SELECT due_date FROM actions WHERE uuid = ?', ok.body.uuid);
    expect(stored.due_date).toBe('2026-06-30');
    const fine = await withAuth(request(app).patch(`/api/actions/${ok.body.uuid}`), adminCookie).send({ dueDate: '2026-07-15' });
    expect(fine.status).toBe(200);
  });

  it('rejects invalid time-entry dates', async () => {
    const { uuid } = await createAction(db, { projectId, areaId });
    const res = await withAuth(request(app).post('/api/time-entries'), adminCookie).send({ actionId: uuid, entryDate: '2026-04-31', hours: 2, type: 'ACTUAL' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Data do lançamento inválida/);
  });
});

describe('3. Relatórios mensais com linha do tempo contínua', () => {
  let projectId, areaId;
  beforeAll(async () => {
    projectId = await createProject(db, 'Projeto Mensal');
    areaId = await createArea(db, 'Área Mensal');
    await createAction(db, { projectId, areaId, refMonth: '2025-01-01', status: 'CONCLUÍDO', plannedHours: 4 });
    await createAction(db, { projectId, areaId, refMonth: '2025-04-01', status: 'ANDAMENTO', plannedHours: 2 });
  });

  it('resolves the period from Mês, Ano or the data range', () => {
    expect(resolvePeriodMonths({}, ['2025-01-01', '2025-03-01'])).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    expect(resolvePeriodMonths({ year: ['2025'] }, [])).toHaveLength(12);
    expect(resolvePeriodMonths({ refMonth: ['2025-03-01', '2025-01-01'] }, [])).toEqual(['2025-01-01', '2025-03-01']);
  });

  it('includes months with zero activity in the monthly status summary', async () => {
    const res = await withAuth(request(app).get(`/api/reports/monthly-status-summary?projectId=${projectId}`), adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.month)).toEqual(['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01']);
    const feb = res.body.rows[1];
    expect(feb.total).toBe(0);
    expect(res.body.rows[0].concluido).toBe(1);

    const year = await withAuth(request(app).get(`/api/reports/monthly-status-summary?projectId=${projectId}&year=2025`), adminCookie);
    expect(year.body.rows).toHaveLength(12);
    expect(year.body.rows.reduce((s, r) => s + r.total, 0)).toBe(2);
  });

  it('fills the dashboard trend and the planned-vs-actual report', async () => {
    const dash = await withAuth(request(app).get(`/api/dashboard?projectId=${projectId}`), adminCookie);
    expect(dash.body.monthlyTrend.map((m) => m.created)).toEqual([1, 0, 0, 1]);

    const pva = await withAuth(request(app).get(`/api/reports/planned-vs-actual?projectId=${projectId}`), adminCookie);
    expect(pva.body.rows).toHaveLength(4);
    expect(pva.body.rows[1]).toMatchObject({ month: '2025-02-01', planned_hours: 0, actual_hours: 0, utilization_pct: null });
    expect(pva.body.rows[0]).toMatchObject({ planned_hours: 4, variance_hours: -4, utilization_pct: 0 });
  });
});

describe('4. Horas: base de cálculo', () => {
  it('exposes the hours basis (actions without plan, pending hours) on the dashboard', async () => {
    const projectId = await createProject(db, 'Projeto Horas Base');
    const areaId = await createArea(db, 'Área Horas Base');
    const { uuid } = await createAction(db, { projectId, areaId, plannedHours: null });
    await db.run("INSERT INTO time_entries (action_uuid, user_id, entry_date, hours, type, approval_status) VALUES (?, ?, '2026-01-10', 3, 'ACTUAL', 'APPROVED')", uuid, adminId);
    await db.run("INSERT INTO time_entries (action_uuid, user_id, entry_date, hours, type, approval_status) VALUES (?, ?, '2026-01-11', 5, 'ACTUAL', 'PENDING')", uuid, adminId);
    const res = await withAuth(request(app).get(`/api/dashboard?projectId=${projectId}`), adminCookie);
    expect(res.body.hours).toMatchObject({ planned: 0, actual: 3, variance: 3, utilizationPct: null, actionsWithoutPlannedHours: 1, actualHoursWithoutPlan: 3, pendingActualHours: 5 });
  });
});

describe('5. Auditoria legível', () => {
  it('exports audit events with pt-BR labels', async () => {
    const res = await withAuth(request(app).get('/api/audit/export?format=csv&entityType=AUTH'), adminCookie);
    expect(res.status).toBe(200);
    const text = res.text || res.body.toString('utf8');
    expect(text).toContain('Evento');
    expect(text).toContain('Acesso (login)');
    expect(text).not.toMatch(/;LOGIN;/);
  });
});

describe('6. Gerente do projeto', () => {
  it('requires a manager when creating a project', async () => {
    const res = await withAuth(request(app).post('/api/projects'), adminCookie).send({ name: 'Projeto Sem Gerente' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Selecione o gerente do projeto/);
  });

  it('only accepts active Administrators/Project Managers as manager', async () => {
    const viewerId = await createUser(db, { name: 'Visualizador Gerente', email: 'vis.gerente@empresa.com', roleKey: 'VIEWER' });
    const res = await withAuth(request(app).post('/api/projects'), adminCookie).send({ name: 'Projeto Gerente Inválido', managerUserId: viewerId });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Administrador ou Gerente de Projeto/);
  });

  it('persists the manager, grants scope to a Project Manager and lists eligible managers', async () => {
    const pmId = await createUser(db, { name: 'Gerente Real', email: 'gerente.real@empresa.com', roleKey: 'PROJECT_MANAGER' });
    const options = await withAuth(request(app).get('/api/projects/manager-options'), adminCookie);
    expect(options.body.items.map((u) => u.id)).toEqual(expect.arrayContaining([adminId, pmId]));

    const created = await withAuth(request(app).post('/api/projects'), adminCookie).send({ name: 'Projeto Com Gerente', managerUserId: pmId });
    expect(created.status).toBe(201);
    const project = await withAuth(request(app).get(`/api/projects/${created.body.id}`), adminCookie);
    expect(project.body).toMatchObject({ manager_user_id: pmId, manager_name: 'Gerente Real' });
    const scope = await db.get('SELECT 1 AS ok FROM user_project_scope WHERE user_id = ? AND project_id = ?', pmId, created.body.id);
    expect(scope.ok).toBe(1);
  });

  it('lets authorized users change the manager but never clear it, auditing names', async () => {
    const created = await withAuth(request(app).post('/api/projects'), adminCookie).send({ name: 'Projeto Troca Gerente', managerUserId: adminId });
    const pmId = await createUser(db, { name: 'Novo Gerente', email: 'novo.gerente@empresa.com', roleKey: 'PROJECT_MANAGER' });

    const cleared = await withAuth(request(app).patch(`/api/projects/${created.body.id}`), adminCookie).send({ managerUserId: null });
    expect(cleared.status).toBe(400);

    const changed = await withAuth(request(app).patch(`/api/projects/${created.body.id}`), adminCookie).send({ managerUserId: pmId });
    expect(changed.status).toBe(200);
    const audit = await db.get("SELECT old_value, new_value FROM audit_log WHERE entity_type = 'PROJECT' AND entity_id = ? AND field_name = 'manager_user_id'", String(created.body.id));
    expect(audit.new_value).toBe(`Novo Gerente (#${pmId})`);

    // Inline grid edits (priority only) keep working without resending the manager.
    const inline = await withAuth(request(app).patch(`/api/projects/${created.body.id}`), adminCookie).send({ priority: 'ALTA' });
    expect(inline.status).toBe(200);
  });

  it('forbids non-admin roles from assigning managers', async () => {
    await createUser(db, { name: 'Gerente Sem Permissão', email: 'pm.sem.permissao@empresa.com', roleKey: 'PROJECT_MANAGER' });
    const { cookie } = await login(app, 'pm.sem.permissao@empresa.com');
    const res = await withAuth(request(app).post('/api/projects'), cookie).send({ name: 'Projeto PM', managerUserId: adminId });
    expect(res.status).toBe(403);
  });
});
