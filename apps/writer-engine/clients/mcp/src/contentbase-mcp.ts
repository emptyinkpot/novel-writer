#!/usr/bin/env node
// ContentBase MCP client：只调用已部署 HTTP 服务，不执行 git/ssh/docker/部署/验收脚本。
import { collectMaterials, createArticleJob, finalEditArticle, getArticleResult, getJob, health, polishArticle, waitForJob } from './contentbase-http-client.ts';
import { loadMcpEnv } from './env.ts';
import { startMcpServer, type ToolDefinition } from './mcp-protocol.ts';

const tools: ToolDefinition[] = [
  {
    name: 'contentbase_health',
    description: '检查已部署 ContentBase HTTP 服务状态。只请求生产 HTTP，不部署。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'contentbase_collect_materials',
    description: 'ContentBase 日常资料收集入口：只运行第一阶段资料收集 agents，并返回 fact/web/divergence/meaning/writingBrief 与上下文诊断。不生成正文，不部署，不运行 acceptance。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '自然语言写作要求。' },
        topic: { type: 'string', description: '文章主题；不填则从 input 解析。' },
        targetWordCount: { type: 'number', description: '目标字数。' },
      },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'contentbase_generate_article',
    description: 'ContentBase 日常写文章入口：向已部署 ContentBase HTTP 服务创建异步文章生成任务。默认走轻量事实链；可显式传 includeWeb/rounds/persistWeb 调整检索强度。默认只返回 jobId；wait=true 时等待完成并返回结果。不部署，不运行 tests/contentbase-acceptance.py。',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '自然语言写作要求。' },
        topic: { type: 'string', description: '文章主题；不填则从 input 解析。' },
        targetWordCount: { type: 'number', description: '目标字数。' },
        wait: { type: 'boolean', description: '是否等待任务完成并返回 result。' },
        timeoutSec: { type: 'number', description: '等待超时秒数，默认 1800。' },
        pollIntervalSec: { type: 'number', description: '轮询间隔秒数，默认 5。' },
        includeWeb: { type: 'boolean', description: '是否启用 Web 证据检索；默认 false。' },
        includeRagflow: { type: 'boolean', description: '是否启用 RAGFlow 证据检索；默认 true。' },
        persistWeb: { type: 'boolean', description: '是否持久化 Web 证据；默认 false。' },
        rounds: { type: 'number', description: '证据轮次，默认 2。' },
        evidenceTimeoutMs: { type: 'number', description: '证据检索超时毫秒数，默认 120000。' },
      },
      required: ['input'],
      additionalProperties: false,
    },
  },
  {
    name: 'contentbase_get_job',
    description: '查询已创建的 ContentBase 文章生成 job 状态。用于轮询日常生成任务，不部署。',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'contentbase_get_article_result',
    description: '读取已完成的 ContentBase 文章生成结果。用于取得日常生成成品，不部署。',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'contentbase_polish_article',
    description: 'ContentBase 日常润色入口：调用已部署 ContentBase 润色接口，只润色已有正文。不部署，不运行 acceptance。',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        title: { type: 'string' },
        instruction: { type: 'string' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'contentbase_final_edit_article',
    description: 'ContentBase 终稿编辑入口：对已有正文做全文评估、补充检索和局部终稿编辑。适合在主链最后或独立调用时做最后一遍通读润色/补写。',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        title: { type: 'string' },
        topic: { type: 'string' },
        query: { type: 'string' },
        styleAnchor: { type: 'string' },
        openingImage: { type: 'string' },
        chapterBoundaries: { type: 'string' },
        targetWordCount: { type: 'number' },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
];

loadMcpEnv();

startMcpServer({
  serverName: 'contentbase-http-mcp',
  version: '0.1.0',
  tools,
  handlers: {
    contentbase_health: async () => health(),
    contentbase_collect_materials: async (args) => collectMaterials(args),
    contentbase_generate_article: async (args) => {
      const created = await createArticleJob(args);
      const jobId = String(created?.data?.id || '');
      if (!jobId) throw new Error('ContentBase did not return data.id');
      if (!args.wait) return created;
      await waitForJob(jobId, Number(args.timeoutSec || 1800), Number(args.pollIntervalSec || 5));
      return getArticleResult(jobId);
    },
    contentbase_get_job: async (args) => getJob(args.jobId),
    contentbase_get_article_result: async (args) => getArticleResult(args.jobId),
    contentbase_polish_article: async (args) => polishArticle(args),
    contentbase_final_edit_article: async (args) => finalEditArticle(args),
  },
});
