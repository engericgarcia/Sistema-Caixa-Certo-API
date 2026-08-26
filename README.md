<h1 align="center">💚 Caixa Certo — API</h1>

<p align="center">
  API REST do <strong>Caixa Certo</strong>: contas a pagar, contas a receber,
  fluxo de caixa, DRE e relatórios.<br>
  Node.js, Express e SQLite.
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-2a9557?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-4-63cf8a?style=flat-square&logo=express&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-3-96e3b0?style=flat-square&logo=sqlite&logoColor=white">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-1f5d3b?style=flat-square">
</p>

<p align="center">
  👉 <strong>Interface do sistema:</strong>
  <a href="https://github.com/engericgarcia/caixa-certo-web">engericgarcia/caixa-certo-web</a>
</p>

---

## O que a API faz

- **Autenticação** multiusuário com JWT e senhas protegidas por bcrypt — cada usuário
  só enxerga os próprios dados
- **Lançamentos** de receita e despesa com vencimento, baixa, estorno, parcelamento
  (divide o valor) e recorrência (repete o valor)
- **Cadastros** de contas bancárias com saldo calculado, categorias e clientes/fornecedores
- **Relatórios** de fluxo de caixa, DRE simplificado e composição por categoria, em
  regime de caixa ou de competência
- **Exportação** dos lançamentos filtrados em CSV

## Tecnologias

[Express](https://expressjs.com) · [SQLite](https://www.sqlite.org) via
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (banco em arquivo, sem
servidor para instalar) · [JWT](https://github.com/auth0/node-jsonwebtoken) ·
[bcryptjs](https://github.com/dcodeIO/bcrypt.js) · [Zod](https://zod.dev) para validação

---

## Como rodar

**Pré-requisito:** [Node.js 18.18 ou superior](https://nodejs.org).

```bash
git clone https://github.com/engericgarcia/caixa-certo-api.git
cd caixa-certo-api

npm install
cp .env.example .env

npm run seed   # opcional: cria dados de demonstração
npm run dev
```

A API sobe em **http://localhost:4000**. Para conferir: <http://localhost:4000/api/health>

> **Conta de demonstração** (criada pelo `npm run seed`)
> **E-mail:** `demo@caixacerto.app` · **Senha:** `demo1234`

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe a API com recarregamento automático |
| `npm start` | Sobe a API em modo produção |
| `npm run seed` | Cria/recria o usuário de demonstração com alguns meses de lançamentos |
| `npm run reset` | ⚠️ Apaga **todos** os dados e recria apenas a demonstração |

### Variáveis de ambiente

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PORT` | `4000` | Porta da API |
| `JWT_SECRET` | — | Chave que assina os tokens. **Troque em produção** |
| `JWT_EXPIRES_IN` | `7d` | Validade do token |
| `DATABASE_FILE` | `data/financeiro.sqlite` | Caminho do arquivo do banco |
| `CORS_ORIGIN` | `http://localhost:5173` | Origens autorizadas, separadas por vírgula |

> O `CORS_ORIGIN` é o que libera o frontend a chamar a API. Em produção ele precisa
> conter a URL exata do site (ex.: `https://caixa-certo.vercel.app`), sem barra no final.

---

## Endpoints

Todas as rotas, exceto `/api/auth/register`, `/api/auth/login` e `/api/health`,
exigem o cabeçalho `Authorization: Bearer <token>`.

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Cria a conta e devolve o token |
| `POST` | `/api/auth/login` | Autentica e devolve o token |
| `GET` | `/api/auth/me` | Dados do usuário logado |
| `PUT` | `/api/auth/me` · `/api/auth/me/password` | Atualiza perfil / troca a senha |
| `GET` | `/api/dashboard?month=AAAA-MM` | Todos os números do painel em uma chamada |
| `GET` `POST` | `/api/transactions` | Lista (com filtros e paginação) e cria lançamentos |
| `PUT` `DELETE` | `/api/transactions/:id` | Edita e exclui (`?scope=group` remove as parcelas em aberto) |
| `POST` | `/api/transactions/:id/pay` · `/unpay` | Dá baixa e estorna |
| `GET` `POST` `PUT` `DELETE` | `/api/accounts` · `/api/categories` · `/api/contacts` | CRUD dos cadastros |
| `GET` | `/api/reports/cashflow` · `/dre` · `/by-category` · `/export.csv` | Relatórios e exportação |

<details>
<summary>Exemplo: login e criação de uma conta a pagar em 3 parcelas</summary>

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@caixacerto.app","password":"demo1234"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -X POST http://localhost:4000/api/transactions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "despesa",
    "description": "Equipamento novo",
    "amount": 3000,
    "dueDate": "2026-09-10",
    "repeatMode": "parcelada",
    "repeatCount": 3
  }'
```

</details>

<details>
<summary>Filtros aceitos na listagem de lançamentos</summary>

`type` (`receita`/`despesa`) · `status` (`em_aberto`, `pendente`, `atrasado`, `pago`) ·
`from` · `to` · `categoryId` · `contactId` · `accountId` · `search` ·
`sort` (`due_date`, `amount`, `description`, `created_at`) · `order` · `page` · `pageSize`

</details>

---

## Deploy

⚠️ **Não use Vercel, Netlify ou funções serverless.** O banco é um arquivo, e nessas
plataformas o sistema de arquivos é temporário: os dados somem a cada deploy e não são
compartilhados entre instâncias.

Use uma plataforma com **disco persistente** (Railway, Fly.io, Render com disco):

| Configuração | Valor |
| --- | --- |
| Build | `npm install` |
| Start | `npm start` |
| Disco | Montado em `data/` (mesmo caminho do `DATABASE_FILE`) |
| Variáveis | `JWT_SECRET`, `CORS_ORIGIN` com a URL do frontend |

Se preferir um banco gerenciado, o SQL é padrão SQLite e migra bem para
[Turso](https://turso.tech) — mas aí o driver passa a ser assíncrono e as rotas
precisam ser adaptadas.

---

## Estrutura

```
caixa-certo-api/
├── .env.example
└── src/
    ├── index.js           # ponto de entrada, CORS e registro das rotas
    ├── config.js          # leitura das variáveis de ambiente
    ├── db/
    │   ├── schema.sql     # tabelas do banco
    │   ├── database.js    # conexão e migração automática
    │   ├── defaults.js    # categorias padrão de cada usuário novo
    │   └── seed.js        # dados de demonstração
    ├── middleware/        # autenticação JWT e tratamento de erros
    ├── routes/            # auth, accounts, categories, contacts,
    │                      # transactions, dashboard, reports
    └── utils/             # datas, dinheiro e helpers de HTTP
```

## Decisões de projeto

- **Situação calculada, nunca gravada.** Um lançamento não guarda o status "atrasado";
  ele é derivado na consulta comparando o vencimento com a data de hoje, então a
  informação nunca fica velha no banco.
- **Saldo = só o que aconteceu.** O saldo das contas considera apenas lançamentos
  quitados; o que está em aberto aparece como previsão nos relatórios.
- **Regime de caixa x competência.** Os relatórios alternam entre a data de pagamento
  e a data de vencimento, como em um sistema contábil de verdade.
- **Parcelas sem centavo perdido.** Ao dividir R$ 100 em 3, gera 33,34 + 33,33 + 33,33 —
  a diferença do arredondamento vai para a primeira parcela.
- **Isolamento por usuário.** Toda consulta filtra por `user_id`; nenhuma rota devolve
  dados de outra conta.

> **Nota:** os valores são gravados como `REAL` e arredondados em 2 casas a cada
> escrita. Em produção o ideal seria guardar centavos em `INTEGER` — fica registrado
> como próximo passo consciente.

## Licença

[MIT](LICENSE).
