import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { appValidationPipe } from './common/validation.pipe';
import { ENV } from './config/config.module';
import { Env } from './config/env.schema';

/** Configuração HTTP compartilhada entre main.ts e os testes E2E. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()) });
  app.useGlobalPipes(appValidationPipe);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('HelpDesk API')
    .setDescription('API de chamados com triagem assíncrona por IA')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    swaggerOptions: { persistAuthorization: true },
  });
}
