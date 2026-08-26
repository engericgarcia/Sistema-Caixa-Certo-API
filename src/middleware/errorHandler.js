import { ZodError } from 'zod';
import { HttpError } from '../utils/http.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: 'Rota não encontrada' });
}

// eslint-disable-next-line no-unused-vars -- o Express exige os 4 parâmetros
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Já existe um registro com esses dados' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Erro interno do servidor' });
}
