import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')

test('packed materials bundle composes once in standard Web', async t => {
  const home = await mkdtemp(join(tmpdir(), 'materials-bundle-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  // The package test script has already compiled lib; skip the prepack rebuild.
  await exec('pnpm', ['pack', '--ignore-scripts', '--pack-destination', home], { cwd: packageDir })
  const { version } = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const archive = join(home, `banso-dsh-materials-${version}.tgz`)
  const { stdout: listing } = await exec('tar', ['-tzf', archive])
  const files = listing.trim().split('\n').map(path => path.replace(/^package\//, ''))
  for (const path of ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml', 'lib/index.js', 'lib/tools/fetch-policy.js']) assert.ok(files.includes(path), path)
  await exec('tar', ['-xzf', archive, '-C', home])
  assert.equal(await readFile(join(home, 'package/LICENSE'), 'utf8'), await readFile(join(packageDir, '../../LICENSE'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(home, 'package/package.json'), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')

  const profileName = 'web'
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'banso-dsh-materials']
  const profile = join(home, 'profiles', profileName)
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  const dependencies = { 'banso-dsh-materials': 'file:../../package' }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, dsh: { profile: { bundles } } }))
  await symlink(join(home, 'package'), join(profile, 'node_modules/banso-dsh-materials'))
  // Reuse this project's installed dependencies without installing into the packed fixture.
  await symlink(join(packageDir, 'node_modules'), join(home, 'package/node_modules'))
  const { stdout: dump } = await exec(process.execPath, [cli, '--profile', profileName, '--dump-config'], {
    cwd: packageDir, env: { ...process.env, DSH_HOME: home }, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal((dump.match(/id: banso-materials\b/g) ?? []).length, 1)
  assert.match(dump, /name: banso-dsh-materials/)
})
