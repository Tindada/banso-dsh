import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js');
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'banso-web-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profile = join(home, 'profiles', 'banso-web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  const deps = { 'banso-dsh': 'workspace:*', 'banso-dsh-web': 'workspace:*' };
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'web-test-profile', private: true, type: 'module', dependencies: deps, dsh: { profile: { bundles: Object.keys(deps) } } }));
  await symlink(join(root, 'packages/banso'), join(profile, 'node_modules/banso-dsh'));
  await symlink(join(root, 'packages/web'), join(profile, 'node_modules/banso-dsh-web'));
  await writeFile(join(profile, 'cordis.patch.yml'), `
- id: llm-deepseek
  disabled: true
- id: llm-retry
  disabled: true
- id: agent-default-model
  config:
    provider: mock
    model: test
- insert:
    - id: test-model
      name: ${JSON.stringify(resolve(root, 'packages/web/tests/fixtures/model.mjs'))}
`);
  const env = { ...process.env, DSH_HOME: home };
  delete env.DEEPSEEK_API_KEY; delete env.TAVILY_API_KEY; delete env.JINA_API_KEY;
  return { home, env };
}

test('real profile and browser: chat, stream, follow-up, stop, error, refresh', { timeout: 120000 }, async t => {
  const { env } = await fixture(t);
  const child = spawn(process.execPath, [cli, '--profile', 'banso-web', '--port', '0'], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = once(child, 'exit');
  t.after(async () => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited; clearTimeout(timer);
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`startup timeout\n${output}`)); }, 30000);
    const poll = setInterval(() => {
      const match = output.match(/Banso Web: (http:\/\/\S+)/);
      if (match) { cleanup(); resolve(match[1]); }
      else if (child.exitCode !== null) { cleanup(); reject(new Error(output)); }
    }, 50);
    function cleanup() { clearTimeout(timer); clearInterval(poll); }
  });
  assert.doesNotMatch(output, /did not activate|failed to load/i);
  const browser = await chromium.launch({ headless: true, ...(process.env.BANSO_TEST_CHROMIUM ? { executablePath: process.env.BANSO_TEST_CHROMIUM } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  try {
    await page.getByLabel('你的问题').waitFor({ timeout: 20000 });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const input = page.getByLabel('你的问题');
    const ask = async text => { await input.fill(text); await send.click(); };
    await ask('hello');
    await page.waitForFunction(() => {
      const text = document.querySelector('.assistant div')?.textContent;
      return text && text.length < '回答：hello'.length;
    });
    await page.locator('.assistant').filter({ hasText: '回答：hello' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.locator('.assistant').count(), 1);
    assert.equal(await page.locator('.user').count(), 1);
    await ask('again');
    await page.locator('.assistant').filter({ hasText: '回答：again' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    await ask('slow');
    await page.waitForFunction(() => document.querySelectorAll('.assistant').length === 3);
    assert.notEqual(await page.locator('.assistant').last().innerText(), 'Banso\n回答：slow');
    await page.getByRole('button', { name: '停止', exact: true }).waitFor();
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    await ask('error');
    await page.getByRole('alert').filter({ hasText: 'fixture model failure' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    await ask('recovered');
    await page.locator('.assistant').filter({ hasText: '回答：recovered' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    await page.reload();
    await input.waitFor();
    assert.equal(await page.locator('.banso-message').count(), 0);
    await ask('fresh');
    await page.locator('.assistant').filter({ hasText: '回答：fresh' }).waitFor();
    assert.equal(await page.locator('.user').count(), 1);
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    await mkdir(join(root, 'packages/web/lib'), { recursive: true });
    await page.screenshot({ path: join(root, 'packages/web/lib/chat-smoke.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error}\nBrowser: ${await page.locator('body').innerText()}\nPage errors: ${errors.join('\n')}\nHost: ${output}`);
  }
});

test('--help exits without binding HTTP', { timeout: 30000 }, async t => {
  const { env } = await fixture(t);
  const child = spawn(process.execPath, [cli, '--profile', 'banso-web', '--help'], { env, cwd: root });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  assert.match(output, /--port/);
  assert.doesNotMatch(output, /Banso Web:/);
});
