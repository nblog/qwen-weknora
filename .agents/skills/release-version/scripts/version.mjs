import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'

export const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))

/** Derive every release identifier from the native npm package contract. */
export function releaseIdentity(root = projectRoot) {
  const pkg = readJson(resolve(root, 'package.json'))
  if (typeof pkg.version !== 'string' || pkg.version.trim() !== pkg.version || !/^\d/.test(pkg.version) || !semver.valid(pkg.version)) {
    throw new Error('package.json.version must be a complete, valid SemVer without a v prefix')
  }
  if (typeof pkg.name !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(pkg.name)) {
    throw new Error('package.json.name must be a portable, unscoped plugin name')
  }
  const stem = `${pkg.name}-${pkg.version}`
  return Object.freeze({
    name: pkg.name,
    version: pkg.version,
    tag: `v${pkg.version}`,
    branch: `release/${pkg.version}`,
    archive: `${stem}.zip`,
    manifest: `${stem}.manifest.json`,
    checksum: `${stem}.zip.sha256`,
    prerelease: semver.prerelease(pkg.version) !== null,
    nodeRequirement: pkg.engines?.node,
  })
}

/** Validate generated projections; never reinterpret them as version inputs. */
export function checkVersions(root = projectRoot) {
  const identity = releaseIdentity(root)
  const plugin = readJson(resolve(root, 'plugin.json'))
  const lock = readJson(resolve(root, 'package-lock.json'))
  if (plugin.name !== identity.name || lock.name !== identity.name || lock.packages?.['']?.name !== identity.name) {
    throw new Error('Package, plugin and lockfile names must match')
  }
  if (plugin.version !== identity.version || lock.version !== identity.version
    || lock.packages?.['']?.version !== identity.version) {
    throw new Error('Version drift: use npm run release:version -- <package.json.version> to sync projections')
  }
  return identity
}

/** Update the source version and its two projections without Git side effects. */
export function setVersion(requested, root = projectRoot) {
  const current = releaseIdentity(root)
  const target = ['patch', 'minor', 'major'].includes(requested)
    ? semver.inc(current.version, requested)
    : requested
  if (typeof target !== 'string' || target.trim() !== target || !/^\d/.test(target) || !semver.valid(target)) {
    throw new Error('Expected patch, minor, major, or a complete SemVer without a v prefix')
  }
  if (semver.lt(target, current.version)) throw new Error('Version downgrades require a separate explicit migration')
  const files = ['package.json', 'plugin.json', 'package-lock.json']
    .map(name => ({ path: resolve(root, name), value: readJson(resolve(root, name)) }))
  if (!files[2].value.packages?.['']) throw new Error('Lockfile root package is missing')
  if (files.some(file => file.value.name !== current.name) || files[2].value.packages[''].name !== current.name) {
    throw new Error('Refusing to synchronize mismatched package names')
  }
  for (const file of files) {
    const before = JSON.stringify(file.value)
    file.value.version = target
    if (file.value.packages) file.value.packages[''].version = target
    if (JSON.stringify(file.value) !== before) {
      writeFileSync(file.path, `${JSON.stringify(file.value, null, 2)}\n`)
    }
  }
  return checkVersions(root)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [command, requested, ...extra] = process.argv.slice(2)
    if (extra.length || (command === 'check' && requested !== undefined)
      || !['check', 'set'].includes(command)) throw new Error('usage: version.mjs check | set <version|patch|minor|major>')
    console.log(JSON.stringify(command === 'set' ? setVersion(requested) : checkVersions(), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
