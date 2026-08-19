-- =============================================================================
-- PLAYGROUND — Fase 1
--
-- Rode com:
--   docker exec -i my-finance-main-db-1 psql -U myfinance -d myfinance < db/playground.sql
--
-- Ou, melhor, abra o psql e vá colando bloco por bloco pra ler cada erro:
--   docker exec -it my-finance-main-db-1 psql -U myfinance -d myfinance
--
-- A PARTE 2 é feita de comandos que DEVEM FALHAR. Ver o erro é o exercício.
-- Leia o nome da constraint em cada mensagem — é ele que diz qual regra
-- do seu modelo de dados acabou de te proteger.
-- =============================================================================


-- =============================================================================
-- PARTE 1 — Dados de apoio (tudo aqui deve funcionar)
-- =============================================================================

INSERT INTO users (id, email, password_hash, display_name) VALUES
    ('11111111-1111-1111-1111-111111111111',
     'teste@exemplo.com',
     '$argon2id$hash-falso-so-pra-teste',
     'Heitor');

INSERT INTO accounts (id, user_id, name, kind, initial_balance_cents) VALUES
    ('22222222-2222-2222-2222-222222222222',
     '11111111-1111-1111-1111-111111111111',
     'Nubank', 'checking', 100000);          -- R$ 1.000,00

INSERT INTO credit_cards (id, user_id, name, limit_cents, closing_day, due_day) VALUES
    ('33333333-3333-3333-3333-333333333333',
     '11111111-1111-1111-1111-111111111111',
     'Nubank Cartão', 500000, 25, 5);        -- limite R$ 5.000,00

INSERT INTO card_invoices
    (id, user_id, credit_card_id, reference_month, closing_date, due_date, status)
VALUES
    ('44444444-4444-4444-4444-444444444444',
     '11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333',
     '2026-09-01', '2026-08-25', '2026-09-05', 'open');


-- =============================================================================
-- PARTE 2 — VIOLAÇÕES
-- Cada bloco abaixo deve dar ERRO. Leia o nome da constraint.
-- =============================================================================

-- (1) Valor negativo. O sinal vem de `kind`, nunca do valor.
--     Espera: tx_amount_positive
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Valor negativo', -5000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222');


-- (2) Conta E cartão ao mesmo tempo. Uma despesa tem UMA origem.
--     Espera: tx_one_source
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date,
     account_id, credit_card_id, card_invoice_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Origem dupla', 5000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222',
     '33333333-3333-3333-3333-333333333333',
     '44444444-4444-4444-4444-444444444444');


-- (3) Nenhuma origem. Dinheiro não sai do nada.
--     Espera: tx_one_source
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Sem origem', 5000, '2026-08-10');


-- (4) Compra no cartão sem fatura. Toda compra pertence a alguma fatura.
--     Espera: tx_invoice_consistency
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, credit_card_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Cartão sem fatura', 5000, '2026-08-10',
     '33333333-3333-3333-3333-333333333333');


-- (5) Parcela 5 de 3.
--     Espera: tx_installment_consistency
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id,
     series_id, installment_number, installments_total)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Parcela impossível', 5000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222',
     gen_random_uuid(), 5, 3);


-- (6) Série pela metade: series_id sem os campos de parcela.
--     Espera: tx_installment_consistency
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id, series_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Série incompleta', 5000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222', gen_random_uuid());


-- (7) Cartão fechando dia 31. Nem todo mês tem dia 31.
--     Espera: cards_closing_day_valid
INSERT INTO credit_cards (user_id, name, limit_cents, closing_day, due_day)
VALUES ('11111111-1111-1111-1111-111111111111', 'Cartão Dia 31', 100000, 31, 10);


-- (8) Conta corrente com tipo de investimento preenchido.
--     Espera: accounts_investment_kind_valid
INSERT INTO accounts (user_id, name, kind, investment_kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'Confusa', 'checking', 'crypto');


-- (9) Nome de conta repetido para o mesmo usuário.
--     Espera: accounts_user_name_uniq  (repare: "nubank" minúsculo também bate)
INSERT INTO accounts (user_id, name, kind)
VALUES ('11111111-1111-1111-1111-111111111111', 'nubank', 'cash');


-- (10) Fatura com reference_month que não é dia 1.
--      Espera: invoices_month_is_first_day
INSERT INTO card_invoices
    (user_id, credit_card_id, reference_month, closing_date, due_date)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333',
     '2026-10-15', '2026-09-25', '2026-10-05');


-- (11) Fatura duplicada: mesmo cartão, mesmo mês.
--      Espera: invoices_card_month_uniq
INSERT INTO card_invoices
    (user_id, credit_card_id, reference_month, closing_date, due_date)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     '33333333-3333-3333-3333-333333333333',
     '2026-09-01', '2026-08-25', '2026-09-05');


-- (12) Fatura marcada como paga sem data de pagamento.
--      Espera: invoices_paid_consistency
UPDATE card_invoices SET status = 'paid'
WHERE id = '44444444-4444-4444-4444-444444444444';


-- (13) E-mail inválido.
--      Espera: users_email_format
INSERT INTO users (email, password_hash) VALUES ('nao-e-email', 'x');


-- (14) Orçamento com limite zero.
--      Espera: budgets_limit_positive
INSERT INTO budgets (user_id, category_id, reference_month, limit_cents)
VALUES ('11111111-1111-1111-1111-111111111111',
        (SELECT id FROM categories WHERE name = 'Mercado' AND user_id IS NULL),
        '2026-08-01', 0);


-- =============================================================================
-- PARTE 3 — A duplicata de despesa fixa
-- O bug número 1 do sistema antigo, agora impossível.
-- =============================================================================

-- Cria a regra: aluguel, todo dia 10, começando em agosto/2026.
INSERT INTO recurring_rules
    (id, user_id, description, kind, amount_cents, day_of_month, start_month, account_id)
VALUES
    ('55555555-5555-5555-5555-555555555555',
     '11111111-1111-1111-1111-111111111111',
     'Aluguel', 'expense', 180000, 10, '2026-08-01',
     '22222222-2222-2222-2222-222222222222');

-- Materializa a ocorrência de agosto. FUNCIONA.
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id,
     recurring_rule_id, occurrence_month)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Aluguel', 180000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222',
     '55555555-5555-5555-5555-555555555555', '2026-08-01');

-- Tenta materializar de novo — simulando o processFixedExpenses rodando
-- duas vezes, ou duas abas abertas, ou uma request repetida.
-- Espera: tx_rule_occurrence_uniq
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id,
     recurring_rule_id, occurrence_month)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Aluguel', 180000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222',
     '55555555-5555-5555-5555-555555555555', '2026-08-01');

-- E é assim que a API vai fazer, sem precisar de nenhum IF:
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, account_id,
     recurring_rule_id, occurrence_month)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Aluguel', 180000, '2026-08-10',
     '22222222-2222-2222-2222-222222222222',
     '55555555-5555-5555-5555-555555555555', '2026-08-01')
ON CONFLICT DO NOTHING;
-- INSERT 0 0 — não inseriu, não deu erro. Idempotente.


-- =============================================================================
-- PARTE 4 — Parcelamento que fecha a conta
-- R$ 100,00 em 3x. 10000 / 3 = 3333,33...
-- Duas parcelas de 3333 e uma de 3334. Soma exata.
-- =============================================================================

INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date,
     credit_card_id, card_invoice_id, series_id, installment_number, installments_total)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'expense', 'Tênis', 3333, '2026-08-20',
     '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     '66666666-6666-6666-6666-666666666666', 1, 3),
    ('11111111-1111-1111-1111-111111111111', 'expense', 'Tênis', 3333, '2026-09-20',
     '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     '66666666-6666-6666-6666-666666666666', 2, 3),
    ('11111111-1111-1111-1111-111111111111', 'expense', 'Tênis', 3334, '2026-10-20',
     '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
     '66666666-6666-6666-6666-666666666666', 3, 3);

-- Confere: tem que dar exatamente 10000.
SELECT SUM(amount_cents) AS total_parcelas
FROM transactions
WHERE series_id = '66666666-6666-6666-6666-666666666666';

-- Repare que as três compartilham series_id. Editar "toda a série" agora é
-- WHERE series_id = $1. Renomear "Tênis" para outra coisa não quebra nada.


-- =============================================================================
-- PARTE 5 — A fatura, o limite e o saldo
-- O bug do limite que nunca voltava.
-- =============================================================================

-- Qual fatura recebe cada compra? (fechamento dia 25)
SELECT
    card_invoice_month('2026-08-24', 25) AS compra_dia_24,   -- 2026-08-01
    card_invoice_month('2026-08-25', 25) AS compra_dia_25,   -- 2026-09-01
    card_invoice_month('2026-08-31', 25) AS compra_dia_31;   -- 2026-09-01

-- Estado atual: R$ 100,00 de compras na fatura aberta.
SELECT name, limit_cents, used_cents, available_cents
FROM card_available_limit;
-- limite 500000 | usado 10000 | disponível 490000

-- Saldo da conta: ainda R$ 1.000,00. Compra no cartão NÃO sai da conta.
SELECT name, balance_cents FROM account_balances;

-- ---- PAGAR A FATURA ----
-- Duas coisas acontecem juntas, e por isso vão numa transação na API:

BEGIN;

UPDATE card_invoices
   SET status = 'paid', paid_at = now()
 WHERE id = '44444444-4444-4444-4444-444444444444';

INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, paid_at,
     account_id, category_id, pays_invoice_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Pagamento fatura Nubank', 10000, '2026-09-05', '2026-09-05',
     '22222222-2222-2222-2222-222222222222',
     (SELECT id FROM categories WHERE name = 'Fatura Cartão' AND user_id IS NULL),
     '44444444-4444-4444-4444-444444444444');

COMMIT;

-- O limite VOLTOU:
SELECT name, limit_cents, used_cents, available_cents
FROM card_available_limit;
-- limite 500000 | usado 0 | disponível 500000

-- E agora sim o dinheiro saiu da conta:
SELECT name, balance_cents FROM account_balances;
-- 100000 - 10000 = 90000

-- Pagar a mesma fatura duas vezes: impossível.
-- Espera: tx_invoice_payment_uniq
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, paid_at,
     account_id, pays_invoice_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Pagamento duplicado', 10000, '2026-09-05', '2026-09-05',
     '22222222-2222-2222-2222-222222222222',
     '44444444-4444-4444-4444-444444444444');


-- =============================================================================
-- PARTE 6 — Competência x caixa
-- Os dois números que o app antigo misturava num card só.
-- =============================================================================

-- Uma despesa de agosto ainda NÃO paga.
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, paid_at, account_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Conta de luz', 25000, '2026-08-15', NULL,
     '22222222-2222-2222-2222-222222222222');

-- Pergunta 1: "quanto eu tenho hoje?"  -> regime de CAIXA, usa paid_at
SELECT name, balance_cents AS saldo_real FROM account_balances;
-- A luz não entra: não foi paga.

-- Pergunta 2: "como foi meu mês de agosto?" -> COMPETÊNCIA, usa competence_date
SELECT
    kind,
    SUM(amount_cents) AS total,
    COUNT(*) FILTER (WHERE paid_at IS NULL) AS pendentes
FROM transactions
WHERE user_id = '11111111-1111-1111-1111-111111111111'
  AND competence_date >= '2026-08-01'
  AND competence_date <  '2026-09-01'
GROUP BY kind;
-- A luz entra: aconteceu em agosto.

-- Duas perguntas diferentes, duas respostas diferentes, ambas corretas.
-- No app antigo eram um card só chamado "saldo" — por isso nunca batia.


-- =============================================================================
-- PARTE 7 — Semântica de pagamento de fatura (migration 002)
-- =============================================================================

-- (15) Compra no cartão com paid_at preenchido. Quem é paga é a fatura
--      inteira, nunca a compra individual.
--      Espera: tx_card_has_no_paid_at
INSERT INTO transactions
    (user_id, kind, description, amount_cents, competence_date, paid_at,
     credit_card_id, card_invoice_id)
VALUES
    ('11111111-1111-1111-1111-111111111111',
     'expense', 'Compra com paid_at indevido', 5000, '2026-08-10', '2026-08-10',
     '33333333-3333-3333-3333-333333333333',
     '44444444-4444-4444-4444-444444444444');


-- monthly_summary de setembro/2026 não deve incluir o pagamento da fatura
-- (10000, Parte 5) — só a parcela 2/3 do Tênis (3333), que é compra real
-- no cartão daquele mês.
SELECT month, kind, total_cents, pending_count
FROM monthly_summary
WHERE user_id = '11111111-1111-1111-1111-111111111111'
  AND month = '2026-09-01'
  AND kind = 'expense';
-- total_cents esperado: 3333 (não 13333)

-- Prova por contraste: somando transactions "cru", sem excluir
-- pays_invoice_id, o pagamento da fatura entraria junto e duplicaria
-- o valor já contado como despesa no mês da compra.
SELECT SUM(amount_cents) AS total_sem_filtro
FROM transactions
WHERE user_id = '11111111-1111-1111-1111-111111111111'
  AND kind = 'expense'
  AND competence_date >= '2026-09-01' AND competence_date < '2026-10-01';
-- 13333 = 3333 (parcela) + 10000 (pagamento da fatura) — a diferença
-- que monthly_summary existe para corrigir.


-- =============================================================================
-- LIMPEZA
-- =============================================================================
-- DELETE FROM users WHERE email = 'teste@exemplo.com';
-- Todo o resto cai junto pelo ON DELETE CASCADE. Confira que caiu mesmo:
--   SELECT count(*) FROM transactions;
