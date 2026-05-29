const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell } = require('./lib/csv-cell');

test('passes through a plain value unchanged', () => {
  assert.equal(csvCell('Alice'), 'Alice');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(null), '');
});

test('quotes embedded commas (no column injection)', () => {
  assert.equal(csvCell('a,b,c'), '"a,b,c"');
});

test('quotes and doubles embedded quotes', () => {
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
});

test('quotes embedded newlines (no row injection)', () => {
  assert.equal(csvCell('a\n0,1,PWNED'), '"a\n0,1,PWNED"');
  assert.equal(csvCell('a\r\nb'), '"a\r\nb"');
});

test('defangs formula-injection leading chars', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
});

test('a formula that also contains a comma is both defanged AND quoted', () => {
  // leading '=' -> prefix quote; comma -> wrap. Cell cannot break columns or execute.
  const out = csvCell('=cmd,evil');
  assert.equal(out, '"\'=cmd,evil"');
});
