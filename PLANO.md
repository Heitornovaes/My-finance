# Plano de Reconstrução — My Finance

Roteiro em fases. **Execute apenas a fase que eu pedir explicitamente.**
Ao concluir uma fase, pare, resuma o que foi feito e me diga como verificar.

Estrutura alvo do repositório:

```
/
├── CLAUDE.md
├── PLANO.md
├── db/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 001_initial_schema.down.sql
│   └── seeds/
├── api/
│   ├── src/
│   │   ├── config/        # env, conexão com o banco
│   │   ├── modules/       # um diretório por domínio
│   │   ├── shared/        # erros, money, datas, middlewares
│   │   └── server.ts
│   └── package.json
├── web/                   # front atual, movido para cá
└── scripts/
    └── import-supabase.ts
```

---

## Fase 0 — Reconhecimento e reorganização

**Objetivo:** entender o que existe e preparar o terreno. Nenhuma lógica nova.

1. Leia `web/app.js` (ou `app.js` na raiz) por inteiro e me entregue um mapa:
   quais funções existem, o que cada grupo faz, quais tocam o banco.
2. Liste toda operação de banco encontrada (tabela + tipo de operação).
   Isso vira a checklist de endpoints que a API precisa ter.
3. Mova o front atual para `web/`. Não altere o código dele ainda.
4. Crie a estrutura de pastas acima (vazia, com `.gitkeep` onde precisar).
5. Crie `.gitignore` (node_modules, .env, dist, *.log).
6. Crie `README.md` com: o que é o projeto, como rodar em dev, stack.

**Pare.** Me mostre o mapa antes de seguir.

---

## Fase 1 — Banco local e migrations

**Objetivo:** ter o schema rodando e um runner de migrations que eu entenda.

1. `docker-compose.yml` com Postgres 16, volume nomeado, porta 5432.
2. Coloque o schema que já escrevi em `db/migrations/001_initial_schema.sql`.
   Leia ele inteiro antes. Se encontrar erro ou inconsistência, **me avise
   em vez de corrigir sozinho.**
3. Escreva o runner de migrations em `scripts/migrate.ts`. Requisitos:
   - lê `db/migrations/*.sql` em ordem alfabética
   - compara com a tabela `schema_migrations`
   - aplica só as pendentes, **cada uma dentro de uma transação**
   - se uma falhar, faz rollback dela e para (não continua nas seguintes)
   - suporta `--status` para listar aplicadas e pendentes
   - **mantenha simples e comentado** — quero conseguir ler e entender
4. Scripts no `package.json`: `migrate`, `migrate:status`, `db:reset`.

**Pare.** Vou rodar e brincar no `psql` tentando violar as constraints.

---

## Fase 2 — Importação dos dados do Supabase

**Objetivo:** trazer meu histórico real para o schema novo.

Tenho um dump do Supabase (vou colocar em `db/dump/`). O schema antigo é
diferente do novo, então isto é uma tradução, não uma cópia.

**Pré-requisitos levantados no mapeamento do `app.js` (Fase 0) — resolver
antes ou durante o relatório do passo 1, não durante a escrita do script:**

- `accounts.name` de investimento guarda o tipo antes do `|`
  (`"Renda Fixa | Nubank"`). Fazer `split('|')` na importação e gravar em
  `investment_kind`, não deixar o tipo embutido no nome.
- O saldo real do investimento **não** está em `accounts.initial_balance`
  — vive em `asset_history` (o app antigo edita só o histórico de
  propósito, pra não quebrar a série mensal). Importar saldo de
  investimento a partir de `asset_history`, nunca de `initial_balance`.
- `goals` não tem mês (é uma meta única por categoria); o schema novo tem
  `reference_month` em `budgets`. **Antes de escrever o script, me
  pergunte qual estratégia usar** (ex.: aplicar a meta atual a todos os
  meses futuros? Só ao mês corrente? Duplicar por competência existente?).
- Parcelas não têm `series_id` no schema antigo — o único vínculo é o
  sufixo `"(x/y)"` na `description`. Reconstruir a série via parsing desse
  sufixo (mesma descrição-base + mesmo valor total implícito) e
  **reportar no log os casos ambíguos** (sufixo ausente, quebrado, ou
  descrição-base colidindo com outra série).

1. Leia o dump e me mostre um relatório **antes de escrever o script**:
   quantas linhas por tabela, quais campos existem, quais transações têm
   `is_fixed = true`, e quais parecem ter sido geradas retroativamente pelo
   bug do `processFixedExpenses`.
2. Só depois escreva `scripts/import-supabase.ts`. Ele precisa:
   - converter valores float para centavos com arredondamento explícito
   - agrupar despesas fixas em `recurring_rules`, deduzindo `start_month`
     da ocorrência mais antiga legítima
   - agrupar parcelas em séries, atribuindo `series_id`
   - criar as `card_invoices` retroativas usando `card_invoice_month()`
   - rodar tudo em **uma transação**, com `--dry-run` que só relata
   - gerar um log do que foi convertido, ignorado e por quê
3. Ao final, um relatório de conferência: total de receitas e despesas por
   mês, antes e depois. Os números têm que bater — se não baterem, quero
   saber exatamente onde divergiu.

**Pare.** Esta fase mexe no meu histórico real; quero revisar com calma.

---

## Fase 3 — Esqueleto da API

**Objetivo:** servidor de pé, com as fundações certas. Ainda sem regra de negócio.

1. `api/` com TypeScript strict, Fastify, `pg`, Zod, tsx para dev.
2. `config/env.ts` — validação das variáveis de ambiente com Zod, falhando
   no boot se faltar alguma. `.env.example` junto.
3. `config/db.ts` — pool de conexões + um helper `withTransaction(fn)` que
   pega client, abre transação, commita ou dá rollback, e sempre libera.
4. `shared/errors.ts` — classes de erro do domínio (`NotFoundError`,
   `ValidationError`, `ConflictError`, `UnauthorizedError`) e um error
   handler global que traduz para status HTTP. **Erro de constraint do
   Postgres (23505, 23514) deve virar mensagem legível, não 500.**
5. `shared/money.ts` — `parseMoneyToCents()` e `formatCentsToBRL()`, com
   testes cobrindo `"1.234,56"`, `"1234.56"`, `0`, valores negativos e lixo.
6. `shared/dates.ts` — helpers de mês (`monthStart`, `monthEnd`,
   `toISODate`), **sem usar `toISOString()`**.
7. Rota `GET /health` que testa o banco de verdade (`SELECT 1`).
8. Logger estruturado (pino) e CORS configurado.

**Pare.** Quero entender o `withTransaction` antes de seguir.

---

## Fase 4 — Autenticação

**Objetivo:** substituir o Supabase Auth. Fase sensível — vá devevagar e explique.

1. `POST /auth/register` — Zod (email válido, senha mínima 8), hash argon2id,
   409 se email duplicado.
2. `POST /auth/login` — verifica hash, cria sessão, retorna cookie httpOnly
   + secure + sameSite lax. **Grave o hash do token na tabela, não o token.**
   Resposta idêntica para email inexistente e senha errada (não revele qual).
3. `POST /auth/logout` — marca `revoked_at`.
4. `GET /auth/me` — dados do usuário logado.
5. Middleware `requireAuth` que lê o cookie, valida sessão não expirada nem
   revogada, e injeta `request.userId`.
6. Rate limit no login (`@fastify/rate-limit`).

**Antes de escrever, me explique:** por que token opaco em cookie httpOnly e
não JWT no localStorage. Quero entender a decisão, não só aceitar.

**Pare.**

---

## Fase 5 — CRUD das entidades simples

**Objetivo:** contas, categorias e cartões. É aqui que o padrão de código
do projeto se estabelece.

1. Comece **só por `accounts`**, completo: rotas, validação Zod, repositório
   com SQL cru, mapeamento snake_case↔camelCase, testes.
2. **Pare e me mostre.** Vamos ajustar o padrão juntos antes de replicar.
3. Depois de aprovado, replique para `categories` e `credit_cards`.
4. `GET /accounts` deve usar a view `account_balances` — não calcule saldo
   em JavaScript.
5. Arquivar (`archived_at`) em vez de deletar, sempre.

---

## Fase 6 — Transações e as regras de negócio

**Objetivo:** o coração. É onde os bugs antigos moravam. Uma sub-etapa por vez.

**6a — CRUD básico de transação.** Criar, listar por mês, editar, excluir,
alternar pago/pendente. Filtro por mês usando `competence_date` e strings
`YYYY-MM-DD`.

**6b — Parcelamento.** `POST /transactions` com `installments: n` cria n
linhas com o mesmo `series_id`, **em uma transação**. A divisão precisa
fechar exatamente: `Math.floor(total/n)` em todas, e a última recebe o
resto. Teste obrigatório: `10000` centavos em 3x deve somar `10000`.

**6c — Recorrências.** CRUD de `recurring_rules` + endpoint que materializa
as ocorrências de um mês. Regras:
- nunca gerar antes de `start_month` nem depois de `end_month`
- nunca gerar para mês passado que ainda não foi materializado
- confiar no índice único para evitar duplicata (`ON CONFLICT DO NOTHING`)
- editar a regra **não** reescreve ocorrências já materializadas; ofereça
  isso como ação explícita separada

**6d — Faturas de cartão.** Criação automática da fatura ao lançar compra,
usando `card_invoice_month()`. Fechamento de fatura. `POST /invoices/:id/pay`
que cria a transação de pagamento na conta escolhida, vincula por
`pays_invoice_id` e marca a fatura como `paid` — tudo numa transação.

**6e — Séries.** Editar/excluir com escopo `'one' | 'forward' | 'all'`,
sempre por `series_id`.

**Pare ao fim de cada sub-etapa.**

---

## Fase 7 — Front conectado à API nova

**Objetivo:** trocar a camada de dados sem redesenhar nada ainda.

1. `web/src/api.ts` — um client com `fetch`, `credentials: 'include'`,
   tratamento de 401 (redireciona pro login) e erros tipados.
2. Substitua todas as chamadas `supabaseClient.*` por chamadas ao client.
3. Remova o SDK do Supabase e as chaves do HTML.
4. Quebre o `app.js` monolítico em módulos ES por domínio.
5. Corrija os bugs pontuais já mapeados: `removeCat(${c.id})` sem aspas,
   `prepareEditInv` com nome contendo apóstrofo, `accs.length` sem null-check,
   `toggleTheme` disparando refetch, `alert`/`confirm` restantes.
6. Substitua todo `innerHTML +=` por criação de nós.
7. **Os 49 `onclick="..."` inline no `index.html` dependem de funções
   penduradas em `window.*`.** Quebrar `app.js` em módulos ES (item 4) faz
   esses handlers pararem de existir no escopo global — trocar todos por
   `addEventListener` nos elementos, atribuído depois da renderização.
   Não é opcional nem incidental: sem isso a UI inteira para de responder
   a clique.

**Pare.** A partir daqui o app já funciona sem Supabase.

---

## Fase 8 — Design

**Objetivo:** resolver a causa raiz, não pintar por cima.

1. **Remova os 106 atributos `style=""` inline do HTML** e as cores
   hardcoded dentro do JS. Enquanto eles existirem, tema não funciona.
2. Sistema de tokens em CSS custom properties: escala tipográfica de 6
   tamanhos, escala de espaçamento, 4 níveis de cinza, cores semânticas
   (`--surface`, `--surface-raised`, `--border`, `--text-primary`,
   `--text-secondary`, `--text-muted`, `--positive`, `--negative`).
3. Dark mode só por troca de tokens em `[data-theme="dark"]`.
   **Zero `!important`** — se precisar de um, o token está faltando.
4. Componentes CSS reutilizáveis (card, botão, input, badge, tabela) em
   vez de estilo por tela.
5. Empty states desenhados de verdade, com ação sugerida.
6. Estados de loading (skeleton) e de erro em cada tela.
7. Acessibilidade: `aria-label` nos botões de ícone, foco visível,
   contraste mínimo 4.5:1, navegação por teclado nos modais.
8. Responsivo revisado — hoje só existem dois breakpoints.

**Antes de codar, me proponha a paleta e a escala tipográfica** e espere
minha aprovação.

---

## Fase 9 — Testes e deploy

1. Testes de integração das regras críticas: parcelamento fecha a soma,
   recorrência não duplica, fatura paga devolve limite, saldo bate,
   usuário A não lê dado do usuário B.
2. GitHub Actions: lint, typecheck, testes, migrations num Postgres de CI.
3. Banco no Neon, API no Render/Railway, front na Vercel.
4. Backup automático (`pg_dump` agendado) — não repetir a lição do projeto
   pausado.

---

## Fora de escopo por enquanto

Não faça, mesmo que pareça boa ideia:

- Migrar o front para React (fase futura, decisão minha)
- Instalar ORM ou query builder
- Multiusuário/compartilhamento, importação OFX, app mobile, PWA
- Docker para a API (só o banco por ora)
- Refatorações amplas não pedidas: se notar algo, **anote e me conte**,
  não corrija por conta própria
