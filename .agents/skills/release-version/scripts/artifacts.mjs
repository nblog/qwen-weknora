import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { checkVersions, readJson, projectRoot } from './version.mjs'

export const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Reject stale, misnamed or modified assets before an external upload. */
export function verifyArtifacts(root = projectRoot) {
  const identity = checkVersions(root)
  const directory = resolve(root, 'release')
  if (readFileSync(resolve(directory, '.gitignore'), 'utf8').trim() !== '*') {
    throw new Error('release/.gitignore must contain *')
  }
  const manifest = readJson(resolve(directory, identity.manifest))
  if (manifest.name !== identity.name || manifest.version !== identity.version || manifest.archive !== identity.archive) {
    throw new Error('Artifact identity differs from package.json.version/name')
  }
  const archive = resolve(directory, identity.archive)
  if (sha256(archive) !== manifest.archiveSha256 || statSync(archive).size !== manifest.archiveBytes) {
    throw new Error('ZIP checksum or size differs from its manifest')
  }
  if (readFileSync(resolve(directory, identity.checksum), 'utf8').trim().toLowerCase() !== manifest.archiveSha256) {
    throw new Error('SHA-256 file differs from the ZIP')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Manifest file list is empty')
  const names = new Set()
  for (const entry of manifest.files) {
    const source = resolve(root, entry.path)
    if (!source.startsWith(resolve(root) + sep) || entry.path.includes('\\') || names.has(entry.path)
      || /(^|\/)(node_modules|\.codex-tracking|release|test|\.agents)(\/|$)/.test(entry.path)
      || entry.path.split('/').at(-1) === 'config.json') throw new Error(`Forbidden manifest path: ${entry.path}`)
    names.add(entry.path)
    if (sha256(source) !== entry.sha256 || statSync(source).size !== entry.bytes) {
      throw new Error(`Stale artifact: ${entry.path}; rebuild the package`)
    }
  }
  return [identity.archive, identity.manifest, identity.checksum].map(name => {
    const path = resolve(directory, name)
    return Object.freeze({ name, path, bytes: statSync(path).size, sha256: sha256(path) })
  })
}
