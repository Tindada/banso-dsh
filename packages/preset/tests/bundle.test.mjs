import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// The monorepo root supplies the CLI and its runtime for this composition test.
const require = createRequire(import.meta.url)
const anchor = require.resolve('@deepseek-ai/dsh/package.json')
const runtime = createRequire(anchor)
const fromDsh = name => import(runtime.resolve(name))
const exec = promisify(execFile)
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const { Context } = await fromDsh('@deepseek-ai/cordis')
const { LlmAdapter, createUserMessage } = await fromDsh('@deepseek-ai/dsh-llm')
const { SessionId } = await fromDsh('@deepseek-ai/dsh-session')
const { scopeOf } = await fromDsh('@deepseek-ai/dsh-scope')
const { loadProfile, composeEntries, loadOptionalPatches } = await fromDsh('@deepseek-ai/dsh-app-boot')
const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const snapshot = request => textOf(request.messages.findLast(m => m.source.kind === 'banso-materials' && m.source.form === 'snapshot'))

test('Banso bundle composes with official Web and runs scoped research without changing another preset', async t => {
  const home = await mkdtemp(join(tmpdir(), 'banso-preset-'))
  t.after(() => rm(home, { recursive: true, force: true }))

  // Check the shipped tarball and its composition against the actual official CLI.
  await exec('pnpm', ['pack', '--ignore-scripts', '--pack-destination', home], { cwd: packageDir })
  await exec('tar', ['-xzf', join(home, 'banso-dsh-preset-0.1.0.tgz'), '-C', home])
  const manifest = JSON.parse(await readFile(join(home, 'package/package.json'), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  for (const [name, version] of Object.entries({ 'banso-dsh-materials': '0.1.3', 'banso-dsh-prompt': '0.1.1', 'banso-dsh-web-fetch-jina': '0.1.1' })) assert.equal(manifest.dependencies[name], version)
  assert.doesNotMatch(JSON.stringify(manifest), /workspace:|link:/)
  assert.equal(await readFile(join(home, 'package/LICENSE'), 'utf8'), await readFile(join(packageDir, '../../LICENSE'), 'utf8'))
  assert.match(await readFile(join(home, 'package/README.md'), 'utf8'), /Banso/)
  await symlink(join(packageDir, 'node_modules'), join(home, 'package/node_modules'))
  const profileDir = join(home, 'profiles/web')
  await mkdir(join(profileDir, 'node_modules'), { recursive: true })
  await symlink(join(home, 'package'), join(profileDir, 'node_modules/banso-dsh-preset'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'banso-dsh-preset': 'file:../../package' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'banso-dsh-preset'] } } }))
  const { stdout } = await exec(process.execPath, [join(dirname(anchor), 'lib/bin.js'), '--profile', 'web', '--dump-config'], {
    cwd: home, env: { ...process.env, DSH_HOME: home }, maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal((stdout.match(/id: preset-banso\b/g) ?? []).length, 1)
  assert.doesNotMatch(stdout, /banso-dsh-base|banso-dsh-ui|sdk-jsonrpc-server/)
  const profile = loadProfile('dsh', 'web', anchor, home)
  const entries = composeEntries(profile.layers.map(layer => layer.patches))
  assert.equal(entries.find(row => row.id === 'agent-preset-registry').config.default, 'standard')
  for (const id of ['standard', 'minimal', 'ptc', 'cordis', 'banso']) assert.equal(entries.find(row => row.id === `preset-${id}`).disabled ?? false, false)
  assert.deepEqual(entries.filter(row => row.id.startsWith('tool-') && !row.disabled).map(row => row.id), ['tool-working-directory'])

  // Mount the actual declaration using the real preset loader and agent loop.
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  ctx.baseUrl = new URL('../', import.meta.url).href
  await ctx.plugin((await fromDsh('@deepseek-ai/cordis-plugin-loader')).default)
  ctx.loader.builtins.group = (await fromDsh('@deepseek-ai/cordis-plugin-group')).default
  for (const name of ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'fs-local', 'working-directory']) {
    await ctx.plugin((await fromDsh(`@deepseek-ai/dsh-${name}`)).default, name === 'system-prompt' ? { personaPrefix: 'HOST IDENTITY' } : {})
  }
  await ctx.plugin(await fromDsh('@deepseek-ai/dsh-tool-working-directory'))
  await ctx.plugin((await fromDsh('@deepseek-ai/dsh-agent-loop')).default, { agents: [] })
  await ctx.plugin(await fromDsh('@deepseek-ai/dsh-tool-call-timeout-policy'))
  await ctx.plugin((await fromDsh('@deepseek-ai/dsh-web')).default, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  const records = []
  const providers = { inject: ['web'], apply(child) {
    const record = { web: child.web, searches: 0, fetches: 0 }
    records.push(record)
    child.web.registerSearchProvider({ id: 'fixture', available: () => true, async search() {
      record.searches++
      return { sources: [{ url: 'https://example.com/article', title: 'Article', snippet: 'Search snippet' }], truncated: false }
    } })
    child.web.registerFetchProvider({ id: 'fixture', available: () => true, async fetch(request) {
      record.fetches++
      return { url: request.url, statusCode: 200, body: { kind: 'text', content: 'FULL PAGE BODY' }, truncated: false }
    } })
  } }
  await ctx.plugin(providers)
  ctx.loader.builtins.fixture = providers
  await ctx.plugin((await fromDsh('@deepseek-ai/dsh-agent-preset-registry')).default, { default: 'standard' })
  const declaration = composeEntries([loadOptionalPatches('test', join(packageDir, 'cordis.patch.yml'))])[0]
  const webRows = declaration.config.plugins.find(row => row.id === 'research-web').config
  const web = webRows.find(row => row.id === 'web')
  assert.deepEqual(web.config, { searchProvider: 'deepseek-search-api', fetchProvider: 'jina' })
  assert.equal(webRows.find(row => row.id === 'tool-web').config.searchTimeoutMs, 60000)
  web.config = { searchProvider: 'fixture', fetchProvider: 'fixture' }
  webRows.push({ id: 'fixture', name: 'cordis:fixture' })
  declaration.config.plugins.find(row => row.id === 'banso-prompt').config = { researchPrompt: 'RESEARCH RULE FIXTURE' }
  await ctx.loader.root.update([
    { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', plugins: [
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true } },
    ] } }, declaration,
  ])
  assert.ok((await ctx.agentPresets.list()).every(preset => preset.broken === undefined))
  assert.equal(ctx.agentPresets.defaultId, 'standard')

  class Model extends LlmAdapter {
    requests = []
    extractions = 0
    async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'off', name: 'Off' }] } } }
    async *stream(request) {
      let response = 'Done'
      if (request.system !== undefined) { this.extractions++; response = JSON.stringify({ text: 'EXTRACTED EVIDENCE' }) }
      else {
        this.requests.push(request)
        const last = request.messages.findLast(m => m.role === 'user' && m.source.kind === 'user')
        const results = request.messages.slice(request.messages.indexOf(last) + 1).filter(m => m.role === 'tool')
        const steps = textOf(last) === 'standard' ? [['web_search', { queries: ['other preset'] }]] : [
          ['web_search', { queries: ['research'] }],
          ['web_read', { target: 'S1', mode: 'direct' }],
          ['web_read', { target: 'S1', mode: 'extract', focus: 'facts' }],
          ['materials_hide', { handles: ['S1'] }],
        ]
        if (steps[results.length]) {
          const [name, args] = steps[results.length], id = `call-${results.length}`, argumentsText = JSON.stringify(args)
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsText }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsText } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
        }
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: response }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: response } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const model = new Model(), errors = []
  ctx.llm.registerAdapter(['mock'], model)
  ctx.on('agent/error', ({ error }) => errors.push(error))
  const create = async id => (await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'test' },
    setup: async child => { await ctx.agentPresets.mount(child, id) } })).agent
  const ask = async (agent, text) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle()
  }
  const other = await create('standard')
  const originalSearch = ctx.tools.get('web_search', other)
  const banso = await create('banso')
  await ask(banso, 'research')
  assert.deepEqual(errors, [])
  assert.equal(model.requests.length, 5)
  for (const request of model.requests) {
    assert.deepEqual(request.tools.map(tool => tool.name).sort(), ['materials_hide', 'web_read', 'web_search', 'working_directory'])
    const content = JSON.stringify(request.messages)
    assert.match(content, /You are Banso/)
    assert.match(content, /RESEARCH RULE FIXTURE/)
    assert.match(content, /Research reference time \(UTC\): \d{4}-/)
    assert.doesNotMatch(content, /HOST IDENTITY/)
  }
  assert.match(snapshot(model.requests[1]), /Search snippet/)
  assert.match(snapshot(model.requests[0]), /Research budget: 15/)
  assert.match(snapshot(model.requests[2]), /FULL PAGE BODY/)
  assert.match(snapshot(model.requests[3]), /EXTRACTED EVIDENCE/)
  assert.doesNotMatch(snapshot(model.requests[3]), /FULL PAGE BODY/)
  assert.doesNotMatch(snapshot(model.requests[4]), /Material: S1/)
  assert.equal(model.extractions, 1)
  assert.equal(records[1].fetches, 1)
  assert.notEqual(records[1].web, ctx.web)
  assert.equal(ctx.tools.get('web_search', other), originalSearch)
  await ask(other, 'standard')
  assert.deepEqual(errors, [])
  const last = model.requests.at(-1)
  assert.match(JSON.stringify(last.messages), /HOST IDENTITY/)
  assert.ok(!last.messages.some(m => m.source.kind === 'banso-materials'))
  assert.match(textOf(last.messages.findLast(m => m.role === 'tool')), /Search snippet/)
  assert.equal(records[0].searches, 1)
  assert.equal(records[0].fetches, 0)
  assert.equal(ctx.tools.get('web_search', other), originalSearch)
  assert.ok(ctx.tools.schemas(scopeOf(other.ctx)).some(tool => tool.name === 'web_fetch'))
})
