// 文章产品源码主入口：只向 server.ts 暴露文章业务入口。
//
// 分层地图：
// - registry/：agent/tool 注册声明，只记录产物 owner、能力边界和 stage 约束。
// - runtime/article-runtime.ts：文章生成业务主入口，内部调用 article-flow。
// - contracts.ts：文章生产流水线的共享协议，只定义跨层数据形状。
// - planning/context-builder.ts：资料召回、RAGFlow/DataBase/STORM 装箱、预算裁剪和诊断，不写正文。
// - context/：source authority、Writer context projection 和 context diagnostics 等上下文子能力。
// - agents/：多 agent 阅读材料、组织写作简报、审稿和修订；prompts/ 是唯一提示词根。
// - tools/：LLM、HTTP、DataBase、STORM 等工具能力实现，不拥有文章产物。
// - postprocess/index.ts：确定性后处理和风格传感器，不做二次创作。
// - jobs/：在 article 模块外层管理异步任务生命周期和结果持久化。
export { createArticleRuntime } from './runtime/article-runtime.ts';
export type { ArticleProgressEvent, ArticleRuntime, ArticleRuntimeOptions } from './runtime/article-runtime.ts';
