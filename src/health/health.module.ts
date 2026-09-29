import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { TriageProducer } from '../queue/triage.producer';

type Check = 'up' | 'down';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: TriageProducer,
  ) {}

  /** 200 se banco e Redis respondem; 503 caso contrário (para orquestrador/load balancer). */
  @Public()
  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', checks: { database: 'up', redis: 'up' } } } })
  @ApiServiceUnavailableResponse()
  async check(): Promise<{ status: 'ok'; checks: Record<string, Check> }> {
    const [database, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000).then<Check, Check>(
        () => 'up',
        () => 'down',
      ),
      withTimeout(this.producer.ping(), 2_000).then<Check, Check>(
        () => 'up',
        () => 'down',
      ),
    ]);
    const checks = { database, redis };
    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({
        message: 'Dependência indisponível',
        errors: checks,
      });
    }
    return { status: 'ok', checks };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
