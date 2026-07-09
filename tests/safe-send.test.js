// FIX 2 — crash safety. safeSend wraps a fire-and-forget Telegram send so a
// rejected API call (429 burst / 403 bot-blocked / 400) is LOGGED and swallowed
// instead of becoming an unhandled rejection that kills the score API mid-tournament.
// throttleKey backs the throttled polling_error logger.

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeSend, SAFE_SEND_FAILED, throttleKey } = require('../lib/safe-send');

test('safeSend: resolved value passes through (function form)', async () => {
  const out = await safeSend(() => Promise.resolve(42));
  assert.equal(out, 42);
});

test('safeSend: resolved value passes through (promise form)', async () => {
  const out = await safeSend(Promise.resolve('ok'));
  assert.equal(out, 'ok');
});

test('safeSend: rejection is logged and returns the sentinel, never throws', async () => {
  const logs = [];
  const logger = (...a) => logs.push(a.join(' '));
  let out;
  await assert.doesNotReject(async () => {
    out = await safeSend(() => Promise.reject(new Error('429 too many requests')), 'sendMessage', logger);
  });
  assert.equal(out, SAFE_SEND_FAILED);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /sendMessage/);
  assert.match(logs[0], /429 too many requests/);
});

test('safeSend: synchronous throw inside the thunk is also caught', async () => {
  const out = await safeSend(() => { throw new Error('boom'); }, 'sync', () => {});
  assert.equal(out, SAFE_SEND_FAILED);
});

test('safeSend: a directly-passed rejected promise is caught, not unhandled', async () => {
  const out = await safeSend(Promise.reject(new Error('403 blocked')), 'photo', () => {});
  assert.equal(out, SAFE_SEND_FAILED);
});

test('throttleKey: first call true, immediate repeat false, distinct keys independent', () => {
  const state = new Map();
  assert.equal(throttleKey(state, 'EFATAL', 1000, 30000), true);   // first time
  assert.equal(throttleKey(state, 'EFATAL', 1005, 30000), false);  // within window
  assert.equal(throttleKey(state, 'ETELEGRAM', 1005, 30000), true); // other key independent
  assert.equal(throttleKey(state, 'EFATAL', 31000, 30000), true);  // window elapsed
});
