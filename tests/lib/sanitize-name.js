// Display-name sanitiser — mirror of sanitizeName() used by upsertPlayer() in db.js.
// Strips control chars (incl. CR/LF/TAB/NUL) that could corrupt the CSV archive
// or rendered cards, trims, length-clamps, and falls back to 'Player' when empty.
function sanitizeName(s, max = 32) {
  const cleaned = String(s == null ? '' : s)
    .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return cleaned || 'Player';
}

module.exports = { sanitizeName };
