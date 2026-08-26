-- ---------------------------------------------------------------------------
-- Esquema do banco de dados (SQLite)
--
-- Todo registro pertence a um usuário (user_id), então vários usuários podem
-- usar a mesma instalação sem enxergar os dados uns dos outros.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Contas bancárias, caixa, carteira, cartão...
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL DEFAULT 'corrente'
                    CHECK (type IN ('corrente','poupanca','caixa','cartao','investimento')),
  bank            TEXT,
  initial_balance REAL    NOT NULL DEFAULT 0,
  color           TEXT    NOT NULL DEFAULT '#22c55e',
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Plano de contas simplificado
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('receita','despesa')),
  color      TEXT    NOT NULL DEFAULT '#4ade80',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name, type)
);

-- Clientes e fornecedores
CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'cliente'
               CHECK (type IN ('cliente','fornecedor','ambos')),
  document   TEXT,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Lançamentos: contas a pagar (despesa) e contas a receber (receita).
-- Um lançamento sem `paid_at` está em aberto; com `paid_at` está quitado.
CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT    NOT NULL CHECK (type IN ('receita','despesa')),
  description       TEXT    NOT NULL,
  amount            REAL    NOT NULL CHECK (amount > 0),
  due_date          TEXT    NOT NULL,           -- YYYY-MM-DD
  paid_at           TEXT,                       -- YYYY-MM-DD (NULL = em aberto)
  paid_amount       REAL,                       -- valor efetivamente pago/recebido
  account_id        INTEGER REFERENCES accounts(id)   ON DELETE SET NULL,
  category_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  contact_id        INTEGER REFERENCES contacts(id)   ON DELETE SET NULL,
  document_number   TEXT,                       -- nº da nota / boleto
  notes             TEXT,
  installment_no    INTEGER,                    -- parcela 2 de 12 -> 2
  installment_total INTEGER,                    -- parcela 2 de 12 -> 12
  group_id          TEXT,                       -- liga parcelas/recorrências
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_user_due   ON transactions (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tx_user_type  ON transactions (user_id, type);
CREATE INDEX IF NOT EXISTS idx_tx_user_paid  ON transactions (user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_tx_group      ON transactions (group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_cats_user     ON categories (user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts (user_id);
