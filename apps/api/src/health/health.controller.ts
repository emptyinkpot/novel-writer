import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    const uptime = process.uptime();
    let dbConnected = false;
    try {
      await this.dataSource.query('SELECT 1');
      dbConnected = true;
    } catch {}
    return { status: dbConnected ? 'ok' : 'degraded', uptime: Math.floor(uptime) };
  }
}
