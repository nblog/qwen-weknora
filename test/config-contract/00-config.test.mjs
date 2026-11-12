import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolveConfig } from '../../src/config.ts'

const server = join('dist', 'server.js')

test('schema defaults are applied to a normalized immutable configuration', () => {
  const config = resolveConfig({
    baseUrl: ' https://kb.example.test/ ',
    apiKey: '  ',
    tenantId: '',
    agentId: '  ',
    knowledgeBaseIds: [' kb-product '],
  })
  assert.equal(config.baseUrl, 'https://kb.example.test/api/v1')
  assert.equal(config.apiKey, undefined)
  assert.equal(config.tenantId, undefined)
  assert.equal(config.agentId, undefined)
  assert.deepEqual(config.knowledgeBaseIds, ['kb-product'])
  assert.equal(config.maxResults, 8)
  assert.equal(config.maxChunkChars, 1200)
  assert.equal(config.requestTimeoutMs, 30000)
  assert.equal(config.chatTimeoutMs, 300000)
  assert.equal(config.resourceUrls, 'public')
  assert.deepEqual(config.tools, {
    listKnowledgeBases: true,
    search: true,
    readDocument: true,
    ask: true,
  })
  assert.throws(() => { config.baseUrl = 'changed' }, TypeError)
})

test('resolved defaults are read from the authoritative schema', async () => {
  const schema = JSON.parse(await readFile(join('schemas', 'config.schema.json'), 'utf8'))
  const config = resolveConfig({})
  assert.equal(config.baseUrl, schema.properties.baseUrl.default)
  assert.equal(config.maxResults, schema.properties.maxResults.default)
  assert.equal(config.maxChunkChars, schema.properties.maxChunkChars.default)
  assert.equal(config.requestTimeoutMs, schema.properties.requestTimeoutMs.default)
  assert.equal(config.chatTimeoutMs, schema.properties.chatTimeoutMs.default)
  assert.equal(config.resourceUrls, schema.properties.resourceUrls.default)
})

test('the shipped example resolves successfully', async () => {
  const example = JSON.parse(await readFile(join('examples', 'config.example.json'), 'utf8'))
  const config = resolveConfig(example)
  assert.equal(config.baseUrl, 'https://weknora.example.test/api/v1')
  assert.equal(config.knowledgeBaseIds.length, 1)
})

test('strict numeric and closed-field violations are reported together', () => {
  assert.throws(() => resolveConfig({
    maxResults: 8.5,
    maxChunkChars: 0,
    requestTimeoutMs: -1,
    chatTimeoutMs: '300000',
    toolPrefix: 'weknora',
    unknown: true,
  }), /unknown field "toolPrefix"[\s\S]*unknown field "unknown"[\s\S]*maxResults must be of type integer[\s\S]*maxChunkChars must be an integer >= 1[\s\S]*requestTimeoutMs must be an integer >= 1[\s\S]*chatTimeoutMs must be of type integer/)
})

test('all tools disabled and invalid URLs are actionable schema failures', () => {
  assert.throws(() => resolveConfig({ tools: {
    listKnowledgeBases: false,
    search: false,
    readDocument: false,
    ask: false,
  } }), /at least one tool must stay enabled/)
  assert.throws(() => resolveConfig({ baseUrl: 'ftp://kb.example.test' }), /baseUrl must match the declared URL pattern/)
})

test('URL normalization preserves valid absolute hosts and rejects URL-shaped non-hosts', () => {
  assert.equal(resolveConfig({ baseUrl: 'https://kb.example.test/' }).baseUrl,
    'https://kb.example.test/api/v1')
  for (const baseUrl of ['https://?', 'https://#', 'https://']) {
    assert.throws(
      () => resolveConfig({ baseUrl }),
      /baseUrl must (?:match the declared URL pattern|be an absolute http\/https URL with a non-empty hostname)/,
      `expected ${JSON.stringify(baseUrl)} to be rejected`,
    )
  }
})

test('partial tool disablement retains defaults for omitted tools', () => {
  const config = resolveConfig({ tools: { search: false } })
  assert.deepEqual(config.tools, {
    listKnowledgeBases: true,
    search: false,
    readDocument: true,
    ask: true,
  })
})

test('startup failures are nonzero, stdout-free, and credential-free', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'weknora-config-'))
  t.after(async () => { await rm(directory, { recursive: true, force: true }) })
  const secret = 'test-secret-value'
  const configPath = join(directory, 'config.json')
  await writeFile(configPath, JSON.stringify({
    baseUrl: 'https://kb.example.test',
    apiKey: secret,
    tenantId: 'tenant-test',
    maxResults: 8.5,
  }))

  const cases = [
    [],
    ['--config'],
    ['--config', join(directory, 'missing.json')],
    ['--config', configPath, 'extra'],
    ['--config', configPath],
  ]
  for (const args of cases) {
    const result = spawnSync(process.execPath, [server, ...args], { encoding: 'utf8' })
    assert.notEqual(result.status, 0, `expected failure for ${JSON.stringify(args)}`)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /WeKnora Agent Plugin failed to start/)
    assert.doesNotMatch(result.stderr, new RegExp(secret))
  }

  const malformed = join(directory, 'malformed.json')
  await writeFile(malformed, '{')
  const malformedResult = spawnSync(process.execPath, [server, '--config', malformed], { encoding: 'utf8' })
  assert.notEqual(malformedResult.status, 0)
  assert.equal(malformedResult.stdout, '')
  assert.match(malformedResult.stderr, /not valid JSON/)

  for (const baseUrl of ['https://?', 'https://#']) {
    const invalidUrlPath = join(directory, `invalid-url-${baseUrl.length}.json`)
    await writeFile(invalidUrlPath, JSON.stringify({ baseUrl, apiKey: secret }))
    const invalidUrlResult = spawnSync(process.execPath,
      [server, '--config', invalidUrlPath], { encoding: 'utf8' })
    assert.notEqual(invalidUrlResult.status, 0)
    assert.equal(invalidUrlResult.stdout, '')
    assert.match(invalidUrlResult.stderr,
      /baseUrl must be an absolute http\/https URL with a non-empty hostname/)
    assert.doesNotMatch(invalidUrlResult.stderr, new RegExp(secret))
  }
})
