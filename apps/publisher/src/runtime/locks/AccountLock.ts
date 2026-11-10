/**
 * 按账号维度串行化运行任务。
 *
 * 同一个番茄账号的浏览器 profile、cookie 和发布状态不能被并发写入；
 * 这个锁只约束同一个 accountId，不阻塞不同账号之间的任务。
 */
export class AccountLock {
  /**
   * 每个账号当前排队中的 promise。
   * value 代表“当前账号的队尾”，后续任务会接在它后面执行。
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  /**
   * 在指定账号的串行队列中执行一个异步任务。
   *
   * 即使前一个任务失败，后续任务也会继续获得执行机会；
   * finally 中释放当前任务，并在自己仍是队尾时清理 Map。
   */
  async run<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const key = accountId.trim();
    const previous = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    // current 是本任务的占位 promise，用来让下一批同账号任务排在后面。
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    try {
      // 前序任务失败不能阻断队列，错误由前序任务自己的调用方处理。
      await previous.catch(() => undefined);
      return await task();
    } finally {
      release();
      // 只有当前任务仍然是队尾时才删除，避免误删后续任务刚登记的锁。
      if (this.locks.get(key) === tail) {
        this.locks.delete(key);
      }
    }
  }
}
