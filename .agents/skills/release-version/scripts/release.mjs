import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkVersions, projectRoot } from './version.mjs'
import { verifyArtifacts, sha256 } from './artifacts.mjs'

function run(root, file, args, inherit = false) {
  const result = spawnSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: inherit ? 'inherit' : 'pipe' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${file} ${args[0]} failed: ${result.stderr || result.stdout || result.status}`)
  return result.stdout?.trim() ?? ''
}
const git = (root, ...args) => run(root, 'git', args)

export function checkSource(root = projectRoot) {
  const identity = checkVersions(root)
  if (git(root, 'ls-files', '--', 'release', '.codex-tracking')) throw new Error('Generated or private files are tracked by Git')
  for (const path of ['release/.ignore-probe', '.codex-tracking/.ignore-probe']) {
    git(root, 'check-ignore', '--no-index', '--quiet', path)
  }
  return identity
}

function cleanHead(root, identity) {
  if (git(root, 'status', '--porcelain')) throw new Error('Commit the source changes before release operations')
  const branch = git(root, 'branch', '--show-current')
  if (branch !== 'main' && branch !== identity.branch) throw new Error(`Use main or ${identity.branch}`)
  return { branch, head: git(root, 'rev-parse', 'HEAD') }
}

export function checkLocalTag(root, tag, head) {
  const probe = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, windowsHide: true })
  if (probe.status === 1) return false
  if (probe.status !== 0) throw new Error('Cannot inspect local tag')
  if (git(root, 'rev-parse', `refs/tags/${tag}^{commit}`) !== head) throw new Error(`${tag} points to a different commit`)
  return true
}

export function checkRemoteTag(root, tag, head) {
  const lines = git(root, 'ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    .split('\n').filter(Boolean).map(line => line.split(/\s+/))
  const refs = Object.fromEntries(lines.map(([sha, ref]) => [ref, sha]))
  const target = refs[`refs/tags/${tag}^{}`] ?? refs[`refs/tags/${tag}`]
  if (target && target !== head) throw new Error(`Remote ${tag} points to a different commit; refusing to move it`)
}

function repository(root) {
  const remote = git(root, 'remote', 'get-url', 'origin')
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/)
  if (!match) throw new Error('origin must identify a GitHub repository without embedded credentials')
  return match[1]
}

function api(root, path) {
  return JSON.parse(run(root, 'gh', ['api', path]))
}

// The by-tag REST endpoint omits drafts, even for this repository's owner.
export function readRelease(root, repo, tag) {
  const pages = JSON.parse(run(root, 'gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]))
  return pages.flat().find(release => release.tag_name === tag) ?? null
}

/** Resume only an existing draft whose frozen runtime inputs are unchanged. */
export function checkResumeSource(root, identity, draft) {
  if (!draft?.draft || draft.tag_name !== identity.tag || !/^[0-9a-f]{40}$/.test(draft.target_commitish)) {
    throw new Error('Resume requires the matching unpublished draft with an exact source commit')
  }
  const target = draft.target_commitish
  const taggedPackage = JSON.parse(git(root, 'show', `${target}:package.json`))
  if (taggedPackage.name !== identity.name || taggedPackage.version !== identity.version) {
    throw new Error('Draft source package differs from package.json identity')
  }
  const inputs = ['src', 'scripts', 'package.json', 'package-lock.json', 'plugin.json', 'mcp.json',
    'skills', 'schemas', 'examples', 'README.md', 'README.zh-CN.md', 'LICENSE', 'NOTICE']
  if (git(root, 'diff', '--name-only', target, 'HEAD', '--', ...inputs)) {
    throw new Error('Release inputs changed after the draft was created; refusing to reuse its assets')
  }
  return target
}

function ensureTag(root, identity, head) {
  checkRemoteTag(root, identity.tag, head)
  if (!checkLocalTag(root, identity.tag, head)) git(root, 'tag', '-a', identity.tag, head, '-m', `Release ${identity.version}`)
}

function npm(root, script) {
  if (!process.env.npm_execpath) throw new Error('Run release commands through npm run so npm_execpath is available')
  run(root, process.execPath, [resolve(process.env.npm_execpath), 'run', script], true)
}

async function publish(root, identity, resume) {
  const { branch, head } = cleanHead(root, identity)
  const repo = repository(root)
  let draft = readRelease(root, repo, identity.tag)
  const target = resume ? checkResumeSource(root, identity, draft) : head
  checkLocalTag(root, identity.tag, target)
  checkRemoteTag(root, identity.tag, target)
  if (!resume && draft) throw new Error(`${identity.tag} already has a Release; inspect its state before resuming a draft`)
  if (!resume) {
    npm(root, 'package')
    npm(root, 'test')
  }
  if (cleanHead(root, identity).head !== head) throw new Error('HEAD changed during release verification')
  const assets = verifyArtifacts(root)
  git(root, 'push', '--set-upstream', 'origin', `HEAD:refs/heads/${branch}`)
  const gh = (...args) => run(root, 'gh', ['release', ...args, '--repo', repo], true)
  if (!resume) {
    ensureTag(root, identity, target)
    git(root, 'push', 'origin', `refs/tags/${identity.tag}`)
    gh('create', identity.tag, '--draft', '--verify-tag', '--target', target, '--title', identity.tag, '--notes',
      `Prebuilt ${identity.name} ${identity.version}. Requires Node.js ${identity.nodeRequirement}. Download the ZIP; the manifest and SHA-256 file verify the assets.`)
    gh('upload', identity.tag, ...assets.map(asset => asset.path))
    draft = readRelease(root, repo, identity.tag)
  }
  if (!draft?.draft || draft.tag_name !== identity.tag || draft.target_commitish !== target || draft.assets.length !== assets.length) {
    throw new Error('Unexpected draft Release state; leave it unpublished for inspection')
  }
  const directory = mkdtempSync(join(tmpdir(), 'weknora-release-verify-'))
  try {
    gh('download', identity.tag, '--dir', directory, ...assets.flatMap(asset => ['--pattern', asset.name]))
    for (const asset of assets) {
      const remote = draft.assets.find(item => item.name === asset.name)
      if (!remote || remote.size !== asset.bytes || sha256(join(directory, asset.name)) !== asset.sha256) {
        throw new Error(`Uploaded asset verification failed: ${asset.name}`)
      }
    }
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary cleanup path')
    rmSync(directory, { recursive: true, force: true })
  }
  gh('edit', identity.tag, '--draft=false', `--prerelease=${identity.prerelease}`, identity.prerelease ? '--latest=false' : '--latest', '--verify-tag')
  const released = readRelease(root, repo, identity.tag)
  if (!released || released.draft || released.prerelease !== identity.prerelease) throw new Error('Release publication was not confirmed')
  checkRemoteTag(root, identity.tag, target)
  const remoteHead = git(root, 'ls-remote', 'origin', `refs/heads/${branch}`).split(/\s+/)[0]
  if (remoteHead !== head) throw new Error('Remote source commit differs from the release commit')
  const tree = api(root, `repos/${repo}/git/trees/${head}`)
  if (tree.tree.some(entry => ['release', '.codex-tracking'].includes(entry.path))) throw new Error('Private or generated directory is present remotely')
  console.log(JSON.stringify({ version: identity.version, tag: identity.tag, commit: target, sourceBranchCommit: head, url: released.html_url, assets }, null, 2))
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['check', 'verify', 'branch', 'tag', 'publish'].includes(command)
    || (args.length && !(args.length === 1 && ((command === 'tag' && args[0] === '--push')
      || (command === 'publish' && args[0] === '--resume'))))) {
    throw new Error('usage: release.mjs check | verify | branch | tag [--push] | publish [--resume]')
  }
  const identity = checkSource()
  if (command === 'check') return console.log(JSON.stringify(identity, null, 2))
  if (command === 'verify') return console.log(JSON.stringify(verifyArtifacts(), null, 2))
  const { head } = cleanHead(projectRoot, identity)
  if (command === 'branch') return git(projectRoot, 'switch', '-c', identity.branch)
  if (command === 'tag') {
    ensureTag(projectRoot, identity, head)
    if (args[0] === '--push') git(projectRoot, 'push', 'origin', `refs/tags/${identity.tag}`)
    return console.log(identity.tag)
  }
  await publish(projectRoot, identity, args[0] === '--resume')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
