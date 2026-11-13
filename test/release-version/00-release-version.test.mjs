import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { checkVersions, readJson, releaseIdentity, setVersion } from '../../.agents/skills/release-version/scripts/version.mjs'
import { sha256, verifyArtifacts } from '../../.agents/skills/release-version/scripts/artifacts.mjs'
import { checkLocalTag, checkRemoteTag, checkSource } from '../../.agents/skills/release-version/scripts/release.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'weknora-version-test-'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    rmSync(root, { recursive: true, force: true })
  })
  const pkg = { name: 'weknora-agent-plugin', version: '1.2.3', engines: { node: '>=22' } }
  const json = (name, value) => writeFileSync(join(root, name), JSON.stringify(value))
  json('package.json', pkg)
  json('plugin.json', { name: pkg.name, version: pkg.version })
  json('package-lock.json', { name: pkg.name, version: pkg.version, packages: { '': { name: pkg.name, version: pkg.version } } })
  writeFileSync(join(root, '.gitignore'), '/release/\n/.codex-tracking/\n')
  mkdirSync(join(root, 'release'))
  writeFileSync(join(root, 'release/.gitignore'), '*\n')
  return { root, json }
}

test('one source version updates projections and all derived release identifiers', t => {
  const { root } = fixture(t)
  const id = setVersion('minor', root)
  assert.equal(id.version, '1.3.0')
  assert.equal(id.tag, 'v1.3.0')
  assert.equal(id.branch, 'release/1.3.0')
  assert.equal(id.archive, 'weknora-agent-plugin-1.3.0.zip')
  for (const file of ['package.json', 'plugin.json', 'package-lock.json']) {
    assert.equal(readJson(join(root, file)).version, id.version)
  }
  assert.equal(readJson(join(root, 'package-lock.json')).packages[''].version, id.version)
  assert.equal(setVersion('1.4.0-rc.1', root).prerelease, true)
  for (const invalid of ['v2.0.0', '1.4', '1.4.0 ', '0.9.0']) assert.throws(() => setVersion(invalid, root))
  assert.equal(checkVersions(root).version, '1.4.0-rc.1')
})

test('projection drift fails until regenerated from package.json', t => {
  const { root, json } = fixture(t)
  json('plugin.json', { name: 'weknora-agent-plugin', version: '9.0.0' })
  assert.throws(() => checkVersions(root), /Version drift/)
  assert.equal(setVersion(releaseIdentity(root).version, root).version, '1.2.3')
  json('package.json', { name: 'weknora-agent-plugin', version: 'invalid' })
  assert.throws(() => checkVersions(root), /SemVer/)
})

test('asset verification rejects stale source, modified ZIP and wrong manifest version', t => {
  const { root, json } = fixture(t)
  const id = checkVersions(root)
  writeFileSync(join(root, 'README.md'), 'Current release documentation\n')
  const archive = join(root, 'release', id.archive)
  writeFileSync(archive, 'checksum-fixture-bytes')
  const manifest = {
    name: id.name, version: id.version, archive: id.archive,
    archiveBytes: readFileSync(archive).length, archiveSha256: sha256(archive),
    files: [{ path: 'README.md', bytes: readFileSync(join(root, 'README.md')).length, sha256: sha256(join(root, 'README.md')) }],
  }
  json(`release/${id.manifest}`, manifest)
  writeFileSync(join(root, 'release', id.checksum), manifest.archiveSha256)
  assert.equal(verifyArtifacts(root).length, 3)
  writeFileSync(join(root, 'README.md'), 'Unbuilt change\n')
  assert.throws(() => verifyArtifacts(root), /Stale artifact/)
  writeFileSync(join(root, 'README.md'), 'Current release documentation\n')
  writeFileSync(archive, 'tampered')
  assert.throws(() => verifyArtifacts(root), /ZIP checksum/)
  json(`release/${id.manifest}`, { ...manifest, version: '9.0.0' })
  assert.throws(() => verifyArtifacts(root), /Artifact identity/)
})

test('real Git checks reject stale tag targets and tracked generated or private files', t => {
  const { root } = fixture(t)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release-test@example.invalid')
  git('add', '.')
  git('commit', '-m', 'Fixture source')
  const first = git('rev-parse', 'HEAD')
  git('tag', '-a', 'v1.2.3', '-m', 'Fixture release')
  const remote = join(root, 'remote.git')
  git('init', '--bare', remote)
  git('remote', 'add', 'origin', remote)
  git('push', 'origin', 'refs/tags/v1.2.3')
  assert.equal(checkSource(root).version, '1.2.3')
  assert.equal(checkLocalTag(root, 'v1.2.3', first), true)
  assert.doesNotThrow(() => checkRemoteTag(root, 'v1.2.3', first))
  writeFileSync(join(root, 'change.txt'), 'new source')
  git('add', 'change.txt')
  git('commit', '-m', 'Changed source')
  assert.throws(() => checkLocalTag(root, 'v1.2.3', git('rev-parse', 'HEAD')), /different commit/)
  assert.throws(() => checkRemoteTag(root, 'v1.2.3', git('rev-parse', 'HEAD')), /different commit/)
  for (const forbidden of ['release/should-not-be-tracked.zip', '.codex-tracking/private.txt']) {
    mkdirSync(join(root, forbidden.split('/')[0]), { recursive: true })
    writeFileSync(join(root, forbidden), 'fixture data')
    git('add', '--force', forbidden)
    assert.throws(() => checkSource(root), /tracked by Git/)
    git('rm', '--cached', forbidden)
  }
})
