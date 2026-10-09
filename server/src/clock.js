// Single source of "now" so tests can move time forward.
let offsetMs = 0;
module.exports = {
  now: () => new Date(Date.now() + offsetMs),
  advance: (ms) => { offsetMs += ms; },
  reset: () => { offsetMs = 0; },
};
