import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../user/user.entity';

@Entity('nw_platform_account_links')
@Index('uq_platform_account_link', ['platform', 'platformAccountId'], { unique: true })
@Index('idx_platform_account_link_user', ['user', 'platform'])
export class PlatformAccountLinkEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ length: 32 })
  platform: string;

  @Column({ name: 'platform_account_id', length: 128 })
  platformAccountId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 191, nullable: true })
  displayName: string | null;

  @ManyToOne(() => UserEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
