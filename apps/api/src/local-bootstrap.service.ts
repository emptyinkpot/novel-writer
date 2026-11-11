import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';
import { AuthService } from './auth/auth.service';
import { LOCAL_ADMIN_ENABLED } from './env';

@Injectable()
export class LocalBootstrapService implements OnApplicationBootstrap {
  constructor(private readonly dataSource: DataSource, private readonly authService: AuthService) {}

  async onApplicationBootstrap() {
    await this.ensureOwnershipSchema();
    if (!LOCAL_ADMIN_ENABLED) return;
    const admin = await this.authService.ensureConfiguredLocalAdmin();
    if (admin) {
      await this.dataSource.query('UPDATE works SET owner_user_id = ? WHERE owner_user_id IS NULL', [admin.id]);
    }
  }

  private async ensureOwnershipSchema() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      if (!(await runner.hasColumn('works', 'owner_user_id'))) {
        await runner.addColumn('works', new TableColumn({ name: 'owner_user_id', type: 'int', isNullable: true }));
      }
      const works = await runner.getTable('works');
      if (works && !works.foreignKeys.some((key) => key.columnNames.includes('owner_user_id'))) {
        await runner.createForeignKey('works', new TableForeignKey({
          name: 'fk_works_owner_user',
          columnNames: ['owner_user_id'],
          referencedTableName: 'nw_users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }));
      }
      const refreshedWorks = await runner.getTable('works');
      if (refreshedWorks && !refreshedWorks.indices.some((index) => index.name === 'idx_works_owner_updated')) {
        await runner.createIndex('works', new TableIndex({
          name: 'idx_works_owner_updated',
          columnNames: ['owner_user_id', 'updated_at'],
        }));
      }
      if (!(await runner.hasTable('nw_platform_account_links'))) {
        await runner.createTable(new Table({
          name: 'nw_platform_account_links',
          columns: [
            new TableColumn({ name: 'id', type: 'varchar', length: '36', isPrimary: true }),
            new TableColumn({ name: 'platform', type: 'varchar', length: '32' }),
            new TableColumn({ name: 'platform_account_id', type: 'varchar', length: '128' }),
            new TableColumn({ name: 'display_name', type: 'varchar', length: '191', isNullable: true }),
            new TableColumn({ name: 'user_id', type: 'int' }),
            new TableColumn({ name: 'created_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' }),
          ],
          indices: [
            new TableIndex({ name: 'uq_platform_account_link', columnNames: ['platform', 'platform_account_id'], isUnique: true }),
            new TableIndex({ name: 'idx_platform_account_link_user', columnNames: ['user_id', 'platform'] }),
          ],
          foreignKeys: [new TableForeignKey({
            name: 'fk_platform_account_link_user',
            columnNames: ['user_id'],
            referencedTableName: 'nw_users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          })],
        }));
      } else if (!(await runner.hasColumn('nw_platform_account_links', 'display_name'))) {
        await runner.addColumn('nw_platform_account_links', new TableColumn({
          name: 'display_name', type: 'varchar', length: '191', isNullable: true,
        }));
      }
    } finally {
      await runner.release();
    }
  }
}
