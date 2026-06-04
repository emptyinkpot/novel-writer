import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { LibraryModule } from './library/library.module';
import { ChatModule } from './chat/chat.module';
import { SessionModule } from './session/session.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'PRIVATE_IP_REMOVED',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'novel_writer',
      password: process.env.DB_PASS || 'changeme',
      database: process.env.DB_NAME || 'novel_writer',
      autoLoadEntities: true,
      synchronize: false,
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
