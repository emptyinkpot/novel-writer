/**
 * 浏览器 runtime 的最小状态接口。
 *
 * 这里目前只暴露是否可用和名称；真正的 Playwright 执行逻辑在
 * browser/*.mjs 脚本与 ScriptFanqiePlatformDriver 中。
 */
export interface BrowserRuntime {
  /** 当前 runtime 是否已经具备可执行配置。 */
  readonly configured: boolean;
  /** runtime 名称，用于健康检查和诊断输出。 */
  readonly name: string;
}

/**
 * Playwright runtime 占位实现。
 *
 * 当前 TS 服务层不直接持有 Playwright context，所以这里标记为未配置；
 * 实际浏览器调用走脚本 driver。
 */
export class PlaywrightBrowserRuntime implements BrowserRuntime {
  readonly configured = false;
  readonly name = 'playwright';
}
