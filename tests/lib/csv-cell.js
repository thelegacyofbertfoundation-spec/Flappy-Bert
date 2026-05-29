// RFC-4180 CSV cell encoder with spreadsheet formula-injection defang.
// Mirror of the csvCell() helper used by archiveWeek() in db.js.
// - Prefixes a leading ' to neutralise cells starting with = + - @ \t \r
//   (Excel/Sheets formula / DDE execution).
// - Quotes and doubles embedded quotes for any cell containing " , CR or LF,
//   so an embedded newline can never inject a new physical CSV row.
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = { csvCell };
