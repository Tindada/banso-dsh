import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import Web from '@deepseek-ai/dsh-web'
import * as Jina from '../lib/index.js'

const createProvider = options => new Jina.JinaFetchProvider({ apiKey: '', timeoutMs: 30000, maxBodyChars: 100000, ...options })
const url = 'https://example.com/article?edition=global&lang=en'
const payload = (data = {}) => ({ code: 200, status: 20000, data: { content: '# Article\n\nEvidence.', ...data } })
async function server(t, handler) {
  const instance = createServer(handler)
  instance.listen(0, '127.0.0.1')
  await once(instance, 'listening')
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve) }))
  return `http://127.0.0.1:${instance.address().port}`
}
const rejects = (promise, message, code = 'WEB_PROVIDER_ERROR') => assert.rejects(promise, error => {
  assert.equal(error.code, code)
  assert.match(error.message, message)
  return true
})

test('anonymous and authenticated requests map Markdown and target URLs', async t => {
  const requests = []
  const baseURL = await server(t, (req, res) => {
    requests.push({ path: req.url, headers: req.headers, method: req.method })
    res.end(JSON.stringify(payload({ url: 'https://example.com/final', content: '  # Article\n\nEvidence.  ', extra: true })))
  })
  for (const apiKey of ['', 'secret']) {
    const provider = createProvider({ baseURL, apiKey })
    assert.equal(provider.available(), true)
    assert.deepEqual(await provider.fetch({ url }), {
      url: 'https://example.com/final', statusCode: 200,
      body: { kind: 'text', content: '# Article\n\nEvidence.' }, truncated: false,
    })
  }
  assert.ok(requests.every(req => req.path === `/${url}` && req.method === 'GET'))
  assert.ok(requests.every(req => req.headers.accept === 'application/json' && req.headers['x-no-cache'] === 'true'))
  assert.deepEqual(requests.map(req => req.headers.authorization), [undefined, 'Bearer secret'])
})

test('URL fallback, truncation and target failures', async t => {
  let data = { url: ' ', content: '123456' }
  const baseURL = await server(t, (_req, res) => res.end(JSON.stringify(payload(data))))
  const provider = createProvider({ baseURL, maxBodyChars: 5 })
  const result = await provider.fetch({ url })
  assert.equal(result.url, url)
  assert.deepEqual(result.body, { kind: 'text', content: '12345' })
  assert.equal(result.truncated, true)
  data = { content: '', warning: 'Target URL returned error 404: Not Found' }
  const failed = await createProvider({ baseURL }).fetch({ url })
  assert.equal(failed.statusCode, 404)
  assert.equal(failed.body.content, data.warning)
  data = { content: '12345', warning: 'Other warning' }
  assert.equal((await provider.fetch({ url })).truncated, false)
})

test('service errors and invalid responses are provider errors', async t => {
  let body, status = 200
  const baseURL = await server(t, (_req, res) => { res.statusCode = status; res.end(body) })
  const provider = createProvider({ baseURL, apiKey: '', timeoutMs: 30000, maxBodyChars: 100000 })
  for (const [value, message] of [
    ['bad json', /invalid response/],
    [JSON.stringify({ code: 500 }), /invalid response/],
    [JSON.stringify(payload({ content: 1 })), /invalid response/],
    [JSON.stringify(payload({ warning: [] })), /invalid response/],
    [JSON.stringify(payload({ url: 'file:///bad' })), /invalid response/],
    [JSON.stringify(payload({ content: '  ' })), /no extractable text/],
  ]) { body = value; await rejects(provider.fetch({ url }), message) }
  for (status of [401, 429, 503]) {
    body = 'secret service details'
    await rejects(provider.fetch({ url }), new RegExp(`HTTP ${status}$`))
  }
  await rejects(provider.fetch({ url: 'file:///bad' }), /HTTP\(S\)/)
})

test('transport failures do not expose credentials', async t => {
  const baseURL = await server(t, req => req.socket.destroy())
  await rejects(createProvider({ baseURL, apiKey: 'secret' }).fetch({ url }), /^Jina Reader request failed$/)
})

test('external cancellation covers waiting for headers and reading the body', async t => {
  for (const bodyStarted of [false, true]) {
    let arrived
    const ready = new Promise(resolve => { arrived = resolve })
    const baseURL = await server(t, (_req, res) => {
      if (bodyStarted) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{') }
      arrived()
    })
    const controller = new AbortController()
    const result = createProvider({ baseURL }).fetch({ url }, controller.signal)
    const checked = rejects(result, /aborted/, 'WEB_ABORTED')
    await ready
    controller.abort(new Error('custom cancellation'))
    await checked
  }
})

test('provider timeout and already-aborted signals', async t => {
  const baseURL = await server(t, (_req, res) => { res.writeHead(200); res.write('{') })
  const provider = createProvider({ baseURL, timeoutMs: 50 })
  await rejects(provider.fetch({ url }), /timed out/, 'WEB_ABORTED')
  await rejects(provider.fetch({ url }, AbortSignal.abort()), /aborted/, 'WEB_ABORTED')
})

test('availability checks configuration without network requests', () => {
  const defaults = { apiKey: '', baseURL: 'https://r.jina.ai', timeoutMs: 30000, maxBodyChars: 100000 }
  assert.equal(new Jina.JinaFetchProvider(defaults).available(), true)
  for (const options of [
    { baseURL: 'file:///bad' }, { baseURL: 'https://example.com/?q=x' },
  ]) assert.equal(new Jina.JinaFetchProvider({ ...defaults, ...options }).available(), false)
})

test('config schema validates numeric limits', () => {
  assert.doesNotThrow(() => Jina.Config({}))
  assert.doesNotThrow(() => Jina.Config({ timeoutMs: 30000, maxBodyChars: 100000 }))
  for (const config of [
    { timeoutMs: 0 }, { timeoutMs: 2 ** 31 }, { timeoutMs: 1.5 },
    { maxBodyChars: 0 }, { maxBodyChars: NaN }, { maxBodyChars: 1.5 },
  ]) assert.throws(() => Jina.Config(config))
})

test('plugin registration, explicit selection, unload and reload', async t => {
  const baseURL = await server(t, (_req, res) => res.end(JSON.stringify(payload())))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Web, { fetchProvider: 'jina' })
  ctx.web.registerFetchProvider({ id: 'http', available: () => true, fetch() { throw new Error('wrong provider') } })
  const plugin = await ctx.plugin(Jina, { baseURL, apiKey: '' })
  assert.equal((await ctx.web.fetch({ url })).body.content, '# Article\n\nEvidence.')
  await plugin.dispose()
  await rejects(ctx.web.fetch({ url }), /not registered/, 'WEB_PROVIDER_CONFIGURED_MISSING')
  await ctx.plugin(Jina, { baseURL, apiKey: '' })
  assert.equal((await ctx.web.fetch({ url })).statusCode, 200)
})
