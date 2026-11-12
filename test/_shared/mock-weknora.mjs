import assert from 'node:assert/strict'
import { createServer } from 'node:http'

/** Start a local HTTP recorder with request-specific behavior. */
export async function startHttpRecorder(handler) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const entry = {
        method: request.method ?? '',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: request.headers,
        body: rawBody === '' ? null : JSON.parse(rawBody),
      }
      requests.push(entry)
      Promise.resolve(handler(entry, response, url)).catch(error => {
        response.statusCode = 500
        response.end(JSON.stringify({
          error: { message: error instanceof Error ? error.message : String(error) },
        }))
      })
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(typeof address === 'object' && address !== null)
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error))
      })
    },
  }
}

export function jsonResponse(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

export function sseResponse(response, events) {
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
}

/** A deterministic API surface matching the fixed upstream snapshot fixture. */
export function defaultWeknoraHandler(entry, response) {
  if (entry.path === '/api/v1/knowledge-bases') {
    jsonResponse(response, 200, {
      data: [
        { id: 'kb-product', name: 'Product', description: 'Product documents' },
      ],
    })
    return
  }
  if (entry.path === '/api/v1/knowledge-search') {
    jsonResponse(response, 200, {
      data: [
        {
          id: 'chunk-1',
          knowledge_id: 'doc-retrieval-pipeline',
          knowledge_title: 'Retrieval pipeline',
          chunk_index: 3,
          score: 0.87,
          content: 'The default retrieval threshold is configurable.',
        },
      ],
    })
    return
  }
  if (entry.path === '/api/v1/knowledge/search') {
    jsonResponse(response, 200, {
      data: [
        {
          id: 'doc-retrieval-pipeline',
          title: 'Retrieval pipeline',
          knowledge_base_id: 'kb-product',
          knowledge_base_name: 'Product',
        },
      ],
    })
    return
  }
  if (entry.path === '/api/v1/chunks/doc-retrieval-pipeline') {
    const page = Number(entry.query.page ?? 1)
    const pageSize = Number(entry.query.page_size ?? 20)
    const count = Math.min(pageSize, 3)
    jsonResponse(response, 200, {
      data: Array.from({ length: count }, (_value, index) => {
        const chunkIndex = (page - 1) * pageSize + index
        return {
          id: `chunk-${chunkIndex + 1}`,
          chunk_index: chunkIndex,
          content: `Passage ${chunkIndex + 1}`,
        }
      }),
      total: 5,
      page,
      page_size: pageSize,
    })
    return
  }
  if (entry.path === '/api/v1/knowledge/doc-retrieval-pipeline') {
    jsonResponse(response, 200, {
      data: {
        title: 'Retrieval pipeline',
        description: 'Describes ingestion and retrieval.',
      },
    })
    return
  }
  if (entry.path === '/api/v1/sessions') {
    jsonResponse(response, 200, { data: { id: 'session-mock-1' } })
    return
  }
  if (entry.path === '/api/v1/knowledge-chat/session-mock-1' || entry.path === '/api/v1/agent-chat/s1') {
    sseResponse(response, [
      { response_type: 'answer', content: 'The threshold is configurable.' },
      {
        response_type: 'references',
        knowledge_references: [
          {
            knowledge_id: 'doc-retrieval-pipeline',
            knowledge_title: 'Retrieval pipeline',
            chunk_index: 3,
            content: 'reference text',
          },
        ],
      },
      { response_type: 'tool_call', tool_calls: [{ function: { name: 'search' } }] },
      { session_id: entry.path.includes('agent-chat') ? 's1' : 'session-mock-1' },
      { response_type: 'complete' },
    ])
    return
  }
  jsonResponse(response, 404, { error: { message: `unmocked path ${entry.path}` } })
}

export async function startMockWeknora(handler = defaultWeknoraHandler) {
  return await startHttpRecorder(handler)
}
