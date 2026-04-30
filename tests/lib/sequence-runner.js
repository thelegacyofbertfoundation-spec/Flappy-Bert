// Sequenced reveal — generic timeout chain with cancel + skip.
// Mirror of FX.gameOverSequence in flappy_bert.html.
function createSequence(steps) {
  const timers = [];
  let canceled = false;
  let completedNames = new Set();

  function start() {
    for (const step of steps) {
      const id = setTimeout(() => {
        if (!canceled) { step.fn(); completedNames.add(step.name); }
      }, step.at);
      timers.push(id);
    }
  }
  function cancel() {
    canceled = true;
    for (const id of timers) clearTimeout(id);
    timers.length = 0;
  }
  function skip() {
    cancel();
    for (const step of steps) {
      step.fn();
      completedNames.add(step.name);
    }
  }
  return { start, cancel, skip, get completed() { return completedNames; } };
}

module.exports = { createSequence };
