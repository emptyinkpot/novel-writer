/**
 * 队列任务的最小 contract：入队后异步执行，不返回业务结果。
 */
export type QueueTask = () => Promise<void>;

/**
 * 进程内 FIFO 队列。
 *
 * 用于需要单进程串行化的后台任务；它不做持久化，也不跨进程协调。
 * 如果服务重启，队列中的未执行任务会丢失。
 */
export class InMemoryJobQueue {
  /**
   * 当前队尾 promise。
   * 新任务总是挂到 current 后面，形成串行执行链。
   */
  private current = Promise.resolve();

  /**
   * 把任务追加到队尾并返回该任务自己的完成 promise。
   *
   * this.current 会吞掉当前任务错误，保证后续任务仍能继续排队；
   * 调用方拿到的 next 仍会保留原始成功/失败状态。
   */
  enqueue(task: QueueTask): Promise<void> {
    const next = this.current.then(task, task);
    this.current = next.catch(() => undefined);
    return next;
  }
}
