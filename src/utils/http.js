/** Erro de aplicação com status HTTP — capturado pelo errorHandler. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Não autorizado') => new HttpError(401, msg);
export const forbidden = (msg = 'Acesso negado') => new HttpError(403, msg);
export const notFound = (msg = 'Registro não encontrado') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/**
 * Envolve um handler async para que exceções caiam no middleware de erro
 * sem precisar de try/catch em toda rota.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
