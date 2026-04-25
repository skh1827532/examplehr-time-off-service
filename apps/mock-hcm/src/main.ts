import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.MOCK_HCM_PORT ?? 4000);
  await app.listen(port);
  new Logger('MockHCM').log(`Mock HCM listening on :${port}`);
}

if (require.main === module) {
  bootstrap();
}
