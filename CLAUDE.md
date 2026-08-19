# My Finance — Contexto do Projeto

## O que é

App de controle financeiro pessoal. Existe hoje em vanilla JS + Supabase,
hospedado na Vercel. Está sendo reconstruído: backend próprio + Postgres,
sem Supabase.

## Como eu quero trabalhar (LEIA ISTO PRIMEIRO)

Estou fazendo este projeto **para aprender backend**. Isso muda como você
deve me ajudar:

- **Explique antes de escrever.** Antes de criar um arquivo novo, me diga em
  2-4 frases o que ele vai fazer e por quê. Não peça permissão pra cada
  linha, mas não despeje 400 linhas sem contexto.
- **Uma fase por vez.** O `PLANO.md` tem fases numeradas. Faça só a fase que
  eu pedir. Ao terminar, **pare** e me diga o que fazer para verificar que
  funcionou. Não emende na fase seguinte.
- **Quando houver decisão de arquitetura, me pergunte.** Não escolha por mim
  entre duas abordagens válidas — apresente as duas com o trade-off.
- **Não silencie erro.** Nada de `try/catch` vazio ou fallback que esconde
  falha. Prefiro ver o erro estourar.
- **Se eu escrever algo errado, me corrija.** Não implemente uma ideia ruim
  minha só porque eu pedi. Diga que é ruim e por quê.

## Stack decidida

| Camada | Escolha |
|---|---|
| Banco | PostgreSQL 16 (Docker local em dev, Neon em prod) |
| API | Node 20+ / TypeScript / Fastify |
| Acesso a dados | `pg` com **SQL cru**. Sem ORM. |
| Validação | Zod, em toda entrada de rota |
| Senha | argon2id |
| Sessão | token opaco em cookie httpOnly, tabela `sessions` |
| Front (por ora) | o vanilla JS atual, só trocando a camada de dados |
| Migrations | runner próprio, escrito à mão |

**Não instale um ORM (Prisma, Drizzle, TypeORM).** O objetivo é aprender SQL.
Se em algum momento você achar que um query builder ajudaria, me diga —
mas não instale.

## Regras técnicas invioláveis

1. **Dinheiro é `BIGINT` em centavos.** Nunca float, nunca `number` para
   valores monetários no domínio. Conversão real↔centavos só na borda
   (parsing de entrada e formatação de saída), em funções dedicadas e
   testadas.

2. **`amount_cents` é sempre positivo.** O sinal vem da coluna `kind`
   (`'expense'` | `'income'`). Nunca grave valor negativo.

3. **O `user_id` vem SEMPRE da sessão, nunca do corpo da requisição.**
   Se um payload trouxer `user_id`, ignore. Toda query que toca dados do
   usuário leva `WHERE user_id = $1`. Não existe RLS aqui — a segurança é
   essa cláusula, e esquecê-la é vazamento de dados.

4. **Datas como `DATE` e strings `YYYY-MM-DD`.** Nunca `toISOString()` para
   filtrar mês — isso desloca as bordas por causa do fuso (estou em UTC-3).
   O banco guarda `DATE`, a API trafega `'2026-08-19'`.

5. **Operação multi-linha roda em transação.** Criar 10 parcelas são 10
   linhas: ou entram todas, ou nenhuma. Use `BEGIN`/`COMMIT`/`ROLLBACK`.
   Nunca um `for` com um `INSERT` solto por iteração.

6. **Prefira o banco garantir a regra.** Se dá pra expressar como `CHECK`,
   `UNIQUE` ou `FOREIGN KEY`, é lá que vai — não num `if` no JavaScript.

7. **Nada de `innerHTML` com dado do usuário** no front. `textContent` ou
   `createElement`. O código antigo tem 7 pontos assim; não replique.

8. **Segredos em `.env`**, nunca commitados. Mantenha `.env.example`
   atualizado.

9. **Migrations não têm `BEGIN`/`COMMIT`.** Quem abre, comita e faz
   rollback da transação é o runner (`scripts/migrate.ts`) — nunca o
   arquivo `.sql`. Um `BEGIN` dentro do `.sql` viraria transação aninhada,
   o Postgres ignora com warning, e o `COMMIT` interno commitaria a
   transação externa antes da hora, quebrando o rollback em caso de erro.

10. **`schema_migrations` é do runner, não das migrations.** Nenhum
    `.sql` cria essa tabela nem insere sua própria versão nela — isso
    criaria referência circular (o runner precisa consultar a tabela
    antes mesmo de rodar a migration 001). O runner faz
    `CREATE TABLE IF NOT EXISTS schema_migrations` no boot e, dentro da
    mesma transação de cada migration aplicada, insere a versão (extraída
    do nome do arquivo, ex. `001_initial_schema.sql` →
    `'001_initial_schema'`) — aplicar e registrar são atômicos porque
    Postgres tem DDL transacional. No rollback, é o runner que faz
    `DELETE FROM schema_migrations WHERE version = $1`.

## Modelo de dados — conceitos que não podem ser confundidos

- **`competence_date`** = quando a transação aconteceu.
  **`paid_at`** = quando o dinheiro efetivamente entrou/saiu (NULL = pendente).
  Saldo de conta usa `paid_at`. Resultado do mês usa `competence_date`.

- **`recurring_rules`** guarda a REGRA da despesa fixa (uma linha).
  As ocorrências são geradas sob demanda em `transactions`, com
  `recurring_rule_id` + `occurrence_month`. Um índice único impede duplicata.
  **Nunca gere ocorrência para mês anterior ao `start_month` da regra.**

- **Parcelas** compartilham `series_id`. Editar/excluir "toda a série" busca
  por `series_id`, **nunca por descrição**. O app antigo usava descrição e
  isso quebrava ao renomear.

- **Compra no cartão não sai da conta.** Ela tem `credit_card_id` e
  `card_invoice_id`, com `account_id` NULL. O que sai da conta é o pagamento
  da fatura: uma transação normal com `account_id` e `pays_invoice_id`.

- **Limite disponível** = limite − soma das faturas com status ≠ `'paid'`.
  Pagou a fatura, o limite volta.

## Erros conhecidos do sistema antigo (não repetir)

O `app.js` legado tem estes bugs. Estão documentados aqui para você não
recriá-los ao portar a lógica:

- `processFixedExpenses` materializava despesas fixas ao navegar entre meses,
  inclusive **retroativamente**, corrompendo o histórico.
- Checagem de duplicata sem `user_id` no filtro.
- Séries identificadas por `description`.
- Parcelamento com `valor / n` sem tratar o resto da divisão.
- `closing_day` e `due_day` cadastrados e nunca usados em cálculo.
- Limite do cartão somando todas as compras desde sempre, sem nunca voltar.
- Card de saldo misturando regime de caixa com competência.

## Comandos

```bash
npm run dev            # API em watch mode
npm run migrate        # aplica migrations pendentes
npm run migrate:status # mostra o que já foi aplicado
npm run db:reset       # derruba e recria o banco local (dev apenas)
npm test               # testes
```

## Estilo de código

- TypeScript `strict: true`. Sem `any` — se precisar, comente o porquê.
- SQL em template literals multi-linha, keywords em MAIÚSCULA, sempre
  parametrizado com `$1, $2`. **Nunca concatene valor em string de SQL.**
- Nomes de rota e coluna em `snake_case`; variáveis TS em `camelCase`.
  A conversão acontece na camada de repositório.
- Comentário explica *por quê*, não *o quê*.
- **Todo arquivo em LF e UTF-8 sem BOM.** Garantido por `.gitattributes`
  (`* text=auto eol=lf`) + `core.autocrlf false` neste repo. Se um arquivo
  aparecer com CR no meio (`git diff` mostrando a linha inteira como
  alterada, ou checksum de migration batendo errado só no Windows), o
  arquivo não foi reescrito a partir do blob normalizado — resolva com
  `git checkout HEAD -- <arquivo>` (às vezes precisa apagar o arquivo
  antes: `rm <arquivo> && git checkout HEAD -- <arquivo>`, porque o
  checkout comum pode pular arquivos que o git já considera "iguais").
- **Checksum de migration é calculado sobre conteúdo normalizado**, não
  sobre os bytes crus do arquivo (`scripts/migrate.ts`, `normalizeForChecksum`):
  remove BOM e converte `\r\n`/`\r` para `\n` antes do SHA-256. Isso separa
  duas coisas que pareciam a mesma: "o arquivo mudou de verdade" vs. "o
  arquivo tem final de linha diferente". Só a primeira deve travar o
  runner.
- **Nunca crie ou edite arquivo de código por redirecionamento no
  PowerShell** (`echo`, `Add-Content`, `>`, `>>`, here-string sem
  `-Encoding utf8`). Por padrão eles gravam em UTF-16 ou na codepage do
  sistema, corrompendo o arquivo — já aconteceu neste projeto e custou uma
  hora de investigação. Use o editor/ferramenta de escrita de arquivo.
