// Client-side mirror of backend/src/utils/dates.js (validateActionDates) so
// invalid dates are caught before submitting. The API enforces the same
// rules, so this is a convenience, never the only check.

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const LABELS = {
  startDate: 'Data de início',
  dueDate: 'Prazo',
  completionDate: 'Data de conclusão',
};

/** True only for a real calendar date written as YYYY-MM-DD (the value of <input type="date">). */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** True for YYYY-MM (the value of <input type="month">). */
export function isValidRefMonth(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && isValidISODate(`${value}-01`);
}

/**
 * Returns { field: message } for every invalid date; empty object when valid.
 * Note: a browser date input reports '' for an incomplete/impossible date,
 * so pass `rawInvalid` (field names whose input reported badInput) to flag those.
 */
export function validateActionDates({ startDate, dueDate, completionDate }, rawInvalid = []) {
  const errors = {};
  const values = { startDate, dueDate, completionDate };
  for (const [key, value] of Object.entries(values)) {
    if (rawInvalid.includes(key) || (value && !isValidISODate(value))) {
      errors[key] = `${LABELS[key]} inválida: use uma data real no formato dd/mm/aaaa (entre ${MIN_YEAR} e ${MAX_YEAR}).`;
    }
  }
  if (Object.keys(errors).length) return errors;
  if (startDate && dueDate && dueDate < startDate) errors.dueDate = 'O prazo não pode ser anterior à data de início.';
  if (startDate && completionDate && completionDate < startDate) errors.completionDate = 'A data de conclusão não pode ser anterior à data de início.';
  return errors;
}
