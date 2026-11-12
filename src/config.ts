/** Configuration loading, schema validation, and immutable resolution. */

import { readFile } from 'node:fs/promises'
import { Ajv2020, type AnySchemaObject, type ErrorObject } from 'ajv/dist/2020.js'
import configSchemaJson from '../schemas/config.schema.json' with { type: 'json' }

/** Tool switches after schema defaults have been applied. */
export interface ToolToggles {
  readonly listKnowledgeBases: boolean
  readonly search: boolean
  readonly readDocument: boolean
  readonly ask: boolean
}

/** JSON value accepted by the authoritative schema. */
export type ConfigDocument = unknown

/** Configuration after preprocessing, schema defaults, validation, and freezing. */
export interface ResolvedConfig {
  readonly baseUrl: string
  readonly apiKey: string | undefined
  readonly tenantId: string | undefined
  readonly knowledgeBaseIds: readonly string[]
  readonly agentId: string | undefined
  readonly maxResults: number
  readonly maxChunkChars: number
  readonly requestTimeoutMs: number
  readonly chatTimeoutMs: number
  readonly resourceUrls: 'handle' | 'public'
  readonly tools: ToolToggles
}

/** A startup failure with actionable, credential-free schema diagnostics. */
export class ConfigError extends Error {
  readonly violations: readonly string[]

  constructor(violations: readonly string[]) {
    super(`WeKnora Agent Plugin configuration is invalid:\n  - ${violations.join('\n  - ')}`)
    this.name = 'ConfigError'
    this.violations = violations
  }
}

/** CLI usage failure; separated from schema violations for concise diagnostics. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

interface JsonSchemaNodeLike {
  readonly type?: string | readonly string[]
  readonly properties?: Record<string, JsonSchemaNodeLike>
  readonly default?: unknown
}

const configSchema = configSchemaJson as unknown as AnySchemaObject
const ajv = new Ajv2020({ allErrors: true, verbose: false })
ajv.addFormat('uri', (value: string): boolean => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
})
const validateConfig = ajv.compile(configSchema)

const API_ROOT = /\/api\/v\d+$/

/** Normalize a declared string URL without accepting another declared type. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return API_ROOT.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

/**
 * Apply only the narrow preprocess documented for declared string fields.
 * Unknown keys and wrong types are deliberately left for the schema to reject.
 */
export function preprocessConfig(raw: ConfigDocument): ConfigDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const source = raw as Record<string, unknown>
  const result: Record<string, unknown> = { ...source }

  if (typeof result.baseUrl === 'string') result.baseUrl = normalizeBaseUrl(result.baseUrl)
  for (const field of ['apiKey', 'tenantId', 'agentId'] as const) {
    const value = result[field]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '') delete result[field]
    else result[field] = trimmed
  }
  if (Array.isArray(result.knowledgeBaseIds)) {
    result.knowledgeBaseIds = result.knowledgeBaseIds.map(entry =>
      typeof entry === 'string' ? entry.trim() : entry,
    )
  }
  return result
}

/** Recursively apply defaults declared by the authoritative schema. */
function applySchemaDefaults(value: unknown, schema: JsonSchemaNodeLike): unknown {
  if (schema.type !== 'object' || schema.properties === undefined) return value
  const shouldCreate = value !== undefined || Object.values(schema.properties).some(hasDefault)
  if (!shouldCreate) return value
  const candidate = value === undefined ? {} : value
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return value

  const output: Record<string, unknown> = { ...(candidate as Record<string, unknown>) }
  for (const [key, childSchema] of Object.entries(schema.properties)) {
    if (output[key] === undefined && childSchema.default !== undefined) {
      output[key] = structuredClone(childSchema.default)
    }
    if (childSchema.type === 'object') {
      output[key] = applySchemaDefaults(output[key], childSchema)
    }
  }
  return output
}

function hasDefault(schema: JsonSchemaNodeLike): boolean {
  return schema.default !== undefined
    || (schema.type === 'object' && schema.properties !== undefined
      && Object.values(schema.properties).some(hasDefault))
}

function propertyPath(instancePath: string): string {
  if (instancePath === '') return 'config'
  return `config${instancePath.replace(/~0/g, '~').replace(/~1/g, '/')}`
}

function describeViolation(error: ErrorObject): string {
  const path = propertyPath(error.instancePath)
  // Ajv traverses the schema's `not` branch; those errors prove that branch is
  // valid and are represented once by the root `not` diagnostic instead.
  if (error.schemaPath.includes('/not/') && error.keyword !== 'not') return ''
  switch (error.keyword) {
    case 'additionalProperties': {
      const key = (error.params as { additionalProperty?: unknown }).additionalProperty
      return `${path}: unknown field ${JSON.stringify(String(key))}`
    }
    case 'required': {
      const key = (error.params as { missingProperty?: unknown }).missingProperty
      return `${path}: missing required field ${JSON.stringify(String(key))}`
    }
    case 'type':
      return `${path} must be of type ${String((error.params as { type?: unknown }).type)}`
    case 'minimum':
      return `${path} must be an integer >= ${String((error.params as { limit?: unknown }).limit)}`
    case 'pattern':
      return `${path} must match the declared URL pattern`
    case 'format':
      return `${path} must be an absolute http/https URL with a non-empty hostname`
    case 'enum':
      return `${path} must be one of the values declared in the schema`
    case 'minLength':
      return `${path} must not be an empty string`
    case 'not':
      return 'config.tools: at least one tool must stay enabled'
    default:
      return `${path} does not satisfy the configuration schema (${error.keyword})`
  }
}

/** Resolve preprocessed JSON strictly from the single authoritative schema. */
export function resolveConfig(raw: ConfigDocument): ResolvedConfig {
  const preprocessed = preprocessConfig(raw)
  const withDefaults = applySchemaDefaults(preprocessed, configSchema as JsonSchemaNodeLike)
  if (!validateConfig(withDefaults)) {
    const violations = (validateConfig.errors ?? [])
      .map(describeViolation)
      .filter((item: string) => item !== '')
    if (violations.length === 0) violations.push('config does not satisfy the configuration schema')
    throw new ConfigError(violations)
  }

  const value = withDefaults as {
    baseUrl?: unknown
    apiKey?: unknown
    tenantId?: unknown
    knowledgeBaseIds?: unknown
    agentId?: unknown
    maxResults?: unknown
    maxChunkChars?: unknown
    requestTimeoutMs?: unknown
    chatTimeoutMs?: unknown
    resourceUrls?: unknown
    tools?: {
      listKnowledgeBases?: unknown
      search?: unknown
      readDocument?: unknown
      ask?: unknown
    }
  }
  const resolved: ResolvedConfig = {
    baseUrl: value.baseUrl as string,
    apiKey: value.apiKey as string | undefined,
    tenantId: value.tenantId as string | undefined,
    knowledgeBaseIds: Object.freeze([...(value.knowledgeBaseIds as string[])]),
    agentId: value.agentId as string | undefined,
    maxResults: value.maxResults as number,
    maxChunkChars: value.maxChunkChars as number,
    requestTimeoutMs: value.requestTimeoutMs as number,
    chatTimeoutMs: value.chatTimeoutMs as number,
    resourceUrls: value.resourceUrls as 'handle' | 'public',
    tools: Object.freeze({
      listKnowledgeBases: value.tools?.listKnowledgeBases as boolean,
      search: value.tools?.search as boolean,
      readDocument: value.tools?.readDocument as boolean,
      ask: value.tools?.ask as boolean,
    }),
  }
  return Object.freeze(resolved)
}

/** Parse the narrow CLI contract: exactly `--config <path>`. */
export function parseConfigArgv(argv: readonly string[]): string {
  if (argv.length === 2 && argv[0] === '--config' && argv[1] !== '') return argv[1] as string
  throw new CliUsageError(
    'usage: node server.js --config <PLUGIN_DATA>/config.json\n'
      + 'example: node dist/server.js --config "$PLUGIN_DATA/config.json"',
  )
}

/** Read and resolve the authoritative config file. */
export async function loadConfigFile(path: string): Promise<ResolvedConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined
    if (code === 'ENOENT') {
      throw new ConfigError([
        `config file does not exist: ${path}; copy examples/config.example.json to the plugin data directory and edit it`,
      ])
    }
    throw new ConfigError([`config file could not be read (${path}): ${code ?? 'unknown error'}`])
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parse error'
    throw new ConfigError([`config file is not valid JSON (${path}): ${reason}`])
  }
  return resolveConfig(parsed)
}
