const crypto = require('crypto');
const request = require('supertest');
const { initTestDb, closeTestDb, getDb, getApp, login, withAuth, createUser } = require('./helpers');

let app, db;

beforeAll(async () => {
  await initTestDb();
  db = getDb();
  app = getApp();
});

afterAll(async () => {
  await closeTestDb();
});

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Captures the reset link the mail service writes to the log when SMTP is not configured. */
async function requestResetLink(email) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const res = await request(app).post('/api/auth/forgot-password').send({ email });
    // The e-mail is sent in the background; give it a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    const line = spy.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('/redefinir-senha?token='));
    const token = line ? line.match(/token=([0-9a-f]{64})/)[1] : null;
    return { res, token };
  } finally {
    spy.mockRestore();
  }
}

describe('Meu perfil: editar nome e e-mail', () => {
  let cookie, userId;

  beforeAll(async () => {
    userId = await createUser(db, { name: 'Perfil Original', email: 'perfil@empresa.com', roleKey: 'CONTRIBUTOR' });
    ({ cookie } = await login(app, 'perfil@empresa.com'));
  });

  it('updates the own name without asking for the password', async () => {
    const res = await withAuth(request(app).patch('/api/me'), cookie).send({ name: 'Perfil Novo' });
    expect(res.status).toBe(200);
    const me = await withAuth(request(app).get('/api/me'), cookie);
    expect(me.body.name).toBe('Perfil Novo');
    const audit = await db.get("SELECT * FROM audit_log WHERE entity_type = 'USER' AND entity_id = ? AND field_name = 'name'", String(userId));
    expect(audit).toBeTruthy();
  });

  it('requires the current password to change the e-mail', async () => {
    const res = await withAuth(request(app).patch('/api/me'), cookie).send({ email: 'perfil.novo@empresa.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PASSWORD');

    const wrong = await withAuth(request(app).patch('/api/me'), cookie).send({ email: 'perfil.novo@empresa.com', currentPassword: 'errada123' });
    expect(wrong.status).toBe(400);
  });

  it('rejects an e-mail that belongs to someone else', async () => {
    await createUser(db, { name: 'Outra Pessoa', email: 'outra@empresa.com', roleKey: 'VIEWER' });
    const res = await withAuth(request(app).patch('/api/me'), cookie).send({ email: 'OUTRA@empresa.com', currentPassword: 'Test@1234' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EMAIL_TAKEN');
  });

  it('changes the e-mail with the right password, and the new e-mail is the login', async () => {
    const res = await withAuth(request(app).patch('/api/me'), cookie).send({ email: 'Perfil.Novo@empresa.com', currentPassword: 'Test@1234' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('perfil.novo@empresa.com');
    await login(app, 'perfil.novo@empresa.com');
    const old = await request(app).post('/api/auth/login').send({ email: 'perfil@empresa.com', password: 'Test@1234' });
    expect(old.status).toBe(401);
  });

  it('does not let a user change their role or status through the profile', async () => {
    const res = await withAuth(request(app).patch('/api/me'), cookie).send({ name: 'Perfil Novo', role: 'ADMIN', active: 0 });
    expect(res.status).toBe(200);
    const row = await db.get('SELECT r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', userId);
    expect(row.key).toBe('CONTRIBUTOR');
  });

  it('blocks demo accounts from changing the e-mail', async () => {
    const { cookie: adminCookie } = await login(app, 'admin@projetos.local');
    const res = await withAuth(request(app).patch('/api/me'), adminCookie).send({ email: 'admin@empresa.com', currentPassword: 'Test@1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_ACCOUNT');
  });
});

describe('Trocar a própria senha', () => {
  let cookie;

  beforeAll(async () => {
    await createUser(db, { name: 'Troca Senha', email: 'troca@empresa.com', roleKey: 'VIEWER' });
    ({ cookie } = await login(app, 'troca@empresa.com'));
  });

  it('rejects a wrong current password', async () => {
    const res = await withAuth(request(app).post('/api/me/change-password'), cookie)
      .send({ currentPassword: 'errada123', newPassword: 'NovaSenha@1', confirmPassword: 'NovaSenha@1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PASSWORD');
  });

  it('rejects a confirmation that does not match', async () => {
    const res = await withAuth(request(app).post('/api/me/change-password'), cookie)
      .send({ currentPassword: 'Test@1234', newPassword: 'NovaSenha@1', confirmPassword: 'Outra@123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('confirmação');
  });

  it('enforces the password policy (min. 8 characters)', async () => {
    const res = await withAuth(request(app).post('/api/me/change-password'), cookie)
      .send({ currentPassword: 'Test@1234', newPassword: 'curta', confirmPassword: 'curta' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('8 caracteres');
  });

  it('changes the password, keeps this session and ends sessions opened before', async () => {
    const { cookie: otherDevice } = await login(app, 'troca@empresa.com');
    const res = await withAuth(request(app).post('/api/me/change-password'), cookie)
      .send({ currentPassword: 'Test@1234', newPassword: 'NovaSenha@1', confirmPassword: 'NovaSenha@1' });
    expect(res.status).toBe(200);
    const freshCookie = res.headers['set-cookie'];
    expect(freshCookie).toBeTruthy();

    expect((await withAuth(request(app).get('/api/me'), freshCookie)).status).toBe(200);
    expect((await withAuth(request(app).get('/api/me'), otherDevice)).status).toBe(401);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: 'troca@empresa.com', password: 'Test@1234' });
    expect(oldLogin.status).toBe(401);
    await login(app, 'troca@empresa.com', 'NovaSenha@1');

    const hash = (await db.get("SELECT password_hash FROM users WHERE email = 'troca@empresa.com'")).password_hash;
    expect(hash).toMatch(/^\$2[aby]\$10\$/); // same bcrypt cost as the rest of the backend
  });
});

describe('Esqueci minha senha', () => {
  let userId;

  beforeAll(async () => {
    userId = await createUser(db, { name: 'Esquecida', email: 'esquecida@empresa.com', roleKey: 'VIEWER' });
  });

  it('answers the same way for known and unknown e-mails, without a token in the body', async () => {
    const known = await requestResetLink('esquecida@empresa.com');
    const unknown = await requestResetLink('ninguem@empresa.com');
    expect(known.res.status).toBe(200);
    expect(unknown.res.status).toBe(200);
    expect(known.res.body).toEqual(unknown.res.body);
    expect(JSON.stringify(known.res.body)).not.toMatch(/[0-9a-f]{64}/);
    expect(known.token).toBeTruthy();
    expect(unknown.token).toBeNull();
  });

  it('stores only the hash of the token, expiring in 1 hour', async () => {
    const { token } = await requestResetLink('esquecida@empresa.com');
    const raw = await db.get('SELECT * FROM password_reset_tokens WHERE token_hash = ?', token);
    expect(raw).toBeUndefined();
    const row = await db.get('SELECT * FROM password_reset_tokens WHERE token_hash = ?', sha256(token));
    expect(row.user_id).toBe(userId);
    const minutes = (new Date(row.expires_at) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(58);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it('a new request invalidates the previous link', async () => {
    const first = await requestResetLink('esquecida@empresa.com');
    const second = await requestResetLink('esquecida@empresa.com');
    const v1 = await request(app).get(`/api/auth/reset-password/validate?token=${first.token}`);
    const v2 = await request(app).get(`/api/auth/reset-password/validate?token=${second.token}`);
    expect(v1.body.valid).toBe(false);
    expect(v2.body.valid).toBe(true);
  });

  it('resets the password once, ending older sessions; the link cannot be reused', async () => {
    const { cookie: oldSession } = await login(app, 'esquecida@empresa.com');
    const { token } = await requestResetLink('esquecida@empresa.com');

    const mismatch = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Redefinida@1', confirmPassword: 'Diferente@1' });
    expect(mismatch.status).toBe(400);

    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Redefinida@1', confirmPassword: 'Redefinida@1' });
    expect(res.status).toBe(200);
    await login(app, 'esquecida@empresa.com', 'Redefinida@1');
    expect((await withAuth(request(app).get('/api/me'), oldSession)).status).toBe(401);

    const again = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Outra@12345' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('INVALID_TOKEN');
  });

  it('rejects an expired link', async () => {
    const { token } = await requestResetLink('esquecida@empresa.com');
    await db.run('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?', new Date(Date.now() - 1000).toISOString(), sha256(token));
    const res = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Expirada@123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TOKEN');
  });

  it('rejects a made-up token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'a'.repeat(64), newPassword: 'Qualquer@123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TOKEN');
  });

  it('issues no link for inactive accounts', async () => {
    await createUser(db, { name: 'Inativa', email: 'inativa@empresa.com', roleKey: 'VIEWER', active: 0 });
    const { res, token } = await requestResetLink('inativa@empresa.com');
    expect(res.status).toBe(200);
    expect(token).toBeNull();
  });
});

describe('Envio do e-mail de redefinição', () => {
  it('builds the link from APP_URL and sends through SMTP when configured', async () => {
    const nodemailer = require('nodemailer');
    const sendMail = vi.fn().mockResolvedValue({});
    const spy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });
    const saved = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: 'smtp.exemplo.com', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'Sistema <nao-responda@exemplo.com>', APP_URL: 'https://projetos.exemplo.com/' });
    try {
      const mailService = require('../src/services/mailService');
      const result = await mailService.sendPasswordResetEmail({ to: 'x@exemplo.com', name: 'X', rawToken: 'f'.repeat(64) });
      expect(result.sent).toBe(true);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.exemplo.com', port: 465, secure: true }));
      const msg = sendMail.mock.calls[0][0];
      expect(msg.from).toBe('Sistema <nao-responda@exemplo.com>');
      expect(msg.to).toBe('x@exemplo.com');
      expect(msg.text).toContain(`https://projetos.exemplo.com/redefinir-senha?token=${'f'.repeat(64)}`);
    } finally {
      for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
      spy.mockRestore();
    }
  });
});
