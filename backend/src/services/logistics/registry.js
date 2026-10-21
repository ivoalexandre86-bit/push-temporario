// Acesso a dados e regras de negócio dos cadastros de logística (CRUD
// manual). A importação usa as mesmas chaves de duplicidade (normalize.js)
// e o mesmo catálogo de campos (fields.js), então um registro criado à mão
// é reconhecido como "já existe" por uma importação posterior e vice-versa.
const N = require('./normalize');
const { TARGETS, dataFields } = require('./fields');
const { AppError } = require('../../middleware/errorHandler');

const ENTITY = {
  BRANCHES: { target: 'BRANCHES', table: 'branches', entityType: 'BRANCH', label: 'Filial' },
  CARRIERS: { target: 'CARRIERS', table: 'carriers', entityType: 'CARRIER', label: 'Transportador' },
  CONTACTS: { target: 'REGIONS', table: 'region_contacts', entityType: 'REGION_CONTACT', label: 'Contato' },
};

const META_FIELDS = ['id', 'region_id', 'source', 'created_at', 'updated_at'];

/** DB row -> API object (camelCase keys from the field catalog). */
function toApi(targetKey, row, extra = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    regionId: row.region_id,
    regionName: row.region_name ?? undefined,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const f of dataFields(targetKey)) out[f.key] = row[f.column] ?? null;
  if (targetKey === 'CARRIERS') {
    out.branchId = row.branch_id ?? null;
    out.linkedBranchName = row.linked_branch_name ?? null;
  }
  return { ...out, ...extra };
}

/**
 * Validates the fields that are being written. For edits, only fields whose
 * value actually changes are checked, so records imported with a value the
 * spreadsheet already had "wrong" (ex.: CNPJ inválido) can still be edited
 * in other fields; the import screen already flagged those values.
 */
function validateValues(targetKey, values, current = null) {
  const errors = [];
  for (const f of dataFields(targetKey)) {
    if (!(f.key in values)) continue;
    const v = values[f.key];
    if (v === null || v === '') continue;
    if (current && String(current[f.column] ?? '') === String(v)) continue;
    if (f.kind === 'cnpj') {
      const d = N.digitsOnly(v);
      if (d.length !== 14 || !N.isValidCnpj(d)) errors.push({ path: f.key, message: 'CNPJ inválido.' });
    } else if (f.kind === 'uf') {
      if (!N.UFS.has(String(v).toUpperCase())) errors.push({ path: f.key, message: 'UF inválida (use a sigla do estado, ex.: SC).' });
    } else if (f.kind === 'email') {
      const parts = String(v).split(/\s*(?:\/|;|,|\se\s)\s*/i).filter(Boolean);
      if (parts.some((p) => !N.isValidEmail(p))) errors.push({ path: f.key, message: 'E-mail inválido.' });
    } else if (f.kind === 'zip') {
      if (N.digitsOnly(v).length !== 8) errors.push({ path: f.key, message: 'CEP deve ter 8 dígitos.' });
    }
  }
  if (errors.length) throw new AppError(400, 'VALIDATION_ERROR', `Dados inválidos: ${errors.map((e) => e.message).join(' ')}`, errors);
}

/** Cleans incoming strings and canonical formats (CNPJ/CEP/UF) for manual input. */
function cleanValues(targetKey, body) {
  const out = {};
  for (const f of dataFields(targetKey)) {
    if (!(f.key in body)) continue;
    let v = N.cleanText(body[f.key]);
    if (v !== null) {
      if (N.isPersonField(f)) v = N.cleanPersonName(v).value;
      if (f.kind === 'uf') v = v.toUpperCase();
      if (f.kind === 'cnpj') {
        const d = N.digitsOnly(v);
        if (d.length === 14 && N.isValidCnpj(d)) v = N.formatCnpj(d);
      }
      if (f.kind === 'zip') {
        const d = N.digitsOnly(v);
        if (d.length === 8) v = `${d.slice(0, 5)}-${d.slice(5)}`;
      }
    }
    out[f.key] = v;
  }
  return out;
}

async function getRegion(db, id) {
  const region = await db.get('SELECT * FROM regions WHERE id = ? AND deleted_at IS NULL', id);
  if (!region) throw new AppError(404, 'NOT_FOUND', 'Regional não encontrada.');
  return region;
}

function computeKey(targetKey, merged, regionName) {
  if (targetKey === 'REGIONS') return N.contactKey(regionName, merged.department);
  const parts = { cnpjDigits: N.digitsOnly(merged.cnpj), branchCode: merged.branchCode, branchName: merged.branchName, regionName };
  return targetKey === 'BRANCHES' ? N.branchKey(parts) : N.carrierKey({ ...parts, carrierName: merged.carrierName });
}

function requireIdentity(targetKey, merged) {
  const errors = [];
  if (targetKey === 'BRANCHES' && !merged.branchName) errors.push({ path: 'branchName', message: 'Informe o nome da filial.' });
  if (targetKey === 'CARRIERS') {
    if (!merged.carrierName) errors.push({ path: 'carrierName', message: 'Informe a transportadora.' });
    if (!merged.branchName && !merged.cnpj && !merged.branchId) errors.push({ path: 'branchName', message: 'Informe a filial atendida (selecione uma filial ou preencha nome/CNPJ da unidade).' });
  }
  if (targetKey === 'REGIONS' && !merged.department) errors.push({ path: 'department', message: 'Informe o departamento do contato.' });
  if (errors.length) throw new AppError(400, 'VALIDATION_ERROR', `Dados inválidos: ${errors.map((e) => e.message).join(' ')}`, errors);
}

async function assertNoDuplicate(db, table, key, exceptId, label) {
  const dup = await db.get(`SELECT id FROM ${table} WHERE dedupe_key = ? AND deleted_at IS NULL AND id <> ?`, key, exceptId || 0);
  if (dup) throw new AppError(409, 'DUPLICATE', `Já existe ${label} cadastrado(a) com a mesma identificação.`, { existingId: dup.id });
}

/**
 * Recomputes dedupe keys that depend on the region name (contacts, and
 * branches/carriers without CNPJ) after a region is renamed.
 */
async function recomputeKeysForRegion(tx, regionId, regionName) {
  for (const [targetKey, table] of [['REGIONS', 'region_contacts'], ['BRANCHES', 'branches'], ['CARRIERS', 'carriers']]) {
    const rows = await tx.all(`SELECT * FROM ${table} WHERE region_id = ? AND deleted_at IS NULL`, regionId);
    for (const row of rows) {
      const merged = toApi(targetKey, row);
      const key = computeKey(targetKey, merged, regionName);
      if (key !== row.dedupe_key) {
        const clash = await tx.get(`SELECT id FROM ${table} WHERE dedupe_key = ? AND deleted_at IS NULL AND id <> ?`, key, row.id);
        if (clash) throw new AppError(409, 'DUPLICATE', 'Renomear a regional deixaria registros duplicados; revise os cadastros vinculados antes.');
        await tx.run(`UPDATE ${table} SET dedupe_key = ? WHERE id = ?`, key, row.id);
      }
    }
  }
}

/** Inserts or updates a branch / carrier / contact. Returns the saved id. */
async function saveRecord(tx, entityKey, { id, body, user, auditService, req }) {
  const ent = ENTITY[entityKey];
  const targetKey = ent.target;
  const now = new Date().toISOString();
  const current = id ? await tx.get(`SELECT * FROM ${ent.table} WHERE id = ? AND deleted_at IS NULL`, id) : null;
  if (id && !current) throw new AppError(404, 'NOT_FOUND', `${ent.label} não encontrado(a).`);

  const values = cleanValues(targetKey, body);
  validateValues(targetKey, values, current);

  const regionId = body.regionId !== undefined ? Number(body.regionId) : current?.region_id;
  if (!regionId) throw new AppError(400, 'VALIDATION_ERROR', 'Selecione a regional.', [{ path: 'regionId', message: 'Selecione a regional.' }]);
  const region = await getRegion(tx, regionId);

  let branchId = current?.branch_id ?? null;
  if (targetKey === 'CARRIERS' && body.branchId !== undefined) {
    branchId = body.branchId ? Number(body.branchId) : null;
    if (branchId) {
      const branch = await tx.get('SELECT id, region_id FROM branches WHERE id = ? AND deleted_at IS NULL', branchId);
      if (!branch) throw new AppError(400, 'VALIDATION_ERROR', 'A filial selecionada não existe.', [{ path: 'branchId', message: 'Filial inexistente.' }]);
      if (branch.region_id !== regionId) throw new AppError(400, 'VALIDATION_ERROR', 'A filial selecionada pertence a outra regional.', [{ path: 'branchId', message: 'Filial de outra regional.' }]);
    }
  }

  const merged = { ...(current ? toApi(targetKey, current) : {}), ...values, branchId };
  requireIdentity(targetKey, merged);
  const key = computeKey(targetKey, merged, region.name);
  await assertNoDuplicate(tx, ent.table, key, id, ent.label.toLowerCase());

  const fields = dataFields(targetKey).filter((f) => f.key in values);
  const cols = fields.map((f) => f.column);
  const vals = fields.map((f) => values[f.key]);
  cols.push('region_id', 'dedupe_key');
  vals.push(regionId, key);
  if (targetKey !== 'REGIONS' && 'cnpj' in values) { cols.push('cnpj_digits'); vals.push(N.digitsOnly(values.cnpj) || null); }
  if (targetKey === 'CARRIERS') {
    cols.push('branch_id'); vals.push(branchId);
    if ('carrierName' in values) { cols.push('carrier_key'); vals.push(N.normalizeKey(values.carrierName)); }
  }

  if (!current) {
    cols.push('source', 'created_by', 'updated_by', 'created_at', 'updated_at');
    vals.push('MANUAL', user.id, user.id, now, now);
    const info = await tx.run(`INSERT INTO ${ent.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`, ...vals);
    await auditService.record({ entityType: ent.entityType, entityId: info.lastInsertRowid, actionType: 'CREATE', newValue: merged.branchName || merged.carrierName || merged.department, actor: user, req, tx });
    return info.lastInsertRowid;
  }

  await tx.run(`UPDATE ${ent.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`, ...vals, user.id, now, id);
  const after = { ...current, region_id: regionId, branch_id: branchId };
  for (const f of fields) after[f.column] = values[f.key];
  await auditService.recordDiff({
    entityType: ent.entityType, entityId: id, before: current, after,
    fieldsToTrack: [...dataFields(targetKey).map((f) => f.column), 'region_id', ...(targetKey === 'CARRIERS' ? ['branch_id'] : [])],
    actor: user, req, tx,
  });
  return id;
}

/** Soft delete with referential checks. Returns null when deleted, or the reason it was blocked. */
async function softDelete(tx, kind, id, { user, auditService, req }) {
  const now = new Date().toISOString();
  if (kind === 'REGION') {
    const region = await tx.get('SELECT * FROM regions WHERE id = ? AND deleted_at IS NULL', id);
    if (!region) return 'Regional não encontrada.';
    const b = await tx.get('SELECT COUNT(*) AS n FROM branches WHERE region_id = ? AND deleted_at IS NULL', id);
    const c = await tx.get('SELECT COUNT(*) AS n FROM carriers WHERE region_id = ? AND deleted_at IS NULL', id);
    if (b.n || c.n) {
      return `A regional "${region.name}" tem ${b.n} filial(is) e ${c.n} transportador(es) vinculados; exclua ou mova esses cadastros antes.`;
    }
    await tx.run('UPDATE region_contacts SET deleted_at = ?, updated_by = ? WHERE region_id = ? AND deleted_at IS NULL', now, user.id, id);
    await tx.run('UPDATE regions SET deleted_at = ?, updated_by = ? WHERE id = ?', now, user.id, id);
    await auditService.record({ entityType: 'REGION', entityId: id, actionType: 'DELETE', oldValue: region.name, actor: user, req, tx });
    return null;
  }
  const ent = ENTITY[kind];
  const row = await tx.get(`SELECT * FROM ${ent.table} WHERE id = ? AND deleted_at IS NULL`, id);
  if (!row) return `${ent.label} não encontrado(a).`;
  if (kind === 'BRANCHES') {
    const c = await tx.get('SELECT COUNT(*) AS n FROM carriers WHERE branch_id = ? AND deleted_at IS NULL', id);
    if (c.n) return `A filial "${row.branch_name}" tem ${c.n} transportador(es) vinculado(s); exclua-os ou troque a filial deles antes.`;
  }
  await tx.run(`UPDATE ${ent.table} SET deleted_at = ?, updated_by = ? WHERE id = ?`, now, user.id, id);
  await auditService.record({ entityType: ent.entityType, entityId: id, actionType: 'DELETE', oldValue: row.branch_name || row.carrier_name || row.department, actor: user, req, tx });
  return null;
}

module.exports = {
  ENTITY, META_FIELDS, TARGETS, toApi, cleanValues, validateValues, getRegion, saveRecord, softDelete, recomputeKeysForRegion, assertNoDuplicate,
};
