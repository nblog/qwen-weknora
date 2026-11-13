import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { jsonResponse, startMockWeknora } from '../_shared/mock-weknora.mjs'
import packageManifest from '../../package.json' with { type: 'json' }

const archive = join('release', `${packageManifest.name}-${packageManifest.version}.zip`)

async function extractInstalledPackage() {
  const directory = await mkdtemp(join(tmpdir(), 'weknora-installed-e2e-'))
  const tar = spawnSync('tar', ['-xf', archive, '-C', directory], { encoding: 'utf8' })
  assert.equal(tar.status, 0, tar.stderr)
  return directory
}

async function withInstalledClient(mock, overrides, run) {
  const installed = await extractInstalledPackage()
  const dataDirectory = await mkdtemp(join(tmpdir(), 'weknora-installed-data-'))
  const configPath = join(dataDirectory, 'config.json')
  await writeFile(configPath, JSON.stringify({ baseUrl: mock.url, ...overrides }))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(installed, 'dist', 'server.js'), '--config', configPath],
    cwd: installed,
    stderr: 'pipe',
  })
  const stderr = []
  transport.stderr?.setEncoding('utf8')
  transport.stderr?.on('data', chunk => stderr.push(chunk))
  const client = new Client({ name: 'installed-e2e', version: '0.0.0' })
  try {
    await client.connect(transport)
    return await run(client)
  } finally {
    await client.close()
    assert.equal(stderr.join(''), '', 'installed stdio server wrote unexpected stderr')
    await rm(dataDirectory, { recursive: true, force: true })
    await rm(installed, { recursive: true, force: true })
  }
}

test('installed archive completes the full stdio MCP tool lifecycle', async () => {
  const mock = await startMockWeknora()
  try {
    await withInstalledClient(mock, {}, async client => {
      assert.equal(client.getServerVersion()?.name, 'weknora')
      assert.equal(client.getServerVersion()?.version, packageManifest.version)
      assert.ok(client.getServerCapabilities()?.tools, 'tools capability was not advertised')

      const listed = await client.listTools()
      assert.deepEqual(listed.tools.map(tool => tool.name), [
        'weknora_list_knowledge_bases',
        'weknora_search',
        'weknora_read_document',
        'weknora_ask',
      ])

      const knowledgeBases = await client.callTool({
        name: 'weknora_list_knowledge_bases',
        arguments: {},
      })
      assert.equal(knowledgeBases.isError, undefined)
      assert.deepEqual(knowledgeBases.structuredContent, {
        count: 1,
        knowledge_bases: [{
          id: 'kb-product',
          name: 'Product',
          description: 'Product documents',
        }],
      })

      const search = await client.callTool({
        name: 'weknora_search',
        arguments: { query: 'retrieval threshold' },
      })
      assert.equal(search.isError, undefined)
      assert.equal(search.structuredContent.query, 'retrieval threshold')
      assert.equal(search.structuredContent.results[0].knowledge_id, 'doc-retrieval-pipeline')
      assert.match(search.structuredContent.results[0].content, /retrieval threshold is configurable/)
      assert.match(search.content[0].text, /doc-retrieval-pipeline/)

      const firstPage = await client.callTool({
        name: 'weknora_read_document',
        arguments: { knowledge_id: 'doc-retrieval-pipeline', page: 1, page_size: 2 },
      })
      assert.equal(firstPage.isError, undefined)
      assert.equal(firstPage.structuredContent.page, 1)
      assert.equal(firstPage.structuredContent.has_more, true)
      assert.match(firstPage.structuredContent.content, /Passage 1[\s\S]*Passage 2/)
      const secondPage = await client.callTool({
        name: 'weknora_read_document',
        arguments: {
          knowledge_id: 'doc-retrieval-pipeline',
          page: firstPage.structuredContent.page + 1,
          page_size: firstPage.structuredContent.page_size,
        },
      })
      assert.equal(secondPage.isError, undefined)
      assert.equal(secondPage.structuredContent.page, 2)
      assert.match(secondPage.structuredContent.content, /Passage 3[\s\S]*Passage 4/)

      const firstAsk = await client.callTool({
        name: 'weknora_ask',
        arguments: { query: 'What is the retrieval threshold?' },
      })
      assert.equal(firstAsk.isError, undefined)
      assert.equal(firstAsk.structuredContent.session_id, 'session-mock-1')
      assert.match(firstAsk.structuredContent.answer, /threshold is configurable/)
      const secondAsk = await client.callTool({
        name: 'weknora_ask',
        arguments: {
          query: 'Ask a follow-up in the same context',
          session_id: firstAsk.structuredContent.session_id,
        },
      })
      assert.equal(secondAsk.isError, undefined)
      assert.equal(secondAsk.structuredContent.session_id, 'session-mock-1')
      assert.match(secondAsk.structuredContent.answer, /threshold is configurable/)

      assert.equal(mock.requests.some(request => request.path === '/api/v1/knowledge-bases'), true)
      assert.equal(mock.requests.some(request => request.path === '/api/v1/knowledge-search'), true)
      assert.equal(mock.requests.filter(request => request.path === '/api/v1/chunks/doc-retrieval-pipeline').length, 2)
      assert.equal(mock.requests.filter(request => request.path === '/api/v1/sessions').length, 1)
      const chats = mock.requests.filter(request => request.path === '/api/v1/knowledge-chat/session-mock-1')
      assert.equal(chats.length, 2)
      assert.deepEqual(chats.map(request => request.body?.query), [
        'What is the retrieval threshold?',
        'Ask a follow-up in the same context',
      ])
    })
  } finally {
    await mock.close()
  }
})

test('installed archive maps cancellation, budgets, and a broken SSE stream to protocol errors', async () => {
  const hangingChat = await startMockWeknora((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
      return
    }
    if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 'session-cancel' } })
      return
    }
    if (entry.path === '/api/v1/knowledge-chat/session-cancel') {
      response.statusCode = 200
      response.setHeader('content-type', 'text/event-stream')
      response.write('data: {"response_type":"answer","content":"partial"}\n\n')
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    await withInstalledClient(
      hangingChat,
      { requestTimeoutMs: 5000, chatTimeoutMs: 5000 },
      async client => {
        const controller = new AbortController()
        const call = client.callTool({
          name: 'weknora_ask',
          arguments: { query: 'cancel me' },
        }, undefined, { signal: controller.signal })
        const deadline = Date.now() + 2000
        while (!hangingChat.requests.some(request => request.path === '/api/v1/knowledge-chat/session-cancel')) {
          assert.ok(Date.now() < deadline, 'cancelled ask never reached the backend')
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        controller.abort()
        await assert.rejects(call, /aborted|cancelled/i)
      },
    )
  } finally {
    await hangingChat.close()
  }

  const slowRequest = await startMockWeknora(async (_entry, response) => {
    await new Promise(resolve => setTimeout(resolve, 100))
    jsonResponse(response, 200, { data: [] })
  })
  try {
    await withInstalledClient(slowRequest, { requestTimeoutMs: 20 }, async client => {
      const result = await client.callTool({
        name: 'weknora_list_knowledge_bases',
        arguments: {},
      })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /requestTimeoutMs timed out/)
    })
  } finally {
    await slowRequest.close()
  }

  for (const behavior of ['delay', 'broken']) {
    const mock = await startMockWeknora((entry, response) => {
      if (entry.path === '/api/v1/knowledge-bases') {
        jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
        return
      }
      if (entry.path === '/api/v1/sessions') {
        jsonResponse(response, 200, { data: { id: 'session-budget' } })
        return
      }
      if (entry.path === '/api/v1/knowledge-chat/session-budget') {
        if (behavior === 'delay') return new Promise(resolve => setTimeout(resolve, 100))
        response.statusCode = 200
        response.setHeader('content-type', 'text/event-stream')
        response.end('data: {"response_type":"answer","content":"partial"}\n\n')
        return
      }
      jsonResponse(response, 404, { error: { message: 'unmocked' } })
    })
    try {
      await withInstalledClient(
        mock,
        { requestTimeoutMs: 5000, chatTimeoutMs: 20 },
        async client => {
          const result = await client.callTool({
            name: 'weknora_ask',
            arguments: { query: 'budget' },
          })
          assert.equal(result.isError, true)
          assert.match(result.content[0].text,
            behavior === 'delay' ? /chatTimeoutMs timed out/ : /ended before WeKnora completed/)
        },
      )
    } finally {
      await mock.close()
    }
  }
})
