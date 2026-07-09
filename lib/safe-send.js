// Crash-safety helpers for the Telegram bot (FIX 2).
//
// node's default kills the process on an unhandled promise rejection, so a single
// failed Telegram send (429 burst, 403 bot-blocked, 400) would take down the whole
// score API mid-tournament. safeSend wraps a fire-and-forget send so any rejection
// (or synchronous throw) is LOGGED and swallowed — the returned promise NEVER rejects.

// Distinct sentinel so callers can tell "send failed" from a legit falsy result.
const SAFE_SEND_FAILED = Symbol('safeSendFailed');

// op: an async function OR a promise (a bot.sendMessage/sendPhoto/… call).
// Returns the resolved value on success, or SAFE_SEND_FAILED on any failure.
async function safeSend(op, label = 'send', logger = console.error) {
  try {
    return await (typeof op === 'function' ? op() : op);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    logger(`⚠️  safeSend(${label}) failed: ${msg}`);
    return SAFE_SEND_FAILED;
  }
}

// Throttle gate for repeated log lines keyed by e.g. an error code. Mutates `state`
// (a Map of key -> lastLoggedMs). Returns true iff at least `windowMs` has elapsed
// since this key last logged (and records `now`), so a 409-conflict storm during a
// deploy overlap logs at most once per window per code instead of spamming.
function throttleKey(state, key, now, windowMs) {
  if (!state.has(key) || (now - state.get(key)) >= windowMs) {
    state.set(key, now);
    return true;
  }
  return false;
}

module.exports = { safeSend, SAFE_SEND_FAILED, throttleKey };
