import assert from 'node:assert/strict'
import test from 'node:test'
import { WeknoraClient } from '../../src/client.ts'
import { resolveConfig } from '../../src/config.ts'
import {
  jsonResponse,
  sseResponse,
  startHttpRecorder,
  startMockWeknora,
} from '../_shared/mock-weknora.mjs'

function configuredClient(overrides = {}) {
  const config = resolveConfig({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'test-key',
    tenantId: 'tenant-1',
    ...overrides,
  })
  return { config, client: new WeknoraClient(config) }
}

test('REST calls carry authentication, public resource mode, and parsed envelopes', async () => {
  const mock = await startMockWeknora()
  try {
    const { config, client } = configuredClient({ baseUrl: mock.url })
    assert.equal(config.baseUrl, `${mock.url}/api/v1`)
    assert.deepEqual(await client.listKnowledgeBases(new AbortController().signal).then(bases => bases.map(base => base.id)), ['kb-product'])
    assert.deepEqual(await client.search({
      query: 'threshold',
      knowledgeBaseIds: ['kb-product'],
      knowledgeIds: ['doc-x'],
    }, new AbortController().signal).then(hits => hits.map(hit => hit.id)), ['chunk-1'])
    const document = await client.getDocument('doc-retrieval-pipeline', new AbortController().signal)
    assert.equal(document.title, 'Retrieval pipeline')
    const session = await client.createSession('weknora: threshold', new AbortController().signal)
    assert.equal(session, 'session-mock-1')

    for (const request of mock.requests) {
      assert.equal(request.headers['x-api-key'], 'test-key')
      assert.equal(request.headers['x-tenant-id'], 'tenant-1')
      assert.equal(request.query.resource_urls, 'public')
    }
    assert.equal(mock.requests.find(request => request.path === '/api/v1/knowledge-search').body.knowledge_ids[0], 'doc-x')
  } finally {
    await mock.close()
  }
})

test('only a 403 naming resource_urls=public downgrades and remains sticky', async () => {
  const mock = await startHttpRecorder((entry, response) => {
    if (entry.query.resource_urls === 'public') {
      jsonResponse(response, 403, { error: { message: 'resource_urls=public is not allowed for this key' } })
      return
    }
    jsonResponse(response, 200, { data: [{ id: 'kb-product' }] })
  })
  try {
    const { client } = configuredClient({ baseUrl: mock.url })
    assert.equal((await client.listKnowledgeBases(new AbortController().signal))[0].id, 'kb-product')
    await client.listKnowledgeBases(new AbortController().signal)
    assert.equal(mock.requests.length, 3)
    assert.deepEqual(mock.requests[1].query, {})
    assert.deepEqual(mock.requests[2].query, {})
  } finally {
    await mock.close()
  }
})

test('an unrelated 403 is not treated as the documented resource downgrade', async () => {
  const mock = await startHttpRecorder((_entry, response) => {
    jsonResponse(response, 403, { error: { message: 'tenant denied' } })
  })
  try {
    const { client } = configuredClient({ baseUrl: mock.url })
    await assert.rejects(client.listKnowledgeBases(new AbortController().signal), /HTTP 403: tenant denied/)
    assert.equal(mock.requests.length, 1)
  } finally {
    await mock.close()
  }
})

test('transport failures separate caller cancellation from request timeout', async () => {
  const mock = await startHttpRecorder((_entry, response) => { setTimeout(() => jsonResponse(response, 200, { data: [] }), 150) })
  try {
    const cancelled = configuredClient({ baseUrl: mock.url, requestTimeoutMs: 5000 })
    const cancelController = new AbortController()
    const cancellation = cancelled.client.listKnowledgeBases(cancelController.signal)
    setTimeout(() => cancelController.abort(), 10)
    await assert.rejects(cancellation, /the call was cancelled/)

    const timedOut = configuredClient({ baseUrl: mock.url, requestTimeoutMs: 10 })
    await assert.rejects(timedOut.client.listKnowledgeBases(new AbortController().signal), /requestTimeoutMs timed out/)
  } finally {
    await mock.close()
  }
})

test('SSE answer succeeds only after complete and aggregates all result parts', async () => {
  const mock = await startMockWeknora()
  try {
    const { client } = configuredClient({ baseUrl: mock.url })
    const answer = await client.ask({
      sessionId: 'session-mock-1',
      query: 'threshold',
      knowledgeBaseIds: ['kb-product'],
      agentId: undefined,
      webSearch: false,
    }, new AbortController().signal)
    assert.equal(answer.answer, 'The threshold is configurable.')
    assert.equal(answer.sessionId, 'session-mock-1')
    assert.deepEqual(answer.toolCalls, ['search'])
    assert.equal(answer.references[0].knowledge_id, 'doc-retrieval-pipeline')
    assert.equal(mock.requests.at(-1).body.channel, 'api')
  } finally {
    await mock.close()
  }
})

test('SSE error and missing complete both reject without returning a partial answer', async () => {
  for (const events of [
    [{ response_type: 'answer', content: 'partial' }, { response_type: 'error', content: 'model unavailable' }],
    [{ response_type: 'answer', content: 'partial' }],
  ]) {
    const mock = await startHttpRecorder((_entry, response) => sseResponse(response, events))
    try {
      const { client } = configuredClient({ baseUrl: mock.url, chatTimeoutMs: 1000 })
      await assert.rejects(client.ask({
        sessionId: 's',
        query: 'q',
        knowledgeBaseIds: [],
        agentId: undefined,
        webSearch: false,
      }, new AbortController().signal), events.at(-1).response_type === 'error' ? /model unavailable/ : /ended before WeKnora completed/)
    } finally {
      await mock.close()
    }
  }
})

test('the chat timeout covers the entire SSE stream', async () => {
  const mock = await startHttpRecorder((_entry, response) => {
    setTimeout(() => sseResponse(response, [{ response_type: 'complete' }]), 100)
  })
  try {
    const { client } = configuredClient({ baseUrl: mock.url, chatTimeoutMs: 10, requestTimeoutMs: 5000 })
    await assert.rejects(client.ask({
      sessionId: 's',
      query: 'q',
      knowledgeBaseIds: [],
      agentId: undefined,
      webSearch: false,
    }, new AbortController().signal), /chatTimeoutMs timed out/)
  } finally {
    await mock.close()
  }
})
