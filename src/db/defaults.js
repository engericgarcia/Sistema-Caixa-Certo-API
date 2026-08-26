import { db } from './database.js';

/** Categorias sugeridas para quem está começando. */
export const DEFAULT_CATEGORIES = [
  { name: 'Vendas', type: 'receita', color: '#22c55e' },
  { name: 'Prestação de serviços', type: 'receita', color: '#4ade80' },
  { name: 'Outras receitas', type: 'receita', color: '#86efac' },
  { name: 'Fornecedores', type: 'despesa', color: '#f97316' },
  { name: 'Folha de pagamento', type: 'despesa', color: '#ef4444' },
  { name: 'Aluguel', type: 'despesa', color: '#8b5cf6' },
  { name: 'Água, luz e internet', type: 'despesa', color: '#0ea5e9' },
  { name: 'Impostos', type: 'despesa', color: '#64748b' },
  { name: 'Marketing', type: 'despesa', color: '#ec4899' },
  { name: 'Outras despesas', type: 'despesa', color: '#a16207' },
];

/**
 * Cria categorias e a conta "Caixa" para um usuário recém-cadastrado,
 * para que ele não caia num sistema completamente vazio.
 */
export function seedDefaultsForUser(userId) {
  const insertCategory = db.prepare(
    'INSERT OR IGNORE INTO categories (user_id, name, type, color) VALUES (?, ?, ?, ?)'
  );
  const insertAccount = db.prepare(
    'INSERT INTO accounts (user_id, name, type, initial_balance, color) VALUES (?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    for (const c of DEFAULT_CATEGORIES) {
      insertCategory.run(userId, c.name, c.type, c.color);
    }
    insertAccount.run(userId, 'Caixa', 'caixa', 0, '#22c55e');
  })();
}
