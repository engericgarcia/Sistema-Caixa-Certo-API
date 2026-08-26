/** Utilitários de data trabalhando sempre com strings `YYYY-MM-DD` (sem fuso). */

export function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function isValidISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Soma meses preservando o fim do mês (31/01 + 1 mês => 28/02). */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Soma dias a uma data ISO. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Retorna { start, end } do mês informado no formato `YYYY-MM`. */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** Mês atual no formato `YYYY-MM`. */
export function currentMonth() {
  return todayISO().slice(0, 7);
}

/** Lista os N últimos meses (incluindo `month`) em ordem cronológica. */
export function lastMonths(month, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(addMonths(`${month}-01`, -i).slice(0, 7));
  }
  return out;
}
