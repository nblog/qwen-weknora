/** MCP server lifecycle and registration of the fixed WeKnora tools. */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { WeknoraClient } from './client.ts'
import type { ResolvedConfig } from './config.ts'
import { createTools } from './tools.ts'

export interface WeknoraMcpApplication {
  readonly server: McpServer
  close(): Promise<void>
}

/** Build an MCP server without connecting a transport. */
export function createWeknoraMcpServer(
  client: WeknoraClient,
  config: ResolvedConfig,
  version = '0.1.0',
): WeknoraMcpApplication {
  const server = new McpServer({
    name: 'weknora',
    version,
  })
  const shutdown = new AbortController()
  const secrets = [config.apiKey, config.tenantId]
    .filter((value): value is string => value !== undefined && value !== '')

  const redact = (text: string): string => {
    let output = text
    for (const secret of secrets) output = output.split(secret).join('[redacted]')
    return output
  }

  for (const tool of createTools(client, config)) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    }, async (args, extra): Promise<CallToolResult> => {
      const signal = AbortSignal.any([extra.signal, shutdown.signal])
      try {
        const structuredContent = await tool.execute(args, signal) as Record<string, unknown>
        return {
          content: [{ type: 'text', text: tool.render(structuredContent) }],
          structuredContent,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${tool.name}: ${redact(message)}`)
      }
    })
  }

  return {
    server,
    async close(): Promise<void> {
      if (!shutdown.signal.aborted) shutdown.abort(new Error('server closed'))
      await server.close()
    },
  }
}
