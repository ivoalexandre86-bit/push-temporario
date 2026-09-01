const express = require('express');
const db = require('../db/connection');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Distinct list of responsible-person names (imported "QUEM" catalog + any
// added since). Used to populate filter/assignee dropdowns.
router.get('/', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT id, name, active FROM people ORDER BY name');
    res.json({ items: rows });
  } catch (err) { next(err); }
});

module.exports = router;
