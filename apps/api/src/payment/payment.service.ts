import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
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

interface PaymentIntent {
  provider: string;
  mode: 'redirect' | 'qrcode';
  paymentUrl: string;
}

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

    const payment = await this.initiatePayment(order, payMethod);

    return {
      orderNo: order.orderNo,
      amount: plan.price,
      payMethod,
      paymentUrl: payment.paymentUrl,
      paymentMode: payment.mode,
      provider: payment.provider,
    };
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
  ): Promise<PaymentIntent> {
    if (payMethod === 'wechat') {
      return this.createWechatPay(order);
    }
    if (payMethod === 'alipay') {
      return this.createAlipay(order);
    }
    throw new BadRequestException(`unsupported payment method: ${payMethod}`);
  }

  private async createWechatPay(order: OrderEntity): Promise<PaymentIntent> {
    const mchId = process.env.WECHAT_MCH_ID;
    const appId = process.env.WECHAT_PAY_APP_ID || process.env.WECHAT_APP_ID;
    const apiKey = process.env.WECHAT_MCH_KEY || process.env.WECHAT_PAY_API_KEY;
    const notifyUrl = process.env.WECHAT_PAY_NOTIFY_URL || this.absoluteApiUrl('/api/v1/payment/notify/wechat');
    if (!mchId || !appId || !apiKey || !notifyUrl) {
      throw new ServiceUnavailableException('wechat pay is not configured');
    }

    const payload: Record<string, string> = {
      appid: appId,
      mch_id: mchId,
      nonce_str: crypto.randomBytes(16).toString('hex'),
      body: `咕嘎写作-${PLANS[order.planType]?.name || order.planType}`,
      out_trade_no: order.orderNo,
      total_fee: String(Math.round(Number(order.amount) * 100)),
      spbill_create_ip: process.env.WECHAT_PAY_CLIENT_IP || '127.0.0.1',
      notify_url: notifyUrl,
      trade_type: 'NATIVE',
    };
    payload.sign = this.signWechatV2(payload, apiKey);

    const res = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: this.toWechatXml(payload),
    });
    const xml = await res.text();
    const data = this.parseSimpleXml(xml);
    if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS' || !data.code_url) {
      throw new ServiceUnavailableException(data.return_msg || data.err_code_des || 'wechat native pay failed');
    }

    return { provider: 'wechat', mode: 'qrcode', paymentUrl: data.code_url };
  }

  private async createAlipay(order: OrderEntity): Promise<PaymentIntent> {
    const appId = process.env.ALIPAY_APP_ID;
    const privateKey = process.env.ALIPAY_PRIVATE_KEY;
    const gateway = process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
    const notifyUrl = process.env.ALIPAY_NOTIFY_URL || this.absoluteApiUrl('/api/v1/payment/notify/alipay');
    const returnUrl = process.env.ALIPAY_RETURN_URL || process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:19200/pricing';
    if (!appId || !privateKey || !notifyUrl || !returnUrl) {
      throw new ServiceUnavailableException('alipay is not configured');
    }

    const params: Record<string, string> = {
      app_id: appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.formatAlipayTimestamp(new Date()),
      version: '1.0',
      notify_url: notifyUrl,
      return_url: returnUrl,
      biz_content: JSON.stringify({
        out_trade_no: order.orderNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: order.amount,
        subject: `咕嘎写作-${PLANS[order.planType]?.name || order.planType}`,
      }),
    };
    params.sign = this.signAlipay(params, privateKey);

    return { provider: 'alipay', mode: 'redirect', paymentUrl: `${gateway}?${new URLSearchParams(params).toString()}` };
  }

  private absoluteApiUrl(path: string): string {
    const base = process.env.API_PUBLIC_URL
      || process.env.APP_URL
      || process.env.FRONTEND_URL
      || 'http://localhost:19200';
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private signWechatV2(params: Record<string, string>, key: string): string {
    const source = Object.keys(params)
      .filter((name) => name !== 'sign' && params[name])
      .sort()
      .map((name) => `${name}=${params[name]}`)
      .join('&');
    return crypto.createHash('md5').update(`${source}&key=${key}`).digest('hex').toUpperCase();
  }

  private toWechatXml(params: Record<string, string>): string {
    const nodes = Object.entries(params)
      .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
      .join('');
    return `<xml>${nodes}</xml>`;
  }

  private parseSimpleXml(xml: string): Record<string, string> {
    const data: Record<string, string> = {};
    for (const match of xml.matchAll(/<([a-zA-Z0-9_]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g)) {
      data[match[1]] = match[2];
    }
    return data;
  }

  private signAlipay(params: Record<string, string>, privateKey: string): string {
    const source = Object.keys(params)
      .filter((name) => name !== 'sign' && params[name])
      .sort()
      .map((name) => `${name}=${params[name]}`)
      .join('&');
    const normalizedKey = privateKey.includes('BEGIN')
      ? privateKey.replace(/\\n/g, '\n')
      : `-----BEGIN PRIVATE KEY-----\n${privateKey.replace(/\\n/g, '\n')}\n-----END PRIVATE KEY-----`;
    return crypto.createSign('RSA-SHA256').update(source, 'utf8').sign(normalizedKey, 'base64');
  }

  private formatAlipayTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
