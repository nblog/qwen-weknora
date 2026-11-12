/** Model-facing WeKnora tools and their single MCP contract definitions. */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type {
  DocumentRecord,
  SearchResult,
  WeknoraClient,
} from './client.ts'
import type { ResolvedConfig } from './config.ts'

/** Clip text to a character budget, reporting whether anything was dropped. */
function clip(text: string, maxChars: number): { text: string, truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length <= maxChars) return { text: normalized, truncated: false }
  return { text: `${normalized.slice(0, maxChars).trimEnd()}…`, truncated: true }
}

function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(3) : 'n/a'
}

function describeScope(ids: readonly string[]): string {
  if (ids.length === 0) return '(direct document ids)'
  if (ids.length <= 3) return ids.join(', ')
  return `${ids.length} knowledge bases`
}

export interface SearchHit {
  rank: number
  chunk_id: string
  knowledge_id: string
  document: string
  chunk_index: number
  score: number
  content: string
  truncated: boolean
}

export interface DocumentMatch {
  knowledge_id: string
  title: string
  knowledge_base_id: string
  knowledge_base: string
}

export interface SearchValue {
  query: string
  knowledge_base_ids: string[]
  count: number
  results: SearchHit[]
  documents: DocumentMatch[]
}

export interface KnowledgeBasesValue {
  count: number
  knowledge_bases: { id: string, name: string, description: string }[]
}

export interface DocumentValue {
  knowledge_id: string
  title: string
  summary: string
  page: number
  page_size: number
  total_chunks: number
  returned_chunks: number
  has_more: boolean
  truncated: boolean
  content: string
}

export interface AskReference {
  knowledge_id: string
  document: string
  chunk_index: number
  content: string
}

export interface AskValue {
  answer: string
  session_id: string
  pipeline: 'rag' | 'agent'
  tool_calls: string[]
  references: AskReference[]
}

export interface PluginTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<unknown>
  readonly outputSchema: z.ZodType<unknown>
  readonly annotations: ToolAnnotations
  execute(args: unknown, signal: AbortSignal): Promise<unknown>
  render(value: unknown): string
}

const stringArray = z.array(z.string())

const listInput = z.object({}).strict()
const listOutput = z.object({
  count: z.number().int(),
  knowledge_bases: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
  }).strict()),
}).strict()

const searchInput = z.object({
  query: z.string().describe('Search text.'),
  knowledge_base_ids: stringArray.optional().describe('Restrict retrieval to these knowledge base ids.'),
  knowledge_ids: stringArray.optional().describe('Restrict the search to these document ids.'),
  max_results: z.number().int().optional().describe('Maximum passages to return; capped by configured maxResults.'),
}).strict()
const searchOutput = z.object({
  query: z.string(),
  knowledge_base_ids: stringArray,
  count: z.number().int(),
  results: z.array(z.object({
    rank: z.number().int(),
    chunk_id: z.string(),
    knowledge_id: z.string(),
    document: z.string(),
    chunk_index: z.number().int(),
    score: z.number(),
    content: z.string(),
    truncated: z.boolean(),
  }).strict()),
  documents: z.array(z.object({
    knowledge_id: z.string(),
    title: z.string(),
    knowledge_base_id: z.string(),
    knowledge_base: z.string(),
  }).strict()),
}).strict()

const readInput = z.object({
  knowledge_id: z.string().describe('Document id, as returned in a search hit.'),
  page: z.number().int().optional().describe('Page of passages, starting at 1.'),
  page_size: z.number().int().optional().describe('Passages per page (max 100).'),
}).strict()
const readOutput = z.object({
  knowledge_id: z.string(),
  title: z.string(),
  summary: z.string(),
  page: z.number().int(),
  page_size: z.number().int(),
  total_chunks: z.number().int(),
  returned_chunks: z.number().int(),
  has_more: z.boolean(),
  truncated: z.boolean(),
  content: z.string(),
}).strict()

const askInput = z.object({
  query: z.string().describe('The question to answer.'),
  knowledge_base_ids: stringArray.optional().describe('Restrict retrieval to these knowledge base ids.'),
  agent_id: z.string().optional().describe('Custom agent id; selects the server-side ReAct pipeline.'),
  session_id: z.string().optional().describe('Continue an earlier WeKnora session instead of starting one.'),
  web_search: z.boolean().optional().describe('Let WeKnora also search the web, when its deployment allows it. Default false.'),
}).strict()
const askOutput = z.object({
  answer: z.string(),
  session_id: z.string(),
  pipeline: z.enum(['rag', 'agent']),
  tool_calls: stringArray,
  references: z.array(z.object({
    knowledge_id: z.string(),
    document: z.string(),
    chunk_index: z.number().int(),
    content: z.string(),
  }).strict()),
}).strict()

type SearchInput = z.infer<typeof searchInput>
type ReadInput = z.infer<typeof readInput>
type AskInput = z.infer<typeof askInput>

function requiredString(value: string | undefined, field: string, toolName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${toolName}: "${field}" is required and must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function stringList(value: string[] | undefined): string[] {
  return (value ?? []).map(entry => entry.trim()).filter(entry => entry !== '')
}

function boundedInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

function documentLabel(result: SearchResult): string {
  const title = typeof result.knowledge_title === 'string' ? result.knowledge_title.trim() : ''
  if (title !== '') return title
  const filename = typeof result.knowledge_filename === 'string' ? result.knowledge_filename.trim() : ''
  if (filename !== '') return filename
  return typeof result.knowledge_id === 'string' && result.knowledge_id !== ''
    ? result.knowledge_id
    : '(untitled)'
}

function projectHit(result: SearchResult, rank: number, maxChunkChars: number): SearchHit {
  const clipped = clip(typeof result.content === 'string' ? result.content : '', maxChunkChars)
  return {
    rank,
    chunk_id: typeof result.id === 'string' ? result.id : '',
    knowledge_id: typeof result.knowledge_id === 'string' ? result.knowledge_id : '',
    document: documentLabel(result),
    chunk_index: typeof result.chunk_index === 'number' ? result.chunk_index : -1,
    score: typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : 0,
    content: clipped.text,
    truncated: clipped.truncated,
  }
}

function projectNamedDocuments(
  named: DocumentRecord[],
  passages: SearchHit[],
  knowledgeBaseIds: readonly string[],
  knowledgeIds: readonly string[],
): DocumentMatch[] {
  const already = new Set(passages.map(hit => hit.knowledge_id))
  const scope = new Set(knowledgeBaseIds)
  const wanted = new Set(knowledgeIds)
  const output: DocumentMatch[] = []
  for (const document of named) {
    const id = typeof document.id === 'string' ? document.id : ''
    const kbId = typeof document.knowledge_base_id === 'string' ? document.knowledge_base_id : ''
    if (id === '' || already.has(id)) continue
    if (wanted.size > 0 ? !wanted.has(id) : !scope.has(kbId)) continue
    const title = typeof document.title === 'string' && document.title.trim() !== ''
      ? document.title.trim()
      : typeof document.file_name === 'string' ? document.file_name : id
    output.push({
      knowledge_id: id,
      title,
      knowledge_base_id: kbId,
      knowledge_base: typeof document.knowledge_base_name === 'string'
        ? document.knowledge_base_name
        : kbId,
    })
    already.add(id)
  }
  return output
}

/** Build the enabled fixed-name tools for one configured deployment. */
export function createTools(client: WeknoraClient, config: ResolvedConfig): PluginTool[] {
  const tools: PluginTool[] = []

  let everyVisibleId: Promise<string[]> | undefined
  const allKnowledgeBaseIds = (signal: AbortSignal): Promise<string[]> => {
    everyVisibleId ??= client.listKnowledgeBases(signal).then(
      bases => bases
        .map(base => typeof base.id === 'string' ? base.id : '')
        .filter(id => id !== ''),
      (error: unknown) => {
        everyVisibleId = undefined
        throw error
      },
    )
    return everyVisibleId
  }
  const resolveScope = async (
    requested: readonly string[],
    knowledgeIds: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> => {
    if (requested.length > 0) return [...requested]
    if (config.knowledgeBaseIds.length > 0) return [...config.knowledgeBaseIds]
    if (knowledgeIds.length > 0) return []
    return await allKnowledgeBaseIds(signal)
  }

  if (config.tools.listKnowledgeBases) {
    tools.push({
      name: 'weknora_list_knowledge_bases',
      description: 'List the WeKnora knowledge bases this deployment can retrieve from, with their ids. '
        + 'weknora_search already spans them all, so use this to report what is available or narrow a later search.',
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async execute(_args, signal): Promise<KnowledgeBasesValue> {
        const bases = await client.listKnowledgeBases(signal)
        return {
          count: bases.length,
          knowledge_bases: bases.map(base => ({
            id: typeof base.id === 'string' ? base.id : '',
            name: typeof base.name === 'string' ? base.name : '',
            description: typeof base.description === 'string' ? base.description : '',
          })),
        }
      },
      render(value): string {
        const result = value as KnowledgeBasesValue
        if (result.count === 0) return 'No knowledge base is available to this WeKnora credential.'
        const lines = result.knowledge_bases.map(base => {
          const description = base.description === '' ? '' : ` — ${base.description}`
          return `- ${base.name} (id: ${base.id})${description}`
        })
        return `${result.count} knowledge base(s):\n${lines.join('\n')}`
      },
    })
  }

  if (config.tools.search) {
    tools.push({
      name: 'weknora_search',
      description: 'Search WeKnora knowledge bases and return matching passages verbatim (hybrid vector and '
        + 'keyword retrieval, no model summarization). A title-like query can also return documents by name. '
        + `Every hit carries a knowledge_id you can pass to weknora_read_document for more context.`,
      inputSchema: searchInput,
      outputSchema: searchOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async execute(args, signal): Promise<SearchValue> {
        const input = searchInput.parse(args) as SearchInput
        const toolName = 'weknora_search'
        const query = requiredString(input.query, 'query', toolName)
        const knowledgeIds = stringList(input.knowledge_ids)
        const knowledgeBaseIds = await resolveScope(
          stringList(input.knowledge_base_ids),
          knowledgeIds,
          signal,
        )
        if (knowledgeBaseIds.length === 0 && knowledgeIds.length === 0) {
          throw new Error(`${toolName}: this WeKnora credential can see no knowledge base, so there is `
            + 'nothing to search. Check the deployment API key scope.')
        }
        const limit = boundedInt(input.max_results, config.maxResults, config.maxResults)
        const enrichByName = async (): Promise<DocumentRecord[]> => {
          try {
            return await client.findDocuments({ keyword: query, limit }, signal)
          } catch (error) {
            if (signal.aborted) throw error
            return []
          }
        }
        const [hits, named] = await Promise.all([
          client.search({ query, knowledgeBaseIds, knowledgeIds }, signal),
          enrichByName(),
        ])
        const results = hits
          .slice(0, limit)
          .map((hit, index) => projectHit(hit, index + 1, config.maxChunkChars))
        return {
          query,
          knowledge_base_ids: knowledgeBaseIds,
          count: results.length,
          results,
          documents: projectNamedDocuments(named, results, knowledgeBaseIds, knowledgeIds),
        }
      },
      render(value): string {
        const result = value as SearchValue
        const named = result.documents.length === 0
          ? ''
          : `\n\nDocuments named "${result.query}" (read them with weknora_read_document):\n`
            + result.documents.map(document =>
              `- ${document.title} · knowledge_id: ${document.knowledge_id} · in ${document.knowledge_base}`,
            ).join('\n')
        if (result.count === 0) {
          if (named === '') {
            return `Nothing in WeKnora matched "${result.query}" `
              + `(searched: ${describeScope(result.knowledge_base_ids)}). `
              + 'Try a differently worded query, or widen the knowledge base scope.'
          }
          return `No passage matched "${result.query}", but its name matches document(s).${named}`
        }
        const blocks = result.results.map(hit =>
          `[${hit.rank}] ${hit.document} · score ${formatScore(hit.score)} · chunk ${hit.chunk_index} `
          + `· knowledge_id: ${hit.knowledge_id}\n${hit.content}${hit.truncated ? '\n(passage truncated)' : ''}`)
        return `${result.count} passage(s) for "${result.query}" `
          + `(searched: ${describeScope(result.knowledge_base_ids)}):\n\n${blocks.join('\n\n')}${named}`
      },
    })
  }

  if (config.tools.readDocument) {
    tools.push({
      name: 'weknora_read_document',
      description: 'Read a WeKnora document stored passages in order, reassembled into bounded pages of text. '
        + 'Use it after weknora_search when one passage is not enough context; page through long documents.',
      inputSchema: readInput,
      outputSchema: readOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async execute(args, signal): Promise<DocumentValue> {
        const input = readInput.parse(args) as ReadInput
        const toolName = 'weknora_read_document'
        const knowledgeId = requiredString(input.knowledge_id, 'knowledge_id', toolName)
        const page = boundedInt(input.page, 1, 10_000)
        const pageSize = boundedInt(input.page_size, 20, 100)
        const loadMetadata = async (): Promise<DocumentRecord> => {
          if (page !== 1) return {}
          try {
            return await client.getDocument(knowledgeId, signal)
          } catch (error) {
            if (signal.aborted) throw error
            return {}
          }
        }
        const [result, metadata] = await Promise.all([
          client.listChunks({ knowledgeId, page, pageSize }, signal),
          loadMetadata(),
        ])
        const ordered = [...result.chunks].sort((left, right) => {
          const a = typeof left.chunk_index === 'number' ? left.chunk_index : 0
          const b = typeof right.chunk_index === 'number' ? right.chunk_index : 0
          return a - b
        })
        const joined = ordered
          .map(chunk => typeof chunk.content === 'string' ? chunk.content : '')
          .join('\n\n')
        const clipped = clip(
          joined,
          config.maxChunkChars * Math.max(1, Math.min(ordered.length, 10)),
        )
        const title = typeof metadata.title === 'string' && metadata.title.trim() !== ''
          ? metadata.title.trim()
          : typeof metadata.file_name === 'string' ? metadata.file_name.trim() : ''
        return {
          knowledge_id: knowledgeId,
          title,
          summary: clip(
            typeof metadata.description === 'string' ? metadata.description.trim() : '',
            config.maxChunkChars,
          ).text,
          page: result.page,
          page_size: result.pageSize,
          total_chunks: result.total,
          returned_chunks: ordered.length,
          has_more: result.page * result.pageSize < result.total,
          truncated: clipped.truncated,
          content: clipped.text,
        }
      },
      render(value): string {
        const result = value as DocumentValue
        const label = result.title === '' ? result.knowledge_id : `${result.title} (${result.knowledge_id})`
        if (result.returned_chunks === 0) {
          return `Document ${label} has no passage on page ${result.page} `
            + `(${result.total_chunks} passage(s) in total).`
        }
        const summary = result.summary === '' ? '' : `\n\nSummary: ${result.summary}`
        const more = result.has_more ? `\n\n(more passages available: request page ${result.page + 1})` : ''
        const cut = result.truncated ? '\n(content truncated)' : ''
        return `Document ${label}, passages ${result.returned_chunks} of ${result.total_chunks} `
          + `(page ${result.page}):${summary}\n\n${result.content}${cut}${more}`
      },
    })
  }

  if (config.tools.ask) {
    tools.push({
      name: 'weknora_ask',
      description: 'Ask WeKnora a question and get its server-side composed answer with citations. '
        + 'Reserve it for broad synthesis questions whose answer spans many documents; prefer weknora_search '
        + 'when specific passages are enough. This call creates or updates a server-side WeKnora session.',
      inputSchema: askInput,
      outputSchema: askOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      async execute(args, signal): Promise<AskValue> {
        const input = askInput.parse(args) as AskInput
        const toolName = 'weknora_ask'
        const query = requiredString(input.query, 'query', toolName)
        const requested = stringList(input.knowledge_base_ids)
        const agentId = optionalString(input.agent_id) ?? config.agentId
        const knowledgeBaseIds = agentId === undefined
          ? await resolveScope(requested, [], signal)
          : requested.length > 0 ? requested : [...config.knowledgeBaseIds]
        if (agentId === undefined && knowledgeBaseIds.length === 0) {
          throw new Error(`${toolName}: this WeKnora credential can see no knowledge base, so there is `
            + 'nothing to answer from. Check the deployment API key scope.')
        }
        const sessionId = optionalString(input.session_id)
          ?? await client.createSession(`weknora: ${clip(query, 60).text}`, signal)
        const streamed = await client.ask({
          sessionId,
          query,
          knowledgeBaseIds,
          agentId,
          webSearch: input.web_search === true,
        }, signal)
        return {
          answer: streamed.answer.trim(),
          session_id: streamed.sessionId,
          pipeline: agentId === undefined ? 'rag' : 'agent',
          tool_calls: streamed.toolCalls,
          references: streamed.references.slice(0, config.maxResults).map(reference => ({
            knowledge_id: typeof reference.knowledge_id === 'string' ? reference.knowledge_id : '',
            document: documentLabel(reference),
            chunk_index: typeof reference.chunk_index === 'number' ? reference.chunk_index : -1,
            content: clip(
              typeof reference.content === 'string' ? reference.content : '',
              config.maxChunkChars,
            ).text,
          })),
        }
      },
      render(value): string {
        const result = value as AskValue
        const parts: string[] = []
        parts.push(result.answer === ''
          ? 'WeKnora returned an empty answer. Retry with a more specific question, or retrieve passages instead.'
          : result.answer)
        if (result.references.length > 0) {
          const cited = result.references.map((reference, index) =>
            `[${index + 1}] ${reference.document} · chunk ${reference.chunk_index} `
            + `· knowledge_id: ${reference.knowledge_id}`)
          parts.push(`Citations:\n${cited.join('\n')}`)
        }
        if (result.tool_calls.length > 0) parts.push(`WeKnora tools used: ${result.tool_calls.join(', ')}`)
        parts.push(`WeKnora session: ${result.session_id} (pass session_id to ask a follow-up in context)`)
        return parts.join('\n\n')
      },
    })
  }

  return tools
}
