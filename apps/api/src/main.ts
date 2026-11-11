import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { LOCAL_ADMIN_ENABLED } from './env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (LOCAL_ADMIN_ENABLED) await app.listen(process.env.PORT || 19201, '127.0.0.1');
  else await app.listen(process.env.PORT || 19201);
}
bootstrap();
