import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Params } from 'nestjs-pino';
import { Env } from '../config/env.schema';

/**
 * Logs estruturados (JSON) com correlation id por requisição.
 * O id vem do header x-request-id (se o cliente/gateway mandar) ou é gerado,
 * e volta no header de resposta para o cliente citar num chamado de suporte.
 */
export function loggerParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header.length <= 100 ? header : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req: IncomingMessage) => ({ correlationId: req.id }),
      // Nunca logar dados sensíveis
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.refreshToken',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  };
}
