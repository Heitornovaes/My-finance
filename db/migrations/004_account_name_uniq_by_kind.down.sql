-- =============================================================================
-- My Finance — Rollback: nome de conta volta a ser único só por usuário
--
-- Migration: 004_account_name_uniq_by_kind (down)
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner.
-- =============================================================================

DROP INDEX accounts_user_name_uniq;

CREATE UNIQUE INDEX accounts_user_name_uniq
    ON accounts (user_id, lower(name))
    WHERE archived_at IS NULL;
