import assert from 'node:assert/strict'
import { createServer } from 'node:http'

function messageText(message) {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map(part => {
      if (typeof part === 'string') return part
      if (part !== null && typeof part === 'object' && typeof part.text === 'string') return part.text
      return JSON.stringify(part)
    }).join('\n')
  }
  return JSON.stringify(message.content ?? null)
}

function functionCall(id, name, args) {
  return {
    tool_calls: [{
      id: `call-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }],
    content: null,
  }
}

function previousDeferredTool(messages, fallback) {
  const call = messages.at(-2)?.tool_calls?.[0]?.function
  if (call?.name !== 'tool_call') return fallback
  try {
    const parsed = JSON.parse(call.arguments ?? '{}')
    return typeof parsed.name === 'string' ? parsed.name : fallback
  } catch {
    return fallback
  }
}

function discoveredWeknoraTool(text, suffix) {
  const jsonMatch = text.match(/"name"\s*:\s*"(mcp__weknora__[^"]+)"/)
  const plainMatch = text.match(/\b(mcp__weknora__[A-Za-z0-9_]+)\b/)
  const name = jsonMatch?.[1] ?? plainMatch?.[1]
  if (name === undefined || !name.endsWith(suffix)) {
    throw new Error(`tool_search result is missing ${suffix}`)
  }
  return name
}

function chooseMessage(messages) {
  const transcript = messages.map(messageText).join('\n')
  const toolMessages = messages.filter(message => message.role === 'tool')
  const lastToolText = toolMessages.at(-1) === undefined ? '' : messageText(toolMessages.at(-1))

  if (transcript.includes('SEARCH_E2E')) {
    if (toolMessages.length === 0) {
      return functionCall('call-search-discover', 'tool_search', { query: 'weknora search', max_results: 10 })
    }
    if (toolMessages.length === 1) {
      return functionCall('call-search-invoke', 'tool_call', {
        name: discoveredWeknoraTool(lastToolText, 'weknora_search'),
        arguments: { query: 'retrieval threshold' },
      })
    }
    return {
      role: 'assistant',
      content: `MODEL_SEARCH_RESULT id=${lastToolText.includes('doc-retrieval-pipeline') ? 'doc-retrieval-pipeline' : 'missing'} content=${lastToolText.includes('The default retrieval threshold is configurable.') ? 'The default retrieval threshold is configurable.' : 'missing'}`,
    }
  }

  if (transcript.includes('READ_E2E')) {
    if (toolMessages.length === 0) {
      return functionCall('call-read-discover', 'tool_search', { query: 'weknora read document', max_results: 10 })
    }
    if (toolMessages.length === 1) {
      return functionCall('call-read-page-1', 'tool_call', {
        name: discoveredWeknoraTool(lastToolText, 'weknora_read_document'),
        arguments: { knowledge_id: 'doc-retrieval-pipeline', page: 1, page_size: 2 },
      })
    }
    if (toolMessages.length === 2) {
      return functionCall('call-read-page-2', 'tool_call', {
        name: previousDeferredTool(messages, 'mcp__weknora__weknora_read_document'),
        arguments: { knowledge_id: 'doc-retrieval-pipeline', page: 2, page_size: 2 },
      })
    }
    const seenPages = [1, 2, 3, 4].map(page => transcript.includes(`Passage ${page}`))
    return { role: 'assistant', content: `MODEL_READ_RESULT pages=${seenPages.join(',')}` }
  }

  if (transcript.includes('ASK_E2E')) {
    if (toolMessages.length === 0) {
      return functionCall('call-ask-discover', 'tool_search', { query: 'weknora ask', max_results: 10 })
    }
    if (toolMessages.length === 1) {
      return functionCall('call-ask-new', 'tool_call', {
        name: discoveredWeknoraTool(lastToolText, 'weknora_ask'),
        arguments: { query: 'What is the retrieval threshold?' },
      })
    }
    if (toolMessages.length === 2) {
      const session = lastToolText.includes('session-mock-1') ? 'session-mock-1' : 'missing-session'
      return functionCall('call-ask-follow-up', 'tool_call', {
        name: previousDeferredTool(messages, 'mcp__weknora__weknora_ask'),
        arguments: { query: 'Ask a follow-up in the same session', session_id: session },
      })
    }
    return {
      role: 'assistant',
      content: `MODEL_ASK_RESULT first=${transcript.includes('The threshold is configurable.')} followUp=${lastToolText.includes('The threshold is configurable.')} session=${lastToolText.includes('session-mock-1')}`,
    }
  }

  throw new Error('deterministic model received an unknown e2e scenario')
}

/** Start the OpenAI-compatible model service used by the real client process. */
export async function startDeterministicModel() {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const message = chooseMessage(parsed.messages ?? [])
      const finishReason = message.tool_calls === undefined ? 'stop' : 'tool_calls'
      requests.push({
        url: request.url,
        model: parsed.model,
        stream: parsed.stream === true,
        tools: parsed.tools ?? [],
        messages: parsed.messages ?? [],
      })
      if (parsed.stream !== true) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 1,
          model: parsed.model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }))
        return
      }
      response.setHeader('content-type', 'text/event-stream')
      const chunk = (delta, finish = null) => `data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: parsed.model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`
      response.write(chunk(message))
      response.write(chunk({}, finishReason))
      response.end('data: [DONE]\n\n')
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
      server.closeAllConnections()
      await new Promise((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error))
      })
    },
  }
}
