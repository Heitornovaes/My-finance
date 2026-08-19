-- =============================================================================
-- My Finance — Vencimento de fatura pode cair em qualquer dia do mês
--
-- Migration: 003_relax_due_day
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner.
--
-- closing_day continua limitado a 1-28: é ele que decide o MÊS da fatura
-- (card_invoice_month), e um fechamento em dia que não existe em todo mês
-- mudaria de mês sozinho, o que não faz sentido.
--
-- due_day é só uma data de vencimento DENTRO do mês da fatura já decidido.
-- Cartão real pode vencer dia 30 (ex.: XP do dump antigo). Se o mês da
-- fatura não tiver esse dia (30 em fevereiro), quem calcula due_date usa
-- o último dia do mês — isso é responsabilidade de quem monta a fatura
-- (script de importação, e depois a rota de faturas), não do CHECK aqui.
-- =============================================================================

ALTER TABLE credit_cards
    DROP CONSTRAINT cards_due_day_valid;

ALTER TABLE credit_cards
    ADD CONSTRAINT cards_due_day_valid CHECK (due_day BETWEEN 1 AND 31);
