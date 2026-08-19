-- =============================================================================
-- My Finance — Semântica de pagamento de fatura
--
-- Migration: 002_invoice_payment_semantics
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner
-- (scripts/migrate.ts). Ver CLAUDE.md, regras 9 e 10.
--
-- Duas lacunas encontradas no playground (db/playground.sql):
--
--   1. Pagamento de fatura é TRANSFERÊNCIA, não despesa nova. A compra já
--      contou como despesa no mês da compra (via card_invoice_id); se o
--      pagamento da fatura também entrar numa soma de despesas do mês,
--      o mesmo dinheiro é contado duas vezes. `monthly_summary` agrega
--      por competência excluindo `pays_invoice_id IS NOT NULL`.
--
--   2. Compra no cartão não tem "pago" individual — quem é paga é a
--      fatura inteira (`card_invoices.status`/`paid_at`). Uma transação
--      de compra no cartão com `paid_at` preenchido é um estado que não
--      deveria existir.
-- =============================================================================


-- =============================================================================
-- 1. COMPRA NO CARTÃO NÃO TEM PAID_AT PRÓPRIO
-- =============================================================================

ALTER TABLE transactions
    ADD CONSTRAINT tx_card_has_no_paid_at
    CHECK (credit_card_id IS NULL OR paid_at IS NULL);


-- =============================================================================
-- 2. RESUMO MENSAL POR COMPETÊNCIA, SEM CONTAR PAGAMENTO DE FATURA
-- Toda agregação de despesa/receita do projeto deve usar esta view ou
-- repetir o filtro `pays_invoice_id IS NULL` — nunca somar transactions
-- por competência sem excluir pagamentos de fatura.
-- =============================================================================

CREATE VIEW monthly_summary AS
SELECT
    t.user_id,
    date_trunc('month', t.competence_date)::DATE AS month,
    t.kind,
    SUM(t.amount_cents) AS total_cents,
    COUNT(*) FILTER (WHERE t.paid_at IS NULL) AS pending_count
FROM transactions t
WHERE t.pays_invoice_id IS NULL
GROUP BY t.user_id, date_trunc('month', t.competence_date)::DATE, t.kind;
