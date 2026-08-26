import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { asyncHandler, notFound } from '../utils/http.js';

const router = Router();

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome'),
  type: z.enum(['cliente', 'fornecedor', 'ambos']).default('cliente'),
  document: z.preprocess(emptyToNull, z.string().trim().max(20).nullable().optional()),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().email('E-mail inválido').nullable().optional()
  ),
  phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
});

router.get('/', (req, res) => {
  const { type, search } = req.query;
  const like = search ? `%${search}%` : null;

  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.contact_id = c.id) AS transactions_count,
              (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
                WHERE t.contact_id = c.id AND t.paid_at IS NULL) AS open_amount
         FROM contacts c
        WHERE c.user_id = ?
          AND (? IS NULL OR c.type = ? OR c.type = 'ambos')
          AND (? IS NULL OR c.name LIKE ? OR IFNULL(c.document, '') LIKE ?)
        ORDER BY c.name`
    )
    .all(req.user.id, type ?? null, type ?? null, like, like, like);

  res.json(rows);
});

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db
      .prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!row) throw notFound('Contato não encontrado');
    res.json(row);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const d = contactSchema.parse(req.body);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO contacts (user_id, name, type, document, email, phone, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        d.name,
        d.type,
        d.document ?? null,
        d.email ?? null,
        d.phone ?? null,
        d.notes ?? null
      );
    res
      .status(201)
      .json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(lastInsertRowid));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = contactSchema.parse(req.body);
    const result = db
      .prepare(
        `UPDATE contacts
            SET name = ?, type = ?, document = ?, email = ?, phone = ?, notes = ?
          WHERE id = ? AND user_id = ?`
      )
      .run(
        d.name,
        d.type,
        d.document ?? null,
        d.email ?? null,
        d.phone ?? null,
        d.notes ?? null,
        req.params.id,
        req.user.id
      );

    if (result.changes === 0) throw notFound('Contato não encontrado');
    res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = db
      .prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (result.changes === 0) throw notFound('Contato não encontrado');
    res.status(204).end();
  })
);

export default router;
