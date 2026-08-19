-- =============================================================================
-- My Finance — Rollback: due_day volta a 1-28
--
-- Migration: 003_relax_due_day (down)
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner.
-- =============================================================================

ALTER TABLE credit_cards
    DROP CONSTRAINT cards_due_day_valid;

ALTER TABLE credit_cards
    ADD CONSTRAINT cards_due_day_valid CHECK (due_day BETWEEN 1 AND 28);
