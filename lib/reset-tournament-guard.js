// Pure decision logic for the /resettournament admin command (FIX 3).
//
// The command hard-DELETEs a tournament's score rows. During a LIVE cash-prize
// race an admin typo must not be able to destroy it, so a reset requires BOTH an
// exact known tournament id AND the literal keyword CONFIRM (exact uppercase).
//
// parseResetCommand(argString, knownIds) →
//   { action: 'reset',  id }               when both are present and the id exists
//   { action: 'reject', reason[, id] }     otherwise (caller replies with usage,
//                                           the known ids, and each id's score count)
// reasons: 'missing_args' | 'unknown_id' | 'missing_confirm' | 'extra_args'
function parseResetCommand(argString, knownIds) {
  const ids = Array.isArray(knownIds) ? knownIds : [];
  const tokens = String(argString == null ? '' : argString).trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { action: 'reject', reason: 'missing_args' };

  const id = tokens[0];
  if (!ids.includes(id)) return { action: 'reject', reason: 'unknown_id', id };

  const confirm = tokens[1];
  if (confirm !== 'CONFIRM') return { action: 'reject', reason: 'missing_confirm', id };

  if (tokens.length > 2) return { action: 'reject', reason: 'extra_args', id };

  return { action: 'reset', id };
}

module.exports = { parseResetCommand };
