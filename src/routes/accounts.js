import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { asyncHandler, notFound } from '../utils/http.js';
import { round2 } from '../utils/money.js';

const router = Router();

const accountSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da conta'),
  type: z
    .enum(['corrente', 'poupanca', 'caixa', 'cartao', 'investimento'])
    .default('corrente'),
  bank: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().max(60).nullable().optional()
    ),
  initialBalance: z.coerce.number().default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida').default('#22c55e'),
  archived: z.coerce.boolean().default(false),
});

/**
 * Saldo = saldo inicial + tudo que já foi efetivamente recebido
 *         − tudo que já foi efetivamente pago naquela conta.
 * Lançamentos em aberto não entram no saldo (entram na previsão).
 */
const BALANCE_SQL = `
  a.initial_balance + COALESCE((
    SELECT SUM(CASE WHEN t.type = 'receita'
                    THEN COALESCE(t.paid_amount, t.amount)
                    ELSE -COALESCE(t.paid_amount, t.amount) END)
      FROM transactions t
     WHERE t.account_id = a.id AND t.paid_at IS NOT NULL
  ), 0) AS balance`;

router.get('/', (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const rows = db
    .prepare(
      `SELECT a.*, ${BALANCE_SQL}
         FROM accounts a
        WHERE a.user_id = ? AND (? = 1 OR a.archived = 0)
        ORDER BY a.archived, a.name`
    )
    .all(req.user.id, includeArchived ? 1 : 0);

  res.json(rows.map((r) => ({ ...r, balance: round2(r.balance) })));
});

router.get('/summary', (req, res) => {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(saldo), 0) AS total FROM (
         SELECT ${BALANCE_SQL} AS saldo
           FROM accounts a
          WHERE a.user_id = ? AND a.archived = 0
       )`
    )
    .get(req.user.id);
  res.json({ total: round2(row.total) });
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = accountSchema.parse(req.body);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO accounts (user_id, name, type, bank, initial_balance, color, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        d.name,
        d.type,
        d.bank ?? null,
        round2(d.initialBalance),
        d.color,
        d.archived ? 1 : 0
      );
    res
      .status(201)
      .json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = accountSchema.parse(req.body);
    const result = db
      .prepare(
        `UPDATE accounts
            SET name = ?, type = ?, bank = ?, initial_balance = ?, color = ?, archived = ?
          WHERE id = ? AND user_id = ?`
      )
      .run(
        d.name,
        d.type,
        d.bank ?? null,
        round2(d.initialBalance),
        d.color,
        d.archived ? 1 : 0,
        req.params.id,
        req.user.id
      );

    if (result.changes === 0) throw notFound('Conta não encontrada');
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = db
      .prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (result.changes === 0) throw notFound('Conta não encontrada');
    res.status(204).end();
  })
);

export default router;
