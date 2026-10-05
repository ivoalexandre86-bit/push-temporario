export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

export function formatMonthYear(iso) {
  if (!iso) return '—';
  const [y, m] = String(iso).slice(0, 10).split('-');
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] || m}/${y}`;
}

export function formatNumber(n, opts = {}) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2, ...opts });
}

export function formatHours(n) {
  if (n === null || n === undefined) return '—';
  return `${formatNumber(n)}h`;
}

/** Hours with an explicit sign (+3h / −2,5h), used for variations. */
export function formatSignedHours(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (v > 0) return `+${formatNumber(v)}h`;
  if (v < 0) return `−${formatNumber(Math.abs(v))}h`;
  return '0h';
}

export function formatPercent(n) {
  if (n === null || n === undefined) return '—';
  return `${formatNumber(n)}%`;
}

export function toInputDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}
