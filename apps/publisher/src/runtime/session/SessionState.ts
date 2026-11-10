/**
 * 番茄账号登录态快照。
 *
 * 这是 runtime 层对一次 session 检查结果的最小表达；
 * 具体证据可以放在 evidence 中，但业务判断只依赖 status。
 */
export interface SessionState {
  /** 被检查的番茄账号 ID。 */
  accountId: string;
  /** 当前登录态判断结果。 */
  status: 'valid' | 'expired' | 'missing' | 'unknown';
  /** 检查发生的 ISO 时间。 */
  checkedAt: string;
  /** 浏览器页面、cookie、截图路径等诊断证据。 */
  evidence?: Record<string, unknown>;
}
