import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { FanqieService } from './fanqie.service';

@Controller('api/v1/fanqie')
@UseGuards(JwtAuthGuard)
export class FanqieController {
  constructor(private readonly fanqieService: FanqieService) {}

  @Get('accounts')
  listAccounts(@Req() req: Request) {
    return this.respond(this.fanqieService.listAccounts(this.userId(req)));
  }

  @Post('accounts/discover')
  discoverAccount(@Req() req: Request) {
    return this.respond(this.fanqieService.discoverAccount(this.userId(req)));
  }

  @Post('accounts/:accountId/link')
  linkAccount(@Req() req: Request, @Param('accountId') accountId: string, @Body() body: { displayName?: string }) {
    return this.respond(this.fanqieService.linkAccount(this.userId(req), accountId, body.displayName));
  }

  @Post('accounts/:accountId/scan')
  scanAccount(@Req() req: Request, @Param('accountId') accountId: string) {
    return this.respond(this.fanqieService.scanAccount(this.userId(req), accountId));
  }

  @Get('accounts/:accountId/works/:bookId/chapters')
  listChapters(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string) {
    return this.respond(this.fanqieService.listChapters(this.userId(req), accountId, bookId));
  }

  @Get('accounts/:accountId/works/:bookId/chapters/:itemId')
  getChapter(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string,
    @Param('itemId') itemId: string) {
    return this.respond(this.fanqieService.getChapter(this.userId(req), accountId, bookId, itemId));
  }

  @Post('accounts/:accountId/works/:bookId/chapters/:itemId')
  updateChapter(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string,
    @Param('itemId') itemId: string, @Body() body: { title?: string; contentText?: string }) {
    return this.respond(this.fanqieService.updateChapter(this.userId(req), accountId, bookId, itemId, body));
  }

  @Get('accounts/:accountId/works/:bookId/drafts/:itemId')
  getDraft(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string, @Param('itemId') itemId: string) {
    return this.respond(this.fanqieService.getDraft(this.userId(req), accountId, bookId, itemId));
  }

  @Post('accounts/:accountId/works/:bookId/drafts/:itemId')
  updateDraft(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string,
    @Param('itemId') itemId: string, @Body() body: { title?: string; content?: string }) {
    return this.respond(this.fanqieService.updateDraft(this.userId(req), accountId, bookId, itemId, body));
  }

  @Post('accounts/:accountId/works/:bookId/drafts/:itemId/publish')
  publishDraft(@Req() req: Request, @Param('accountId') accountId: string, @Param('bookId') bookId: string,
    @Param('itemId') itemId: string, @Body() body: { chapterNumber: number }) {
    return this.respond(this.fanqieService.publishDraft(this.userId(req), accountId, bookId, itemId, Number(body.chapterNumber)));
  }

  private userId(req: Request) {
    return (req.user as { id: number }).id;
  }

  private async respond<T>(task: Promise<T>) {
    return { code: 0, data: await task };
  }
}
