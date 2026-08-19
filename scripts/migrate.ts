// Runner de migrations. Sem framework: lê os .sql de db/migrations em ordem
// alfabética, compara com o que já foi aplicado e roda só o que falta.
//
// Por que o runner (e não o .sql) é dono da transação e da tabela
// schema_migrations: ver CLAUDE.md, regras 9 e 10.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'db', 'migrations');

// Chave arbitrária, só precisa ser fixa e exclusiva deste projeto: serializa
// execuções concorrentes do runner (dois `npm run migrate` ao mesmo tempo).
// A segunda execução espera aqui até a primeira soltar o lock.
const MIGRATION_LOCK_KEY = 754_913_821;

// Garante que a tabela de controle existe. Não pode vir de uma migration:
// o runner precisa dela para saber o que já rodou ANTES de rodar a 001.
async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// Só os arquivos "up". *.down.sql nunca é aplicado automaticamente, e
// qualquer .sql fora de db/migrations/ (ex.: db/playground.sql) nem entra
// aqui, porque só lemos este diretório.
function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort(); // nomes com prefixo numérico (001, 002...) ordenam certo aqui
}

function versionOf(file: string): string {
  return file.replace(/\.sql$/, '');
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

// version -> checksum com que foi aplicada.
async function getAppliedMigrations(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

// Recusa seguir se um arquivo já aplicado foi editado depois. Migration
// aplicada é histórico; se precisa mudar algo, é uma migration nova.
function verifyChecksums(files: string[], applied: Map<string, string>): void {
  for (const file of files) {
    const version = versionOf(file);
    const storedChecksum = applied.get(version);
    if (storedChecksum === undefined) continue; // ainda não foi aplicada

    const currentChecksum = checksumOf(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    if (currentChecksum !== storedChecksum) {
      throw new Error(
        `Migration '${version}' foi modificada depois de aplicada ` +
          `(checksum não bate com o que está em schema_migrations). ` +
          `Não edite migrations já aplicadas — crie uma nova migration.`,
      );
    }
  }
}

async function showStatus(files: string[], applied: Map<string, string>): Promise<void> {
  console.log('Migrations:');
  for (const file of files) {
    const mark = applied.has(versionOf(file)) ? 'x' : ' ';
    console.log(`  [${mark}] ${versionOf(file)}`);
  }
}

// Aplica UMA migration inteira dentro de uma transação: o SQL da migration
// e o INSERT em schema_migrations são atômicos (Postgres tem DDL
// transacional), então nunca fica "aplicou mas não registrou".
async function applyMigration(client: Client, file: string): Promise<void> {
  const version = versionOf(file);
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const checksum = checksumOf(sql);

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
      [version, checksum],
    );
    await client.query('COMMIT');
    console.log(`✓ aplicada: ${version}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✗ falhou: ${version}`);
    throw err;
  }
}

// Roda as pendentes em ordem. Se uma falhar, o erro sobe e para o loop —
// as seguintes não são tentadas.
async function migrate(client: Client, files: string[], applied: Map<string, string>): Promise<void> {
  const pending = files.filter((f) => !applied.has(versionOf(f)));

  if (pending.length === 0) {
    console.log('Nenhuma migration pendente.');
    return;
  }

  for (const file of pending) {
    await applyMigration(client, file);
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Bloqueia até conseguir o lock: impede duas execuções do runner
  // aplicando migrations ao mesmo tempo.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await ensureMigrationsTable(client);

    const files = listMigrationFiles();
    const applied = await getAppliedMigrations(client);
    verifyChecksums(files, applied);

    if (process.argv.includes('--status')) {
      await showStatus(files, applied);
    } else {
      await migrate(client, files, applied);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
