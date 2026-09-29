import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { aiAccuracy, secondsToMinutes, slaCompliance } from './metrics.calc';

export class MetricsQueryDto {
  @ApiPropertyOptional({ description: 'Chamados abertos a partir de (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Chamados abertos até (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class MetricsOverviewDto {
  @ApiProperty({ example: 50 }) totalTickets!: number;
  @ApiProperty({
    example: { ABERTO: 9, EM_ATENDIMENTO: 8, AGUARDANDO_CLIENTE: 10, RESOLVIDO: 9, FECHADO: 14 },
  })
  ticketsByStatus!: Record<TicketStatus, number>;
  @ApiProperty({ nullable: true, example: 312, description: 'Minutos; null sem dados' })
  avgFirstResponseMinutes!: number | null;
  @ApiProperty({ nullable: true, example: 1450, description: 'Minutos; null sem dados' })
  avgResolutionMinutes!: number | null;
  @ApiProperty({
    nullable: true,
    example: 71.4,
    description: '% de chamados avaliados dentro do SLA',
  })
  slaCompliancePercent!: number | null;
  @ApiProperty({ nullable: true, example: 70, description: '% de sugestões aceitas sem correção' })
  aiAccuracyPercent!: number | null;
  @ApiProperty({ example: { accepted: 7, corrected: 3, pending: 5, failed: 0 } })
  aiSuggestions!: { accepted: number; corrected: number; pending: number; failed: number };
}

interface Averages {
  avgFirstResponse: number | null;
  avgResolution: number | null;
  evaluated: bigint;
  breached: bigint;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: MetricsQueryDto): Promise<MetricsOverviewDto> {
    const createdAt = query.from || query.to ? { gte: query.from, lte: query.to } : undefined;
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date('9999-12-31');

    // Três consultas independentes em paralelo; agregação feita no banco, não em memória
    const [byStatus, [avg], triage] = await Promise.all([
      this.prisma.ticket.groupBy({ by: ['status'], where: { createdAt }, _count: { _all: true } }),
      this.prisma.$queryRaw<Averages[]>(Prisma.sql`
        SELECT
          AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")))::float AS "avgFirstResponse",
          AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")))::float AS "avgResolution",
          COUNT(*) FILTER (WHERE "firstResponseAt" IS NOT NULL OR "slaBreached") AS "evaluated",
          COUNT(*) FILTER (WHERE "slaBreached") AS "breached"
        FROM "Ticket"
        WHERE "createdAt" BETWEEN ${from} AND ${to}
      `),
      this.prisma.triageSuggestion.groupBy({
        by: ['status'],
        where: { ticket: { createdAt } },
        _count: { _all: true },
      }),
    ]);

    const ticketsByStatus = Object.fromEntries(
      Object.values(TicketStatus).map((s) => [s, 0]),
    ) as Record<TicketStatus, number>;
    for (const row of byStatus) ticketsByStatus[row.status] = row._count._all;

    const count = (status: string) => triage.find((t) => t.status === status)?._count._all ?? 0;
    const aiSuggestions = {
      accepted: count('ACCEPTED'),
      corrected: count('CORRECTED'),
      pending: count('PENDING') + count('SUGGESTED'),
      failed: count('FAILED'),
    };

    return {
      totalTickets: Object.values(ticketsByStatus).reduce((a, b) => a + b, 0),
      ticketsByStatus,
      avgFirstResponseMinutes: secondsToMinutes(avg?.avgFirstResponse ?? null),
      avgResolutionMinutes: secondsToMinutes(avg?.avgResolution ?? null),
      slaCompliancePercent: slaCompliance(Number(avg?.evaluated ?? 0), Number(avg?.breached ?? 0)),
      aiAccuracyPercent: aiAccuracy(aiSuggestions.accepted, aiSuggestions.corrected),
      aiSuggestions,
    };
  }
}

@ApiTags('metrics')
@ApiBearerAuth()
@Roles('ATENDENTE', 'ADMIN')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  @ApiOkResponse({ type: MetricsOverviewDto })
  overview(@Query() query: MetricsQueryDto): Promise<MetricsOverviewDto> {
    return this.metrics.overview(query);
  }
}

@Module({ controllers: [MetricsController], providers: [MetricsService] })
export class MetricsModule {}
