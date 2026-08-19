-- =============================================================================
-- My Finance — Rollback da semântica de pagamento de fatura
--
-- Migration: 002_invoice_payment_semantics (down)
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner.
-- =============================================================================

DROP VIEW IF EXISTS monthly_summary;

ALTER TABLE transactions
    DROP CONSTRAINT IF EXISTS tx_card_has_no_paid_at;
