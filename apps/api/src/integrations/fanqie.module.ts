import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAccountLinkEntity } from './platform-account-link.entity';
import { FanqieController } from './fanqie.controller';
import { FanqieService } from './fanqie.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformAccountLinkEntity])],
  controllers: [FanqieController],
  providers: [FanqieService],
})
export class FanqieModule {}
