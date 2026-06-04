export interface MemberPlan {
  plan: 'free' | 'basic' | 'pro';
  quota: number;
  memberQuota: number;
  wordPackages: number;
  exchangedQuota: number;
  freeWordPackages: number;
  extraWordPackages: number;
  startDate: string;
  endDate: string;
  lastRefreshDate: string;
  lastQuotaRefreshDate: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string;
  provider: 'wechat' | 'google' | 'email';
  inviteCode: string;
  userType: 'REGULAR' | 'VIP';
  status: 'NORMAL' | 'BANNED';
  memberPlan: MemberPlan;
  lastSignInAt: string;
  createdAt: string;
  updatedAt: string;
}
