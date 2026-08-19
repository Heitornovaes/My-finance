import { Pool, type PoolClient } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

// CLAUDE.md regra 5: operação multi-linha roda em transação. Este é o
// único jeito de abrir uma transação no projeto — nenhuma rota deve
// escrever BEGIN/COMMIT/ROLLBACK por conta própria.
//
// `pool.connect()` empresta UM client fixo do pool (não dá pra usar
// `pool.query()` direto: cada chamada pegaria uma conexão diferente, e
// BEGIN numa conexão não afeta as outras). `finally { client.release() }`
// devolve esse client ao pool sempre — commitou, deu rollback ou o `fn`
// nem chegou a rodar (erro ao abrir a transação), o client nunca fica
// preso fora do pool.
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
