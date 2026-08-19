// Importa o dump do Supabase (db/dump/supabase.sql) pro schema novo.
// Fase 2 do PLANO.md. Regras de conversão vieram de decisões já tomadas
// fora deste script (ver conversa) — este arquivo só as executa.
//
// Só o usuário TARGET_USER_ID é importado. `goals` não é importado (será
// recadastrado no app). Tudo roda numa única transação: em --dry-run ela
// é revertida no final (ROLLBACK), então o relatório reflete exatamente o
// que teria sido gravado, sem gravar de verdade.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUMP_PATH = join(__dirname, '..', 'db', 'dump', 'supabase.sql');

const TARGET_USER_ID = '10a456a4-50b3-4608-bc8f-48199464859e';

type Log = (msg: string) => void;

function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

function cleanInstallmentSuffix(desc: string): string {
  return desc.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

// Usa Date só pra aritmética de calendário (dias no mês), sempre em UTC e
// com y/m/d explícitos — nunca lendo "agora" nem usando toISOString().
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function closingDateFor(refYear: number, refMonth: number, closingDay: number): string {
  const prev = addMonths(refYear, refMonth, -1);
  return ymd(prev.year, prev.month, closingDay); // closing_day é sempre <=28, nunca precisa de clamp
}

function dueDateFor(refYear: number, refMonth: number, dueDay: number): string {
  const day = Math.min(dueDay, daysInMonth(refYear, refMonth)); // clamp: dia 30 em fevereiro -> 28
  return ymd(refYear, refMonth, day);
}

async function cardInvoiceMonth(client: Client, purchaseDate: string, closingDay: number): Promise<string> {
  const { rows } = await client.query<{ month: string }>(
    'SELECT card_invoice_month($1::date, $2::int)::text AS month',
    [purchaseDate, closingDay],
  );
  return rows[0].month;
}

// =============================================================================
// Carrega o dump num schema isolado (legacy_import), sem tocar no schema
// público real. O `pg_dump` já produz SQL válido — deixamos o Postgres
// interpretar em vez de escrever um parser de SQL à mão.
// =============================================================================
async function loadLegacyDump(client: Client, log: Log): Promise<void> {
  let sql = readFileSync(DUMP_PATH, 'utf8');

  if (sql.charCodeAt(0) === 0xfeff) sql = sql.slice(1); // remove BOM se houver
  sql = sql.replace(/\r\n/g, '\n');

  // \restrict / \unrestrict são meta-comandos do psql (pg_dump 17+), não SQL.
  sql = sql.replace(/^\\restrict\b.*$/gm, '').replace(/^\\unrestrict\b.*$/gm, '');

  // Isola tudo num schema próprio. Assume que a palavra "public" não
  // aparece dentro de nenhum valor de dado do dump (verdade neste dump).
  sql = sql.replace(/\bpublic\b/g, 'legacy_import');

  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + ';')
    // Não deixamos o dump alterar search_path/timeouts da nossa conexão.
    .filter((s) => !/^SET\s/i.test(s))
    .filter((s) => !/^SELECT pg_catalog\.set_config/i.test(s))
    // Supabase Auth não existe aqui: sem essas linhas, FK/policy que
    // referenciam auth.users ou auth.uid() quebrariam a carga.
    .filter((s) => !/\bauth\./i.test(s))
    .filter((s) => !/ROW LEVEL SECURITY/i.test(s))
    .filter((s) => !/CREATE POLICY/i.test(s));

  await client.query('DROP SCHEMA IF EXISTS legacy_import CASCADE');
  await client.query(statements.join('\n'));
  log(`Dump carregado em schema temporário 'legacy_import' (${statements.length} comandos).`);
}

async function importUser(client: Client, log: Log): Promise<string> {
  // O dump não traz auth.users (é do Supabase Auth, fora deste export) —
  // não existe e-mail real disponível aqui.
  const placeholderEmail = `usuario-${TARGET_USER_ID}@pendente.local`;
  const { rows: [row] } = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, 'PENDING_SETUP') RETURNING id`,
    [placeholderEmail],
  );
  log(`ATENÇÃO: users.email é um placeholder ('${placeholderEmail}') — defina o e-mail real manualmente antes da Fase 4.`);
  return row.id;
}

async function importAccounts(
  client: Client,
  newUserId: string,
  log: Log,
): Promise<Map<string, string>> {
  const { rows: legacyAccounts } = await client.query<{
    id: string; name: string; type: string; initial_balance: string;
  }>(
    `SELECT id, name, type, initial_balance FROM legacy_import.accounts WHERE user_id = $1 ORDER BY id`,
    [TARGET_USER_ID],
  );

  const accountIdMap = new Map<string, string>();
  const investmentKindByPrefix: Record<string, string> = {
    'Renda Fixa': 'fixed_income',
    Reserva: 'emergency',
    Ações: 'stocks',
    Cripto: 'crypto',
  };

  // accounts_user_name_uniq é (user_id, lower(name), kind) — nome só
  // precisa ser único DENTRO do mesmo kind (migration 004). Uma conta
  // corrente "BB" e um investimento "BB" não colidem, então não há
  // desempate de nome a fazer aqui.
  for (const acc of legacyAccounts.filter((a) => a.type !== 'investment')) {
    const name = acc.name.trim();
    let kind: string;
    if (name === 'BB') kind = 'checking';
    else if (name === 'VA') kind = 'cash';
    else throw new Error(`Conta não-investimento com nome inesperado: '${name}' (id legado ${acc.id}). Só sei converter 'BB' e 'VA'.`);

    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO accounts (user_id, name, kind, initial_balance_cents) VALUES ($1,$2,$3,$4) RETURNING id`,
      [newUserId, name, kind, toCents(acc.initial_balance)],
    );
    accountIdMap.set(acc.id, row.id);
  }

  for (const acc of legacyAccounts.filter((a) => a.type === 'investment')) {
    const [prefix, rest] = acc.name.split('|').map((s) => s.trim());
    const investmentKind = investmentKindByPrefix[prefix];
    if (!investmentKind) throw new Error(`investment_kind desconhecido: '${prefix}' (conta legada id ${acc.id}, nome '${acc.name}').`);

    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO accounts (user_id, name, kind, investment_kind, initial_balance_cents)
       VALUES ($1,$2,'investment',$3,0) RETURNING id`,
      [newUserId, rest, investmentKind],
    );
    accountIdMap.set(acc.id, row.id);
  }

  log(`Contas importadas: ${accountIdMap.size}.`);
  return accountIdMap;
}

async function importCategories(
  client: Client,
  newUserId: string,
  log: Log,
): Promise<Map<string, string>> {
  const { rows: newDefaults } = await client.query<{ id: string; kind: string; name: string }>(
    `SELECT id, kind, name FROM categories WHERE user_id IS NULL`,
  );
  const defaultByKindName = new Map(newDefaults.map((d) => [`${d.kind}:${d.name}`, d.id]));

  const { rows: legacyDefaults } = await client.query<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM legacy_import.categories WHERE is_default = true ORDER BY id`,
  );
  const { rows: legacyCustom } = await client.query<{ id: string; name: string; type: string }>(
    `SELECT id, name, type FROM legacy_import.categories WHERE user_id = $1 AND is_default = false ORDER BY id`,
    [TARGET_USER_ID],
  );

  const categoryIdMap = new Map<string, string>();

  for (const cat of legacyDefaults) {
    const matchedId = defaultByKindName.get(`${cat.type}:${cat.name}`);
    if (matchedId) {
      categoryIdMap.set(cat.id, matchedId);
      continue;
    }
    log(`Categoria padrão antiga '${cat.name}' (${cat.type}) não existe nos defaults novos — criada como categoria do usuário.`);
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO categories (user_id, name, kind) VALUES ($1,$2,$3) RETURNING id`,
      [newUserId, cat.name, cat.type],
    );
    categoryIdMap.set(cat.id, row.id);
  }

  for (const cat of legacyCustom) {
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO categories (user_id, name, kind) VALUES ($1,$2,$3) RETURNING id`,
      [newUserId, cat.name, cat.type],
    );
    categoryIdMap.set(cat.id, row.id);

    const lower = cat.name.trim().toLowerCase();
    const similar = newDefaults.find((d) => d.kind === cat.type && d.name.toLowerCase() === lower);
    if (similar) {
      log(`REVISAR NO APP: categoria custom '${cat.name}' tem o mesmo nome (sem diferenciar maiúsculas) do default '${similar.name}' — mantidas separadas, sem merge automático.`);
    }
  }
  // Caso apontado manualmente: não é igual textualmente, então a checagem
  // acima não pega — mas é a mesma decisão (não fundir, só reportar).
  if (legacyCustom.some((c) => c.name === 'Estudo')) {
    log(`REVISAR NO APP: categoria custom 'Estudo' é parecida com o default 'Educação' — mantidas separadas, sem merge automático.`);
  }

  log(`Categorias importadas: ${categoryIdMap.size}.`);
  return categoryIdMap;
}

async function importCreditCards(
  client: Client,
  newUserId: string,
  log: Log,
): Promise<{ idMap: Map<string, string>; meta: Map<string, { closingDay: number; dueDay: number }> }> {
  const { rows: legacyCards } = await client.query<{
    id: string; name: string; limit_amount: string; closing_day: number; due_day: number;
  }>(
    `SELECT id, name, limit_amount, closing_day, due_day FROM legacy_import.credit_cards WHERE user_id = $1 ORDER BY id`,
    [TARGET_USER_ID],
  );

  const idMap = new Map<string, string>();
  const meta = new Map<string, { closingDay: number; dueDay: number }>();

  for (const card of legacyCards) {
    const { rows: [row] } = await client.query<{ id: string }>(
      `INSERT INTO credit_cards (user_id, name, limit_cents, closing_day, due_day) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [newUserId, card.name.trim(), toCents(card.limit_amount), card.closing_day, card.due_day],
    );
    idMap.set(card.id, row.id);
    meta.set(row.id, { closingDay: card.closing_day, dueDay: card.due_day });
  }

  log(`Cartões importados: ${idMap.size}.`);
  return { idMap, meta };
}

async function importAssetSnapshots(
  client: Client,
  newUserId: string,
  accountIdMap: Map<string, string>,
  log: Log,
): Promise<void> {
  const { rows: history } = await client.query<{
    account_id: string; reference_date: string; amount: string;
  }>(
    `SELECT account_id, reference_date::text AS reference_date, amount
     FROM legacy_import.asset_history WHERE user_id = $1 ORDER BY id`,
    [TARGET_USER_ID],
  );

  let count = 0;
  for (const h of history) {
    const newAccountId = accountIdMap.get(h.account_id);
    if (!newAccountId) continue; // conta de outro usuário, fora de escopo
    await client.query(
      `INSERT INTO asset_snapshots (user_id, account_id, reference_month, amount_cents) VALUES ($1,$2,$3,$4)`,
      [newUserId, newAccountId, h.reference_date, toCents(h.amount)],
    );
    count++;
  }
  log(`Snapshots de patrimônio importados: ${count}.`);
}

type LegacyTx = {
  id: string; description: string; amount: string; type: string;
  category_id: string | null; account_id: string | null; credit_card_id: string | null;
  payment_method: string; is_fixed: boolean; is_paid: boolean;
  installment_number: number; installments_total: number; date: string;
};

// Regras fixas (recurring_rules): agrupa por (descrição, tipo, valor,
// categoria, conta) ignorando a data. A ocorrência mais antiga do grupo é
// a que processFixedExpenses criou de verdade; qualquer outra é projeção
// materializada em lote (o bug do sistema antigo) — descartamos.
async function importFixedRules(
  client: Client,
  newUserId: string,
  fixedRows: LegacyTx[],
  accountIdMap: Map<string, string>,
  categoryIdMap: Map<string, string>,
  log: Log,
): Promise<void> {
  const groups = new Map<string, LegacyTx[]>();
  for (const t of fixedRows) {
    const key = `${t.description}|${t.type}|${t.amount}|${t.category_id}|${t.account_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  let rulesCreated = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date));
    const [original, ...discarded] = group;

    if (original.credit_card_id) throw new Error(`Recorrência em cartão não suportada (id legado ${original.id}).`);
    const newAccountId = original.account_id ? accountIdMap.get(original.account_id) : undefined;
    if (!newAccountId) throw new Error(`Recorrência ${original.id}: account_id legado ${original.account_id} não mapeado.`);
    const newCategoryId = original.category_id ? categoryIdMap.get(original.category_id) ?? null : null;

    const day = Number(original.date.slice(8, 10));
    const amountCents = toCents(original.amount);

    const { rows: [rule] } = await client.query<{ id: string }>(
      `INSERT INTO recurring_rules
         (user_id, description, kind, amount_cents, category_id, account_id, day_of_month, start_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7, date_trunc('month', $8::date)::date)
       RETURNING id`,
      [newUserId, original.description, original.type, amountCents, newCategoryId, newAccountId, day, original.date],
    );
    rulesCreated++;

    await client.query(
      `INSERT INTO transactions
         (user_id, kind, description, amount_cents, category_id, competence_date, paid_at,
          account_id, recurring_rule_id, occurrence_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, date_trunc('month', $6::date)::date)`,
      [newUserId, original.type, original.description, amountCents, newCategoryId,
        original.date, original.is_paid ? original.date : null, newAccountId, rule.id],
    );

    if (discarded.length > 0) {
      log(`Descartada(s) ${discarded.length} projeção(ões) de '${original.description}' (regra criada a partir de ${original.date}): ${discarded.map((d) => d.date).join(', ')} — cópias que o processFixedExpenses antigo materializava; o sistema novo gera sob demanda.`);
    }
  }
  log(`Regras de recorrência criadas: ${rulesCreated} (${fixedRows.length - rulesCreated} ocorrência(s) descartada(s) de ${fixedRows.length} linhas fixas no total).`);
}

// Compras avulsas no cartão e séries de parcelas. Precisa das faturas
// (card_invoices) já existentes pra vincular card_invoice_id.
async function importCardAndDebitTransactions(
  client: Client,
  newUserId: string,
  otherRows: LegacyTx[],
  accountIdMap: Map<string, string>,
  categoryIdMap: Map<string, string>,
  creditCardIdMap: Map<string, string>,
  creditCardMeta: Map<string, { closingDay: number; dueDay: number }>,
  log: Log,
): Promise<void> {
  const singleRows: LegacyTx[] = [];
  const seriesGroups = new Map<string, LegacyTx[]>();

  for (const t of otherRows) {
    if (t.installments_total > 1) {
      const key = `${cleanInstallmentSuffix(t.description)}|${t.credit_card_id}|${t.installments_total}`;
      if (!seriesGroups.has(key)) seriesGroups.set(key, []);
      seriesGroups.get(key)!.push(t);
    } else {
      singleRows.push(t);
    }
  }

  // --- Faturas: uma por (cartão, mês de referência) realmente usado ---
  const cardRows = [...singleRows.filter((t) => t.credit_card_id), ...seriesGroups.values()].flat();
  const invoiceMap = new Map<string, string>(); // `${newCardId}|${refMonth}` -> invoiceId

  for (const t of cardRows) {
    const newCardId = creditCardIdMap.get(t.credit_card_id!);
    if (!newCardId) throw new Error(`Transação ${t.id}: credit_card_id legado ${t.credit_card_id} não mapeado.`);
    const meta = creditCardMeta.get(newCardId)!;
    const refMonth = await cardInvoiceMonth(client, t.date, meta.closingDay);
    const key = `${newCardId}|${refMonth}`;
    if (invoiceMap.has(key)) continue;

    const [y, m] = refMonth.split('-').map(Number);
    const closingDate = closingDateFor(y, m, meta.closingDay);
    const dueDate = dueDateFor(y, m, meta.dueDay);

    const { rows: [inv] } = await client.query<{ id: string }>(
      `INSERT INTO card_invoices (user_id, credit_card_id, reference_month, closing_date, due_date, status)
       VALUES ($1,$2,$3,$4,$5,'open') RETURNING id`,
      [newUserId, newCardId, refMonth, closingDate, dueDate],
    );
    invoiceMap.set(key, inv.id);
    log(`Fatura criada: ${refMonth} (fechamento ${closingDate}, vencimento ${dueDate}).`);
  }

  async function invoiceFor(t: LegacyTx): Promise<{ cardId: string; invoiceId: string }> {
    const cardId = creditCardIdMap.get(t.credit_card_id!)!;
    const meta = creditCardMeta.get(cardId)!;
    const refMonth = await cardInvoiceMonth(client, t.date, meta.closingDay);
    return { cardId, invoiceId: invoiceMap.get(`${cardId}|${refMonth}`)! };
  }

  // --- Transações avulsas ---
  let singleCount = 0;
  for (const t of singleRows) {
    const newCategoryId = t.category_id ? categoryIdMap.get(t.category_id) ?? null : null;
    const amountCents = toCents(t.amount);

    if (t.payment_method === 'credit_card') {
      const { cardId, invoiceId } = await invoiceFor(t);
      await client.query(
        `INSERT INTO transactions
           (user_id, kind, description, amount_cents, category_id, competence_date, paid_at,
            credit_card_id, card_invoice_id)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)`,
        [newUserId, t.type, t.description, amountCents, newCategoryId, t.date, cardId, invoiceId],
      );
    } else if (t.payment_method === 'debit') {
      const newAccountId = t.account_id ? accountIdMap.get(t.account_id) : undefined;
      if (!newAccountId) throw new Error(`Transação ${t.id} (débito) sem account_id mapeado.`);
      await client.query(
        `INSERT INTO transactions
           (user_id, kind, description, amount_cents, category_id, competence_date, paid_at, account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newUserId, t.type, t.description, amountCents, newCategoryId, t.date,
          t.is_paid ? t.date : null, newAccountId],
      );
    } else {
      throw new Error(`Transação ${t.id}: payment_method desconhecido '${t.payment_method}'.`);
    }
    singleCount++;
  }
  log(`Transações avulsas importadas: ${singleCount}.`);

  // --- Séries de parcelas ---
  let seriesCount = 0;
  for (const rows of seriesGroups.values()) {
    rows.sort((a, b) => a.installment_number - b.installment_number);
    const seriesId = randomUUID();
    const description = cleanInstallmentSuffix(rows[0].description);

    for (const t of rows) {
      const newCategoryId = t.category_id ? categoryIdMap.get(t.category_id) ?? null : null;
      const { cardId, invoiceId } = await invoiceFor(t);
      await client.query(
        `INSERT INTO transactions
           (user_id, kind, description, amount_cents, category_id, competence_date, paid_at,
            credit_card_id, card_invoice_id, series_id, installment_number, installments_total)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11)`,
        [newUserId, t.type, description, toCents(t.amount), newCategoryId, t.date,
          cardId, invoiceId, seriesId, t.installment_number, t.installments_total],
      );
    }
    log(`Série criada: '${description}' — ${rows.length} parcela(s).`);
    seriesCount++;
  }
  log(`Séries de parcelamento importadas: ${seriesCount}.`);
}

async function reportDiscardedScope(client: Client, log: Log): Promise<void> {
  const { rows: [{ count: goalsCount }] } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM legacy_import.goals WHERE user_id = $1`,
    [TARGET_USER_ID],
  );
  log(`Descartada a tabela goals (${goalsCount} linha(s) do usuário-alvo) — serão recadastradas no app.`);

  const { rows: [{ count: otherTx }] } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM legacy_import.transactions WHERE user_id <> $1`,
    [TARGET_USER_ID],
  );
  const { rows: [{ count: otherAccounts }] } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM legacy_import.accounts WHERE user_id <> $1`,
    [TARGET_USER_ID],
  );
  log(`Descartados dados de outros usuários do dump (fora de escopo): ${otherAccounts} conta(s), ${otherTx} transação(ões).`);
}

async function printConference(client: Client, newUserId: string, log: Log): Promise<void> {
  log('\n--- CONFERÊNCIA (monthly_summary, exclui pagamento de fatura) ---');
  const { rows } = await client.query<{
    month: string; kind: string; total_cents: string; pending_count: string;
  }>(
    `SELECT month::text AS month, kind, total_cents, pending_count
     FROM monthly_summary
     WHERE user_id = $1 AND month IN ('2026-02-01','2026-03-01','2026-04-01')
     ORDER BY month, kind`,
    [newUserId],
  );
  for (const r of rows) {
    log(`${r.month} | ${r.kind.padEnd(7)} | R$ ${(Number(r.total_cents) / 100).toFixed(2)} | pendentes: ${r.pending_count}`);
  }

  const { rows: invRows } = await client.query<{ total_cents: string }>(
    `SELECT it.total_cents FROM invoice_totals it
     JOIN card_invoices ci ON ci.id = it.invoice_id
     JOIN credit_cards cc ON cc.id = ci.credit_card_id
     WHERE ci.user_id = $1 AND ci.reference_month = '2026-02-01' AND cc.name = 'XP'`,
    [newUserId],
  );
  if (invRows[0]) {
    log(`Fatura XP fev/2026: R$ ${(Number(invRows[0].total_cents) / 100).toFixed(2)}`);
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const log: Log = (msg) => console.log(msg);

  try {
    await loadLegacyDump(client, log);

    await client.query('BEGIN');
    try {
      const newUserId = await importUser(client, log);
      const accountIdMap = await importAccounts(client, newUserId, log);
      const categoryIdMap = await importCategories(client, newUserId, log);
      const { idMap: creditCardIdMap, meta: creditCardMeta } = await importCreditCards(client, newUserId, log);
      await importAssetSnapshots(client, newUserId, accountIdMap, log);

      const { rows: legacyTx } = await client.query<LegacyTx>(
        `SELECT id, description, amount, type, category_id, account_id, credit_card_id,
                payment_method, is_fixed, is_paid, installment_number, installments_total, date::text AS date
         FROM legacy_import.transactions
         WHERE user_id = $1
         ORDER BY id`,
        [TARGET_USER_ID],
      );
      const fixedRows = legacyTx.filter((t) => t.is_fixed);
      const otherRows = legacyTx.filter((t) => !t.is_fixed);

      await importFixedRules(client, newUserId, fixedRows, accountIdMap, categoryIdMap, log);
      await importCardAndDebitTransactions(
        client, newUserId, otherRows, accountIdMap, categoryIdMap, creditCardIdMap, creditCardMeta, log,
      );

      await reportDiscardedScope(client, log);
      await printConference(client, newUserId, log);

      if (dryRun) {
        await client.query('ROLLBACK');
        log('\n[DRY RUN] Nada foi gravado — ROLLBACK executado.');
      } else {
        await client.query('COMMIT');
        log('\n[OK] Importação commitada.');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    await client.query('DROP SCHEMA IF EXISTS legacy_import CASCADE');
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
