# My Finance

App de controle financeiro pessoal. Hoje roda em vanilla JS + Supabase; está
sendo reconstruído com backend próprio (Node/TypeScript/Fastify) e
PostgreSQL, sem Supabase e sem ORM.

Contexto completo do projeto e decisões de arquitetura: ver `CLAUDE.md`.
Roteiro de implementação por fases: ver `PLANO.md`.

## Estrutura

```
/
├── db/           # migrations e seeds do Postgres
├── api/          # backend (Node/TS/Fastify)
├── web/          # front-end (vanilla JS, por ora)
└── scripts/      # scripts utilitários (migração de dados, etc.)
```

## Stack

| Camada | Escolha |
|---|---|
| Banco | PostgreSQL 16 (Docker local em dev, Neon em prod) |
| API | Node 20+ / TypeScript / Fastify |
| Acesso a dados | `pg` com SQL cru (sem ORM) |
| Validação | Zod |
| Senha | argon2id |
| Sessão | token opaco em cookie httpOnly |
| Front | vanilla JS |
| Migrations | runner próprio |

## Como rodar em dev

Ainda em construção (fases 1 e 3 do `PLANO.md`). Quando prontos:

```bash
npm run dev            # API em watch mode
npm run migrate        # aplica migrations pendentes
npm run migrate:status  # mostra o que já foi aplicado
npm run db:reset        # derruba e recria o banco local (dev apenas)
npm test                # testes
```
