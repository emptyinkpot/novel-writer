import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { LibraryModule } from './library/library.module';
import { ChatModule } from './chat/chat.module';
import { SessionModule } from './session/session.module';
import { HealthModule } from './health/health.module';
import { PaymentModule } from './payment/payment.module';
import { ChapterModule } from './chapter/chapter.module';
import { UserEntity } from './user/user.entity';
import { SessionEntity } from './session/session.entity';
import { WorkEntity } from './library/work.entity';
import { OrderEntity } from './payment/order.entity';
import { ChapterEntity } from './chapter/chapter.entity';
import { requiredEnv } from './env';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: requiredEnv('DB_HOST'),
      port: parseInt(requiredEnv('DB_PORT'), 10),
      username: requiredEnv('DB_USER'),
      password: requiredEnv('DB_PASS'),
      database: requiredEnv('DB_NAME'),
      entities: [UserEntity, SessionEntity, WorkEntity, OrderEntity, ChapterEntity],
      synchronize: false,
    }),
    AuthModule,
    UserModule,
    LibraryModule,
    ChatModule,
    SessionModule,
    HealthModule,
    PaymentModule,
    ChapterModule,
  ],
})
export class AppModule {}
