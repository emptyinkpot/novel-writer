import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from './order.entity';
import { UserEntity } from '../user/user.entity';

interface PlanDefinition {
  type: string;
  name: string;
  price: string;
  durationDays: number;
}

const PLANS: Record<string, PlanDefinition> = {
  weekly: { type: 'weekly', name: '周卡', price: '49.99', durationDays: 7 },
  monthly: { type: 'monthly', name: '月卡', price: '89.99', durationDays: 30 },
  quarterly: { type: 'quarterly', name: '季卡', price: '254.99', durationDays: 90 },
  yearly: { type: 'yearly', name: '年卡', price: '949.99', durationDays: 365 },
};

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  getPlans() {
    return Object.values(PLANS).map((p) => ({
      type: p.type,
      name: p.name,
      price: p.price,
      durationDays: p.durationDays,
    }));
  }

  async createOrder(userId: number, planType: string, payMethod: string) {
    const plan = PLANS[planType];
    if (!plan) throw new Error(`invalid plan: ${planType}`);

    const orderNo = this.generateOrderNo();
    const order = this.orderRepo.create({
      userId,
      orderNo,
      planType,
      amount: plan.price,
      payMethod,
      status: 'pending',
    });
    await this.orderRepo.save(order);

    const paymentUrl = await this.initiatePayment(order, payMethod);

    return { orderNo: order.orderNo, amount: plan.price, payMethod, paymentUrl };
  }

  async getOrderStatus(orderNo: string, userId: number) {
    const order = await this.orderRepo.findOneBy({ orderNo, userId });
    if (!order) throw new Error('order not found');
    return { orderNo: order.orderNo, status: order.status, paidAt: order.paidAt };
  }

  async handleWechatNotify(body: Record<string, any>): Promise<boolean> {
    const orderNo = body?.out_trade_no as string;
    const tradeNo = body?.transaction_id as string;
    if (!orderNo) return false;

    const order = await this.orderRepo.findOneBy({ orderNo });
    if (!order || order.status === 'paid') return true;

    order.status = 'paid';
    order.tradeNo = tradeNo;
    order.paidAt = new Date();
    await this.orderRepo.save(order);
    await this.activateMemberPlan(order);
    return true;
  }

  async handleAlipayNotify(body: Record<string, any>): Promise<boolean> {
    const orderNo = body?.out_trade_no as string;
    const tradeNo = body?.trade_no as string;
    const tradeStatus = body?.trade_status as string;
    if (!orderNo || tradeStatus !== 'TRADE_SUCCESS') return false;

    const order = await this.orderRepo.findOneBy({ orderNo });
    if (!order || order.status === 'paid') return true;

    order.status = 'paid';
    order.tradeNo = tradeNo;
    order.paidAt = new Date();
    await this.orderRepo.save(order);
    await this.activateMemberPlan(order);
    return true;
  }

  private async activateMemberPlan(order: OrderEntity) {
    const plan = PLANS[order.planType];
    if (!plan) return;

    const now = new Date();
    const expireAt = new Date(now);
    expireAt.setDate(expireAt.getDate() + plan.durationDays);

    const memberPlan = {
      type: order.planType,
      startAt: now.toISOString().slice(0, 10),
      expireAt: expireAt.toISOString().slice(0, 10),
      wordPackages: [{ type: 'unlimited', remaining: -1 }],
    };

    await this.userRepo.update(order.userId, {
      userType: 'member',
      memberPlan: memberPlan as any,
    });
  }

  private async initiatePayment(
    order: OrderEntity,
    payMethod: string,
  ): Promise<string | null> {
    if (payMethod === 'wechat') {
      return this.createWechatPay(order);
    }
    if (payMethod === 'alipay') {
      return this.createAlipay(order);
    }
    return null;
  }

  private async createWechatPay(order: OrderEntity): Promise<string | null> {
    const mchId = process.env.WECHAT_MCH_ID;
    const mchKey = process.env.WECHAT_MCH_KEY;
    if (!mchId || !mchKey) return null;
    void order;
    return null;
  }

  private async createAlipay(order: OrderEntity): Promise<string | null> {
    const appId = process.env.ALIPAY_APP_ID;
    const privateKey = process.env.ALIPAY_PRIVATE_KEY;
    if (!appId || !privateKey) return null;
    void order;
    return null;
  }

  private generateOrderNo(): string {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `NW${ts}${rand}`;
  }
}
