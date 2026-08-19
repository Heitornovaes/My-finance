import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config/env';
import { pool } from './config/db';
import { errorHandler } from './shared/errors';

const app = Fastify({
  logger:
    env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' } }
      : true,
});

await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

app.setErrorHandler(errorHandler);

// Testa o banco de verdade — se a query falhar, o erro sobe pro error
// handler e vira 500. Um health check que não bate no banco não diz nada
// sobre se a API está de pé de verdade.
app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { status: 'ok' };
});

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
