import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do projeto — usada para resolver os caminhos relativos do .env */
export const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-nao-use-em-producao',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  databaseFile: path.resolve(
    PROJECT_ROOT,
    process.env.DATABASE_FILE || 'data/financeiro.sqlite'
  ),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',
};

if (config.isProduction && config.jwtSecret === 'dev-secret-nao-use-em-producao') {
  console.warn(
    '[aviso] JWT_SECRET não foi definido. Configure a variável antes de usar em produção.'
  );
}
