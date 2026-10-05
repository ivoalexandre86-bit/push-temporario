// Date helpers. Internally all dates/timestamps are stored as ISO strings
// (YYYY-MM-DD for plain dates, YYYY-MM-DDTHH:mm:ss.sssZ for timestamps).
// The UI is responsible for rendering dd/MM/yyyy (pt-BR).

const PT_MONTHS = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

const PT_MONTH_NAMES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(date) {
  if (!date) return null;
  if (typeof date === 'string') return date;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Parses a "MÊS REF." style value which in the source workbook may be:
 *  - a real Date/Excel-serial date already resolved to a JS Date (normal case)
 *  - a short pt-BR string like "jul-26" (month abbreviation + 2-digit year)
 * Returns { refMonth: 'YYYY-MM-01', raw: <original string> } or null.
 */
function parseRefMonth(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = value.getMonth() + 1;
    return { refMonth: `${y}-${pad2(m)}-01`, raw: value.toISOString() };
  }

  const raw = String(value).trim();
  const match = raw.match(/^([a-zA-Zçãáéíóú]{3})-?(\d{2,4})$/i);
  if (match) {
    const abbr = match[1].toLowerCase().slice(0, 3);
    let year = parseInt(match[2], 10);
    if (year < 100) year += 2000;
    const month = PT_MONTHS[abbr];
    if (month) {
      return { refMonth: `${year}-${pad2(month)}-01`, raw };
    }
  }
  // Fallback: try native Date parsing
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return { refMonth: `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-01`, raw };
  }
  return { refMonth: null, raw };
}

/**
 * Parses a plain date cell. Handles JS Date objects (normal case, from
 * exceljs) and short "dd-mon" strings like "31-jul" (no year -> assumed
 * from the provided fallbackYear, defaulting to the current year).
 */
function parseDateCell(value, fallbackYear) {
  if (value == null || value === '') return { date: null, raw: null };
  if (value instanceof Date) {
    return { date: toISODate(value), raw: null };
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2})-([a-zA-Zçãáéíóú]{3})$/i);
  if (match) {
    const day = parseInt(match[1], 10);
    const abbr = match[2].toLowerCase().slice(0, 3);
    const month = PT_MONTHS[abbr];
    const year = fallbackYear || new Date().getFullYear();
    if (month) {
      return { date: `${year}-${pad2(month)}-${pad2(day)}`, raw };
    }
  }
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return { date: toISODate(parsed), raw };
  }
  return { date: null, raw };
}

function formatDatePtBR(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function nowISO() {
  return new Date().toISOString();
}

function todayISODate() {
  return toISODate(new Date());
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Strict validation for user-entered dates (actions, time entries).
// ---------------------------------------------------------------------------

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** True only for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30, 2026-13-01...). */
function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** True for YYYY-MM or a real YYYY-MM-DD date (reference month; normalized to day 01 by the caller). */
function isValidRefMonth(value) {
  if (typeof value !== 'string') return false;
  if (/^\d{4}-\d{2}$/.test(value)) return isValidISODate(`${value}-01`);
  return isValidISODate(value);
}

const ACTION_DATE_LABELS = {
  startDate: 'Data de início',
  dueDate: 'Prazo',
  completionDate: 'Data de conclusão',
};

/**
 * Validates the date fields of an action (already merged with the stored
 * values on updates). Returns a list of { path, message } issues in pt-BR;
 * empty when valid. Empty/null dates are allowed (required-ness is checked
 * by the status rules).
 *
 * Chronology: início <= prazo, início <= conclusão. A conclusão pode ser
 * posterior ao prazo (ação concluída com atraso).
 */
function validateActionDates({ startDate, dueDate, completionDate } = {}) {
  const issues = [];
  const values = { startDate, dueDate, completionDate };
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') continue;
    if (!isValidISODate(value)) {
      issues.push({ path: key, message: `${ACTION_DATE_LABELS[key]} inválida: use uma data real no formato dd/mm/aaaa (entre ${MIN_YEAR} e ${MAX_YEAR}).` });
    }
  }
  if (issues.length) return issues;
  if (startDate && dueDate && dueDate < startDate) {
    issues.push({ path: 'dueDate', message: 'O prazo não pode ser anterior à data de início.' });
  }
  if (startDate && completionDate && completionDate < startDate) {
    issues.push({ path: 'completionDate', message: 'A data de conclusão não pode ser anterior à data de início.' });
  }
  return issues;
}

module.exports = {
  isValidISODate,
  isValidRefMonth,
  validateActionDates,
  PT_MONTHS,
  PT_MONTH_NAMES,
  parseRefMonth,
  parseDateCell,
  formatDatePtBR,
  toISODate,
  nowISO,
  todayISODate,
  addDaysISO,
};
