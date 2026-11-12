import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { WeknoraClient } from '../../src/client.ts'
import { resolveConfig } from '../../src/config.ts'
import { createTools } from '../../src/tools.ts'
import {
  jsonResponse,
  sseResponse,
  startHttpRecorder,
  startMockWeknora,
} from '../_shared/mock-weknora.mjs'

const fixturePath = join('test', '_shared', 'upstream', 'weknora', 'api-contract.json')

function makeTools(mock, overrides = {}) {
  const config = resolveConfig({
    baseUrl: mock.url,
    apiKey: 'test-key',
    tenantId: 'tenant-1',
    ...overrides,
  })
  const client = new WeknoraClient(config)
  return { config, client, tools: createTools(client, config) }
}

function tool(tools, name) {
  const found = tools.find(item => item.name === name)
  assert.notEqual(found, undefined)
  return found
}

test('four fixed tools expose the documented conservative annotations', async () => {
  const mock = await startMockWeknora()
  try {
    const { tools } = makeTools(mock)
    assert.deepEqual(tools.map(item => item.name), [
      'weknora_list_knowledge_bases',
      'weknora_search',
      'weknora_read_document',
      'weknora_ask',
    ])
    assert.deepEqual(tool(tools, 'weknora_ask').annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
  } finally {
    await mock.close()
  }
})

test('REST requests match the upstream fixture with only the registered title difference', async (t) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const expected = (toolName, path) => {
    const found = fixture.calls.find(call => call.tool === toolName && call.path === path)
    assert.notEqual(found, undefined, `missing fixture call ${toolName} ${path}`)
    return found
  }

  for (const [name, path] of [
    ['weknora_list_knowledge_bases', '/api/v1/knowledge-bases'],
    ['weknora_search', '/api/v1/knowledge-search'],
    ['weknora_search', '/api/v1/knowledge/search'],
    ['weknora_read_document', '/api/v1/chunks/doc-retrieval-pipeline'],
    ['weknora_read_document', '/api/v1/knowledge/doc-retrieval-pipeline'],
    ['weknora_ask', '/api/v1/sessions'],
    ['weknora_ask', '/api/v1/knowledge-chat/session-mock-1'],
  ]) {
    const mock = await startMockWeknora()
    t.after(async () => { await mock.close() })
    const { tools } = makeTools(mock)
    const signal = new AbortController().signal
    await tool(tools, 'weknora_list_knowledge_bases').execute({}, signal)
    await tool(tools, 'weknora_search').execute({ query: '默认的检索阈值是多少' }, signal)
    await tool(tools, 'weknora_read_document').execute({
      knowledge_id: 'doc-retrieval-pipeline',
      page_size: 5,
    }, signal)
    await tool(tools, 'weknora_ask').execute({ query: '默认的检索阈值是多少' }, signal)
    const call = expected(name, path)
    const actual = mock.requests.find(request => request.path === path && request.method === call.method)
    assert.notEqual(actual, undefined)
    assert.deepEqual(actual.query, call.query)
    assert.deepEqual(actual.body, name === 'weknora_ask' && path === '/api/v1/sessions'
      ? { title: 'weknora: 默认的检索阈值是多少' }
      : call.body)
  }
})

test('configured and explicit agent parameters preserve upstream semantics', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
  const expected = fixture.calls.find(call => call.path === '/api/v1/agent-chat/s1')
  const mock = await startMockWeknora()
  try {
    const { tools } = makeTools(mock, { agentId: 'agent-42' })
    const result = await tool(tools, 'weknora_ask').execute({
      query: '部署方式',
      session_id: 's1',
      web_search: true,
    }, new AbortController().signal)
    const actual = mock.requests.find(request => request.path === '/api/v1/agent-chat/s1')
    assert.deepEqual(actual.query, expected.query)
    assert.deepEqual(actual.body, expected.body)
    assert.equal(result.pipeline, 'agent')
    assert.equal(result.session_id, 's1')
  } finally {
    await mock.close()
  }
})

test('structured outputs preserve ranks, budgets, pagination, and truncation markers', async () => {
  const mock = await startHttpRecorder((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product', name: 'Product' }] })
    } else if (entry.path === '/api/v1/knowledge-search') {
      jsonResponse(response, 200, {
        data: [
          { id: 'c1', knowledge_id: 'doc', content: 'abcdefghij123', score: Number.NaN },
          { id: 'c2', knowledge_id: 'doc', content: 'second' },
        ],
      })
    } else if (entry.path === '/api/v1/knowledge/search') {
      jsonResponse(response, 200, { data: [] })
    } else if (entry.path === '/api/v1/chunks/doc') {
      jsonResponse(response, 200, {
        data: [
          { chunk_index: 1, content: 'B' },
          { chunk_index: 0, content: 'A' },
        ],
        total: 5,
        page: Number(entry.query.page),
        page_size: Number(entry.query.page_size),
      })
    } else if (entry.path === '/api/v1/knowledge/doc') {
      jsonResponse(response, 200, { data: { title: 'Doc', description: 'summary' } })
    } else if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 's' } })
    } else if (entry.path === '/api/v1/knowledge-chat/s') {
      sseResponse(response, [
        { response_type: 'answer', content: ' answer ' },
        { response_type: 'references', knowledge_references: [
          { knowledge_id: 'doc', knowledge_title: 'Doc', chunk_index: 1, content: 'abcdefghij123' },
        ] },
        { response_type: 'complete' },
      ])
    } else {
      jsonResponse(response, 404, { error: { message: 'unmocked' } })
    }
  })
  try {
    const { tools } = makeTools(mock, { maxResults: 1, maxChunkChars: 10 })
    const signal = new AbortController().signal
    const list = await tool(tools, 'weknora_list_knowledge_bases').execute({}, signal)
    assert.deepEqual(list, { count: 1, knowledge_bases: [{ id: 'kb-product', name: 'Product', description: '' }] })
    const search = await tool(tools, 'weknora_search').execute({ query: ' query ' }, signal)
    assert.equal(search.count, 1)
    assert.deepEqual(search.results[0], {
      rank: 1,
      chunk_id: 'c1',
      knowledge_id: 'doc',
      document: 'doc',
      chunk_index: -1,
      score: 0,
      content: 'abcdefghij…',
      truncated: true,
    })
    const read = await tool(tools, 'weknora_read_document').execute({ knowledge_id: 'doc', page: 2 }, signal)
    assert.equal(read.page, 2)
    assert.equal(read.page_size, 20)
    assert.equal(read.total_chunks, 5)
    assert.equal(read.returned_chunks, 2)
    assert.equal(read.has_more, false)
    assert.equal(read.content, 'A\n\nB')
    assert.equal(read.truncated, false)
    const capped = await tool(tools, 'weknora_read_document').execute({
      knowledge_id: 'doc',
      page: 10001,
      page_size: 101,
    }, signal)
    const cappedRequest = mock.requests.filter(request => request.path === '/api/v1/chunks/doc').at(-1)
    assert.deepEqual(cappedRequest.query, { page: '10000', page_size: '100', resource_urls: 'public' })
    assert.equal(capped.page, 10000)
    assert.equal(capped.page_size, 100)
    const ask = await tool(tools, 'weknora_ask').execute({ query: 'q' }, signal)
    assert.equal(ask.answer, 'answer')
    assert.equal(ask.pipeline, 'rag')
    assert.equal(ask.references[0].content, 'abcdefghij…')
  } finally {
    await mock.close()
  }
})

test('scope defaults are overrideable, read is not blocked, and optional enrichments degrade', async () => {
  let metadataFailures = 0
  let nameSearchFailures = 0
  const mock = await startHttpRecorder((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
    } else if (entry.path === '/api/v1/knowledge-search') {
      jsonResponse(response, 200, { data: [{ id: 'c1', knowledge_id: 'doc', content: 'hit' }] })
    } else if (entry.path === '/api/v1/knowledge/search') {
      nameSearchFailures += 1
      jsonResponse(response, 500, { error: { message: 'name search unavailable' } })
    } else if (entry.path === '/api/v1/chunks/doc') {
      jsonResponse(response, 200, { data: [{ chunk_index: 0, content: 'body' }], total: 1, page: 1, page_size: 20 })
    } else if (entry.path === '/api/v1/knowledge/doc') {
      metadataFailures += 1
      jsonResponse(response, 500, { error: { message: 'metadata unavailable' } })
    } else {
      jsonResponse(response, 404, { error: { message: 'unmocked' } })
    }
  })
  try {
    const { tools } = makeTools(mock, { knowledgeBaseIds: ['kb-default'] })
    const signal = new AbortController().signal
    const overridden = await tool(tools, 'weknora_search').execute({
      query: 'q',
      knowledge_base_ids: ['kb-explicit'],
    }, signal)
    assert.equal(overridden.knowledge_base_ids[0], 'kb-explicit')
    const read = await tool(tools, 'weknora_read_document').execute({ knowledge_id: 'doc' }, signal)
    assert.equal(read.title, '')
    assert.equal(read.content, 'body')
    assert.equal(mock.requests.filter(request => request.path === '/api/v1/knowledge/search').length, 1)
    assert.equal(mock.requests.filter(request => request.path === '/api/v1/knowledge/doc').length, 1)
    assert.equal(mock.requests.some(request => request.path === '/api/v1/knowledge-bases'), false)
  } finally {
    await mock.close()
  }
})

test('knowledge_ids remain a REST filter and visible-KB cache retries after failure', async () => {
  const mock = await startMockWeknora()
  try {
    const { tools } = makeTools(mock)
    const signal = new AbortController().signal
    const search = await tool(tools, 'weknora_search').execute({
      query: 'q',
      knowledge_ids: ['doc-selected'],
    }, signal)
    assert.deepEqual(search.knowledge_base_ids, [])
    const filtered = mock.requests.find(request => request.path === '/api/v1/knowledge-search')
    assert.deepEqual(filtered.body, {
      query: 'q',
      knowledge_ids: ['doc-selected'],
    })
    assert.equal(mock.requests.some(request => request.path === '/api/v1/knowledge-bases'), false)
  } finally {
    await mock.close()
  }

  let listCalls = 0
  const failing = await startHttpRecorder((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') {
      listCalls += 1
      if (listCalls === 1) {
        jsonResponse(response, 500, { error: { message: 'temporarily unavailable' } })
        return
      }
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
      return
    }
    if (entry.path === '/api/v1/knowledge-search') {
      jsonResponse(response, 200, { data: [] })
      return
    }
    jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    const { tools } = makeTools(failing)
    const signal = new AbortController().signal
    await assert.rejects(tool(tools, 'weknora_search').execute({ query: 'first' }, signal), /temporarily unavailable/)
    const second = await tool(tools, 'weknora_search').execute({ query: 'second' }, signal)
    assert.equal(second.count, 0)
    assert.equal(listCalls, 2)
  } finally {
    await failing.close()
  }
})

test('empty visible scope and streamed failures are actionable tool errors', async () => {
  const empty = await startHttpRecorder((entry, response) => {
    if (entry.path === '/api/v1/knowledge-bases') jsonResponse(response, 200, { data: [] })
    else jsonResponse(response, 404, { error: { message: 'unmocked' } })
  })
  try {
    const { tools } = makeTools(empty)
    const signal = new AbortController().signal
    await assert.rejects(tool(tools, 'weknora_search').execute({ query: 'q' }, signal),
      /credential can see no knowledge base/)
    await assert.rejects(tool(tools, 'weknora_ask').execute({ query: 'q' }, signal),
      /credential can see no knowledge base/)
    assert.equal(empty.requests.length, 1)
  } finally {
    await empty.close()
  }

  const incomplete = await startHttpRecorder((entry, response) => {
    if (entry.path === '/api/v1/sessions') {
      jsonResponse(response, 200, { data: { id: 's' } })
    } else if (entry.path === '/api/v1/knowledge-bases') {
      jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
    } else if (entry.path === '/api/v1/knowledge-chat/s') {
      sseResponse(response, [{ response_type: 'answer', content: 'partial' }])
    } else {
      jsonResponse(response, 404, { error: { message: 'unmocked' } })
    }
  })
  try {
    const { tools } = makeTools(incomplete)
    await assert.rejects(
      tool(tools, 'weknora_ask').execute({ query: 'q' }, new AbortController().signal),
      /ended before WeKnora completed/,
    )
  } finally {
    await incomplete.close()
  }
})
