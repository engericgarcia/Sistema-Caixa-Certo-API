import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import './db/database.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import categoryRoutes from './routes/categories.js';
import contactRoutes from './routes/contacts.js';
import transactionRoutes from './routes/transactions.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';

const app = express();

// A interface roda em outro domínio, então só as origens listadas no
// CORS_ORIGIN podem chamar esta API.
const allowedOrigins = config.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Sem origin = chamada de servidor para servidor (curl, health check).
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // Origem desconhecida: responde sem os cabeçalhos de liberação, e o
      // próprio navegador bloqueia. Devolver erro aqui viraria um 500 no log.
      return callback(null, false);
    },
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) =>
  res.json({
    name: 'Caixa Certo API',
    version: '1.0.0',
    docs: 'https://github.com/engericgarcia/caixa-certo-api#endpoints',
    health: '/api/health',
  })
);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime() })
);

app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireAuth, accountRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api/transactions', requireAuth, transactionRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/reports', requireAuth, reportRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`\n  Caixa Certo API em http://localhost:${config.port}`);
  console.log(`  Banco de dados: ${config.databaseFile}`);
  console.log(`  Origens liberadas: ${allowedOrigins.join(', ') || '(nenhuma)'}\n`);
});
