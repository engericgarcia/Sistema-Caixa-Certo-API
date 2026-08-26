/**
 * Popula o banco com um usuário de demonstração e alguns meses de lançamentos,
 * para que o sistema já abra com gráficos e listas preenchidos.
 *
 *   npm run seed            -> cria/atualiza o usuário demo
 *   npm run reset           -> APAGA todos os dados e recria a demonstração
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './database.js';
import { seedDefaultsForUser } from './defaults.js';
import { addDays, addMonths, todayISO } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

const DEMO_EMAIL = 'demo@caixacerto.app';
const DEMO_PASSWORD = 'demo1234';

const reset = process.argv.includes('--reset');

if (reset) {
  db.exec('DELETE FROM users;');
  console.log('• Todos os dados foram apagados.');
}

db.prepare('DELETE FROM users WHERE email = ?').run(DEMO_EMAIL);

const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
const { lastInsertRowid } = db
  .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
  .run('Usuário Demonstração', DEMO_EMAIL, passwordHash);
const userId = Number(lastInsertRowid);

seedDefaultsForUser(userId);

// --- Contas ----------------------------------------------------------------
const insertAccount = db.prepare(
  'INSERT INTO accounts (user_id, name, type, bank, initial_balance, color) VALUES (?, ?, ?, ?, ?, ?)'
);
const contaCorrente = Number(
  insertAccount.run(userId, 'Conta Corrente', 'corrente', 'Banco do Brasil', 12500, '#16a34a')
    .lastInsertRowid
);
const poupanca = Number(
  insertAccount.run(userId, 'Reserva', 'poupanca', 'Nubank', 30000, '#4ade80').lastInsertRowid
);
const caixa = db
  .prepare("SELECT id FROM accounts WHERE user_id = ? AND name = 'Caixa'")
  .get(userId).id;
db.prepare('UPDATE accounts SET initial_balance = 800 WHERE id = ?').run(caixa);

// --- Contatos --------------------------------------------------------------
const insertContact = db.prepare(
  'INSERT INTO contacts (user_id, name, type, document, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
);
const contatos = {
  clientes: [
    ['Mercado Bom Preço Ltda', 'cliente', '12.345.678/0001-90', 'financeiro@bompreco.com.br', '(11) 3222-1010'],
    ['Padaria Estrela', 'cliente', '98.765.432/0001-10', 'contato@padariaestrela.com.br', '(11) 3555-2020'],
    ['Ana Beatriz Souza', 'cliente', '123.456.789-00', 'ana.souza@email.com', '(11) 99888-7766'],
    ['Construtora Horizonte', 'cliente', '45.678.912/0001-33', 'compras@horizonte.com.br', '(11) 3777-3030'],
  ],
  fornecedores: [
    ['Distribuidora Central', 'fornecedor', '11.222.333/0001-44', 'vendas@central.com.br', '(11) 3444-5050'],
    ['Imobiliária Praça Nova', 'fornecedor', '22.333.444/0001-55', 'locacao@pracanova.com.br', '(11) 3666-6060'],
    ['Companhia de Energia', 'fornecedor', '33.444.555/0001-66', null, '0800 123 4567'],
    ['Contabilidade Prisma', 'fornecedor', '44.555.666/0001-77', 'contato@prisma.cnt.br', '(11) 3888-7070'],
  ],
};

const contactIds = {};
for (const list of Object.values(contatos)) {
  for (const [name, type, doc, email, phone] of list) {
    contactIds[name] = Number(
      insertContact.run(userId, name, type, doc, email, phone).lastInsertRowid
    );
  }
}

// --- Categorias ------------------------------------------------------------
const categoryId = (name) =>
  db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, name)?.id ??
  null;

// --- Lançamentos -----------------------------------------------------------
const insertTx = db.prepare(
  `INSERT INTO transactions
     (user_id, type, description, amount, due_date, paid_at, paid_amount,
      account_id, category_id, contact_id, document_number, notes,
      installment_no, installment_total, group_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const hoje = todayISO();
const primeiroDia = `${hoje.slice(0, 7)}-01`;

/** Data no mês relativo ao atual (offset negativo = passado). */
const dia = (offsetMeses, diaDoMes) =>
  addMonths(`${primeiroDia.slice(0, 8)}${String(diaDoMes).padStart(2, '0')}`, offsetMeses);

/**
 * Datas relativas a hoje: garantem que a demonstração fique coerente
 * independentemente do dia em que o seed for executado.
 */
const emDias = (n) => addDays(hoje, n);

const criar = ({ type, desc, amount, due, pago, categoria, contato, conta, doc, parcela }) => {
  insertTx.run(
    userId,
    type,
    desc,
    round2(amount),
    due,
    pago ? due : null,
    pago ? round2(amount) : null,
    conta ?? contaCorrente,
    categoria ? categoryId(categoria) : null,
    contato ? contactIds[contato] : null,
    doc ?? null,
    null,
    parcela?.no ?? null,
    parcela?.total ?? null,
    parcela?.groupId ?? null
  );
};

// Últimos 5 meses fechados: tudo quitado
for (let m = -5; m <= -1; m += 1) {
  const fator = 1 + (m + 5) * 0.06; // crescimento leve mês a mês
  criar({ type: 'receita', desc: 'Venda mensal - Mercado Bom Preço', amount: 8400 * fator, due: dia(m, 5), pago: true, categoria: 'Vendas', contato: 'Mercado Bom Preço Ltda', doc: `NF ${1200 + m}` });
  criar({ type: 'receita', desc: 'Contrato de manutenção - Construtora Horizonte', amount: 4200, due: dia(m, 10), pago: true, categoria: 'Prestação de serviços', contato: 'Construtora Horizonte' });
  criar({ type: 'receita', desc: 'Vendas balcão', amount: 2650 * fator, due: dia(m, 20), pago: true, categoria: 'Vendas', conta: caixa });

  criar({ type: 'despesa', desc: 'Compra de mercadorias', amount: 5100 * fator, due: dia(m, 8), pago: true, categoria: 'Fornecedores', contato: 'Distribuidora Central' });
  criar({ type: 'despesa', desc: 'Aluguel da loja', amount: 3200, due: dia(m, 10), pago: true, categoria: 'Aluguel', contato: 'Imobiliária Praça Nova' });
  criar({ type: 'despesa', desc: 'Folha de pagamento', amount: 4800, due: dia(m, 5), pago: true, categoria: 'Folha de pagamento' });
  criar({ type: 'despesa', desc: 'Energia elétrica', amount: 640 + m * -12, due: dia(m, 15), pago: true, categoria: 'Água, luz e internet', contato: 'Companhia de Energia' });
  criar({ type: 'despesa', desc: 'Honorários contábeis', amount: 750, due: dia(m, 15), pago: true, categoria: 'Impostos', contato: 'Contabilidade Prisma' });
  criar({ type: 'despesa', desc: 'Anúncios online', amount: 480, due: dia(m, 22), pago: true, categoria: 'Marketing' });
}

// Mês atual: parte quitada, parte em aberto
// Já realizados neste mês
criar({ type: 'receita', desc: 'Venda mensal - Mercado Bom Preço', amount: 9100, due: emDias(-12), pago: true, categoria: 'Vendas', contato: 'Mercado Bom Preço Ltda', doc: 'NF 1290' });
criar({ type: 'despesa', desc: 'Aluguel da loja', amount: 3200, due: emDias(-10), pago: true, categoria: 'Aluguel', contato: 'Imobiliária Praça Nova' });
criar({ type: 'despesa', desc: 'Folha de pagamento', amount: 4950, due: emDias(-14), pago: true, categoria: 'Folha de pagamento' });

// Ainda em aberto, vencendo nos próximos dias
criar({ type: 'receita', desc: 'Contrato de manutenção - Construtora Horizonte', amount: 4200, due: emDias(2), pago: false, categoria: 'Prestação de serviços', contato: 'Construtora Horizonte' });
criar({ type: 'receita', desc: 'Pedido especial - Padaria Estrela', amount: 3350, due: emDias(6), pago: false, categoria: 'Vendas', contato: 'Padaria Estrela', doc: 'NF 1293' });
criar({ type: 'receita', desc: 'Consultoria - Ana Beatriz', amount: 1800, due: emDias(11), pago: false, categoria: 'Prestação de serviços', contato: 'Ana Beatriz Souza' });
criar({ type: 'receita', desc: 'Vendas balcão', amount: 2900, due: emDias(4), pago: false, categoria: 'Vendas', conta: caixa });
criar({ type: 'despesa', desc: 'Compra de mercadorias', amount: 5600, due: emDias(3), pago: false, categoria: 'Fornecedores', contato: 'Distribuidora Central', doc: 'Boleto 88231' });
criar({ type: 'despesa', desc: 'Energia elétrica', amount: 705, due: emDias(7), pago: false, categoria: 'Água, luz e internet', contato: 'Companhia de Energia' });
criar({ type: 'despesa', desc: 'Honorários contábeis', amount: 750, due: emDias(9), pago: false, categoria: 'Impostos', contato: 'Contabilidade Prisma' });
criar({ type: 'despesa', desc: 'Simples Nacional', amount: 1420, due: emDias(14), pago: false, categoria: 'Impostos' });

// Duas contas atrasadas, para a demonstração mostrar o alerta em vermelho
criar({ type: 'despesa', desc: 'Internet e telefonia', amount: 389.9, due: emDias(-5), pago: false, categoria: 'Água, luz e internet' });
criar({ type: 'receita', desc: 'Fatura em atraso - Padaria Estrela', amount: 1240, due: emDias(-9), pago: false, categoria: 'Vendas', contato: 'Padaria Estrela', doc: 'NF 1265' });

// Compra parcelada em 6x (equipamento)
const grupo = randomUUID();
for (let i = 0; i < 6; i += 1) {
  criar({
    type: 'despesa',
    desc: 'Equipamento novo (balcão refrigerado)',
    amount: 1150,
    due: addMonths(emDias(-6), i),
    pago: i === 0,
    categoria: 'Fornecedores',
    contato: 'Distribuidora Central',
    conta: poupanca,
    parcela: { no: i + 1, total: 6, groupId: grupo },
  });
}

// Próximos meses já previstos
for (let m = 1; m <= 2; m += 1) {
  criar({ type: 'receita', desc: 'Venda mensal - Mercado Bom Preço', amount: 9100, due: dia(m, 5), pago: false, categoria: 'Vendas', contato: 'Mercado Bom Preço Ltda' });
  criar({ type: 'receita', desc: 'Contrato de manutenção - Construtora Horizonte', amount: 4200, due: dia(m, 10), pago: false, categoria: 'Prestação de serviços', contato: 'Construtora Horizonte' });
  criar({ type: 'despesa', desc: 'Aluguel da loja', amount: 3200, due: dia(m, 10), pago: false, categoria: 'Aluguel', contato: 'Imobiliária Praça Nova' });
  criar({ type: 'despesa', desc: 'Folha de pagamento', amount: 4950, due: dia(m, 5), pago: false, categoria: 'Folha de pagamento' });
}

const { total } = db
  .prepare('SELECT COUNT(*) AS total FROM transactions WHERE user_id = ?')
  .get(userId);

console.log(`\n  Base de demonstração criada com ${total} lançamentos.`);
console.log('  ------------------------------------------------');
console.log(`  E-mail: ${DEMO_EMAIL}`);
console.log(`  Senha:  ${DEMO_PASSWORD}\n`);
