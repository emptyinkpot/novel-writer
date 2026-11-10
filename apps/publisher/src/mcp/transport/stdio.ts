import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContainer } from '../../container.js';
import { registerFanqieTools } from '../tool-registry/mcp-tools.js';

export async function startStdioServer() {
  const container = createContainer();
  const server = new McpServer({
    name: 'fanqie-service',
    version: container.config.version,
  });
  registerFanqieTools(server, container);
  await server.connect(new StdioServerTransport());
  console.error('[fanqie-service] MCP stdio transport started');
}
