import { Router } from 'express';
import { db } from '../db/database.js';
import { currentMonth, lastMonths, monthRange, todayISO } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

const router = Router();

/**
 * GET /api/dashboard?month=YYYY-MM
 * Devolve tudo que a tela inicial precisa em uma única chamada.
 */
router.get('/', (req, res) => {
  const userId = req.user.id;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
    ? String(req.query.month)
    : currentMonth();
  const { start, end } = monthRange(month);
  const today = todayISO();

  // Saldo consolidado das contas ativas
  const { balance } = db
    .prepare(
      `SELECT COALESCE(SUM(
                a.initial_balance + COALESCE((
                  SELECT SUM(CASE WHEN t.type = 'receita'
                                  THEN COALESCE(t.paid_amount, t.amount)
                                  ELSE -COALESCE(t.paid_amount, t.amount) END)
                    FROM transactions t
                   WHERE t.account_id = a.id AND t.paid_at IS NOT NULL), 0)
              ), 0) AS balance
         FROM accounts a
        WHERE a.user_id = ? AND a.archived = 0`
    )
    .get(userId);

  // Números do mês selecionado
  const month_totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='receita' THEN amount END), 0)                              AS receitas_previstas,
         COALESCE(SUM(CASE WHEN type='despesa' THEN amount END), 0)                              AS despesas_previstas,
         COALESCE(SUM(CASE WHEN type='receita' AND paid_at IS NOT NULL
                           THEN COALESCE(paid_amount, amount) END), 0)                           AS recebido,
         COALESCE(SUM(CASE WHEN type='despesa' AND paid_at IS NOT NULL
                           THEN COALESCE(paid_amount, amount) END), 0)                           AS pago,
         COALESCE(SUM(CASE WHEN type='receita' AND paid_at IS NULL THEN amount END), 0)          AS a_receber,
         COALESCE(SUM(CASE WHEN type='despesa' AND paid_at IS NULL THEN amount END), 0)          AS a_pagar
       FROM transactions
      WHERE user_id = ? AND date(due_date) BETWEEN date(?) AND date(?)`
    )
    .get(userId, start, end);

  // Vencidos (qualquer data anterior a hoje, ainda em aberto)
  const overdue = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='receita' THEN amount END), 0) AS receber,
         COALESCE(SUM(CASE WHEN type='despesa' THEN amount END), 0) AS pagar,
         COUNT(*) AS quantidade
       FROM transactions
      WHERE user_id = ? AND paid_at IS NULL AND date(due_date) < date(?)`
    )
    .get(userId, today);

  // Evolução dos últimos 6 meses (previsto x realizado)
  const months = lastMonths(month, 6);
  const monthlyStmt = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='receita' THEN amount END), 0) AS receitas,
       COALESCE(SUM(CASE WHEN type='despesa' THEN amount END), 0) AS despesas,
       COALESCE(SUM(CASE WHEN type='receita' AND paid_at IS NOT NULL
                         THEN COALESCE(paid_amount, amount) END), 0) AS recebido,
       COALESCE(SUM(CASE WHEN type='despesa' AND paid_at IS NOT NULL
                         THEN COALESCE(paid_amount, amount) END), 0) AS pago
     FROM transactions
    WHERE user_id = ? AND strftime('%Y-%m', due_date) = ?`
  );

  const monthly = months.map((m) => {
    const r = monthlyStmt.get(userId, m);
    return {
      month: m,
      receitas: round2(r.receitas),
      despesas: round2(r.despesas),
      recebido: round2(r.recebido),
      pago: round2(r.pago),
      resultado: round2(r.receitas - r.despesas),
    };
  });

  // Despesas do mês por categoria (para o gráfico de pizza)
  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') AS name,
              COALESCE(c.color, '#94a3b8')      AS color,
              COALESCE(SUM(t.amount), 0)        AS total
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.type = 'despesa'
          AND date(t.due_date) BETWEEN date(?) AND date(?)
        GROUP BY c.id
        HAVING total > 0
        ORDER BY total DESC
        LIMIT 8`
    )
    .all(userId, start, end);

  // Próximos vencimentos (30 dias a partir de hoje)
  const upcoming = db
    .prepare(
      `SELECT t.id, t.type, t.description, t.amount, t.due_date,
              c.name AS category_name, p.name AS contact_name,
              CASE WHEN date(t.due_date) < date('now','localtime')
                   THEN 'atrasado' ELSE 'pendente' END AS status
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN contacts   p ON p.id = t.contact_id
        WHERE t.user_id = ? AND t.paid_at IS NULL
          AND date(t.due_date) <= date(?, '+30 days')
        ORDER BY t.due_date ASC
        LIMIT 8`
    )
    .all(userId, today);

  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.color, a.type,
              a.initial_balance + COALESCE((
                SELECT SUM(CASE WHEN t.type='receita'
                                THEN COALESCE(t.paid_amount, t.amount)
                                ELSE -COALESCE(t.paid_amount, t.amount) END)
                  FROM transactions t
                 WHERE t.account_id = a.id AND t.paid_at IS NOT NULL), 0) AS balance
         FROM accounts a
        WHERE a.user_id = ? AND a.archived = 0
        ORDER BY a.name`
    )
    .all(userId);

  res.json({
    month,
    balance: round2(balance),
    totals: {
      receitasPrevistas: round2(month_totals.receitas_previstas),
      despesasPrevistas: round2(month_totals.despesas_previstas),
      recebido: round2(month_totals.recebido),
      pago: round2(month_totals.pago),
      aReceber: round2(month_totals.a_receber),
      aPagar: round2(month_totals.a_pagar),
      resultadoPrevisto: round2(
        month_totals.receitas_previstas - month_totals.despesas_previstas
      ),
      resultadoRealizado: round2(month_totals.recebido - month_totals.pago),
    },
    overdue: {
      receber: round2(overdue.receber),
      pagar: round2(overdue.pagar),
      quantidade: overdue.quantidade,
    },
    monthly,
    byCategory: byCategory.map((c) => ({ ...c, total: round2(c.total) })),
    upcoming,
    accounts: accounts.map((a) => ({ ...a, balance: round2(a.balance) })),
  });
});

export default router;
