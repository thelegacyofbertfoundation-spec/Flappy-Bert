// Mirror of FX._spawnParticles cap behavior (in flappy_bert.html).
// Tests reference this; HTML implementation must match.
const PARTICLE_CAP = 150;

function spawnParticles(particles, opts) {
  // Early-return when at cap: micro-opt; the Math.min clamp below would
  // also yield 0 iterations. Mirror these two checks together.
  if (particles.length >= PARTICLE_CAP) return 0;
  const count = opts.count || 1;
  const allow = Math.min(count, PARTICLE_CAP - particles.length);
  const speed = opts.speed != null ? opts.speed : 4;
  for (let i = 0; i < allow; i++) {
    particles.push({
      x: opts.x, y: opts.y,
      vx: speed === 0 ? 0 : (Math.random() - 0.5) * speed,
      vy: speed === 0 ? 0 : (Math.random() - 0.5) * speed,
      life: opts.life || 30, maxLife: opts.life || 30,
      color: opts.color || '#fff',
      size: opts.size || 2,
    });
  }
  return allow;
}

module.exports = { spawnParticles, PARTICLE_CAP };
