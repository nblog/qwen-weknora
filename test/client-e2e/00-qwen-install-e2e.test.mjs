import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { startMockWeknora } from '../_shared/mock-weknora.mjs'
import { startDeterministicModel } from './deterministic-model.mjs'
import packageManifest from '../../package.json' with { type: 'json' }

const root = process.cwd()
const archive = resolve(root, 'release', `${packageManifest.name}-${packageManifest.version}.zip`)
const relativeCliEntry = join('.tmp-qwen', 'cli', 'node_modules', '@qwen-code', 'qwen-code', 'cli-entry.js')

async function ensureQwenCli() {
  const candidates = [
    process.env.WEKNORA_E2E_QWEN_CLI,
    resolve(root, relativeCliEntry),
    resolve(root, '..', 'v1-implementation', relativeCliEntry),
  ].filter(value => typeof value === 'string')
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await readFile(join(dirname(candidate), 'package.json'), 'utf8'))
      if (manifest.name === '@qwen-code/qwen-code' && manifest.version === '0.27.2') return candidate
    } catch {
      // Try the next fixed-version candidate or install into this worktree.
    }
  }
  const npmEntryPoint = process.env.npm_execpath
  if (npmEntryPoint === undefined) {
    throw new Error('npm_execpath is required to install the fixed client; run through npm test, or set WEKNORA_E2E_QWEN_CLI to an existing 0.27.2 cli-entry.js')
  }
  const install = spawnSync(process.execPath, [
    resolve(npmEntryPoint), 'install',
    '--prefix', resolve(root, '.tmp-qwen', 'cli'),
    '--cache', resolve(root, '.tmp-qwen', 'npm-cache'),
    '--no-save', '@qwen-code/qwen-code@0.27.2',
  ], { cwd: root, encoding: 'utf8', timeout: 120000 })
  const installDiagnostics = [install.error, install.stdout, install.stderr]
    .filter(value => value !== undefined && value !== '')
    .join('\n')
  assert.equal(install.status, 0, `fixed Qwen Code installation failed:\n${installDiagnostics}`)
  return resolve(root, relativeCliEntry)
}

async function walkFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await walkFiles(path))
    else output.push(path)
  }
  return output
}

function messageText(message) {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map(part => part.text ?? JSON.stringify(part)).join('\n')
  }
  return JSON.stringify(message.content ?? null)
}

test('Qwen Code installs the archive and closes a deterministic model-to-WeKnora loop', async t => {
  const cli = await ensureQwenCli()
  const model = await startDeterministicModel()
  const weknora = await startMockWeknora()
  await mkdir(join(root, '.tmp-qwen'), { recursive: true })
  const sandbox = await mkdtemp(join(root, '.tmp-qwen', 'qwen-install-e2e-'))
  const home = join(sandbox, 'home')
  const cwd = join(sandbox, 'cwd')
  const appData = join(home, 'AppData', 'Roaming')
  const localAppData = join(home, 'AppData', 'Local')
  const qwenHome = join(home, '.qwen')
  for (const directory of [home, cwd, appData, localAppData, qwenHome]) await mkdir(directory, { recursive: true })
  const environment = () => ({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    QWEN_CODE_HOME: qwenHome,
    OPENAI_API_KEY: 'test-model-key',
    QWEN_CODE_SUPPRESS_YOLO_WARNING: '1',
  })
  const runClient = (args, options = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: environment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => child.kill('SIGTERM'), options.timeout ?? 90000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (status, signal) => {
      clearTimeout(timeout)
      resolve({ status, signal, stdout: stdout.join(''), stderr: stderr.join('') })
    })
    child.stdin.end(options.input ?? '')
  })

  t.after(async () => {
    await model.close()
    await weknora.close()
    await rm(sandbox, { recursive: true, force: true })
  })

  const installation = await runClient(['extensions', 'install', archive], { input: 'y\n' })
  assert.equal(installation.status, 0, installation.stderr)
  assert.match(installation.stdout, /weknora-agent-plugin/)

  const discovery = await runClient(['--list-extensions'])
  assert.equal(discovery.status, 0, discovery.stderr)
  assert.match(discovery.stdout, /weknora-agent-plugin/)
  assert.match(discovery.stdout, /weknora/)
  assert.match(discovery.stdout, /MCP servers/)

  const settings = {
    modelProviders: {
      openai: [{
        id: 'deterministic-model',
        name: 'deterministic-model',
        wireApi: 'chat-completions',
        baseUrl: model.url,
        envKey: 'OPENAI_API_KEY',
      }],
    },
    env: { OPENAI_API_KEY: 'test-model-key' },
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'deterministic-model' },
    memory: {
      enableManagedAutoMemory: false,
      enableManagedAutoDream: false,
      enableAutoSkill: false,
    },
  }
  await writeFile(join(qwenHome, 'settings.json'), JSON.stringify(settings, null, 2))
  const pluginDataRoot = join(qwenHome, 'extension-store', 'plugin-data', 'agent-plugins')
  const pluginDataDirectories = await readdir(pluginDataRoot, { withFileTypes: true })
  assert.equal(pluginDataDirectories.length, 1)
  const pluginData = join(pluginDataRoot, pluginDataDirectories[0].name)
  await writeFile(join(pluginData, 'config.json'), JSON.stringify({
    baseUrl: weknora.url,
    apiKey: 'test-weknora-key',
    tenantId: 'tenant-e2e',
  }))

  const connection = await runClient(['mcp', 'list'])
  assert.equal(connection.status, 0, connection.stderr)
  assert.match(connection.stdout, /weknora: node .*weknora-agent-plugin[\\/]dist[\\/]server\.js/)
  assert.match(connection.stdout, /Connected/)

  const scenarios = [
    ['SEARCH_E2E', 'SEARCH_E2E: What is the retrieval threshold?', 'MODEL_SEARCH_RESULT id=doc-retrieval-pipeline'],
    ['READ_E2E', 'READ_E2E: Read the retrieval pipeline document and continue onto page two.', 'MODEL_READ_RESULT pages=true,true,true,true'],
    ['ASK_E2E', 'ASK_E2E: Ask WeKnora and then ask a follow-up in the same session.', 'MODEL_ASK_RESULT first=true followUp=true session=true'],
  ]
  for (const [marker, prompt, expected] of scenarios) {
    const result = await runClient([
      '--auth-type', 'openai',
      '--model', 'deterministic-model',
      '--yolo',
      '--max-wall-time', '60s',
      '--output-format', 'text',
      prompt,
    ])
    assert.equal(result.status, 0, `${marker} stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    assert.match(result.stdout, new RegExp(expected))
  }

  const requestsFor = marker => model.requests.filter(request =>
    request.messages.some(message => messageText(message).includes(marker)))
  const callsIn = request => request.messages
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.tool_calls ?? [])
    .map(call => {
      let argumentsText = call.function?.arguments ?? '{}'
      try { argumentsText = JSON.parse(argumentsText) } catch { /* Keep the raw text. */ }
      return `${call.function?.name}:${typeof argumentsText === 'string' ? argumentsText : JSON.stringify(argumentsText)}`
    })
  const textOf = message => {
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content.map(part => part.text ?? JSON.stringify(part)).join('\n')
    }
    return JSON.stringify(message.content ?? null)
  }

  const searchRequests = requestsFor('SEARCH_E2E')
  assert.equal(searchRequests.length, 3)
  const searchCalls = searchRequests.flatMap(callsIn).join('|')
  assert.match(searchCalls, /tool_search:\{"query":"weknora search"/)
  assert.match(searchCalls, /tool_call:\{"name":"mcp__weknora__weknora_search"/)
  assert.match(textOf(searchRequests[2].messages.at(-1)), /doc-retrieval-pipeline/)
  assert.match(textOf(searchRequests[2].messages.at(-1)), /The default retrieval threshold is configurable\./)

  const readRequests = requestsFor('READ_E2E')
  assert.equal(readRequests.length, 4)
  const readCalls = readRequests.flatMap(callsIn).join('|')
  assert.match(readCalls, /weknora_read_document/)
  assert.match(readCalls, /"page":1/)
  assert.match(readCalls, /"page":2/)
  assert.match(textOf(readRequests[2].messages.at(-1)), /Passage 1[\s\S]*Passage 2/)
  assert.match(textOf(readRequests[3].messages.at(-1)), /Passage 3[\s\S]*Passage 4/)

  const askRequests = requestsFor('ASK_E2E')
  assert.equal(askRequests.length, 4)
  const askCalls = askRequests.flatMap(callsIn).join('|')
  assert.match(askCalls, /weknora_ask/)
  assert.match(askCalls, /\{"name":"mcp__weknora__weknora_ask","arguments":\{"query":"What is the retrieval threshold\?"\}\}/)
  assert.match(askCalls, /"session_id":"session-mock-1"/)
  assert.match(textOf(askRequests[2].messages.at(-1)), /session-mock-1/)
  assert.match(textOf(askRequests[3].messages.at(-1)), /The threshold is configurable\./)

  assert.equal(weknora.requests.some(request => request.path === '/api/v1/knowledge-search'), true)
  const readQueries = weknora.requests
    .filter(request => request.path === '/api/v1/chunks/doc-retrieval-pipeline')
    .map(request => `${request.query.page}:${request.query.page_size}`)
  assert.deepEqual(readQueries, ['1:2', '2:2'])
  assert.equal(weknora.requests.filter(request => request.path === '/api/v1/sessions').length, 1)
  const chats = weknora.requests.filter(request => request.path === '/api/v1/knowledge-chat/session-mock-1')
  assert.deepEqual(chats.map(request => request.body?.query), [
    'What is the retrieval threshold?',
    'Ask a follow-up in the same session',
  ])

  const extensionRoot = join(qwenHome, 'extensions', 'weknora-agent-plugin')
  const isolatedFiles = await walkFiles(home)
  assert.ok(isolatedFiles.length > 0)
  assert.ok(isolatedFiles.every(path => path.startsWith(home)))
  assert.ok(extensionRoot.startsWith(home))
  assert.ok(pluginData.startsWith(home))
})
