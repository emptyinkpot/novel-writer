import { startStdioServer } from './transport/stdio.js';

startStdioServer().catch((error) => {
  console.error('[fanqie-service] MCP stdio transport failed:', error);
  process.exit(1);
});
