import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { asyncHandler, badRequest, notFound } from '../utils/http.js';
import { addMonths, todayISO } from '../utils/dates.js';
import { round2, splitInstallments } from '../utils/money.js';

const router = Router();

/** Situação calculada na hora da consulta — nunca fica desatualizada no banco. */
const STATUS_SQL = `
  CASE
    WHEN t.paid_at IS NOT NULL THEN 'pago'
    WHEN date(t.due_date) < date('now', 'localtime') THEN 'atrasado'
    ELSE 'pendente'
  END`;

const SELECT_SQL = `
  SELECT t.*,
         ${STATUS_SQL} AS status,
         c.name  AS category_name,  c.color AS category_color,
         p.name  AS contact_name,   p.type  AS contact_type,
         a.name  AS account_name,   a.color AS account_color
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN contacts   p ON p.id = t.contact_id
    LEFT JOIN accounts   a ON a.id = t.account_id`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');
const optionalId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
  z.number().int().positive().nullable()
);
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(300).nullable().optional()
);

const baseSchema = z.object({
  type: z.enum(['receita', 'despesa']),
  description: z.string().trim().min(2, 'Informe a descrição'),
  amount: z.coerce.number().positive('O valor precisa ser maior que zero'),
  dueDate: isoDate,
  categoryId: optionalId.optional(),
  contactId: optionalId.optional(),
  accountId: optionalId.optional(),
  documentNumber: optionalText,
  notes: optionalText,
  paid: z.boolean().default(false),
  paidAt: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional()),
  paidAmount: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.number().positive().nullable().optional()
  ),
});

const createSchema = baseSchema.extend({
  // 'unica' = um lançamento só; 'parcelada' divide o valor; 'recorrente' repete o valor.
  repeatMode: z.enum(['unica', 'parcelada', 'recorrente']).default('unica'),
  repeatCount: z.coerce.number().int().min(1).max(360).default(1),
  repeatIntervalMonths: z.coerce.number().int().min(1).max(12).default(1),
});

/** Confere que categoria/contato/conta informados pertencem ao usuário logado. */
function assertOwnership(userId, { categoryId, contactId, accountId }) {
  const check = (table, id, label) => {
    if (!id) return;
    const row = db
      .prepare(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`)
      .get(id, userId);
    if (!row) throw badRequest(`${label} inválido(a)`);
  };
  check('categories', categoryId, 'Categoria');
  check('contacts', contactId, 'Contato');
  check('accounts', accountId, 'Conta');
}

// ---------------------------------------------------------------------------
// Listagem com filtros + paginação
// ---------------------------------------------------------------------------
const SORTABLE = {
  due_date: 't.due_date',
  amount: 't.amount',
  description: 't.description',
  created_at: 't.created_at',
};

router.get('/', (req, res) => {
  const {
    type,
    status,
    from,
    to,
    categoryId,
    contactId,
    accountId,
    search,
    sort = 'due_date',
    order = 'asc',
    page = '1',
    pageSize = '20',
  } = req.query;

  const where = ['t.user_id = ?'];
  const params = [req.user.id];

  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  if (status === 'pago') where.push('t.paid_at IS NOT NULL');
  if (status === 'em_aberto') where.push('t.paid_at IS NULL');
  if (status === 'pendente') {
    where.push("t.paid_at IS NULL AND date(t.due_date) >= date('now','localtime')");
  }
  if (status === 'atrasado') {
    where.push("t.paid_at IS NULL AND date(t.due_date) < date('now','localtime')");
  }
  if (from) {
    where.push('date(t.due_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(t.due_date) <= date(?)');
    params.push(to);
  }
  if (categoryId) {
    where.push('t.category_id = ?');
    params.push(categoryId);
  }
  if (contactId) {
    where.push('t.contact_id = ?');
    params.push(contactId);
  }
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (search) {
    where.push(
      "(t.description LIKE ? OR IFNULL(t.document_number,'') LIKE ? OR IFNULL(t.notes,'') LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const sortSql = SORTABLE[sort] || SORTABLE.due_date;
  const orderSql = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
  const currentPage = Math.max(Number(page) || 1, 1);
  const offset = (currentPage - 1) * limit;

  const rows = db
    .prepare(
      `${SELECT_SQL} ${whereSql} ORDER BY ${sortSql} ${orderSql}, t.id ${orderSql} LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(t.amount), 0) AS total,
         COALESCE(SUM(CASE WHEN t.paid_at IS NOT NULL
                           THEN COALESCE(t.paid_amount, t.amount) ELSE 0 END), 0) AS paid,
         COALESCE(SUM(CASE WHEN t.paid_at IS NULL THEN t.amount ELSE 0 END), 0) AS open,
         COALESCE(SUM(CASE WHEN t.paid_at IS NULL
                            AND date(t.due_date) < date('now','localtime')
                           THEN t.amount ELSE 0 END), 0) AS overdue
         FROM transactions t ${whereSql}`
    )
    .get(...params);

  res.json({
    data: rows,
    page: currentPage,
    pageSize: limit,
    total: totals.count,
    totalPages: Math.max(Math.ceil(totals.count / limit), 1),
    summary: {
      total: round2(totals.total),
      paid: round2(totals.paid),
      open: round2(totals.open),
      overdue: round2(totals.overdue),
    },
  });
});

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db
      .prepare(`${SELECT_SQL} WHERE t.id = ? AND t.user_id = ?`)
      .get(req.params.id, req.user.id);
    if (!row) throw notFound('Lançamento não encontrado');
    res.json(row);
  })
);

// ---------------------------------------------------------------------------
// Criação (única, parcelada ou recorrente)
// ---------------------------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = createSchema.parse(req.body);
    assertOwnership(req.user.id, d);

    const repeats = d.repeatMode === 'unica' ? 1 : d.repeatCount;
    const amounts =
      d.repeatMode === 'parcelada'
        ? splitInstallments(d.amount, repeats)
        : Array.from({ length: repeats }, () => round2(d.amount));

    const paidAt = d.paid ? d.paidAt || todayISO() : null;
    const groupId = repeats > 1 ? randomUUID() : null;

    const insert = db.prepare(
      `INSERT INTO transactions
         (user_id, type, description, amount, due_date, paid_at, paid_amount,
          account_id, category_id, contact_id, document_number, notes,
          installment_no, installment_total, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const ids = db.transaction(() => {
      const created = [];
      for (let i = 0; i < repeats; i += 1) {
        const dueDate = addMonths(d.dueDate, i * d.repeatIntervalMonths);
        // Só a primeira ocorrência pode nascer quitada.
        const thisPaidAt = i === 0 ? paidAt : null;
        const { lastInsertRowid } = insert.run(
          req.user.id,
          d.type,
          d.description,
          amounts[i],
          dueDate,
          thisPaidAt,
          thisPaidAt ? round2(d.paidAmount ?? amounts[i]) : null,
          d.accountId ?? null,
          d.categoryId ?? null,
          d.contactId ?? null,
          d.documentNumber ?? null,
          d.notes ?? null,
          repeats > 1 ? i + 1 : null,
          repeats > 1 ? repeats : null,
          groupId
        );
        created.push(Number(lastInsertRowid));
      }
      return created;
    })();

    const rows = db
      .prepare(
        `${SELECT_SQL} WHERE t.id IN (${ids.map(() => '?').join(',')}) ORDER BY t.due_date`
      )
      .all(...ids);

    res.status(201).json({ created: rows.length, data: rows });
  })
);

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = baseSchema.parse(req.body);
    assertOwnership(req.user.id, d);

    const current = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!current) throw notFound('Lançamento não encontrado');

    const paidAt = d.paid ? d.paidAt || current.paid_at || todayISO() : null;

    db.prepare(
      `UPDATE transactions
          SET type = ?, description = ?, amount = ?, due_date = ?, paid_at = ?,
              paid_amount = ?, account_id = ?, category_id = ?, contact_id = ?,
              document_number = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`
    ).run(
      d.type,
      d.description,
      round2(d.amount),
      d.dueDate,
      paidAt,
      paidAt ? round2(d.paidAmount ?? d.amount) : null,
      d.accountId ?? null,
      d.categoryId ?? null,
      d.contactId ?? null,
      d.documentNumber ?? null,
      d.notes ?? null,
      req.params.id,
      req.user.id
    );

    res.json(
      db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(req.params.id)
    );
  })
);

// ---------------------------------------------------------------------------
// Baixa (pagar / receber) e estorno
// ---------------------------------------------------------------------------
const paySchema = z.object({
  paidAt: isoDate.optional(),
  paidAmount: z.coerce.number().positive().optional(),
  accountId: optionalId.optional(),
});

router.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const d = paySchema.parse(req.body ?? {});
    const current = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!current) throw notFound('Lançamento não encontrado');
    if (d.accountId) assertOwnership(req.user.id, { accountId: d.accountId });

    db.prepare(
      `UPDATE transactions
          SET paid_at = ?, paid_amount = ?, account_id = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(
      d.paidAt || todayISO(),
      round2(d.paidAmount ?? current.amount),
      d.accountId ?? current.account_id,
      current.id
    );

    res.json(db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(current.id));
  })
);

router.post(
  '/:id/unpay',
  asyncHandler(async (req, res) => {
    const result = db
      .prepare(
        `UPDATE transactions
            SET paid_at = NULL, paid_amount = NULL, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`
      )
      .run(req.params.id, req.user.id);
    if (result.changes === 0) throw notFound('Lançamento não encontrado');
    res.json(db.prepare(`${SELECT_SQL} WHERE t.id = ?`).get(req.params.id));
  })
);

// ---------------------------------------------------------------------------
// Exclusão — `?scope=group` remove todas as parcelas em aberto do mesmo grupo
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const current = db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!current) throw notFound('Lançamento não encontrado');

    let deleted = 0;
    if (req.query.scope === 'group' && current.group_id) {
      deleted = db
        .prepare(
          'DELETE FROM transactions WHERE group_id = ? AND user_id = ? AND paid_at IS NULL'
        )
        .run(current.group_id, req.user.id).changes;
      // O lançamento clicado sai mesmo que já esteja quitado.
      deleted += db
        .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
        .run(current.id, req.user.id).changes;
    } else {
      deleted = db
        .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
        .run(current.id, req.user.id).changes;
    }

    res.json({ deleted });
  })
);

export default router;
