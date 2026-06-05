import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { LibraryModule } from './library/library.module';
import { ChatModule } from './chat/chat.module';
import { SessionModule } from './session/session.module';
import { HealthModule } from './health/health.module';
import { UserEntity } from './user/user.entity';
import { SessionEntity } from './session/session.entity';
import { WorkEntity } from './library/work.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || '124.220.245.121',
      port: parseInt(process.env.DB_PORT || '22295', 10),
      username: process.env.DB_USER || 'database_content_rw',
      password: process.env.DB_PASS || 'vreDCh386uglGIa05sEx1JO9wcAZyK4W',
      database: process.env.DB_NAME || 'cloudbase-4glvyyq9f61b19cd',
      entities: [UserEntity, SessionEntity, WorkEntity],
      synchronize: true,
    }),
    AuthModule,
    UserModule,
    LibraryModule,
    ChatModule,
    SessionModule,
    HealthModule,
  ],
})
export class AppModule {}
