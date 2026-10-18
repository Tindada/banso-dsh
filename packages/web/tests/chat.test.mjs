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
- id: web
  config:
    searchProvider: fixture
    fetchProvider: fixture
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
  const child = spawn(process.execPath, [cli, '--profile', 'banso-web', '--port', '0', '--no-open'], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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
    await input.fill('   ');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '   ');
    assert.equal(await page.locator('.user').count(), 0);
    await input.fill('hello');
    await input.press('Shift+Enter');
    assert.equal(await input.inputValue(), 'hello\n');
    assert.equal(await page.locator('.user').count(), 0);
    // Synthetic IME events exercise the guards; real keyboard input below sends the message.
    await input.dispatchEvent('compositionstart');
    assert.equal(await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))), true);
    await input.dispatchEvent('compositionend');
    for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
      assert.equal(await input.evaluate((node, ime) => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...ime })), ime), true);
    }
    assert.equal(await input.inputValue(), 'hello\n');
    await input.press('Enter');
    await input.press('Enter');
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
    await ask('tools');
    await page.locator('.banso-tool.running').filter({ hasText: '正在搜索' }).waitFor();
    assert.equal(await page.locator('.assistant').filter({ hasText: '我来搜索相关来源。' }).count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('.banso-tool.running').length === 2);
    assert.equal(await page.locator('.assistant').filter({ hasText: '我找到了相关来源，现在开始阅读。' }).count(), 1);
    await page.locator('.banso-tool.completed').filter({ hasText: '返回 2 个来源' }).waitFor();
    await page.locator('.banso-tool.failed').filter({ hasText: '内容提取达到输出上限' }).waitFor();
    assert.equal(await page.locator('.banso-tool').count(), 3);
    assert.equal(await page.locator('.banso-tool.completed').count(), 2);
    const failed = page.locator('.banso-tool.failed');
    assert.equal(await failed.getAttribute('open'), null);
    await failed.locator('summary').click();
    assert.match(await failed.innerText(), /Extraction failed:/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.locator('.assistant').filter({ hasText: '我找到了相关来源，现在开始阅读。' }).count(), 0);
    assert.equal(await page.locator('.assistant').filter({ hasText: '回答：tools' }).count(), 1);
    assert.equal(await page.locator('.assistant').filter({ hasText: '我来搜索相关来源。' }).count(), 0);
    assert.equal(await page.locator('.banso-tool').count(), 0);
    await ask('cancel-tools');
    await page.waitForFunction(() => document.querySelectorAll('.banso-tool.running').length === 2);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.locator('.assistant').filter({ hasText: '我找到了相关来源，现在开始阅读。' }).count(), 0);
    assert.equal(await page.locator('.banso-tool').count(), 0);
    await ask('error-tools');
    await page.locator('.banso-tool.running').waitFor();
    await page.getByRole('alert').filter({ hasText: 'fixture after tools failure' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.locator('.banso-tool').count(), 0);
    await ask('markdown **用户原文** <b>保留标签</b>');
    await page.locator('.assistant h2').filter({ hasText: '研究结论' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    const markdown = page.locator('.assistant').last();
    assert.equal(await markdown.getByRole('link', { name: '来源', exact: true }).getAttribute('href'), 'https://example.com/source');
    assert.equal(await markdown.locator('table tbody td').count(), 5);
    assert.match(await markdown.locator('pre code').innerText(), /^print\(/);
    assert.match(await markdown.innerText(), /渲染完成/);
    assert.equal(await markdown.locator('script').count(), 0);
    assert.equal(await page.evaluate(() => window.markdownExecuted), undefined);
    assert.equal(await page.locator('.user').last().locator('strong').count(), 1);
    assert.equal(await page.locator('.user').last().locator('b').count(), 0);
    assert.match(await page.locator('.user').last().innerText(), /\*\*用户原文\*\* <b>保留标签<\/b>/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    for (const selector of ['table', 'pre']) {
      assert.equal(await markdown.locator(selector).evaluate(node =>
        node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === 'auto'), true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await ask('math');
    await page.locator('.assistant').last().locator('.katex').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    const math = page.locator('.assistant').last();
    assert.equal(await math.locator('.katex').count(), 5);
    assert.equal(await math.locator('.katex-display').count(), 3);
    assert.equal(await math.locator('.katex-error').count(), 1);
    assert.equal(await math.locator('.katex-display annotation').nth(1).textContent(), 'x=1');
    assert.match(await math.innerText(), /金额：\$10 与 \$20；单个金额 \$30/);
    assert.match(await math.innerText(), /公式完成/);
    await page.evaluate(async () => { await document.fonts.ready; });
    assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'KaTeX_Main' && font.status === 'loaded')), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await math.locator('.katex-display').first().evaluate(node =>
      node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === 'auto'), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await input.waitFor();
    assert.equal(await page.locator('.banso-message').count(), 0);
    await ask('fresh');
    await page.locator('.assistant').filter({ hasText: '回答：fresh' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
    assert.equal(await page.locator('.user').count(), 1);
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
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
  assert.match(output, /--no-open/);
  assert.doesNotMatch(output, /Banso Web:/);
});
