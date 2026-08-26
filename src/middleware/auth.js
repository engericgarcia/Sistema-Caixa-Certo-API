import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/database.js';
import { unauthorized } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/**
 * Exige um `Authorization: Bearer <token>` válido e injeta `req.user`.
 * Todas as rotas de dados usam este middleware — é ele que garante que
 * um usuário nunca enxergue os lançamentos de outro.
 */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Token de acesso não informado'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db
      .prepare('SELECT id, name, email, created_at FROM users WHERE id = ?')
      .get(payload.sub);

    if (!user) return next(unauthorized('Usuário não encontrado'));

    req.user = user;
    return next();
  } catch {
    return next(unauthorized('Token inválido ou expirado'));
  }
}
