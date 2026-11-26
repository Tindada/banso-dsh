import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Web, { WebError } from '@deepseek-ai/dsh-web'
import * as Fallback from '../lib/index.js'

const url = 'https://example.com/article'

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

const makeProvider = (id, fetchImpl, available = () => true) => ({
  id,
  available,
  fetch: fetchImpl,
})

test('returns primary 2xx result without calling fallback', async () => {
  let fallbackCalled = 0
  const provider = new Fallback.FallbackFetchProvider({
    primary: makeProvider('deepseek-fetch-api', async () => ({
      url, statusCode: 200, body: { kind: 'text', content: 'from primary' }, truncated: false,
    })),
    fallback: makeProvider('jina', async () => {
      fallbackCalled += 1
      return { url, statusCode: 200, body: { kind: 'text', content: 'from jina' }, truncated: false }
    }),
    primaryTimeoutMs: 5000,
  })
  const result = await provider.fetch({ url })
  assert.equal(result.body.content, 'from primary')
  assert.equal(fallbackCalled, 0)
})

test('falls back to jina on primary 404, 5xx, non-2xx result, and primary timeout', async () => {
  const cases = [
    async () => {
      throw new WebError(
        'DeepSeek API error (HTTP 404): failed to fetch URL\n\nThe web request used endpoint "https://api.deepseek.com/v1/tools/fetch".',
        'WEB_PROVIDER_ERROR',
      )
    },
    async () => {
      throw new WebError('DeepSeek API error (HTTP 502): bad gateway', 'WEB_PROVIDER_ERROR')
    },
    async () => ({ url, statusCode: 404, body: { kind: 'text', content: 'not found' }, truncated: false }),
    async (_req, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new WebError('aborted', 'WEB_ABORTED')), { once: true })
    }),
  ]
  for (const primaryFetch of cases) {
    let fallbackCalled = 0
    const provider = new Fallback.FallbackFetchProvider({
      primary: makeProvider('deepseek-fetch-api', primaryFetch),
      fallback: makeProvider('jina', async () => {
        fallbackCalled += 1
        return { url: `${url}/final`, statusCode: 200, body: { kind: 'text', content: 'from jina' }, truncated: false }
      }),
      primaryTimeoutMs: 30,
    })
    const result = await provider.fetch({ url })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.content, 'from jina')
    assert.equal(fallbackCalled, 1)
  }
})

test('does not fall back on credential missing, auth errors, invalid URL, or external abort', async () => {
  const authErrors = [
    new WebError('DeepSeek web access has no API key', 'WEB_PROVIDER_CREDENTIAL_MISSING'),
    new WebError('DeepSeek API error (HTTP 401): unauthorized\n\nThe web request used endpoint "https://x".', 'WEB_PROVIDER_ERROR'),
    new WebError('DeepSeek API error (HTTP 403): forbidden\n\nThe web request used endpoint "https://x".', 'WEB_PROVIDER_ERROR'),
    new WebError('DeepSeek API error (HTTP 401)\n\nDeepSeek rejected the account sign-in used for this web request.', 'WEB_PROVIDER_ERROR'),
  ]
  for (const err of authErrors) {
    let fallbackCalled = 0
    const provider = new Fallback.FallbackFetchProvider({
      primary: makeProvider('deepseek-fetch-api', async () => { throw err }),
      fallback: makeProvider('jina', async () => {
        fallbackCalled += 1
        return { url, statusCode: 200, body: { kind: 'text', content: 'should not run' }, truncated: false }
      }),
      primaryTimeoutMs: 5000,
    })
    await assert.rejects(provider.fetch({ url }), caught => caught === err)
    assert.equal(fallbackCalled, 0)
  }

  let called = 0
  const guarded = new Fallback.FallbackFetchProvider({
    primary: makeProvider('deepseek-fetch-api', async () => { called += 1; throw new Error('unexpected') }),
    fallback: makeProvider('jina', async () => { called += 1; throw new Error('unexpected') }),
    primaryTimeoutMs: 5000,
  })
  await rejects(guarded.fetch({ url: 'file:///etc/passwd' }), /HTTP\(S\)/)
  await rejects(guarded.fetch({ url }, AbortSignal.abort()), /aborted/, 'WEB_ABORTED')
  assert.equal(called, 0)
})

test('external abort during primary stops immediately without calling fallback', async () => {
  let fallbackCalled = 0
  const controller = new AbortController()
  const provider = new Fallback.FallbackFetchProvider({
    primary: makeProvider('deepseek-fetch-api', (_req, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new WebError('aborted', 'WEB_ABORTED')), { once: true })
    })),
    fallback: makeProvider('jina', async () => {
      fallbackCalled += 1
      return { url, statusCode: 200, body: { kind: 'text', content: 'from jina' }, truncated: false }
    }),
    primaryTimeoutMs: 5000,
  })
  const pending = provider.fetch({ url }, controller.signal)
  controller.abort(new Error('user cancel'))
  await rejects(pending, /aborted/, 'WEB_ABORTED')
  assert.equal(fallbackCalled, 0)
})

test('summarizes both failures concisely and strips endpoint guidance when both fail', async () => {
  const provider = new Fallback.FallbackFetchProvider({
    primary: makeProvider('deepseek-fetch-api', async () => {
      throw new WebError(
        'DeepSeek API error (HTTP 404): failed to fetch URL\n\nThe web request used endpoint "https://api.deepseek.com/v1/tools/fetch". Fetch derives this endpoint from ...',
        'WEB_PROVIDER_ERROR',
      )
    }),
    fallback: makeProvider('jina', async () => ({
      url, statusCode: 403, body: { kind: 'text', content: 'Target URL returned error 403' }, truncated: false,
    })),
    primaryTimeoutMs: 5000,
  })
  await assert.rejects(provider.fetch({ url }), error => {
    assert.equal(error.code, 'WEB_PROVIDER_ERROR')
    assert.equal(
      error.message,
      'deepseek-fetch-api: DeepSeek API error (HTTP 404): failed to fetch URL; jina: HTTP 403',
    )
    assert.ok(!error.message.includes('The web request used endpoint'))
    return true
  })
})

test('config schema validates numeric limits', () => {
  assert.doesNotThrow(() => Fallback.Config({}))
  assert.doesNotThrow(() => Fallback.Config({
    deepseek: { timeoutMs: 20000 },
    jina: { timeoutMs: 30000, maxBodyChars: 100000 },
  }))
  for (const bad of [
    { deepseek: { timeoutMs: 0 } },
    { deepseek: { timeoutMs: 1.5 } },
    { jina: { timeoutMs: 0 } },
    { jina: { maxBodyChars: 0 } },
  ]) assert.throws(() => Fallback.Config(bad))
})

test('Cordis plugin wires DeepSeek Fetch API primary with Jina fallback end-to-end', async t => {
  const dsRequests = []
  const jinaRequests = []
  let dsStatus = 404
  const dsBaseURL = await server(t, (req, res) => {
    dsRequests.push({ path: req.url, auth: req.headers.authorization })
    res.statusCode = dsStatus
    res.setHeader('Content-Type', 'application/json')
    if (dsStatus === 200) {
      res.end(JSON.stringify({ content: '# Primary Content' }))
    } else {
      res.end(JSON.stringify({ error: 'failed to fetch URL' }))
    }
  })
  const jinaBaseURL = await server(t, (req, res) => {
    jinaRequests.push({ path: req.url, auth: req.headers.authorization })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 200, status: 20000, data: { url: `${url}/jina`, content: '# Jina Content' } }))
  })

  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Web, { fetchProvider: 'fallback' })
  const plugin = await ctx.plugin(Fallback, {
    deepseek: { apiKey: 'ds-key', baseURL: dsBaseURL, timeoutMs: 5000 },
    jina: { apiKey: '', baseURL: jinaBaseURL, timeoutMs: 5000 },
  })

  // Primary 404 -> falls back to anonymous Jina
  const fromFallback = await ctx.web.fetch({ url })
  assert.equal(fromFallback.statusCode, 200)
  assert.equal(fromFallback.url, `${url}/jina`)
  assert.equal(fromFallback.body.content, '# Jina Content')
  assert.equal(dsRequests.length, 1)
  assert.equal(dsRequests[0].path, '/fetch')
  assert.equal(dsRequests[0].auth, 'Bearer ds-key')
  assert.equal(jinaRequests.length, 1)
  assert.equal(jinaRequests[0].path, `/${url}`)
  assert.equal(jinaRequests[0].auth, undefined)

  // Primary 200 -> returns directly without hitting Jina
  dsStatus = 200
  const fromPrimary = await ctx.web.fetch({ url })
  assert.equal(fromPrimary.body.content, '# Primary Content')
  assert.equal(jinaRequests.length, 1)

  // Primary 401 -> propagates auth error without hitting Jina
  dsStatus = 401
  await rejects(ctx.web.fetch({ url }), /HTTP 401/)
  assert.equal(jinaRequests.length, 1)

  await plugin.dispose()
  await rejects(ctx.web.fetch({ url }), /not registered/, 'WEB_PROVIDER_CONFIGURED_MISSING')
})
