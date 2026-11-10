export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
};

export type ToolHandler = (args: Record<string, any>) => Promise<any>;

export function startMcpServer(input: {
  serverName: string;
  version: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      void handleLine(line, input);
    }
  });
}

async function handleLine(line: string, server: {
  serverName: string;
  version: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line);
  } catch (error) {
    writeResponse(null, null, errorPayload(-32700, `Parse error: ${stringifyError(error)}`));
    return;
  }
  try {
    const result = await routeRequest(request, server);
    if (request.id !== undefined) writeResponse(request.id, result);
  } catch (error) {
    if (request.id !== undefined) writeResponse(request.id, null, errorPayload(-32000, stringifyError(error)));
  }
}

async function routeRequest(request: JsonRpcRequest, server: {
  serverName: string;
  version: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}): Promise<any> {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: server.serverName, version: server.version },
      };
    case 'notifications/initialized':
      return {};
    case 'tools/list':
      return { tools: server.tools };
    case 'tools/call': {
      const name = String(request.params?.name || '');
      const handler = server.handlers[name];
      if (!handler) throw new Error(`Unknown MCP tool: ${name}`);
      const result = await handler(readObject(request.params?.arguments));
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    default:
      throw new Error(`Unsupported MCP method: ${request.method || 'missing'}`);
  }
}

function writeResponse(id: JsonRpcRequest['id'], result: any, error?: any): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`);
}

function errorPayload(code: number, message: string): Record<string, any> {
  return { code, message };
}

function readObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
