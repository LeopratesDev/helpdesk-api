import { ConnectionOptions } from 'bullmq';

/** Converte REDIS_URL (redis://[:senha@]host:porta[/db]) nas opções que o BullMQ espera. */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Exigido pelo BullMQ para Workers: comandos bloqueantes não podem ter limite de tentativas
    maxRetriesPerRequest: null,
  };
}
