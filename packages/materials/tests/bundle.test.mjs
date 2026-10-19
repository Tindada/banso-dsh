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
const root = fileURLToPath(new URL('../../..', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')

test('packed materials bundle composes once in standard Web; Banso keeps its own activation', async t => {
  const home = await mkdtemp(join(tmpdir(), 'materials-bundle-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  // The package test script has already compiled lib; packing must not launch pnpm recursively.
  const { stdout } = await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', home, '--cache', join(home, 'cache')], { cwd: packageDir })
  const [packed] = JSON.parse(stdout)
  const files = packed.files.map(file => file.path)
  for (const path of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/tools/fetch-policy.js']) assert.ok(files.includes(path), path)
  await exec('tar', ['-xzf', join(home, packed.filename), '-C', home])
  const manifest = JSON.parse(await readFile(join(home, 'package/package.json'), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')

  for (const [profileName, bundles] of [
    ['web', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'banso-dsh-materials']],
    ['banso', ['banso-dsh']],
  ]) {
    const profile = join(home, 'profiles', profileName)
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    const dependencies = profileName === 'web' ? { 'banso-dsh-materials': 'file:../../package' } : { 'banso-dsh': 'workspace:*' }
    await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, dsh: { profile: { bundles } } }))
    await symlink(join(home, 'package'), join(profile, 'node_modules/banso-dsh-materials'))
    if (profileName === 'banso') await symlink(join(root, 'packages/banso'), join(profile, 'node_modules/banso-dsh'))
    const { stdout: dump } = await exec(process.execPath, [cli, '--profile', profileName, '--dump-config'], {
      cwd: root, env: { ...process.env, DSH_HOME: home }, maxBuffer: 4 * 1024 * 1024,
    })
    assert.equal((dump.match(/id: banso-materials\b/g) ?? []).length, 1)
    assert.match(dump, /name: banso-dsh-materials/)
  }
})
