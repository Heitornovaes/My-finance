-- =============================================================================
-- My Finance — Rollback do schema inicial
--
-- Migration: 001_initial_schema (down)
--
-- Sem BEGIN/COMMIT aqui — quem abre e fecha a transação é o runner
-- (scripts/migrate.ts). schema_migrations não aparece no DROP TABLE:
-- essa tabela pertence ao runner, não a esta migration.
-- =============================================================================

DROP VIEW IF EXISTS budget_progress, card_available_limit,
                    invoice_totals, account_balances;

DROP TABLE IF EXISTS asset_snapshots, budgets, transactions,
                     recurring_rules, card_invoices, credit_cards,
                     categories, accounts, sessions, users;

DROP FUNCTION IF EXISTS card_invoice_month(DATE, INT);
DROP FUNCTION IF EXISTS set_updated_at();
