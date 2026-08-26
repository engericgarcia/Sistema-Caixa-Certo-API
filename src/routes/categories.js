import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database.js';
import { asyncHandler, notFound } from '../utils/http.js';

const router = Router();

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da categoria'),
  type: z.enum(['receita', 'despesa']),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida')
    .default('#4ade80'),
});

router.get('/', (req, res) => {
  const { type } = req.query;
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS usage_count
         FROM categories c
        WHERE c.user_id = ?
          AND (? IS NULL OR c.type = ?)
        ORDER BY c.type, c.name`
    )
    .all(req.user.id, type ?? null, type ?? null);
  res.json(rows);
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO categories (user_id, name, type, color) VALUES (?, ?, ?, ?)'
      )
      .run(req.user.id, data.name, data.type, data.color);
    res
      .status(201)
      .json(db.prepare('SELECT * FROM categories WHERE id = ?').get(lastInsertRowid));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const result = db
      .prepare(
        'UPDATE categories SET name = ?, type = ?, color = ? WHERE id = ? AND user_id = ?'
      )
      .run(data.name, data.type, data.color, req.params.id, req.user.id);

    if (result.changes === 0) throw notFound('Categoria não encontrada');
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = db
      .prepare('DELETE FROM categories WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);

    if (result.changes === 0) throw notFound('Categoria não encontrada');
    res.status(204).end();
  })
);

export default router;
