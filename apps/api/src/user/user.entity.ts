import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'full_name', nullable: true })
  fullName: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string;

  @Column({ nullable: true })
  provider: string;

  @Column({ name: 'invite_code', nullable: true })
  inviteCode: string;

  @Column({ name: 'user_type', default: 'free' })
  userType: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ name: 'member_plan', type: 'jsonb', nullable: true })
  memberPlan: Record<string, any>;

  @Column({ name: 'last_sign_in_at', type: 'timestamptz', nullable: true })
  lastSignInAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
