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
  if (Date.parse(obj.endTime) <= Date.parse(obj.startTime)) return false;
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

const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENTLY_ENDED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function getFeaturedTournament(tournaments, now) {
  const t = now instanceof Date ? now : new Date(now);
  const nowMs = t.getTime();

  let live = null;
  let upcoming = null;
  let recentlyEnded = null;

  for (const entry of tournaments) {
    const startMs = Date.parse(entry.startTime);
    const endMs = Date.parse(entry.endTime);

    if (nowMs >= startMs && nowMs <= endMs) {
      if (live === null || startMs > Date.parse(live.startTime)) {
        live = entry;
      }
    } else if (nowMs < startMs) {
      if (startMs - nowMs <= UPCOMING_WINDOW_MS) {
        if (upcoming === null || startMs < Date.parse(upcoming.startTime)) {
          upcoming = entry;
        }
      }
    } else {
      if (nowMs - endMs <= RECENTLY_ENDED_WINDOW_MS) {
        if (recentlyEnded === null || endMs > Date.parse(recentlyEnded.endTime)) {
          recentlyEnded = entry;
        }
      }
    }
  }

  if (live) return { ...live, featured_state: 'live' };
  if (upcoming) return { ...upcoming, featured_state: 'upcoming' };
  if (recentlyEnded) return { ...recentlyEnded, featured_state: 'recently_ended' };
  return null;
}

module.exports = { loadTournamentsFromFile, validateTournament, getFeaturedTournament };
