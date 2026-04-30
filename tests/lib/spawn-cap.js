// Mirror of FX._spawnParticles cap behavior (in flappy_bert.html).
// Tests reference this; HTML implementation must match.
const PARTICLE_CAP = 150;

function spawnParticles(particles, opts) {
  if (particles.length >= PARTICLE_CAP) return 0;
  const count = opts.count || 1;
  const allow = Math.min(count, PARTICLE_CAP - particles.length);
  for (let i = 0; i < allow; i++) {
    particles.push({
      x: opts.x, y: opts.y,
      vx: (Math.random() - 0.5) * (opts.speed || 4),
      vy: (Math.random() - 0.5) * (opts.speed || 4),
      life: opts.life || 30, maxLife: opts.life || 30,
      color: opts.color || '#fff',
      size: opts.size || 2,
    });
  }
  return allow;
}

module.exports = { spawnParticles, PARTICLE_CAP };
