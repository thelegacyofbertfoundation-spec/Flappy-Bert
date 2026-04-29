const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { loadTournamentsFromFile } = require('../tournaments-config');

function withTempFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flappy-test-'));
  const file = path.join(dir, 'tournaments.json');
  fs.writeFileSync(file, contents);
  try { return fn(file); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('loadTournamentsFromFile parses a valid 3-tournament file', () => {
  const json = JSON.stringify([
    { id: 'a', name: 'A', sponsor: 'X', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-31T23:59:59Z' },
    { id: 'b', name: 'B', sponsor: 'X', startTime: '2026-02-01T00:00:00Z', endTime: '2026-02-28T23:59:59Z' },
    { id: 'c', name: 'C', sponsor: 'X', startTime: '2026-03-01T00:00:00Z', endTime: '2026-03-31T23:59:59Z' },
  ]);
  withTempFile(json, (file) => {
    const result = loadTournamentsFromFile(file);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'a');
  });
});

test('loadTournamentsFromFile returns [] when file missing', () => {
  const result = loadTournamentsFromFile('/nonexistent/path/tournaments.json');
  assert.deepEqual(result, []);
});

test('loadTournamentsFromFile returns [] when JSON is malformed', () => {
  withTempFile('{not json', (file) => {
    const result = loadTournamentsFromFile(file);
    assert.deepEqual(result, []);
  });
});

test('loadTournamentsFromFile skips entries missing required fields', () => {
  const json = JSON.stringify([
    { id: 'good', name: 'G', sponsor: 'X', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-31T23:59:59Z' },
    { id: 'bad-no-end', name: 'B', sponsor: 'X', startTime: '2026-02-01T00:00:00Z' },
    { name: 'bad-no-id', sponsor: 'X', startTime: '2026-03-01T00:00:00Z', endTime: '2026-03-31T23:59:59Z' },
  ]);
  withTempFile(json, (file) => {
    const result = loadTournamentsFromFile(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'good');
  });
});

test('loadTournamentsFromFile returns [] when JSON is not an array', () => {
  withTempFile(JSON.stringify({ id: 'wrong' }), (file) => {
    const result = loadTournamentsFromFile(file);
    assert.deepEqual(result, []);
  });
});

const { getFeaturedTournament } = require('../tournaments-config');

const T = (id, startISO, endISO) => ({
  id, name: id, sponsor: 'X',
  startTime: startISO, endTime: endISO,
});

test('getFeaturedTournament: returns null when list is empty', () => {
  const result = getFeaturedTournament([], new Date('2026-05-15T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: prefers a live tournament over everything else', () => {
  const tournaments = [
    T('past',     '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('live',     '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('upcoming', '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result.id, 'live');
  assert.equal(result.featured_state, 'live');
});

test('getFeaturedTournament: picks upcoming starting in <7d if no live', () => {
  const tournaments = [
    T('soon', '2026-05-05T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('far',  '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T12:00:00Z'));
  assert.equal(result.id, 'soon');
  assert.equal(result.featured_state, 'upcoming');
});

test('getFeaturedTournament: ignores upcoming tournaments more than 7d away', () => {
  const tournaments = [
    T('far', '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: picks recently_ended within 14d if no live and no upcoming<7d', () => {
  const tournaments = [
    T('just-ended', '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('older',      '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-05T12:00:00Z'));
  assert.equal(result.id, 'just-ended');
  assert.equal(result.featured_state, 'recently_ended');
});

test('getFeaturedTournament: ignores ended tournaments older than 14d', () => {
  const tournaments = [
    T('old', '2026-02-01T00:00:00Z', '2026-02-28T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result, null);
});

test('getFeaturedTournament: when multiple live, returns the most recently started', () => {
  const tournaments = [
    T('older-live', '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('newer-live', '2026-05-10T00:00:00Z', '2026-06-09T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-15T12:00:00Z'));
  assert.equal(result.id, 'newer-live');
  assert.equal(result.featured_state, 'live');
});

test('getFeaturedTournament: handles April→May handoff at midnight UTC', () => {
  const tournaments = [
    T('april', '2026-04-01T00:00:00Z', '2026-04-30T23:59:59Z'),
    T('may',   '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T00:00:01Z'));
  assert.equal(result.id, 'may');
  assert.equal(result.featured_state, 'live');
});

test('getFeaturedTournament: when multiple upcoming<7d, returns the soonest-start', () => {
  const tournaments = [
    T('later-upcoming',  '2026-05-06T00:00:00Z', '2026-05-31T23:59:59Z'),
    T('sooner-upcoming', '2026-05-03T00:00:00Z', '2026-05-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-01T12:00:00Z'));
  assert.equal(result.id, 'sooner-upcoming');
  assert.equal(result.featured_state, 'upcoming');
});

test('getFeaturedTournament: when multiple recently_ended<14d, returns the most-recently-ended', () => {
  const tournaments = [
    T('older-ended', '2026-04-01T00:00:00Z', '2026-04-25T23:59:59Z'),
    T('newer-ended', '2026-04-05T00:00:00Z', '2026-04-30T23:59:59Z'),
  ];
  const result = getFeaturedTournament(tournaments, new Date('2026-05-05T12:00:00Z'));
  assert.equal(result.id, 'newer-ended');
  assert.equal(result.featured_state, 'recently_ended');
});
