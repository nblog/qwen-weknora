/** CLI entry for the portable WeKnora stdio MCP server. */

import { pathToFileURL } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { WeknoraClient } from './client.ts'
import { loadConfigFile, parseConfigArgv } from './config.ts'
import { createWeknoraMcpServer, type WeknoraMcpApplication } from './server.ts'
import packageManifest from '../package.json' with { type: 'json' }

/** Load config, build the server, and connect the process stdio transport. */
export async function runCli(argv: readonly string[]): Promise<WeknoraMcpApplication> {
  const configPath = parseConfigArgv(argv)
  const config = await loadConfigFile(configPath)
  const client = new WeknoraClient(config)
  const application = createWeknoraMcpServer(client, config, packageManifest.version)
  const transport = new StdioServerTransport()
  await application.server.connect(transport)
  return application
}

async function main(): Promise<void> {
  let application: WeknoraMcpApplication | undefined
  try {
    application = await runCli(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`WeKnora Agent Plugin failed to start: ${message}`)
    process.exitCode = 1
    return
  }

  let closing = false
  const close = async (): Promise<void> => {
    if (closing || application === undefined) return
    closing = true
    try {
      await application.close()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`WeKnora Agent Plugin shutdown failed: ${message}`)
      process.exitCode = 1
    }
  }

  process.once('SIGINT', () => { void close() })
  process.once('SIGTERM', () => { void close() })
  process.stdin.once('end', () => { void close() })
}

const entryUrl = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href
if (entryUrl === import.meta.url) await main()
