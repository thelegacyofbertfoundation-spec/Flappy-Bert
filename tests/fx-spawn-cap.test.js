const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnParticles, PARTICLE_CAP } = require('./lib/spawn-cap');

test('spawnParticles spawns when under cap', () => {
  const arr = [];
  const n = spawnParticles(arr, { x: 0, y: 0, count: 8 });
  assert.equal(n, 8);
  assert.equal(arr.length, 8);
});

test('spawnParticles spawns up to cap then drops silently', () => {
  const arr = new Array(PARTICLE_CAP - 5).fill({});
  const n = spawnParticles(arr, { x: 0, y: 0, count: 20 });
  assert.equal(n, 5, 'should only spawn the 5 remaining slots');
  assert.equal(arr.length, PARTICLE_CAP);
});

test('spawnParticles drops fully when at cap', () => {
  const arr = new Array(PARTICLE_CAP).fill({});
  const n = spawnParticles(arr, { x: 0, y: 0, count: 10 });
  assert.equal(n, 0);
  assert.equal(arr.length, PARTICLE_CAP);
});
