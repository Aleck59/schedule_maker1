import './config/env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/validation';
import { loadConfig } from './config/configuration';

export async function createApp(options: { quiet?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.quiet ? ['error', 'warn'] : ['log', 'error', 'warn'],
  });
  const config = loadConfig();
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '5mb' });

  const swagger = new DocumentBuilder()
    .setTitle('Расписание СПО — API')
    .setDescription(
      'REST API системы автоматизированного составления расписания колледжа СПО: учебные планы, ' +
        'нагрузка, календарный график, генерация расписания (OR-Tools CP-SAT), контроль часов и отчёты.',
    )
    .setVersion(process.env.APP_VERSION ?? 'dev')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Расписание СПО — API',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  });
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const config = loadConfig();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API запущен: http://localhost:${config.port}/api (Swagger: /api/docs)`, 'Bootstrap');
}

if (require.main === module) {
  void bootstrap();
}
