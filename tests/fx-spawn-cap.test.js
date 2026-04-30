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
  const arr = Array.from({ length: PARTICLE_CAP - 5 }, () => ({}));
  const n = spawnParticles(arr, { x: 0, y: 0, count: 20 });
  assert.equal(n, 5, 'should only spawn the 5 remaining slots');
  assert.equal(arr.length, PARTICLE_CAP);
});

test('spawnParticles drops fully when at cap', () => {
  const arr = Array.from({ length: PARTICLE_CAP }, () => ({}));
  const n = spawnParticles(arr, { x: 0, y: 0, count: 10 });
  assert.equal(n, 0);
  assert.equal(arr.length, PARTICLE_CAP);
});

test('spawnParticles with speed=0 still spawns (stationary)', () => {
  const arr = [];
  const n = spawnParticles(arr, { x: 10, y: 20, count: 3, speed: 0 });
  assert.equal(n, 3);
  assert.equal(arr[0].vx, 0);
  assert.equal(arr[0].vy, 0);
});
