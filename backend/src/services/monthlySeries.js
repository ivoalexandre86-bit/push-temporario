// Builds continuous monthly timelines for reports/dashboards, so months with
// no activity show up as zeros instead of disappearing from charts/tables.
//
// The timeline is grouped by the action's reference month (ref_month,
// stored as YYYY-MM-01) and follows the same filters used by the queries
// (see actionFilters.buildActionFilters):
//   - "Mês" (refMonth) selected  -> exactly the selected months;
//   - "Ano" (year) selected      -> every month (jan-dez) of each selected year;
//   - neither                    -> every month between the first and the last
//                                   month that has data for the other filters.

const MAX_MONTHS = 600; // safety cap (50 years)

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Normalizes 'YYYY-MM', 'YYYY-MM-DD' or a Date to 'YYYY-MM-01'. */
function toMonthKey(value) {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-01`;
  const m = String(value).match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

/** Every month from `from` to `to` (inclusive), as 'YYYY-MM-01'. */
function monthsBetween(from, to) {
  const start = toMonthKey(from);
  const end = toMonthKey(to);
  if (!start || !end || start > end) return [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const out = [];
  while (out.length < MAX_MONTHS) {
    const key = `${y}-${pad2(m)}-01`;
    if (key > end) break;
    out.push(key);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Resolves the list of months of the selected reporting period.
 * @param {object} filtersEcho - the `filtersEcho` returned by buildActionFilters
 * @param {string[]} dataMonths - months present in the query result
 */
function resolvePeriodMonths(filtersEcho = {}, dataMonths = []) {
  const years = (filtersEcho.year || []).map(String).filter((y) => /^\d{4}$/.test(y));
  const refMonths = (filtersEcho.refMonth || []).map(toMonthKey).filter(Boolean);

  if (refMonths.length) {
    const inYears = years.length ? refMonths.filter((m) => years.includes(m.slice(0, 4))) : refMonths;
    return [...new Set(inYears)].sort();
  }
  if (years.length) {
    return [...new Set(years)].sort().flatMap((y) => monthsBetween(`${y}-01-01`, `${y}-12-01`));
  }
  const present = dataMonths.map(toMonthKey).filter(Boolean).sort();
  if (!present.length) return [];
  return monthsBetween(present[0], present[present.length - 1]);
}

/**
 * Returns one entry per period month, using the matching row (by
 * `monthKey`) when it exists or `emptyRow(month)` otherwise.
 */
function fillMonths(rows, months, emptyRow, monthKey = 'month') {
  const byMonth = new Map(rows.map((r) => [toMonthKey(r[monthKey]), r]));
  return months.map((m) => byMonth.get(m) || emptyRow(m));
}

module.exports = { toMonthKey, monthsBetween, resolvePeriodMonths, fillMonths };
