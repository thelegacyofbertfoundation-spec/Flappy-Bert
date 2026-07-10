const test = require('node:test');
const assert = require('node:assert/strict');
const { levelForScore, speedAtLevel, gapAtLevel } = require('./lib/difficulty-curve');

test('levelForScore: floor(score/10)+1', () => {
  assert.equal(levelForScore(0), 1);
  assert.equal(levelForScore(9), 1);
  assert.equal(levelForScore(10), 2);
  assert.equal(levelForScore(110), 12);
  assert.equal(levelForScore(190), 20);
  assert.equal(levelForScore(500), 51);
});

test('speed ramps +0.25/level below the cap', () => {
  assert.equal(speedAtLevel(1), 2.75);
  assert.equal(speedAtLevel(6), 4.0);
  assert.equal(speedAtLevel(11), 5.25);
});

test('speed caps at 5.5, reached at level 12', () => {
  assert.equal(speedAtLevel(12), 5.5);
  assert.equal(speedAtLevel(13), 5.5);
  assert.equal(speedAtLevel(60), 5.5);
});

test('speed-at-score matches the approved spec table', () => {
  const speedAtScore = (s) => speedAtLevel(levelForScore(s));
  assert.equal(speedAtScore(0), 2.75);
  assert.equal(speedAtScore(50), 4.0);
  assert.equal(speedAtScore(100), 5.25);
  assert.equal(speedAtScore(110), 5.5);
  assert.equal(speedAtScore(190), 5.5);
  assert.equal(speedAtScore(500), 5.5);
});

test('gap schedule is UNCHANGED: 190 - 4/level, floor 110 at level 20', () => {
  assert.equal(gapAtLevel(1), 186);
  assert.equal(gapAtLevel(19), 114);
  assert.equal(gapAtLevel(20), 110);
  assert.equal(gapAtLevel(60), 110);
});

test('speed never decreases and gap never increases across levels 1..60', () => {
  for (let lvl = 2; lvl <= 60; lvl++) {
    assert.ok(speedAtLevel(lvl) >= speedAtLevel(lvl - 1), `speed dip at level ${lvl}`);
    assert.ok(gapAtLevel(lvl) <= gapAtLevel(lvl - 1), `gap rise at level ${lvl}`);
  }
});
