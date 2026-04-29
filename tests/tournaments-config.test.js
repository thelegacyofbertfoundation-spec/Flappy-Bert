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
