import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class NotFoundError extends Error {
  constructor(message = 'Recurso não encontrado.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends Error {
  constructor(message = 'Não autorizado.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// node-postgres não tipa `.code` no erro (é uma propriedade do protocolo,
// não da classe Error). Guard em vez de `any` — ver CLAUDE.md, sem `any`.
function hasPgErrorCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err
    && typeof (err as { code: unknown }).code === 'string';
}

// 23505 = unique_violation, 23514 = check_violation. São as duas que o
// schema usa pra proteger as regras de negócio (ver db/migrations) — sem
// isso, violar uma constraint vira 500 opaco em vez de mensagem legível.
const PG_ERROR_STATUS: Record<string, { status: number; message: string }> = {
  '23505': { status: 409, message: 'Já existe um registro com esses dados.' },
  '23514': { status: 422, message: 'Os dados enviados violam uma regra do sistema.' },
};

export function errorHandler(
  err: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof NotFoundError) {
    reply.status(404).send({ error: err.message });
    return;
  }
  if (err instanceof ValidationError) {
    reply.status(400).send({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    reply.status(409).send({ error: err.message });
    return;
  }
  if (err instanceof UnauthorizedError) {
    reply.status(401).send({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    reply.status(400).send({ error: 'Dados inválidos.', details: err.issues });
    return;
  }
  if (hasPgErrorCode(err) && PG_ERROR_STATUS[err.code]) {
    const { status, message } = PG_ERROR_STATUS[err.code];
    reply.status(status).send({ error: message });
    return;
  }

  request.log.error(err);
  reply.status(500).send({ error: 'Erro interno.' });
}
