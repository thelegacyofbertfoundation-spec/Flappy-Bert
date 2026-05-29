// Homing "HUNTER" JEET vertical-tracking logic — mirror of code in flappy_bert.html.
// The hunter eases its baseY toward Bert's y by a clamped step each frame, so it
// "lazily" tracks altitude (dodgeable by a late altitude change), rather than
// snapping like a laser.
const TRACK_GAIN = 0.03;
const MAX_TRACK = 1.6; // px/frame

// Eases baseY toward the target (Bert's y) by a clamped step. Returns the new baseY.
function homingStep(baseY, targetY, gain = TRACK_GAIN, maxTrack = MAX_TRACK) {
  let step = (targetY - baseY) * gain;
  if (step > maxTrack) step = maxTrack;
  if (step < -maxTrack) step = -maxTrack;
  return baseY + step;
}

module.exports = { homingStep, TRACK_GAIN, MAX_TRACK };
