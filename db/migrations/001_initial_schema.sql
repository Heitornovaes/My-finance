-- =============================================================================
-- My Finance — Schema inicial
-- PostgreSQL 14+
--
-- Migration: 001_initial_schema
--
-- Decisões de modelagem importantes (leia antes de mexer):
--
--   1. Dinheiro é BIGINT em CENTAVOS. Nunca float, nunca real.
--      R$ 1.234,56 -> 123456. Conversão só na borda (API/front).
--
--   2. `amount_cents` é sempre POSITIVO. O sinal vem da coluna `kind`.
--      Isso evita o clássico "despesa negativa lançada como receita".
--
--   3. Toda ocorrência de recorrência ou parcela carrega o id da série.
--      Renomear a descrição nunca mais quebra a série.
--
--   4. Data de competência (quando aconteceu) é separada de
--      data de pagamento (quando saiu da conta). Saldo usa a segunda.
--
--   5. Fatura de cartão é uma ENTIDADE, não um cálculo em cima do mês
--      da compra. É o que permite o limite voltar quando você paga.
--
--   6. Regras que o banco consegue garantir, o banco garante.
--      Duplicata de recorrência é impedida por UNIQUE, não por um IF no JS.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;   -- email case-insensitive


-- =============================================================================
-- 1. FUNÇÕES AUXILIARES
-- =============================================================================

-- Mantém updated_at sempre correto sem depender da aplicação lembrar.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Dada a data da compra e o dia de fechamento do cartão, retorna o mês
-- de referência da fatura em que essa compra cai.
--
-- Regra: compra feita NO dia do fechamento ou depois entra na fatura seguinte.
-- Ex.: fechamento dia 25. Compra em 24/03 -> fatura de março.
--                          Compra em 25/03 -> fatura de abril.
--
-- É esta função que o app atual não tinha — por isso closing_day era
-- cadastrado e nunca usado.
CREATE OR REPLACE FUNCTION card_invoice_month(purchase_date DATE, closing_day INT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN EXTRACT(DAY FROM purchase_date)::INT >= closing_day
            THEN (date_trunc('month', purchase_date) + INTERVAL '1 month')::DATE
        ELSE date_trunc('month', purchase_date)::DATE
    END;
$$;


-- =============================================================================
-- 2. USUÁRIOS
-- Você assume o que o Supabase Auth fazia. password_hash guarda argon2id.
-- NUNCA guarde a senha, nem "criptografada". Só o hash.
-- =============================================================================

CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          CITEXT      NOT NULL UNIQUE,
    password_hash  TEXT        NOT NULL,
    display_name   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Sessões. Cookie httpOnly com um token opaco > JWT no localStorage
-- para um app financeiro: dá pra revogar, e XSS não rouba a sessão.
CREATE TABLE sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,  -- hash do token, não o token
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;


-- =============================================================================
-- 3. CONTAS E CARTEIRAS
-- `archived_at` em vez de DELETE: você nunca quer apagar uma conta que
-- tem histórico. Arquivar some da UI e preserva os lançamentos.
-- =============================================================================

CREATE TABLE accounts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                   TEXT        NOT NULL,
    kind                   TEXT        NOT NULL,
    -- 'checking' corrente | 'cash' dinheiro | 'savings' poupança | 'investment'
    investment_kind        TEXT,
    -- só para kind='investment': 'fixed_income'|'stocks'|'crypto'|'emergency'
    -- (no app antigo isso vivia dentro do nome com um "|" — era frágil)
    initial_balance_cents  BIGINT      NOT NULL DEFAULT 0,
    color                  TEXT,
    icon                   TEXT,
    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT accounts_kind_valid
        CHECK (kind IN ('checking', 'cash', 'savings', 'investment')),

    CONSTRAINT accounts_investment_kind_valid
        CHECK (
            (kind = 'investment' AND investment_kind IN
                ('fixed_income', 'stocks', 'crypto', 'emergency'))
            OR
            (kind <> 'investment' AND investment_kind IS NULL)
        ),

    CONSTRAINT accounts_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX accounts_user_name_uniq
    ON accounts (user_id, lower(name))
    WHERE archived_at IS NULL;

CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 4. CATEGORIAS
-- user_id NULL = categoria padrão do sistema, visível para todos.
-- =============================================================================

CREATE TABLE categories (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    icon         TEXT        NOT NULL DEFAULT 'fa-tag',
    color        TEXT,
    kind         TEXT        NOT NULL DEFAULT 'expense',
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT categories_kind_valid CHECK (kind IN ('expense', 'income')),
    CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> '')
);

-- Categorias do usuário: nome único por tipo.
CREATE UNIQUE INDEX categories_user_name_uniq
    ON categories (user_id, lower(name), kind)
    WHERE user_id IS NOT NULL AND archived_at IS NULL;

-- Categorias padrão: nome único global.
CREATE UNIQUE INDEX categories_default_name_uniq
    ON categories (lower(name), kind)
    WHERE user_id IS NULL;

CREATE TRIGGER categories_set_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 5. CARTÕES DE CRÉDITO
-- =============================================================================

CREATE TABLE credit_cards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT        NOT NULL,
    limit_cents         BIGINT      NOT NULL,
    closing_day         SMALLINT    NOT NULL,
    due_day             SMALLINT    NOT NULL,
    -- conta de onde a fatura costuma ser paga (sugestão na UI)
    default_account_id  UUID        REFERENCES accounts(id) ON DELETE SET NULL,
    color               TEXT,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT cards_limit_positive   CHECK (limit_cents >= 0),
    CONSTRAINT cards_closing_day_valid CHECK (closing_day BETWEEN 1 AND 28),
    CONSTRAINT cards_due_day_valid     CHECK (due_day     BETWEEN 1 AND 28),
    CONSTRAINT cards_name_not_blank    CHECK (btrim(name) <> '')
);
-- Limite 28: dia 29/30/31 não existe em todo mês. Se você quiser permitir,
-- o app precisa de uma regra de "último dia do mês" — deixe para depois.

CREATE TRIGGER credit_cards_set_updated_at
    BEFORE UPDATE ON credit_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 6. FATURAS
-- A entidade que faltava. Sem isso o limite disponível só desce.
--
-- reference_month é sempre o dia 1 do mês da fatura (ex: 2026-04-01).
-- =============================================================================

CREATE TABLE card_invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credit_card_id    UUID        NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
    reference_month   DATE        NOT NULL,
    closing_date      DATE        NOT NULL,
    due_date          DATE        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'open',
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT invoices_status_valid CHECK (status IN ('open', 'closed', 'paid')),

    CONSTRAINT invoices_month_is_first_day
        CHECK (reference_month = date_trunc('month', reference_month)::DATE),

    -- se está paga, precisa ter data de pagamento — e vice-versa
    CONSTRAINT invoices_paid_consistency
        CHECK ((status = 'paid') = (paid_at IS NOT NULL)),

    -- uma fatura por cartão por mês. Impossível duplicar.
    CONSTRAINT invoices_card_month_uniq UNIQUE (credit_card_id, reference_month)
);

CREATE INDEX invoices_user_month_idx ON card_invoices (user_id, reference_month);

CREATE TRIGGER card_invoices_set_updated_at
    BEFORE UPDATE ON card_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 7. REGRAS DE RECORRÊNCIA
-- A regra existe UMA vez. As ocorrências são geradas a partir dela.
--
-- No app antigo, "despesa fixa" era uma transaction com is_fixed=true que
-- se auto-copiava ao navegar entre meses — inclusive para o passado.
-- Aqui a regra é um objeto separado, com início e fim explícitos.
-- =============================================================================

CREATE TABLE recurring_rules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description      TEXT        NOT NULL,
    kind             TEXT        NOT NULL,
    amount_cents     BIGINT      NOT NULL,
    category_id      UUID        REFERENCES categories(id) ON DELETE SET NULL,
    account_id       UUID        REFERENCES accounts(id)      ON DELETE CASCADE,
    credit_card_id   UUID        REFERENCES credit_cards(id)  ON DELETE CASCADE,
    day_of_month     SMALLINT    NOT NULL,
    start_month      DATE        NOT NULL,
    end_month        DATE,        -- NULL = sem fim
    active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rules_kind_valid    CHECK (kind IN ('expense', 'income')),
    CONSTRAINT rules_amount_positive CHECK (amount_cents > 0),
    CONSTRAINT rules_day_valid     CHECK (day_of_month BETWEEN 1 AND 31),

    CONSTRAINT rules_months_are_first_day CHECK (
        start_month = date_trunc('month', start_month)::DATE
        AND (end_month IS NULL OR end_month = date_trunc('month', end_month)::DATE)
    ),
    CONSTRAINT rules_end_after_start
        CHECK (end_month IS NULL OR end_month >= start_month),

    -- ou sai de uma conta, ou vai pro cartão. Nunca os dois, nunca nenhum.
    CONSTRAINT rules_one_source CHECK (
        (account_id IS NOT NULL AND credit_card_id IS NULL) OR
        (account_id IS NULL AND credit_card_id IS NOT NULL)
    )
);

CREATE INDEX rules_user_active_idx ON recurring_rules (user_id) WHERE active;

CREATE TRIGGER recurring_rules_set_updated_at
    BEFORE UPDATE ON recurring_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 8. TRANSAÇÕES
-- O coração do sistema.
-- =============================================================================

CREATE TABLE transactions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    kind               TEXT        NOT NULL,          -- 'expense' | 'income'
    description        TEXT        NOT NULL,
    amount_cents       BIGINT      NOT NULL,          -- sempre positivo
    category_id        UUID        REFERENCES categories(id) ON DELETE SET NULL,

    -- DATAS: as duas coisas que o app antigo tratava como uma só
    competence_date    DATE        NOT NULL,          -- quando aconteceu
    paid_at            DATE,                          -- quando saiu/entrou de fato
                                                      -- NULL = pendente

    -- ORIGEM: exatamente uma das duas
    account_id         UUID        REFERENCES accounts(id)     ON DELETE CASCADE,
    credit_card_id     UUID        REFERENCES credit_cards(id) ON DELETE CASCADE,
    card_invoice_id    UUID        REFERENCES card_invoices(id) ON DELETE CASCADE,

    -- SÉRIE: parcelas e recorrências. Chave estável, não a descrição.
    series_id            UUID,
    installment_number   SMALLINT,
    installments_total   SMALLINT,

    -- Vínculo com a regra que gerou esta ocorrência (se veio de uma)
    recurring_rule_id  UUID        REFERENCES recurring_rules(id) ON DELETE SET NULL,
    occurrence_month   DATE,       -- mês que esta ocorrência representa

    -- Se esta transação É o pagamento de uma fatura de cartão
    pays_invoice_id    UUID        REFERENCES card_invoices(id) ON DELETE SET NULL,

    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT tx_kind_valid       CHECK (kind IN ('expense', 'income')),
    CONSTRAINT tx_amount_positive  CHECK (amount_cents > 0),
    CONSTRAINT tx_desc_not_blank   CHECK (btrim(description) <> ''),

    -- ou conta, ou cartão. Nunca ambos, nunca nenhum.
    CONSTRAINT tx_one_source CHECK (
        (account_id IS NOT NULL AND credit_card_id IS NULL) OR
        (account_id IS NULL AND credit_card_id IS NOT NULL)
    ),

    -- compra no cartão tem que estar em alguma fatura; compra em conta, não
    CONSTRAINT tx_invoice_consistency CHECK (
        (credit_card_id IS NOT NULL AND card_invoice_id IS NOT NULL) OR
        (credit_card_id IS NULL     AND card_invoice_id IS NULL)
    ),

    -- parcela: ou os três campos juntos, ou nenhum
    CONSTRAINT tx_installment_consistency CHECK (
        (series_id IS NULL AND installment_number IS NULL AND installments_total IS NULL)
        OR
        (series_id IS NOT NULL AND installment_number IS NOT NULL
         AND installments_total IS NOT NULL
         AND installment_number BETWEEN 1 AND installments_total)
    ),

    CONSTRAINT tx_occurrence_is_first_day CHECK (
        occurrence_month IS NULL
        OR occurrence_month = date_trunc('month', occurrence_month)::DATE
    ),

    -- pagamento de fatura sai de uma conta, nunca do próprio cartão
    CONSTRAINT tx_invoice_payment_from_account CHECK (
        pays_invoice_id IS NULL OR account_id IS NOT NULL
    )
);

-- ESTA É A LINHA QUE MATA O BUG DA DUPLICATA DE DESPESA FIXA.
-- Uma regra só pode gerar UMA ocorrência por mês. O banco garante.
-- Não importa quantas vezes o front chamar, quantas abas estejam abertas.
CREATE UNIQUE INDEX tx_rule_occurrence_uniq
    ON transactions (recurring_rule_id, occurrence_month)
    WHERE recurring_rule_id IS NOT NULL;

-- Mesma ideia para parcelas: não existe "parcela 3/10" duplicada.
CREATE UNIQUE INDEX tx_series_installment_uniq
    ON transactions (series_id, installment_number)
    WHERE series_id IS NOT NULL;

-- Uma fatura tem no máximo um pagamento.
CREATE UNIQUE INDEX tx_invoice_payment_uniq
    ON transactions (pays_invoice_id)
    WHERE pays_invoice_id IS NOT NULL;

-- Índices de leitura: a query mais comum do app é "mês X do usuário Y".
CREATE INDEX tx_user_competence_idx ON transactions (user_id, competence_date DESC);
CREATE INDEX tx_account_paid_idx    ON transactions (account_id, paid_at)
    WHERE account_id IS NOT NULL;
CREATE INDEX tx_invoice_idx         ON transactions (card_invoice_id)
    WHERE card_invoice_id IS NOT NULL;
CREATE INDEX tx_series_idx          ON transactions (series_id)
    WHERE series_id IS NOT NULL;
CREATE INDEX tx_category_idx        ON transactions (category_id);

CREATE TRIGGER transactions_set_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 9. ORÇAMENTOS / METAS
-- Por MÊS, não global. Você não gasta o mesmo em dezembro e em fevereiro.
-- =============================================================================

CREATE TABLE budgets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id      UUID        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    reference_month  DATE        NOT NULL,
    limit_cents      BIGINT      NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT budgets_limit_positive CHECK (limit_cents > 0),
    CONSTRAINT budgets_month_is_first_day
        CHECK (reference_month = date_trunc('month', reference_month)::DATE),
    CONSTRAINT budgets_uniq UNIQUE (user_id, category_id, reference_month)
);

CREATE TRIGGER budgets_set_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 10. SNAPSHOTS DE PATRIMÔNIO
-- Um valor por conta de investimento por mês. Alimenta o gráfico
-- de evolução patrimonial.
-- =============================================================================

CREATE TABLE asset_snapshots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    reference_month  DATE        NOT NULL,
    amount_cents     BIGINT      NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT snapshots_amount_non_negative CHECK (amount_cents >= 0),
    CONSTRAINT snapshots_month_is_first_day
        CHECK (reference_month = date_trunc('month', reference_month)::DATE),

    -- o UPSERT do app antigo dependia dessa constraint existir.
    -- Aqui ela existe de verdade.
    CONSTRAINT snapshots_account_month_uniq UNIQUE (account_id, reference_month)
);

CREATE TRIGGER asset_snapshots_set_updated_at
    BEFORE UPDATE ON asset_snapshots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- 11. VIEWS
-- Cálculos que o app antigo fazia em JavaScript, buscando tudo do banco.
-- Aqui o Postgres faz — que é o trabalho dele.
-- =============================================================================

-- Saldo real de cada conta: saldo inicial + tudo que foi EFETIVAMENTE pago.
-- Compra no cartão não entra (account_id é NULL nela). O que entra é o
-- pagamento da fatura, que é uma transação normal na conta.
CREATE VIEW account_balances AS
SELECT
    a.id                AS account_id,
    a.user_id,
    a.name,
    a.kind,
    a.initial_balance_cents,
    a.initial_balance_cents + COALESCE(SUM(
        CASE WHEN t.kind = 'income' THEN t.amount_cents ELSE -t.amount_cents END
    ) FILTER (WHERE t.paid_at IS NOT NULL), 0) AS balance_cents
FROM accounts a
LEFT JOIN transactions t ON t.account_id = a.id
GROUP BY a.id;


-- Total de cada fatura.
CREATE VIEW invoice_totals AS
SELECT
    i.id              AS invoice_id,
    i.user_id,
    i.credit_card_id,
    i.reference_month,
    i.status,
    i.due_date,
    COALESCE(SUM(
        CASE WHEN t.kind = 'income' THEN -t.amount_cents ELSE t.amount_cents END
    ), 0) AS total_cents
FROM card_invoices i
LEFT JOIN transactions t ON t.card_invoice_id = i.id
GROUP BY i.id;


-- Limite disponível do cartão: só faturas AINDA NÃO PAGAS ocupam limite.
-- É isso que faz o limite voltar quando você paga a fatura.
CREATE VIEW card_available_limit AS
SELECT
    c.id          AS credit_card_id,
    c.user_id,
    c.name,
    c.limit_cents,
    COALESCE(SUM(it.total_cents) FILTER (WHERE it.status <> 'paid'), 0) AS used_cents,
    c.limit_cents - COALESCE(SUM(it.total_cents) FILTER (WHERE it.status <> 'paid'), 0)
        AS available_cents
FROM credit_cards c
LEFT JOIN invoice_totals it ON it.credit_card_id = c.id
GROUP BY c.id;


-- Progresso dos orçamentos do mês.
CREATE VIEW budget_progress AS
SELECT
    b.id            AS budget_id,
    b.user_id,
    b.category_id,
    cat.name        AS category_name,
    b.reference_month,
    b.limit_cents,
    COALESCE(SUM(t.amount_cents), 0) AS spent_cents,
    ROUND(
        COALESCE(SUM(t.amount_cents), 0)::NUMERIC / NULLIF(b.limit_cents, 0) * 100,
        1
    ) AS percent_used
FROM budgets b
JOIN categories cat ON cat.id = b.category_id
LEFT JOIN transactions t
       ON t.category_id = b.category_id
      AND t.user_id     = b.user_id
      AND t.kind        = 'expense'
      AND date_trunc('month', t.competence_date)::DATE = b.reference_month
GROUP BY b.id, cat.name;


-- =============================================================================
-- 12. CATEGORIAS PADRÃO
-- =============================================================================

INSERT INTO categories (user_id, name, icon, kind) VALUES
    (NULL, 'Moradia',        'fa-house',            'expense'),
    (NULL, 'Mercado',        'fa-cart-shopping',    'expense'),
    (NULL, 'Transporte',     'fa-car',              'expense'),
    (NULL, 'Alimentação',    'fa-utensils',         'expense'),
    (NULL, 'Saúde',          'fa-heart-pulse',      'expense'),
    (NULL, 'Educação',       'fa-graduation-cap',   'expense'),
    (NULL, 'Lazer',          'fa-film',             'expense'),
    (NULL, 'Assinaturas',    'fa-repeat',           'expense'),
    (NULL, 'Vestuário',      'fa-shirt',            'expense'),
    (NULL, 'Fatura Cartão',  'fa-credit-card',      'expense'),
    (NULL, 'Outros',         'fa-tag',              'expense'),
    (NULL, 'Salário',        'fa-briefcase',        'income'),
    (NULL, 'Freelance',      'fa-laptop-code',      'income'),
    (NULL, 'Rendimentos',    'fa-chart-line',       'income'),
    (NULL, 'Outros',         'fa-tag',              'income');
