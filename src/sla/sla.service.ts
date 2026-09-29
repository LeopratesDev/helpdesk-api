import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marca como "SLA estourado" os chamados sem primeira resposta cujo prazo passou,
   * e grava uma linha de histórico para cada um (ator null = sistema).
   *
   * É um único comando SQL (UPDATE ... RETURNING dentro de um CTE), então é atômico
   * e idempotente: rodar duas vezes seguidas não marca nem audita nada em dobro,
   * porque a segunda execução já não encontra linhas com slaBreached = false.
   * O índice (slaBreached, slaDueAt) atende exatamente este WHERE.
   *
   * @returns ids dos chamados marcados nesta execução
   */
  async markOverdue(now: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ ticketId: string }[]>`
      WITH breached AS (
        UPDATE "Ticket"
        SET "slaBreached" = true, "updatedAt" = ${now}
        WHERE "slaBreached" = false
          AND "firstResponseAt" IS NULL
          AND "slaDueAt" < ${now}
          AND "status" NOT IN ('RESOLVIDO', 'FECHADO')
        RETURNING "id"
      )
      INSERT INTO "TicketHistory" ("id", "ticketId", "field", "oldValue", "newValue", "createdAt")
      SELECT gen_random_uuid(), "id", 'slaBreached', 'false', 'true', ${now} FROM breached
      RETURNING "ticketId"
    `;
    return rows.map((r) => r.ticketId);
  }
}
