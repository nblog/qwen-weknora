import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { jsonResponse, startMockWeknora } from '../_shared/mock-weknora.mjs'

const serverPath = join('dist', 'server.js')

async function closeWithinDeadline(child, deadlineMs) {
  const result = await Promise.race([
    new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))),
    new Promise(resolve => setTimeout(() => resolve(null), deadlineMs)),
  ])
  if (result === null) child.kill('SIGKILL')
  return result
}

async function withStdioClient(mock, overrides, run) {
  const directory = await mkdtemp(join(tmpdir(), 'weknora-mcp-'))
  const configPath = join(directory, 'config.json')
  await writeFile(configPath, JSON.stringify({
    baseUrl: mock.url,
    apiKey: 'test-key',
    tenantId: 'tenant-1',
    ...overrides,
  }))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, '--config', configPath],
  })
  const client = new Client({ name: 'contract-test', version: '0.0.0' })
  try {
    await client.connect(transport)
    return await run(client)
  } finally {
    await client.close()
    await rm(directory, { recursive: true, force: true })
  }
}

test('stdio server initializes, negotiates tools, and advertises one fixed contract', async () => {
  const mock = await startMockWeknora()
  try {
    await withStdioClient(mock, {}, async client => {
      assert.equal(client.getServerVersion()?.name, 'weknora')
      const listed = await client.listTools()
      assert.deepEqual(listed.tools.map(tool => tool.name), [
        'weknora_list_knowledge_bases',
        'weknora_search',
        'weknora_read_document',
        'weknora_ask',
      ])

      for (const tool of listed.tools) {
        assert.equal(tool.inputSchema.type, 'object')
        assert.equal(tool.inputSchema.additionalProperties, false)
        assert.equal(tool.outputSchema.type, 'object')
        assert.equal(tool.outputSchema.additionalProperties, false)
      }
      const search = listed.tools.find(tool => tool.name === 'weknora_search')
      assert.deepEqual(Object.keys(search.inputSchema.properties).sort(),
        ['knowledge_base_ids', 'knowledge_ids', 'max_results', 'query'])
      assert.deepEqual(search.inputSchema.required, ['query'])
      assert.deepEqual(Object.keys(search.outputSchema.properties).sort(),
        ['count', 'documents', 'knowledge_base_ids', 'query', 'results'])
      assert.deepEqual(search.outputSchema.required,
        ['query', 'knowledge_base_ids', 'count', 'results', 'documents'])
      const ask = listed.tools.find(tool => tool.name === 'weknora_ask')
      assert.deepEqual(ask.annotations, {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      })
      assert.equal(ask.inputSchema.properties.web_search.type, 'boolean')
    })
  } finally {
    await mock.close()
  }
})

test('all tools return structured content and text rendered from that value', async () => {
  const mock = await startMockWeknora()
  try {
    await withStdioClient(mock, { maxChunkChars: 30 }, async client => {
      const list = await client.callTool({ name: 'weknora_list_knowledge_bases', arguments: {} })
      assert.equal(list.isError, undefined)
      assert.equal(list.structuredContent.count, 1)
      assert.match(list.content[0].text, /1 knowledge base/)

      const search = await client.callTool({
        name: 'weknora_search',
        arguments: { query: 'threshold' },
      })
      assert.equal(search.structuredContent.results[0].knowledge_id, 'doc-retrieval-pipeline')
      assert.match(search.content[0].text, /Retrieval pipeline/)

      const read = await client.callTool({
        name: 'weknora_read_document',
        arguments: { knowledge_id: 'doc-retrieval-pipeline', page_size: 2 },
      })
      assert.equal(read.structuredContent.returned_chunks, 2)
      assert.equal(read.structuredContent.has_more, true)
      assert.match(read.content[0].text, /more passages available/)

      const ask = await client.callTool({
        name: 'weknora_ask',
        arguments: { query: 'threshold', session_id: 'session-mock-1' },
      })
      assert.equal(ask.structuredContent.answer, 'The threshold is configurable.')
      assert.equal(ask.structuredContent.pipeline, 'rag')
      assert.match(ask.content[0].text, /WeKnora session: session-mock-1/)
    })
  } finally {
    await mock.close()
  }
})

test('invalid tool input is returned as an actionable tool error', async () => {
  const mock = await startMockWeknora()
  try {
    await withStdioClient(mock, {}, async client => {
      const result = await client.callTool({
        name: 'weknora_search',
        arguments: { query: 3, extra: true },
      })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /Invalid arguments for tool weknora_search/)
    })
  } finally {
    await mock.close()
  }
})

test('client cancellation propagates and does not return a partial ask result', async () => {
  const mock = await startMockWeknora(async (entry, response) => {
    if (entry.path === '/api/v1/knowledge-chat/session-mock-1') {
      await new Promise(resolve => setTimeout(resolve, 200))
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.end('data: {"response_type":"answer","content":"partial"}\n\n')
      return
    }
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
      return
    }
    if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 'session-mock-1' } })
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    await withStdioClient(mock, { chatTimeoutMs: 5000, requestTimeoutMs: 5000 }, async client => {
      const controller = new AbortController()
      const call = client.callTool({
        name: 'weknora_ask',
        arguments: { query: 'slow question' },
      }, undefined, { signal: controller.signal })
      const deadline = Date.now() + 2000
      while (!mock.requests.some(request => request.path === '/api/v1/knowledge-chat/session-mock-1')) {
        assert.ok(Date.now() < deadline, 'chat request did not start')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      controller.abort()
      await assert.rejects(call, /aborted|cancelled/i)
      assert.equal(mock.requests.some(request => request.path === '/api/v1/knowledge-chat/session-mock-1'), true)
    })
  } finally {
    await mock.close()
  }
})

test('request and chat budgets are classified separately as tool errors', async () => {
  const mock = await startMockWeknora(async (entry, response) => {
    await new Promise(resolve => setTimeout(resolve, 100))
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
      return
    }
    if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 'session-mock-1' } })
      return
    }
    if (entry.path === '/api/v1/knowledge-chat/session-mock-1') {
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.end('')
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    await withStdioClient(mock, { requestTimeoutMs: 20, chatTimeoutMs: 5000 }, async client => {
      const result = await client.callTool({ name: 'weknora_list_knowledge_bases', arguments: {} })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /requestTimeoutMs timed out/)
    })
  } finally {
    await mock.close()
  }

  const chat = await startMockWeknora(async (entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases' || entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, entry.path === '/api/v1/knowledge-bases'
        ? { data: [{ id: 'kb-product' }] }
        : { data: { id: 'session-mock-1' } })
      return
    }
    if (entry.path === '/api/v1/knowledge-chat/session-mock-1') {
      await new Promise(resolve => setTimeout(resolve, 100))
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.end('')
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    await withStdioClient(chat, { requestTimeoutMs: 5000, chatTimeoutMs: 20 }, async client => {
      const result = await client.callTool({
        name: 'weknora_ask',
        arguments: { query: 'slow question' },
      })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /chatTimeoutMs timed out/)
    })
  } finally {
    await chat.close()
  }
})

test('EOF and POSIX SIGTERM cancel an in-flight ask stream and close cleanly', async () => {
  const closedBackendStreams = []
  let activeShutdownTrigger = ''
  const mock = await startMockWeknora((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
      return
    }
    if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 'session-close' } })
      return
    }
    if (entry.path === '/api/v1/knowledge-chat/session-close') {
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.once('close', () => closedBackendStreams.push(activeShutdownTrigger))
      response.write('data: {"response_type":"answer","content":"partial"}\n\n')
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })

  try {
    // Windows delivers an external SIGTERM as hard termination, so the graceful
    // signal path is exercised only where Node can deliver the signal event.
    const triggers = process.platform === 'win32' ? ['eof'] : ['eof', 'sigterm']
    for (const trigger of triggers) {
      activeShutdownTrigger = trigger
      const directory = await mkdtemp(join(tmpdir(), 'weknora-shutdown-'))
      const configPath = join(directory, 'config.json')
      await writeFile(configPath, JSON.stringify({
        baseUrl: mock.url,
        requestTimeoutMs: 5000,
        chatTimeoutMs: 5000,
      }))
      const child = spawn(process.execPath,
        [serverPath, '--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout = []
      const stderr = []
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => stdout.push(chunk))
      child.stderr.on('data', chunk => stderr.push(chunk))
      const send = message => child.stdin.write(`${JSON.stringify(message)}\n`)
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: `shutdown-${trigger}`, version: '0.0.0' },
        },
      })
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'weknora_ask', arguments: { query: 'shutdown while streaming' } },
      })

      const requestDeadline = Date.now() + 2000
      while (!mock.requests.some(request => request.path === '/api/v1/knowledge-chat/session-close')) {
        assert.ok(Date.now() < requestDeadline, `${trigger}: ask stream did not start`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      if (trigger === 'eof') child.stdin.end()
      else child.kill('SIGTERM')

      const closed = await closeWithinDeadline(child, 2000)
      assert.notEqual(closed, null, `${trigger}: server did not close before deadline`)
      if (trigger === 'eof') {
        assert.equal(closed.code, 0, 'unexpected EOF shutdown exit code')
        assert.equal(closed.signal, null, 'unexpected EOF shutdown signal')
      } else {
        assert.ok(closed.code === 0 || closed.signal === 'SIGTERM',
          `unexpected SIGTERM shutdown result: ${JSON.stringify(closed)}`)
      }
      assert.equal(stderr.join(''), '', `${trigger}: unexpected stderr`)
      for (const line of stdout.join('').split('\n').filter(line => line !== '')) {
        assert.doesNotThrow(() => JSON.parse(line), `${trigger}: non-JSON stdout: ${line}`)
      }
      await rm(directory, { recursive: true, force: true })
    }

    const closeDeadline = Date.now() + 1000
    while (closedBackendStreams.length < 2 && Date.now() < closeDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.deepEqual(closedBackendStreams.sort(), [...triggers].sort(),
      `in-flight backend streams were not cancelled: ${JSON.stringify(closedBackendStreams)}`)
  } finally {
    await mock.close()
  }
})

test('stdout contains only MCP JSON-RPC frames through initialization, listing, and EOF', async () => {
  const mock = await startMockWeknora()
  const directory = await mkdtemp(join(tmpdir(), 'weknora-stdio-'))
  try {
    const configPath = join(directory, 'config.json')
    await writeFile(configPath, JSON.stringify({ baseUrl: mock.url }))
    const child = spawn(process.execPath, [serverPath, '--config', configPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    const request = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
    request({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'stdout-test', version: '0.0.0' },
      },
    })
    const initializeLine = await new Promise(resolve => {
      child.stdout.once('data', chunk => resolve(chunk.trim()))
    })
    const initialized = JSON.parse(initializeLine)
    assert.equal(initialized.id, 1)
    assert.equal(initialized.result.serverInfo.name, 'weknora')
    request({ jsonrpc: '2.0', method: 'notifications/initialized' })
    request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const listing = await new Promise(resolve => {
      child.stdout.once('data', chunk => resolve(chunk.trim()))
    })
    const tools = JSON.parse(listing)
    assert.equal(tools.result.tools.length, 4)
    child.stdin.end()
    const exitCode = await new Promise(resolve => child.once('close', resolve))
    assert.equal(exitCode, 0)
    for (const line of stdout.join('').split('\n').filter(line => line !== '')) {
      assert.doesNotThrow(() => JSON.parse(line), `non-JSON stdout: ${line}`)
    }
    assert.equal(stderr.join(''), '')
  } finally {
    await rm(directory, { recursive: true, force: true })
    await mock.close()
  }
})
