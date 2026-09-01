const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT * FROM saved_views WHERE user_id = ? ORDER BY name', req.user.id);
    res.json({ items: rows.map((r) => ({ ...r, filters: JSON.parse(r.filters_json), columns: r.columns_json ? JSON.parse(r.columns_json) : null })) });
  } catch (err) { next(err); }
});

const upsertSchema = z.object({
  name: z.string().min(1),
  filters: z.record(z.any()),
  columns: z.array(z.string()).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    const existing = await db.get('SELECT id FROM saved_views WHERE user_id = ? AND name = ?', req.user.id, body.name);
    if (existing) {
      await db.run('UPDATE saved_views SET filters_json = ?, columns_json = ? WHERE id = ?',
        JSON.stringify(body.filters), body.columns ? JSON.stringify(body.columns) : null, existing.id);
      return res.json({ id: existing.id });
    }
    const info = await db.run('INSERT INTO saved_views (user_id, name, filters_json, columns_json) VALUES (?, ?, ?, ?) RETURNING id',
      req.user.id, body.name, JSON.stringify(body.filters), body.columns ? JSON.stringify(body.columns) : null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await db.get('SELECT * FROM saved_views WHERE id = ?', Number(req.params.id));
    if (!row || row.user_id !== req.user.id) throw new AppError(404, 'NOT_FOUND', 'Visão salva não encontrada.');
    await db.run('DELETE FROM saved_views WHERE id = ?', row.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
