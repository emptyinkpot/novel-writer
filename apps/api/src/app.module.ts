import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { LibraryModule } from './library/library.module';
import { ChatModule } from './chat/chat.module';
import { SessionModule } from './session/session.module';
import { HealthModule } from './health/health.module';
import { PaymentModule } from './payment/payment.module';
import { UserEntity } from './user/user.entity';
import { SessionEntity } from './session/session.entity';
import { WorkEntity } from './library/work.entity';
import { OrderEntity } from './payment/order.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'SERVER_IP_REMOVED',
      port: parseInt(process.env.DB_PORT || '22295', 10),
      username: process.env.DB_USER || 'database_content_rw',
      password: process.env.DB_PASS || 'vreDCh386uglGIa05sEx1JO9wcAZyK4W',
      database: process.env.DB_NAME || 'cloudbase-4glvyyq9f61b19cd',
      entities: [UserEntity, SessionEntity, WorkEntity, OrderEntity],
      synchronize: false,
    }),
    AuthModule,
    UserModule,
    LibraryModule,
    ChatModule,
    SessionModule,
    HealthModule,
    PaymentModule,
  ],
})
export class AppModule {}
