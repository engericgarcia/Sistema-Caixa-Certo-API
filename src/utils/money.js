/**
 * O banco guarda valores em REAL. Para evitar ruído de ponto flutuante
 * (0.1 + 0.2), toda gravação passa por aqui e é arredondada em 2 casas.
 */
export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Divide um total em N parcelas somando exatamente o total (sobra na 1ª). */
export function splitInstallments(total, count) {
  const base = Math.floor((round2(total) * 100) / count) / 100;
  const parts = Array.from({ length: count }, () => base);
  const diff = round2(total - base * count);
  parts[0] = round2(parts[0] + diff);
  return parts;
}
