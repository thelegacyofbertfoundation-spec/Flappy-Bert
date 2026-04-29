// tournaments-config.js — loads and validates tournament configuration
// from a JSON file. Pure module: no side effects, no DB access.

const fs = require('node:fs');

const REQUIRED_FIELDS = ['id', 'name', 'sponsor', 'startTime', 'endTime'];

function validateTournament(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const field of REQUIRED_FIELDS) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) return false;
  }
  if (Number.isNaN(Date.parse(obj.startTime))) return false;
  if (Number.isNaN(Date.parse(obj.endTime))) return false;
  return true;
}

function loadTournamentsFromFile(filepath) {
  let raw;
  try {
    raw = fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    console.warn(`[tournaments-config] could not read ${filepath}: ${err.message}`);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[tournaments-config] malformed JSON in ${filepath}: ${err.message}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error(`[tournaments-config] ${filepath} must contain a JSON array, got ${typeof parsed}`);
    return [];
  }

  const valid = [];
  for (const entry of parsed) {
    if (validateTournament(entry)) {
      valid.push(entry);
    } else {
      console.warn(`[tournaments-config] skipping invalid entry: ${JSON.stringify(entry)}`);
    }
  }
  return valid;
}

module.exports = { loadTournamentsFromFile, validateTournament };
