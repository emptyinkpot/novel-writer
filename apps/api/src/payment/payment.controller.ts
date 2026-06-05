import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PaymentService } from './payment.service';
import { Request, Response } from 'express';

@Controller('api/v1/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('plans')
  getPlans() {
    return { code: 0, data: this.paymentService.getPlans() };
  }

  @Post('create-order')
  @UseGuards(JwtAuthGuard)
  async createOrder(
    @Req() req: Request,
    @Body() body: { planType: string; payMethod: string },
  ) {
    const user = req.user as any;
    const result = await this.paymentService.createOrder(
      user.id,
      body.planType,
      body.payMethod,
    );
    return { code: 0, data: result };
  }

  @Get('order-status')
  @UseGuards(JwtAuthGuard)
  async getOrderStatus(
    @Req() req: Request,
    @Query('orderNo') orderNo: string,
  ) {
    const user = req.user as any;
    const result = await this.paymentService.getOrderStatus(orderNo, user.id);
    return { code: 0, data: result };
  }

  @Post('notify/wechat')
  @HttpCode(200)
  async wechatNotify(@Body() body: Record<string, any>, @Res() res: Response) {
    const ok = await this.paymentService.handleWechatNotify(body);
    res.set('Content-Type', 'application/xml');
    const xml = ok
      ? '<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>'
      : '<xml><return_code><![CDATA[FAIL]]></return_code></xml>';
    res.send(xml);
  }

  @Post('notify/alipay')
  @HttpCode(200)
  async alipayNotify(@Body() body: Record<string, any>, @Res() res: Response) {
    const ok = await this.paymentService.handleAlipayNotify(body);
    res.send(ok ? 'success' : 'fail');
  }
}
