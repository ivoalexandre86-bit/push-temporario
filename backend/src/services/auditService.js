const db = require('../db/connection');

function stringifyValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Records a single immutable audit event.
 * @param {object} opts
 * @param {string} opts.entityType - 'ACTION' | 'USER' | 'PROJECT' | 'AREA' | 'TIME_ENTRY' | 'AUTH' | 'IMPORT' | 'EXPORT'
 * @param {string|number} opts.entityId
 * @param {number} [opts.businessId]
 * @param {number} [opts.projectId]
 * @param {string} opts.actionType - 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED' | 'IMPORT' | 'EXPORT'
 * @param {string} [opts.fieldName]
 * @param {*} [opts.oldValue]
 * @param {*} [opts.newValue]
 * @param {object} opts.actor - { id, name } or null for system/anonymous
 * @param {object} [opts.req] - express request, to pull ip/user-agent
 */
async function record(opts) {
  await db.run(
    `INSERT INTO audit_log
       (entity_type, entity_id, business_id, project_id, action_type, field_name,
        old_value, new_value, actor_user_id, actor_name, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.entityType,
    String(opts.entityId),
    opts.businessId ?? null,
    opts.projectId ?? null,
    opts.actionType,
    opts.fieldName ?? null,
    stringifyValue(opts.oldValue),
    stringifyValue(opts.newValue),
    opts.actor?.id ?? null,
    opts.actor?.name ?? 'system',
    opts.req ? (opts.req.ip || opts.req.connection?.remoteAddress || null) : null,
    opts.req ? (opts.req.get?.('user-agent') || null) : null
  );
}

/**
 * Diffs two flat objects field-by-field and records one audit row per
 * changed field. Only fields present in `fieldsToTrack` are compared.
 */
async function recordDiff({ entityType, entityId, businessId, projectId, before, after, fieldsToTrack, actor, req }) {
  for (const field of fieldsToTrack) {
    const oldVal = before ? before[field] : undefined;
    const newVal = after ? after[field] : undefined;
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      await record({
        entityType,
        entityId,
        businessId,
        projectId,
        actionType: field === 'status' ? 'STATUS_CHANGE' : 'UPDATE',
        fieldName: field,
        oldValue: oldVal,
        newValue: newVal,
        actor,
        req,
      });
    }
  }
}

module.exports = { record, recordDiff };
