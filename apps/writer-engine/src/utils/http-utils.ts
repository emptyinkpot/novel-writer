import type { IncomingMessage, ServerResponse } from 'node:http';

// HTTP 工具源码：提供鉴权、JSON/HTML/Markdown/Text 响应和请求体读取。
// src/server.ts 通过这里保持路由处理代码简洁一致。
export function createAuthChecker(apiKey: unknown) {
  const expectedApiKey = String(apiKey || '').trim();
  return function checkAuth(req: IncomingMessage, res: ServerResponse) {
    if (!expectedApiKey) return true;
    const auth = String(req.headers['authorization'] || req.headers['x-api-key'] || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (token === expectedApiKey) return true;
    writeJson(res, 401, { success: false, error: 'Unauthorized: invalid or missing API key' });
    return false;
  };
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('request body must be JSON');
  }
}

export function writeJson(res: ServerResponse, status: number, payload: any) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    ...(payload === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
  });
  res.end(payload === null ? '' : JSON.stringify(payload));
}

export function writeText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function writeHtml(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

export function writeMarkdown(res: ServerResponse, status: number, text: string, filename = 'contentbase-article.md') {
  const safeFilename = String(filename || 'contentbase-article.md').replace(/[\\/:*?"<>|\r\n]+/g, '_');
  res.writeHead(status, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}
