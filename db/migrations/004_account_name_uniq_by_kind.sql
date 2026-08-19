-- =============================================================================
-- My Finance — Nome de conta é único por (usuário, kind), não só por usuário
--
-- Migration: 004_account_name_uniq_by_kind
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner.
--
-- accounts_user_name_uniq (migration 001) era (user_id, lower(name)),
-- ignorando `kind`. Isso proibia coisas legítimas: uma conta corrente
-- "BB" e um investimento "BB" são entidades diferentes (o banco e a
-- aplicação de investimento têm o mesmo apelido, mas não são a mesma
-- conta) — a importação do dump antigo (Fase 2) esbarrou nisso de
-- verdade com o usuário 10a456a4.
-- =============================================================================

DROP INDEX accounts_user_name_uniq;

CREATE UNIQUE INDEX accounts_user_name_uniq
    ON accounts (user_id, lower(name), kind)
    WHERE archived_at IS NULL;
