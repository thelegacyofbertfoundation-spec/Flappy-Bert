// Magnet timer logic — mirror of code in flappy_bert.html
const MAGNET_DURATION_FRAMES = 60 * 5;

function createPowerups() {
  return { magnet: { active: false, expiresAt: 0 } };
}

function magnetActivate(powerups, frameCount) {
  powerups.magnet.active = true;
  powerups.magnet.expiresAt = frameCount + MAGNET_DURATION_FRAMES;
}

// Returns true if the magnet just expired this tick.
function magnetTick(powerups, frameCount) {
  if (powerups.magnet.active && frameCount >= powerups.magnet.expiresAt) {
    powerups.magnet.active = false;
    return true;
  }
  return false;
}

module.exports = { createPowerups, magnetActivate, magnetTick, MAGNET_DURATION_FRAMES };
