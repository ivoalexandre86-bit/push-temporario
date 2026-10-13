// Default dates for a new action, in the user's local time zone:
// mês de referência = current month, início = today, fim (prazo) = last day of the current month.

const pad = (n) => String(n).padStart(2, '0');

/** Returns { refMonth: 'YYYY-MM', startDate: 'YYYY-MM-DD', dueDate: 'YYYY-MM-DD' } for `now`. */
export function newActionDateDefaults(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    refMonth: `${y}-${pad(m)}`,
    startDate: `${y}-${pad(m)}-${pad(now.getDate())}`,
    dueDate: `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}
