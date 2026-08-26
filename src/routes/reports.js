import { Router } from 'express';
import { db } from '../db/database.js';
import { currentMonth, lastMonths, monthRange } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

const router = Router();

/**
 * Os relatórios aceitam dois regimes:
 *  - competencia: considera a data de vencimento (o que foi gerado no período)
 *  - caixa:       considera a data de pagamento (o que entrou/saiu de fato)
 */
function regimeColumn(regime) {
  return regime === 'caixa' ? 'paid_at' : 'due_date';
}

function valueColumn(regime) {
  return regime === 'caixa' ? 'COALESCE(paid_amount, amount)' : 'amount';
}

// ---------------------------------------------------------------------------
// GET /api/reports/cashflow?months=12&regime=caixa
// ---------------------------------------------------------------------------
router.get('/cashflow', (req, res) => {
  const regime = req.query.regime === 'competencia' ? 'competencia' : 'caixa';
  const count = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);
  const months = lastMonths(currentMonth(), count);
  const col = regimeColumn(regime);
  const val = valueColumn(regime);

  const stmt = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='receita' THEN ${val} END), 0) AS entradas,
       COALESCE(SUM(CASE WHEN type='despesa' THEN ${val} END), 0) AS saidas
     FROM transactions
    WHERE user_id = ? AND ${col} IS NOT NULL AND strftime('%Y-%m', ${col}) = ?`
  );

  // Saldo inicial: contas + tudo que já foi movimentado antes do 1º mês do relatório
  const { start } = monthRange(months[0]);
  const { opening } = db
    .prepare(
      `SELECT COALESCE((SELECT SUM(initial_balance) FROM accounts WHERE user_id = ?), 0)
              + COALESCE((
                  SELECT SUM(CASE WHEN type='receita'
                                  THEN COALESCE(paid_amount, amount)
                                  ELSE -COALESCE(paid_amount, amount) END)
                    FROM transactions
                   WHERE user_id = ? AND paid_at IS NOT NULL AND date(paid_at) < date(?)
                ), 0) AS opening`
    )
    .get(req.user.id, req.user.id, start);

  let running = round2(opening);
  const data = months.map((m) => {
    const r = stmt.get(req.user.id, m);
    const entradas = round2(r.entradas);
    const saidas = round2(r.saidas);
    const saldoInicial = running;
    running = round2(running + entradas - saidas);
    return {
      month: m,
      entradas,
      saidas,
      resultado: round2(entradas - saidas),
      saldoInicial,
      saldoFinal: running,
    };
  });

  res.json({ regime, opening: round2(opening), data });
});

// ---------------------------------------------------------------------------
// GET /api/reports/by-category?from&to&type&regime
// ---------------------------------------------------------------------------
router.get('/by-category', (req, res) => {
  const regime = req.query.regime === 'competencia' ? 'competencia' : 'caixa';
  const type = req.query.type === 'receita' ? 'receita' : 'despesa';
  const col = regimeColumn(regime);
  const val = valueColumn(regime);
  const { from, to } = req.query;

  const rows = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name,
              COALESCE(c.color, '#94a3b8')      AS color,
              COUNT(*)                          AS quantidade,
              COALESCE(SUM(${val}), 0)          AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.type = ?
          AND t.${col} IS NOT NULL
          AND (? IS NULL OR date(t.${col}) >= date(?))
          AND (? IS NULL OR date(t.${col}) <= date(?))
        GROUP BY c.id
        ORDER BY total DESC`
    )
    .all(req.user.id, type, from ?? null, from ?? null, to ?? null, to ?? null);

  const total = rows.reduce((acc, r) => acc + r.total, 0);
  res.json({
    type,
    regime,
    total: round2(total),
    data: rows.map((r) => ({
      ...r,
      total: round2(r.total),
      percent: total > 0 ? round2((r.total / total) * 100) : 0,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/reports/dre?from&to&regime  (demonstrativo de resultado simplificado)
// ---------------------------------------------------------------------------
router.get('/dre', (req, res) => {
  const regime = req.query.regime === 'competencia' ? 'competencia' : 'caixa';
  const col = regimeColumn(regime);
  const val = valueColumn(regime);
  const { from, to } = req.query;

  const stmt = db.prepare(
    `SELECT COALESCE(c.name, 'Sem categoria') AS name,
            COALESCE(SUM(${val}), 0)          AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.type = ?
        AND t.${col} IS NOT NULL
        AND (? IS NULL OR date(t.${col}) >= date(?))
        AND (? IS NULL OR date(t.${col}) <= date(?))
      GROUP BY c.id
      ORDER BY total DESC`
  );

  const args = [from ?? null, from ?? null, to ?? null, to ?? null];
  const receitas = stmt.all(req.user.id, 'receita', ...args);
  const despesas = stmt.all(req.user.id, 'despesa', ...args);

  const totalReceitas = round2(receitas.reduce((a, r) => a + r.total, 0));
  const totalDespesas = round2(despesas.reduce((a, r) => a + r.total, 0));

  res.json({
    regime,
    from: from ?? null,
    to: to ?? null,
    receitas: receitas.map((r) => ({ ...r, total: round2(r.total) })),
    despesas: despesas.map((r) => ({ ...r, total: round2(r.total) })),
    totalReceitas,
    totalDespesas,
    resultado: round2(totalReceitas - totalDespesas),
    margem: totalReceitas > 0
      ? round2(((totalReceitas - totalDespesas) / totalReceitas) * 100)
      : 0,
  });
});

// ---------------------------------------------------------------------------
// GET /api/reports/export.csv  — exporta os lançamentos filtrados
// ---------------------------------------------------------------------------
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

router.get('/export.csv', (req, res) => {
  const { type, from, to, status } = req.query;
  const where = ['t.user_id = ?'];
  const params = [req.user.id];

  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  if (status === 'pago') where.push('t.paid_at IS NOT NULL');
  if (status === 'em_aberto') where.push('t.paid_at IS NULL');
  if (from) {
    where.push('date(t.due_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(t.due_date) <= date(?)');
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT t.id, t.type, t.description, t.amount, t.due_date, t.paid_at,
              t.paid_amount, t.document_number, t.notes,
              c.name AS categoria, p.name AS contato, a.name AS conta
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN contacts   p ON p.id = t.contact_id
         LEFT JOIN accounts   a ON a.id = t.account_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.due_date`
    )
    .all(...params);

  const header = [
    'ID', 'Tipo', 'Descrição', 'Valor', 'Vencimento', 'Pagamento',
    'Valor pago', 'Documento', 'Categoria', 'Contato', 'Conta', 'Observações',
  ];

  const lines = [header.map(csvCell).join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.type === 'receita' ? 'Receita' : 'Despesa',
        r.description,
        String(round2(r.amount)).replace('.', ','),
        r.due_date,
        r.paid_at,
        r.paid_amount != null ? String(round2(r.paid_amount)).replace('.', ',') : '',
        r.document_number,
        r.categoria,
        r.contato,
        r.conta,
        r.notes,
      ]
        .map(csvCell)
        .join(';')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lancamentos.csv"');
  // BOM para o Excel abrir os acentos corretamente
  res.send(`﻿${lines.join('\n')}`);
});

export default router;
