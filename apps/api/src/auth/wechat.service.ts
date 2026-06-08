import { Injectable, UnauthorizedException } from '@nestjs/common';

interface WechatTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatUserInfo {
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class WechatService {
  private readonly appId = process.env.WECHAT_APP_ID || '';
  private readonly appSecret = process.env.WECHAT_APP_SECRET || '';
  private readonly redirectUri = process.env.WECHAT_REDIRECT_URI || '';
  private readonly oauthMode = process.env.WECHAT_OAUTH_MODE || 'mp';

  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      appid: this.appId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.oauthMode === 'qrconnect' ? 'snsapi_login' : 'snsapi_userinfo',
      state: state || 'login',
    });

    if (this.oauthMode === 'qrconnect') {
      return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
    }

    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
  }

  async exchangeCodeForToken(code: string): Promise<WechatTokenResponse> {
    if (!this.appId || !this.appSecret) {
      throw new UnauthorizedException('wechat oauth not configured');
    }
    const params = new URLSearchParams({
      appid: this.appId,
      secret: this.appSecret,
      code,
      grant_type: 'authorization_code',
    });
    const url = `https://api.weixin.qq.com/sns/oauth2/access_token?${params.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as WechatTokenResponse;
    if (data.errcode) {
      throw new UnauthorizedException(`wechat token exchange failed: ${data.errmsg}`);
    }
    return data;
  }

  async fetchUserInfo(accessToken: string, openid: string): Promise<WechatUserInfo> {
    const params = new URLSearchParams({
      access_token: accessToken,
      openid,
      lang: 'zh_CN',
    });
    const url = `https://api.weixin.qq.com/sns/userinfo?${params.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as WechatUserInfo;
    if (data.errcode) {
      throw new UnauthorizedException(`wechat userinfo failed: ${data.errmsg}`);
    }
    return data;
  }
}
