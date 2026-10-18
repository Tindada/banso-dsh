import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { reportReady } from '../src/index.js';
const url = 'http://127.0.0.1:45678/?token=test-token';
const launcher = exitCode => Object.assign(new EventEmitter(), { exitCode });
test('startup opens the complete URL by default; no-open still prints it', async () => {
  for (const enabled of [undefined, false]) {
    const opened = [], logged = [];
    await reportReady(url, enabled, async value => { opened.push(value); return launcher(0); }, {
      log: value => logged.push(value), warn: () => assert.fail('unexpected failure'),
    });
    assert.deepEqual(opened, enabled === false ? [] : [url]);
    assert.deepEqual(logged, [`Banso Web: ${url}`]);
  }
});
test('browser launch failures warn without rejecting or exposing error details', async () => {
  for (const failure of ['reject', 'exit', 'late-exit', 'error']) {
    const child = launcher(failure === 'exit' ? 1 : null);
    const warnings = [];
    await reportReady(url, true, async () => {
      if (failure === 'reject') throw new Error('launcher details');
      return child;
    }, { log() {}, warn: text => warnings.push(text) });
    if (failure === 'late-exit') child.emit('close', 1);
    if (failure === 'error') { child.emit('error', new Error('failed')); child.emit('close', 1); }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /手动打开/);
  }
});
