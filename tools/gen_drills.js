/* Generates the drill library: random positions built around each concept's motif,
   read out by the solver, kept only when exactly the concept's idea works.
   Usage: node tools/gen_drills.js [perConcept=80]  -> writes drills.gen.js */
const G = require('../engine.js');
const fs = require('fs'), path = require('path');
const { BLACK, WHITE, EMPTY } = G;
const PER = +(process.argv[2] || 80);
const BUDGET = 150000;

let seed = 12345;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------- grid helpers ---------- */
function grid(n) { return { n, s: new Uint8Array(n * n), reg: new Uint8Array(n * n) }; }
const nb = (n, p) => { const x = p % n, y = (p / n) | 0, o = []; if (x > 0) o.push(p - 1); if (x < n - 1) o.push(p + 1); if (y > 0) o.push(p - n); if (y < n - 1) o.push(p + n); return o; };
const nb8 = (n, p) => { const x = p % n, y = (p / n) | 0, o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < n && Y < n) o.push(Y * n + X); } return o; };
function toBoard(g) { const b = new G.Board(g.n); for (let i = 0; i < g.n * g.n; i++) if (g.s[i]) b.set(i, g.s[i]); return b; }
function rowsOf(g) {
  const r = [];
  for (let y = 0; y < g.n; y++) { let t = ''; for (let x = 0; x < g.n; x++) { const i = y * g.n + x; t += g.s[i] === BLACK ? 'X' : g.s[i] === WHITE ? 'O' : g.reg[i] ? '.' : ','; } r.push(t); }
  return r;
}
function transform(g, t, k) { // k in 0..7
  const n = g.n, h = grid(n);
  const map = (p) => { let x = p % n, y = (p / n) | 0; if (k & 1) x = n - 1 - x; if (k & 2) y = n - 1 - y; if (k & 4) [x, y] = [y, x]; return y * n + x; };
  for (let i = 0; i < n * n; i++) { h.s[map(i)] = g.s[i]; h.reg[map(i)] = g.reg[i]; }
  return { g: h, t: map(t) };
}
function canon(g, t, radius) { // symmetry-free key; with radius, only the area around the target (off-board = inert)
  let best = null;
  for (let k = 0; k < 8; k++) {
    const { g: h, t: tt } = transform(g, t, k), n = h.n, tx = tt % n, ty = (tt / n) | 0;
    let s = '';
    if (radius) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) { s += 'x'; continue; }
        const i = y * n + x; s += h.s[i] ? h.s[i] : h.reg[i] ? 'r' : 'x';
      }
    } else {
      for (let i = 0; i < n * n; i++) { s += h.s[i] || (h.reg[i] ? 'r' : '_'); if (i === tt) s += '*'; }
    }
    if (!best || s < best) best = s;
  }
  return best;
}
function chainsOk(b, minLib, except) { // every chain has >= minLib liberties (except the target chain)
  const seen = new Uint8Array(b.N);
  for (let p = 0; p < b.N; p++) if (b.s[p] && !seen[p]) {
    const c = b.chain(p); for (const s of c.stones) seen[s] = 1;
    if (except && c.stones.includes(except)) continue;
    if (c.libs.length < minLib) return false;
  }
  return true;
}

function wallsOk(b, reg) { // stones not inside the lit area must not start in atari
  const seen = new Uint8Array(b.N);
  for (let p = 0; p < b.N; p++) if (b.s[p] && !seen[p]) {
    const c = b.chain(p); for (const s of c.stones) seen[s] = 1;
    if (c.libs.length >= 2) continue;
    if (c.libs.length === 0) return false;
    if (!c.stones.some(s => reg[s])) return false;
  }
  return true;
}
/* ---------- solver wrappers with budget checks ---------- */
function solver(prob) {
  const P = G.parseProblem(prob); P.nodeBudget = BUDGET;
  const S = G.makeSolver(P), b = new G.Board(P.size);
  for (let i = 0; i < b.N; i++) if (P.stones[i]) b.set(i, P.stones[i]);
  let over = false;
  const aw = (bb, c) => { const r = S.attackerWins(bb, c); if (S.stats() >= BUDGET) over = true; return r; };
  return { P, S, b, aw, over: () => over };
}
// moves for Black that achieve Black's goal; null if search ran out of budget
function blackGood(sv, cands) {
  const { P, b, aw } = sv, att = P.attacker === BLACK, out = [];
  for (const m of cands) {
    if (b.s[m] || !b.isLegal(m, BLACK) || !P.region[m]) continue;
    const bb = b.clone(); bb.play(m, BLACK);
    const r = aw(bb, WHITE);
    if (att === r) out.push(m);
  }
  if (sv.over()) return null;
  return out;
}
function passFails(sv) { // if Black passes, Black's goal fails
  const { P, b, aw } = sv, bb = b.clone(); bb.play(-1, BLACK);
  const r = aw(bb, WHITE);
  if (sv.over()) return false;
  return (P.attacker === BLACK) ? !r : r;
}
const allPts = (b) => Array.from({ length: b.N }, (_, i) => i);

/* ---------- output ---------- */
const out = {}; const keys = new Set(), localKeys = new Map();
function add(concept, g, t, extra) {
  const k = canon(g, t, 0); if (keys.has(k)) return false;
  const lk = canon(g, t, 5), lc = localKeys.get(lk) || 0;
  if (lc >= 1) return false; // same local shape already used: keep variety
  keys.add(k); localKeys.set(lk, lc + 1);
  (out[concept] = out[concept] || []).push(Object.assign({ rows: rowsOf(g), t: [t % g.n, (t / g.n) | 0] }, extra));
  return true;
}
const count = (c) => (out[c] || []).length;

/* ---------- family A: open-board chase (ladder, net, atari direction, escape) ---------- */
function openBoard(n, colorT) {
  const g = grid(n); g.reg.fill(1);
  const D = colorT, A = 3 - D;
  // target 1-2 stones placed off the edge
  const tx = ri(1, n === 9 ? 4 : 5), ty = ri(1, n === 9 ? 4 : 5), t = ty * n + tx;
  g.s[t] = D;
  if (rnd() < 0.3) { const q = pick(nb(n, t)); g.s[q] = D; }
  // attackers hug the target to leave it 1-2 liberties
  let b = toBoard(g);
  const libs = () => toBoard(g).chain(t).libs;
  const wantLibs = colorT === BLACK ? ri(1, 2) : 2;
  let guard = 0;
  while (libs().length > wantLibs && guard++ < 20) { const L = libs(); g.s[pick(L)] = A; }
  if (libs().length !== wantLibs) return null;
  // nearby supporting stones and far background
  const near = ri(1, 5), far = ri(2, n === 9 ? 5 : 9);
  for (let i = 0; i < near + far; i++) {
    const isNear = i < near;
    for (let tries = 0; tries < 30; tries++) {
      const p = ri(0, n * n - 1); if (g.s[p]) continue;
      const dx = Math.abs(p % n - tx), dy = Math.abs(((p / n) | 0) - ty), d = dx + dy;
      if (isNear ? (d < 2 || d > 4) : d < 4) continue;
      g.s[p] = rnd() < 0.5 ? BLACK : WHITE;
      b = toBoard(g);
      if (!chainsOk(b, 2, t) || b.chain(t).libs.length !== wantLibs) { g.s[p] = EMPTY; continue; }
      break;
    }
  }
  b = toBoard(g);
  if (!chainsOk(b, 2, t)) return null;
  return { g, t };
}
// play out the main line; returns {plies, allAtari}
function mainLine(sv, first) {
  const { P, S } = sv, b = sv.b.clone(); b.play(first, BLACK);
  let plies = 1, allAtari = b.s[P.target] && b.libCount(P.target, 3) === 1, defMoves = 0;
  for (let i = 0; i < 40; i++) {
    if (b.s[P.target] !== P.stones[P.target]) break;
    const r = S.reply(b, WHITE); if (r.move < 0) break;
    b.play(r.move, WHITE); defMoves++; plies++;
    if (b.s[P.target] !== P.stones[P.target]) break;
    const gm = S.goodMoves(b, BLACK); if (!gm.length) break;
    b.play(gm[0], BLACK); plies++;
    if (b.s[P.target] && b.libCount(P.target, 3) !== 1) allAtari = false;
  }
  return { plies, defMoves, allAtari };
}
function tryCapture() {
  const n = rnd() < 0.6 ? 13 : 9, pos = openBoard(n, WHITE); if (!pos) return;
  const { g, t } = pos, prob = { rows: rowsOf(g), t: [t % n, (t / n) | 0], goal: 'capture', moves: 1 };
  const sv = solver(prob), b = sv.b, libs = b.chain(t).libs;
  const cand = new Set(libs); for (const l of libs) for (const q of b.nb[l]) if (!b.s[q]) cand.add(q);
  for (const l of libs) for (const q of b.dg[l]) if (!b.s[q]) cand.add(q);
  const good = blackGood(sv, [...cand]); if (!good || !good.length || good.length > 2) return;
  if (!passFails(sv)) return;
  const ataris = libs.filter(l => { const bb = b.clone(); return bb.play(l, BLACK) && bb.s[t] && bb.libCount(t, 2) === 1; });
  const goodAtari = good.filter(m => ataris.includes(m));
  let concept = null;
  if (goodAtari.length === good.length) {
    const ml = mainLine(sv, good[0]);
    if (ml.allAtari && ml.defMoves >= 3) concept = 'ladder';
    else if (ataris.length > good.length && ml.defMoves <= 2) concept = 'atari';
  } else if (!goodAtari.length) concept = 'net';
  if (!concept || count(concept) >= PER) return;
  add(concept, g, t, { goal: 'capture', moves: 1 });
}
function tryEscape() {
  const n = rnd() < 0.5 ? 13 : 9, pos = openBoard(n, BLACK); if (!pos) return;
  const { g, t } = pos, prob = { rows: rowsOf(g), t: [t % n, (t / n) | 0], goal: 'escape', moves: 1, esc: 4 };
  const sv = solver(prob), b = sv.b, libs = b.chain(t).libs;
  const cand = new Set(libs); for (const l of libs) for (const q of b.nb[l]) if (!b.s[q]) cand.add(q);
  for (const s of b.chain(t).stones) for (const q of b.nb[s]) if (b.s[q] === WHITE) for (const l of b.chain(q).libs) cand.add(l);
  const good = blackGood(sv, [...cand]); if (!good || !good.length || good.length > 2) return;
  if (!passFails(sv)) return;
  // must be a real choice: at least one natural-looking liberty move fails
  if (libs.every(l => good.includes(l))) return;
  if (count('escape') >= PER) return;
  add('escape', g, t, { goal: 'escape', moves: 1, esc: 4 });
}

/* ---------- family B: enclosed groups (throw-in/snapback, races) ---------- */
function polyomino(n, size, box, corner) {
  // grow a connected set of points touching the top edge (and left edge for corners)
  const inBox = (p) => { const x = p % n, y = (p / n) | 0; return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]; };
  const start = corner ? 0 : ri(box[0], box[2]);
  const S = new Set([start]);
  let guard = 0;
  while (S.size < size && guard++ < 200) {
    const p = pick([...S]), q = pick(nb(n, p));
    if (inBox(q)) S.add(q);
  }
  return S.size === size ? S : null;
}
function enclose(n, space, inner, outer, corner) {
  const g = grid(n), ring = new Set(), wall = new Set();
  for (const p of space) for (const q of nb8(n, p)) if (!space.has(q)) ring.add(q);
  for (const p of ring) for (const q of nb8(n, p)) if (!space.has(q) && !ring.has(q)) wall.add(q);
  for (const p of space) g.reg[p] = 1;
  for (const p of ring) g.s[p] = inner;
  for (const p of wall) g.s[p] = outer;
  return { g, ring, wall };
}
function tryThrowIn() {
  const n = 9, corner = rnd() < 0.5;
  const box = corner ? [0, 0, 4, 3] : [1, 0, 7, 2];
  const space = polyomino(n, ri(2, 5), box, corner); if (!space) return;
  const { g, ring, wall } = enclose(n, space, WHITE, BLACK, corner);
  const t = [...ring][0];
  let b = toBoard(g); if (b.chain(t).stones.length !== ring.size) return; // one white chain
  // open 0-2 outside liberties for White by removing wall stones next to the ring (they become playable)
  const opens = ri(0, 3), wallArr = [...wall].filter(p => nb(n, p).some(q => ring.has(q)));
  for (let i = 0; i < opens; i++) { const p = pick(wallArr); g.s[p] = EMPTY; g.reg[p] = 1; }
  // 0-1 extra stone inside the space
  for (let i = ri(0, 2); i > 0; i--) { const p = pick([...space]); g.s[p] = pick([BLACK, WHITE]); }
  b = toBoard(g);
  if (!chainsOk(b, 1) || !wallsOk(b, g.reg)) return;
  const libsT = b.chain(t).libs.length; if (libsT < 2) return;
  const prob = { rows: rowsOf(g), t: [t % n, (t / n) | 0], goal: 'capture', moves: 1, esc: Math.max(4, libsT + 2) };
  const sv = solver(prob);
  const good = blackGood(sv, allPts(b)); if (!good || good.length !== 1) return;
  if (!passFails(sv)) return;
  const bb = b.clone(); bb.play(good[0], BLACK);
  const selfAtari = bb.s[good[0]] === BLACK && bb.libCount(good[0], 2) === 1 && bb.lastCap === 0;
  if (!selfAtari || count('throwin') >= PER) return;
  add('throwin', g, t, { goal: 'capture', moves: 1, esc: prob.esc });
}
function tryRace() {
  // White chain on row 1 (liberties on row 0), Black chain on row 2 (liberties on row 3),
  // both shut in by walls; a random scatter of stones on the liberty rows sets the counts.
  const n = 9, g = grid(n), L = ri(3, 5), x0 = rnd() < 0.5 ? 0 : ri(1, 2);
  if (x0 + L + 2 >= n) return;
  const at = (x, y, c) => { if (x >= 0 && x < n && y >= 0 && y < n) g.s[y * n + x] = c; };
  for (let x = x0; x < x0 + L; x++) { at(x, 1, WHITE); at(x, 2, BLACK); at(x, 4, WHITE); g.reg[x] = 1; g.reg[3 * n + x] = 1; }
  // right wall: black guards white's row, white guards black's row
  const R = x0 + L; at(R, 0, BLACK); at(R, 1, BLACK); at(R, 2, WHITE); at(R, 3, WHITE); at(R, 4, WHITE);
  at(R + 1, 0, BLACK); at(R + 1, 1, BLACK); at(R + 1, 2, BLACK); at(R + 1, 3, WHITE);
  if (x0 > 0) { // left wall when not in the corner
    const Lx = x0 - 1; at(Lx, 0, BLACK); at(Lx, 1, BLACK); at(Lx, 2, WHITE); at(Lx, 3, WHITE); at(Lx, 4, WHITE);
    if (Lx - 1 >= 0) { at(Lx - 1, 0, BLACK); at(Lx - 1, 1, BLACK); at(Lx - 1, 2, BLACK); at(Lx - 1, 3, WHITE); }
  }
  // tune liberties: fill some of row 0 with Black (outside pressure) and row 3 with White
  for (let x = x0; x < x0 + L; x++) { if (rnd() < 0.35) at(x, 0, BLACK); if (rnd() < 0.35) at(x, 3, WHITE); }
  // sometimes give one side an eye-ish gap inside its chain
  if (rnd() < 0.3) { const x = ri(x0, x0 + L - 1); at(x, 0, EMPTY); }
  const b = toBoard(g), t = 1 * n + x0, bt = 2 * n + x0;
  if (b.s[t] !== WHITE || b.s[bt] !== BLACK) return;
  if (!chainsOk(b, 1) || !wallsOk(b, g.reg)) return;
  const lw = b.chain(t).libs.length, lb = b.chain(bt).libs.length;
  if (lw < 2 || lb < 2 || Math.abs(lw - lb) > 1) return;
  const prob = { rows: rowsOf(g), t: [t % n, (t / n) | 0], goal: 'capture', moves: 1, esc: Math.max(4, lw + 2) };
  const sv = solver(prob);
  const good = blackGood(sv, allPts(b)); if (!good || !good.length || good.length > 2) return;
  let empt = 0; for (let i = 0; i < b.N; i++) if (g.reg[i] && !b.s[i]) empt++;
  if (empt - good.length < 2) return; // there must be wrong moves to avoid
  if (!passFails(sv)) return;
  if (count('race') >= PER) return;
  const tr = transform(g, t, ri(0, 7));
  add('race', tr.g, tr.t, { goal: 'capture', moves: 1, esc: prob.esc });
}

/* ---------- family C: eye space (kill, live) ---------- */
function tryLD(goal) {
  const n = 9, corner = rnd() < 0.55;
  const box = corner ? [0, 0, 4, 3] : [2, 0, 6, 2];
  const size = ri(3, 7);
  const space = polyomino(n, size, box, corner); if (!space) return;
  const D = goal === 'kill' ? WHITE : BLACK, A = 3 - D;
  const { g, ring } = enclose(n, space, D, A, corner);
  const t = [...ring][0];
  let b = toBoard(g); if (b.chain(t).stones.length !== ring.size) return;
  // 0-2 stones inside the space
  const k = ri(0, 2);
  for (let i = 0; i < k; i++) { const p = pick([...space]); g.s[p] = pick([BLACK, WHITE]); }
  b = toBoard(g);
  if (!chainsOk(b, 1) || !wallsOk(b, g.reg)) return;
  let empties = 0; for (const p of space) if (!g.s[p]) empties++;
  if (empties < 3 || empties > 7) return;
  const prob = { rows: rowsOf(g), t: [t % n, (t / n) | 0], goal, moves: 1 };
  const sv = solver(prob);
  if (G.bensonAlive(b, D, t)) return;
  const good = blackGood(sv, allPts(b)); if (!good || !good.length || good.length > 2) return;
  if (!passFails(sv)) return;
  if (count(goal) >= PER) return;
  const tr = transform(g, t, ri(0, 7));
  add(goal, tr.g, tr.t, { goal, moves: 1 });
}

/* ---------- run ---------- */
const jobs = [['ladder', tryCapture], ['net', tryCapture], ['atari', tryCapture], ['escape', tryEscape], ['throwin', tryThrowIn], ['race', tryRace], ['kill', () => tryLD('kill')], ['live', () => tryLD('live')]];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
if (process.env.SEED) seed = +process.env.SEED;
const t0 = Date.now();
for (const [c, fn] of jobs) {
  if (ONLY && !ONLY.includes(c)) continue;
  let tries = 0; const cap = c === 'net' || c === 'atari' || c === 'ladder' ? 60000 : 30000;
  if (ONLY && ['net', 'atari'].includes(c) && !ONLY.includes('ladder')) { /* capture family fills all three */ }
  while (count(c) < PER && tries++ < cap) { try { fn(); } catch (e) { if (!globalThis.__e) { globalThis.__e = 1; console.log(e.stack); } } }
  console.log(c.padEnd(8), count(c), 'tries', tries, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
if (process.env.OUT) { fs.writeFileSync(process.env.OUT, JSON.stringify(out)); process.exit(0); }
if (process.env.MERGE) {
  for (const f of process.env.MERGE.split(',')) {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [c, a] of Object.entries(o)) for (const d of a) {
      if (count(c) >= PER) continue;
      const n = d.rows.length, g = grid(n);
      d.rows.forEach((row, y) => { for (let x = 0; x < n; x++) { const ch = row[x], i = y * n + x; g.s[i] = ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY; g.reg[i] = ch === ',' ? 0 : 1; } });
      const { rows, t, ...extra } = d; add(c, g, t[1] * n + t[0], extra);
    }
  }
}
const lines = Object.entries(out).map(([c, arr]) => `${JSON.stringify(c)}:[\n${arr.map(d => JSON.stringify(d)).join(',\n')}]`);
fs.writeFileSync(path.join(__dirname, '..', 'drills.gen.js'),
  `/* generated by tools/gen_drills.js — do not edit */\n(function (root) {\nconst D = {${lines.join(',\n')}};\nif (typeof module !== 'undefined' && module.exports) module.exports = D; else root.GoDrillLib = D;\n})(typeof self !== 'undefined' ? self : this);\n`);
console.log('wrote drills.gen.js', Object.fromEntries(Object.entries(out).map(([c, a]) => [c, a.length])));
