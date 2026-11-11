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
import { PlatformAccountLinkEntity } from './integrations/platform-account-link.entity';
import { FanqieModule } from './integrations/fanqie.module';
import { LocalBootstrapService } from './local-bootstrap.service';
import { DATA_DIR, USE_MYSQL, requiredEnv } from './env';
import { resolve } from 'path';

const ENTITIES = [UserEntity, SessionEntity, WorkEntity, OrderEntity, ChapterEntity, PlatformAccountLinkEntity];

@Module({
  imports: [
    TypeOrmModule.forRoot(
      USE_MYSQL
        ? {
            type: 'mysql',
            host: requiredEnv('DB_HOST'),
            port: parseInt(process.env.DB_PORT || '3306', 10),
            username: requiredEnv('DB_USER'),
            password: requiredEnv('DB_PASS'),
            database: requiredEnv('DB_NAME'),
            entities: ENTITIES,
            synchronize: false,
          }
        : {
            type: 'better-sqlite3',
            database: resolve(DATA_DIR, 'novel-writer.sqlite'),
            entities: ENTITIES,
            synchronize: true,
          },
    ),
    AuthModule,
    UserModule,
    LibraryModule,
    ChatModule,
    SessionModule,
    HealthModule,
    PaymentModule,
    ChapterModule,
    FanqieModule,
  ],
  providers: [LocalBootstrapService],
})
export class AppModule {}
