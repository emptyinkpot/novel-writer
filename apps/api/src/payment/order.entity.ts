import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('nw_orders')
export class OrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Index({ unique: true })
  @Column({ name: 'order_no', length: 64, unique: true })
  orderNo: string;

  @Column({ name: 'plan_type', length: 32 })
  planType: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: string;

  @Column({ name: 'pay_method', length: 32, nullable: true })
  payMethod: string;

  @Column({ length: 32, default: 'pending' })
  status: string;

  @Column({ name: 'trade_no', length: 128, nullable: true })
  tradeNo: string;

  @Column({ name: 'paid_at', type: 'datetime', nullable: true })
  paidAt: Date;

  @Column({ name: 'expired_at', type: 'datetime', nullable: true })
  expiredAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
