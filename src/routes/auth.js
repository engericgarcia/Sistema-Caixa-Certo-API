import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/database.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { asyncHandler, conflict, unauthorized, badRequest } from '../utils/http.js';
import { seedDefaultsForUser } from '../db/defaults.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.created_at,
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) throw conflict('Já existe uma conta com este e-mail');

    const passwordHash = await bcrypt.hash(password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, passwordHash);

    // Todo usuário novo já começa com categorias e uma conta padrão.
    seedDefaultsForUser(Number(lastInsertRowid));

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) throw unauthorized('E-mail ou senha incorretos');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw unauthorized('E-mail ou senha incorretos');

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
});

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email } = updateProfileSchema.parse(req.body);

    const taken = db
      .prepare('SELECT id FROM users WHERE email = ? AND id <> ?')
      .get(email, req.user.id);
    if (taken) throw conflict('Este e-mail já está em uso');

    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(
      name,
      email,
      req.user.id
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: z.string().min(6, 'A nova senha precisa ter ao menos 6 caracteres'),
});

router.put(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw badRequest('A senha atual está incorreta');

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    res.json({ ok: true });
  })
);

export default router;
