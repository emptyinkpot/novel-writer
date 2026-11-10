/**
 * 浏览器 profile key 解析接口。
 *
 * 上层只关心账号对应哪个 profile key，不直接决定磁盘目录结构。
 */
export interface BrowserProfileStore {
  /** 把账号 ID 映射为浏览器 profile 的稳定 key。 */
  resolveProfileKey(accountId: string): string;
}

/**
 * 文件系统 profile key 实现。
 *
 * 当前约定把所有番茄账号放在 fanqie/ 命名空间下，避免和其他平台混用。
 */
export class FileBrowserProfileStore implements BrowserProfileStore {
  /** 返回相对 profile key，真正的根目录由调用方/runtime 配置决定。 */
  resolveProfileKey(accountId: string): string {
    return `fanqie/${accountId}`;
  }
}
