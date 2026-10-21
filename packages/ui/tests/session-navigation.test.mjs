import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionFromUrl, urlForSession, titleFromQuestion, relativeSessionTime } from '../lib/types/client/session-navigation.js';
test('selection round trips without losing authentication, unrelated parameters or hash', () => {
  const original = 'http://localhost:1234/?token=secret&other=a%2Bb#anchor';
  const selected = urlForSession(original, 'abc /中文');
  assert.equal(sessionFromUrl(selected), 'abc /中文');
  const url = new URL(selected);
  assert.equal(url.searchParams.get('token'), 'secret');
  assert.equal(url.searchParams.get('other'), 'a+b');
  assert.equal(url.hash, '#anchor');
  assert.equal(sessionFromUrl(urlForSession(selected)), undefined);
  assert.equal(new URL(urlForSession(selected)).searchParams.get('token'), 'secret');
});
test('question titles normalize whitespace and truncate Unicode code points', () => {
  assert.equal(titleFromQuestion('  新闻\n\t研究  '), '新闻 研究');
  assert.equal(titleFromQuestion('😀'.repeat(30)), '😀'.repeat(30));
  assert.equal(titleFromQuestion('😀'.repeat(31)), '😀'.repeat(30) + '…');
  assert.equal(titleFromQuestion(''), '');
});

test('relative session times keep rows compact across boundaries', () => {
  const now = new Date(2026, 9, 21, 12).getTime();
  assert.equal(relativeSessionTime(now + 1000, now), '刚刚');
  assert.equal(relativeSessionTime(now - 59000, now), '刚刚');
  assert.equal(relativeSessionTime(now - 60000, now), '1分钟');
  assert.equal(relativeSessionTime(now - 60 * 60000, now), '1小时');
  assert.equal(relativeSessionTime(now - 24 * 60 * 60000, now), '1天');
  assert.equal(relativeSessionTime(new Date(2026, 8, 1).getTime(), now), '2026/9/1');
});
