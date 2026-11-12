import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startMockWeknora } from '../_shared/mock-weknora.mjs'

const version = '0.1.0'
const archive = join('release', `weknora-agent-plugin-${version}.zip`)
const manifestPath = join('release', `weknora-agent-plugin-${version}.manifest.json`)
const specRoot = join('test', '_shared', 'upstream', 'agent-plugins')

async function walk(root) {
  const output = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else output.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  await visit(root)
  return output.sort()
}

test('manifests satisfy the official Agent Plugins 1.0.0 schemas', async () => {
  const ajv = new Ajv2020({ allErrors: true })
  const pluginSchema = JSON.parse(await readFile(join(specRoot, 'schemas', '1.0.0', 'plugin.schema.json'), 'utf8'))
  const mcpSchema = JSON.parse(await readFile(join(specRoot, 'schemas', '1.0.0', 'mcp.schema.json'), 'utf8'))
  const plugin = JSON.parse(await readFile('plugin.json', 'utf8'))
  const mcp = JSON.parse(await readFile('mcp.json', 'utf8'))
  assert.equal(ajv.validate(pluginSchema, plugin), true, JSON.stringify(ajv.errors))
  assert.equal(ajv.validate(mcpSchema, mcp), true, JSON.stringify(ajv.errors))
  assert.equal(plugin.name, 'weknora-agent-plugin')
  assert.equal(plugin.version, version)
  assert.deepEqual(mcp.mcpServers.weknora, {
    type: 'stdio',
    command: 'node',
    args: ['${PLUGIN_ROOT}/dist/server.js', '--config', '${PLUGIN_DATA}/config.json'],
  })
})

test('release archive, explicit allowlist, checksum, and neutral identifiers are valid', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, version)
  const archiveBytes = await readFile(archive)
  assert.equal(archiveBytes.length, manifest.archiveBytes)
  assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), manifest.archiveSha256)

  const extracted = await mkdtemp(join(tmpdir(), 'weknora-package-'))
  try {
    const tar = spawnSync('tar', ['-xf', archive, '-C', extracted], { encoding: 'utf8' })
    assert.equal(tar.status, 0, tar.stderr)
    const actual = await walk(extracted)
    assert.deepEqual(actual, manifest.files.map(file => file.path).sort())
    assert.equal(actual.includes('node_modules'), false)
    assert.equal(actual.includes('config.json'), false)
    assert.equal(actual.some(path => path.startsWith('.codex-tracking/') || path.startsWith('test/')), false)

    for (const entry of manifest.files) {
      const bytes = await readFile(join(extracted, entry.path))
      assert.equal(bytes.length, entry.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256)
    }

    const skill = await readFile(join(extracted, 'skills', 'weknora', 'SKILL.md'), 'utf8')
    assert.match(skill, /^---\r?\nname: weknora\r?\ndescription: .+\r?\n---\r?\n/)
    for (const path of ['plugin.json', 'mcp.json', 'package.json', 'skills/weknora/SKILL.md', 'schemas/config.schema.json', 'examples/config.example.json', 'dist/server.js']) {
      const text = await readFile(join(extracted, path), 'utf8')
      assert.doesNotMatch(text, /qwen/i, `client-specific identifier leaked from ${path}`)
    }
  } finally {
    await rm(extracted, { recursive: true, force: true })
  }
})

test('clean extracted package runs without npm install and lists four tools', async () => {
  const mock = await startMockWeknora()
  const extracted = await mkdtemp(join(tmpdir(), 'weknora-portable-'))
  try {
    const tar = spawnSync('tar', ['-xf', archive, '-C', extracted], { encoding: 'utf8' })
    assert.equal(tar.status, 0, tar.stderr)
    const dataDirectory = await mkdtemp(join(tmpdir(), 'weknora-plugin-data-'))
    const configPath = join(dataDirectory, 'config.json')
    await writeFile(configPath, JSON.stringify({ baseUrl: mock.url }))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(extracted, 'dist', 'server.js'), '--config', configPath],
      cwd: extracted,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'portable-test', version: '0.0.0' })
    try {
      await client.connect(transport)
      const tools = await client.listTools()
      assert.deepEqual(tools.tools.map(tool => tool.name), [
        'weknora_list_knowledge_bases',
        'weknora_search',
        'weknora_read_document',
        'weknora_ask',
      ])
      const result = await client.callTool({ name: 'weknora_list_knowledge_bases', arguments: {} })
      assert.equal(result.structuredContent.count, 1)
    } finally {
      await client.close()
      await rm(dataDirectory, { recursive: true, force: true })
    }
  } finally {
    await rm(extracted, { recursive: true, force: true })
    await mock.close()
  }
})
