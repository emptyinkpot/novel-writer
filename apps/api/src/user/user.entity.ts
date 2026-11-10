import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { columnTypes } from '../env';

@Entity('nw_users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 191, unique: true })
  email: string;

  @Column({ name: 'password_hash', length: 255, nullable: true })
  passwordHash: string;

  @Column({ name: 'full_name', length: 128, nullable: true })
  fullName: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string;

  @Column({ length: 32, default: 'email' })
  provider: string;

  @Column({ name: 'user_type', length: 32, default: 'free' })
  userType: string;

  @Column({ length: 32, default: 'active' })
  status: string;

  @Column({ name: 'member_plan', type: columnTypes.json, nullable: true })
  memberPlan: Record<string, any>;

  @Column({ name: 'last_sign_in_at', type: 'datetime', nullable: true })
  lastSignInAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
