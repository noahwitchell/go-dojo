// Re-checks every library drill through the app's own solver entry point (same as the phone).
const G = require('../engine.js'), D = require('../drills.gen.js');
let bad = 0, slow = [];
for (const [c, arr] of Object.entries(D)) arr.forEach((pr, i) => {
  const P = G.parseProblem(pr), stones = Array.from(P.stones), t = Date.now();
  const r = G.handle({ cmd: 'solve', prob: pr, stones, toMove: G.BLACK, opts: { hint: true } });
  const ms = Date.now() - t, good = (r.good || []).filter(m => m >= 0);
  if (!good.length) { bad++; console.log('NO ANSWER', c, i + 1); }
  if (ms > 400) slow.push(`${c}#${i + 1} ${ms}ms`);
});
console.log('bad', bad, 'slow(>400ms on Mac)', slow.length, slow.slice(0, 10).join(', '));
