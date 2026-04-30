const test = require('node:test');
const assert = require('node:assert/strict');
const { createSequence } = require('./lib/sequence-runner');

test('sequence runs steps at scheduled times', async () => {
  const log = [];
  const seq = createSequence([
    { at: 0,  fn: () => log.push('a'), name: 'a' },
    { at: 10, fn: () => log.push('b'), name: 'b' },
  ]);
  seq.start();
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(log, ['a', 'b']);
});

test('cancel stops pending steps', async () => {
  const log = [];
  const seq = createSequence([
    { at: 0,  fn: () => log.push('a'), name: 'a' },
    { at: 50, fn: () => log.push('b'), name: 'b' },
  ]);
  seq.start();
  await new Promise(r => setTimeout(r, 5));
  seq.cancel();
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(log, ['a']);
  assert.equal(seq.completed.has('b'), false);
});

test('skip jumps to end immediately', () => {
  const log = [];
  const seq = createSequence([
    { at: 0,    fn: () => log.push('a'), name: 'a' },
    { at: 1000, fn: () => log.push('b'), name: 'b' },
    { at: 2000, fn: () => log.push('c'), name: 'c' },
  ]);
  seq.start();
  seq.skip();
  assert.deepEqual(log, ['a', 'b', 'c']);
});
