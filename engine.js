/* Go engine: rules, MCTS opponent, tactical + life-and-death solver.
   Runs in the page, in a Web Worker, and in Node (for verifying drills). */
(function (root) {
'use strict';
const EMPTY = 0, BLACK = 1, WHITE = 2;

const NB = {}, DG = {}, ZB = {};
function nbrs(n) {
  if (NB[n]) return NB[n];
  const a = [], d = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const l = [], g = [];
    if (x > 0) l.push(y * n + x - 1);
    if (x < n - 1) l.push(y * n + x + 1);
    if (y > 0) l.push((y - 1) * n + x);
    if (y < n - 1) l.push((y + 1) * n + x);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < n && Y < n) g.push(Y * n + X);
    }
    a.push(l); d.push(g);
  }
  DG[n] = d;
  return (NB[n] = a);
}
function zob(n) {
  if (ZB[n]) return ZB[n];
  let s = 0x9e3779b9 ^ n;
  const z = new Int32Array(n * n * 3 + n * n);
  for (let i = 0; i < z.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; z[i] = s;
  }
  return (ZB[n] = z);
}

class Board {
  constructor(n) {
    this.n = n; this.N = n * n;
    this.s = new Uint8Array(this.N);
    this.nb = nbrs(n); this.dg = DG[n]; this.z = zob(n);
    this.mark = new Int32Array(this.N); this.stamp = 1;
    this.ko = -1; this.hash = 0; this.cap = [0, 0, 0];
    this.last = -1; this.last2 = -1; this.lastCap = 0; this.capBuf = [];
  }
  clone() {
    const b = new Board(this.n);
    b.s.set(this.s); b.ko = this.ko; b.hash = this.hash;
    b.cap = this.cap.slice(); b.last = this.last; b.last2 = this.last2;
    return b;
  }
  set(p, c) { // raw placement (setup)
    if (this.s[p]) this.hash ^= this.z[p * 3 + this.s[p]];
    this.s[p] = c;
    if (c) this.hash ^= this.z[p * 3 + c];
  }
  chain(p) {
    const c = this.s[p], st = ++this.stamp, stones = [p], libs = [];
    this.mark[p] = st;
    for (let i = 0; i < stones.length; i++) {
      for (const q of this.nb[stones[i]]) {
        if (this.mark[q] === st) continue;
        const v = this.s[q];
        if (v === c) { this.mark[q] = st; stones.push(q); }
        else if (v === EMPTY) { this.mark[q] = st; libs.push(q); }
      }
    }
    return { stones, libs };
  }
  libCount(p, max) { // count liberties of chain at p, stop at max
    const c = this.s[p], st = ++this.stamp, stack = [p];
    let libs = 0; this.mark[p] = st;
    while (stack.length) {
      const r = stack.pop();
      for (const q of this.nb[r]) {
        if (this.mark[q] === st) continue;
        const v = this.s[q];
        if (v === c) { this.mark[q] = st; stack.push(q); }
        else if (v === EMPTY) { this.mark[q] = st; if (++libs >= max) return libs; }
      }
    }
    return libs;
  }
  isLegal(p, c) {
    if (p < 0) return true;
    if (this.s[p] !== EMPTY || p === this.ko) return false;
    const o = 3 - c;
    for (const q of this.nb[p]) {
      const v = this.s[q];
      if (v === EMPTY) return true;
      if (v === c && this.libCount(q, 2) >= 2) return true;
      if (v === o && this.libCount(q, 2) === 1) return true;
    }
    return false;
  }
  // liberties (and size) the chain would have after c plays p; ignores captures except as +libs
  after(p, c) {
    const o = 3 - c, st = ++this.stamp;
    let libs = 0, size = 1, cap = 0;
    this.mark[p] = st;
    const stack = [];
    for (const q of this.nb[p]) {
      const v = this.s[q];
      if (v === EMPTY) { if (this.mark[q] !== st) { this.mark[q] = st; libs++; } }
      else if (v === c && this.mark[q] !== st) { this.mark[q] = st; stack.push(q); size++; }
      else if (v === o && this.libCount2(q) === 1) cap++;
    }
    const st2 = this.stamp; // libCount2 does not touch stamp
    while (stack.length) {
      const r = stack.pop();
      for (const q of this.nb[r]) {
        if (this.mark[q] === st2) continue;
        const v = this.s[q];
        if (v === c) { this.mark[q] = st2; stack.push(q); size++; }
        else if (v === EMPTY) { this.mark[q] = st2; libs++; }
      }
    }
    return { libs: libs + (cap ? 1 : 0), size, cap };
  }
  libCount2(p) { // separate marking array so it can run inside after()
    if (!this.mark2) { this.mark2 = new Int32Array(this.N); this.st2 = 1; }
    const c = this.s[p], st = ++this.st2, stack = [p];
    let libs = 0; this.mark2[p] = st;
    while (stack.length) {
      const r = stack.pop();
      for (const q of this.nb[r]) {
        if (this.mark2[q] === st) continue;
        const v = this.s[q];
        if (v === c) { this.mark2[q] = st; stack.push(q); }
        else if (v === EMPTY) { this.mark2[q] = st; if (++libs >= 2) return libs; }
      }
    }
    return libs;
  }
  play(p, c) {
    this.capBuf.length = 0;
    if (p < 0) { this.ko = -1; this.last2 = this.last; this.last = -1; this.lastCap = 0; return true; }
    if (this.s[p] !== EMPTY || p === this.ko) return false;
    const o = 3 - c;
    this.s[p] = c; this.hash ^= this.z[p * 3 + c];
    let captured = 0, capPt = -1;
    for (const q of this.nb[p]) {
      if (this.s[q] !== o) continue;
      if (this.libCount(q, 1) === 0) {
        const g = this.chain(q);
        captured += g.stones.length; capPt = q;
        for (const r of g.stones) { this.s[r] = EMPTY; this.hash ^= this.z[r * 3 + o]; this.capBuf.push(r); }
      }
    }
    const libs = this.libCount(p, 2);
    if (libs === 0) { this.s[p] = EMPTY; this.hash ^= this.z[p * 3 + c]; return false; }
    let ko = -1;
    if (captured === 1 && libs === 1) {
      let alone = true;
      for (const q of this.nb[p]) if (this.s[q] === c) { alone = false; break; }
      if (alone) ko = capPt;
    }
    this.ko = ko; this.cap[c] += captured;
    this.last2 = this.last; this.last = p; this.lastCap = captured;
    return true;
  }
  isEye(p, c) { // true eye-ish point for c (don't fill in playouts)
    for (const q of this.nb[p]) if (this.s[q] !== c) return false;
    let bad = 0;
    const dg = this.dg[p];
    for (const q of dg) if (this.s[q] === 3 - c) bad++;
    return dg.length === 4 ? bad < 2 : bad === 0;
  }
  key(c) {
    let k = this.hash ^ (c === WHITE ? 0x5bd1e995 : 0);
    if (this.ko >= 0) k ^= this.z[this.N * 3 + this.ko];
    return k >>> 0;
  }
  areaScore(komi) { // black minus white minus komi
    let b = 0, w = 0;
    for (let p = 0; p < this.N; p++) {
      const v = this.s[p];
      if (v === BLACK) b++; else if (v === WHITE) w++;
      else {
        let sb = 0, sw = 0;
        for (const q of this.nb[p]) { if (this.s[q] === BLACK) sb++; else if (this.s[q] === WHITE) sw++; }
        if (sb && !sw) b++; else if (sw && !sb) w++;
      }
    }
    return b - w - komi;
  }
}

/* ---------------- scoring with territory (flood fill) ---------------- */
function territory(b, dead) { // dead: Uint8Array mask of dead stones
  const N = b.N, owner = new Int8Array(N), seen = new Uint8Array(N);
  const col = p => (dead && dead[p]) ? EMPTY : b.s[p];
  for (let p = 0; p < N; p++) {
    if (col(p) !== EMPTY || seen[p]) continue;
    const reg = [p]; seen[p] = 1; let touchB = false, touchW = false;
    for (let i = 0; i < reg.length; i++) for (const q of b.nb[reg[i]]) {
      const v = col(q);
      if (v === EMPTY) { if (!seen[q]) { seen[q] = 1; reg.push(q); } }
      else if (v === BLACK) touchB = true; else touchW = true;
    }
    const o = touchB && !touchW ? 1 : touchW && !touchB ? -1 : 0;
    for (const r of reg) owner[r] = o;
  }
  let sb = 0, sw = 0;
  for (let p = 0; p < N; p++) {
    const v = col(p);
    if (v === BLACK) sb++; else if (v === WHITE) sw++;
    else if (owner[p] === 1) sb++; else if (owner[p] === -1) sw++;
  }
  for (let p = 0; p < N; p++) if (col(p) === BLACK) owner[p] = 1; else if (col(p) === WHITE) owner[p] = -1;
  return { owner, black: sb, white: sw };
}

/* ---------------- random ---------------- */
let rs = (Date.now() ^ 0x2545f491) >>> 0 || 1;
function rnd() { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; }

/* ---------------- playouts ---------------- */
// mode: 'score' or 'capture' (first capture wins). Returns winner color (or 0 for draw).
function playout(b, c, komi, mode, amaf, own) {
  const N = b.N, maxMoves = N * 2 + 20;
  const empt = [], pos = new Int32Array(N).fill(-1);
  for (let p = 0; p < N; p++) if (b.s[p] === EMPTY) { pos[p] = empt.length; empt.push(p); }
  const rem = p => { const i = pos[p]; if (i < 0) return; const last = empt.pop(); if (last !== p) { empt[i] = last; pos[last] = i; } pos[p] = -1; };
  const add = p => { if (pos[p] < 0) { pos[p] = empt.length; empt.push(p); } };
  let passes = 0, winner = 0;
  for (let m = 0; m < maxMoves; m++) {
    let mv = -1;
    // 1. capture last move if it is in atari / save own stones in atari
    const L = b.last;
    if (L >= 0 && rnd() < 0.9) {
      if (b.s[L] === 3 - c) {
        const g = b.chain(L);
        if (g.libs.length === 1 && b.isLegal(g.libs[0], c)) mv = g.libs[0];
      }
      if (mv < 0) {
        for (const q of b.nb[L]) {
          if (b.s[q] !== c) continue;
          const g = b.chain(q);
          if (g.libs.length !== 1) continue;
          const e = g.libs[0];
          if (b.isLegal(e, c) && b.after(e, c).libs >= 2) { mv = e; break; }
        }
      }
    }
    // 2. random legal move that does not fill own eye or self-atari a big group
    if (mv < 0 && empt.length) {
      const start = (rnd() * empt.length) | 0;
      for (let i = 0; i < empt.length; i++) {
        const p = empt[(start + i) % empt.length];
        if (!b.isLegal(p, c) || b.isEye(p, c)) continue;
        const a = b.after(p, c);
        if (a.libs === 1 && a.size >= 2 && !a.cap && rnd() < 0.95) continue;
        mv = p; break;
      }
    }
    b.play(mv, c);
    if (mv < 0) { if (++passes >= 2) break; }
    else {
      passes = 0; rem(mv);
      for (const r of b.capBuf) add(r);
      if (amaf && !amaf[mv]) amaf[mv] = c;
      if (mode === 'capture' && b.lastCap) { winner = c; break; }
    }
    c = 3 - c;
  }
  if (mode === 'capture') return winner;
  const sc = b.areaScore(komi);
  if (own) {
    for (let p = 0; p < N; p++) {
      const v = b.s[p];
      if (v === BLACK) own[p]++; else if (v === WHITE) own[p]--;
      else { let sb = 0, sw = 0; for (const q of b.nb[p]) { if (b.s[q] === BLACK) sb++; else if (b.s[q] === WHITE) sw++; } if (sb && !sw) own[p]++; else if (sw && !sb) own[p]--; }
    }
  }
  return sc > 0 ? BLACK : sc < 0 ? WHITE : 0;
}

/* ---------------- MCTS with RAVE and Go priors ---------------- */
class Node {
  constructor(move, color) { this.move = move; this.color = color; this.n = 0; this.w = 0; this.rn = 0; this.rw = 0; this.kids = null; }
}
function stoneCount(b) { let k = 0; for (let p = 0; p < b.N; p++) if (b.s[p]) k++; return k; }

function prior(b, p, c, stones) {
  const n = b.n;
  if (p < 0) { // pass is only reasonable late
    return stones > b.N * 0.6 ? [10, 4] : [30, 0];
  }
  let pn = 10, pw = 5;
  const x = p % n, y = (p / n) | 0, line = Math.min(x, y, n - 1 - x, n - 1 - y);
  const opening = stones < b.N * (n >= 13 ? 0.12 : 0.2);
  if (line === 0) { pn += 10; pw += 0; }
  else if (line === 1 && opening) { pn += 10; pw += 2; }
  else if ((line === 2 || line === 3) && opening) { pn += 10; pw += 8; }
  // empty area near the move: avoid lonely edge moves late too
  let near = 0;
  for (const q of b.nb[p]) if (b.s[q]) near++;
  for (const q of b.dg[p]) if (b.s[q]) near++;
  if (opening && n >= 13 && near > 0 && line >= 2) { pn += 5; pw += 1; } // don't crawl into contact early on big boards
  // tactics
  const o = 3 - c;
  for (const q of b.nb[p]) {
    const v = b.s[q];
    if (v === o && b.libCount(q, 2) === 1) { const sz = b.chain(q).stones.length; pn += 20; pw += 18 + Math.min(sz, 5); }
    if (v === c && b.libCount(q, 2) === 1) { pn += 15; pw += 12; }
  }
  const a = b.after(p, c);
  if (a.libs === 1 && !a.cap) { pn += 25; pw += 0; }
  else if (a.libs === 2 && a.size >= 3) { pn += 5; pw += 1; }
  // locality: answer near the last two moves
  for (const L of [b.last, b.last2]) {
    if (L < 0) continue;
    const lx = L % n, ly = (L / n) | 0, d = Math.max(Math.abs(lx - x), Math.abs(ly - y));
    if (d <= 2) { pn += 6; pw += 5; break; }
  }
  return [pn, pw];
}

function expand(node, b, c, mode) {
  const kids = [], stones = stoneCount(b);
  for (let p = 0; p < b.N; p++) {
    if (!b.isLegal(p, c) || b.isEye(p, c)) continue;
    const k = new Node(p, c), [pn, pw] = prior(b, p, c, stones);
    k.n = pn; k.w = pw; k.rn = pn; k.rw = pw; k.prior = pn;
    kids.push(k);
  }
  if (mode !== 'capture' || !kids.length) {
    const ps = new Node(-1, c), [pn, pw] = prior(b, -1, c, stones);
    ps.n = pn; ps.w = pw; ps.rn = 0; ps.rw = 0; ps.prior = pn; kids.push(ps);
  }
  node.kids = kids;
}

function select(node) {
  let best = null, bv = -1;
  const lnN = Math.log(node.n + 1);
  for (const k of node.kids) {
    const q = k.w / k.n, r = k.rn ? k.rw / k.rn : q;
    const beta = k.rn / (k.rn + k.n + k.rn * k.n / 2500 + 1e-9);
    const v = (1 - beta) * q + beta * r + 0.25 * Math.sqrt(lnN / k.n);
    if (v > bv) { bv = v; best = k; }
  }
  return best;
}

function think(state, opts) {
  const b = fromState(state), toMove = state.toMove;
  const komi = state.komi || 0, mode = state.mode || 'score';
  const maxPlayouts = opts.playouts || 1000, deadline = Date.now() + (opts.ms || 8000);
  const root = new Node(-1, 3 - toMove);
  expand(root, b, toMove, mode);
  const own = new Float32Array(b.N);
  let sims = 0, passesInRow = state.passes || 0;
  while (sims < maxPlayouts && (sims & 31 || Date.now() < deadline)) {
    const bb = b.clone();
    const path = [root];
    let node = root, c = toMove, passes = passesInRow, ended = false, winner = 0;
    const amaf = new Uint8Array(b.N);
    while (node.kids) {
      const k = select(node);
      bb.play(k.move, c);
      if (k.move >= 0) { if (!amaf[k.move]) amaf[k.move] = c; passes = 0; if (mode === 'capture' && bb.lastCap) { ended = true; winner = c; } }
      else if (++passes >= 2) { ended = true; winner = mode === 'capture' ? 0 : (bb.areaScore(komi) > 0 ? BLACK : WHITE); }
      path.push(k); node = k; c = 3 - c;
      if (ended) break;
    }
    if (!ended && node.n - (node.prior || 0) >= 1 && path.length < 60) expand(node, bb, c, mode);
    if (!ended) winner = playout(bb, c, komi, mode, amaf, own);
    else if (mode === 'score') { for (let p = 0; p < b.N; p++) own[p] += 0; }
    // backprop
    for (let i = 0; i < path.length; i++) {
      const nd = path[i];
      nd.n++; if (winner === nd.color) nd.w++; else if (!winner) nd.w += 0.5;
      if (nd.kids) {
        const toPlay = 3 - nd.color;
        for (const k of nd.kids) {
          if (k.move >= 0 && amaf[k.move] === toPlay) { k.rn++; if (winner === toPlay) k.rw++; else if (!winner) k.rw += 0.5; }
        }
      }
    }
    sims++;
  }
  const kids = root.kids.slice().sort((a, b2) => (b2.n - b2.prior) - (a.n - a.prior));
  const top = kids.slice(0, 6).map(k => ({ move: k.move, visits: k.n - k.prior, win: k.w / k.n }));
  let pick = kids[0];
  if (opts.randomness && kids.length > 1) { // weaker levels: sample among the strong candidates
    const cand = kids.slice(0, opts.randomness).filter(k => k.n - k.prior > 0);
    let tot = 0; for (const k of cand) tot += Math.pow(k.n - k.prior, 1.5);
    let r = rnd() * tot;
    for (const k of cand) { r -= Math.pow(k.n - k.prior, 1.5); if (r <= 0) { pick = k; break; } }
  }
  const ownership = Array.from(own, v => sims ? v / sims : 0);
  // pass instead of playing inside settled areas
  let move = pick.move;
  if (move >= 0 && mode === 'score') {
    const sign = toMove === BLACK ? 1 : -1;
    const settled = Math.abs(ownership[move]) > 0.9;
    if (settled && stoneCount(b) > b.N * 0.45 && (passesInRow > 0 || ownership[move] * sign > 0.9)) {
      const pass = root.kids.find(k => k.move < 0);
      if (pass && passesInRow > 0) move = -1;
    }
  }
  return { move, win: pick.w / pick.n, top, ownership, sims };
}

function ownershipEstimate(state, playouts) {
  const b = fromState(state), own = new Float32Array(b.N);
  for (let i = 0; i < playouts; i++) playout(b.clone(), state.toMove, state.komi || 0, 'score', null, own);
  return Array.from(own, v => v / playouts);
}

function fromState(st) {
  const b = new Board(st.size);
  for (let p = 0; p < b.N; p++) if (st.stones[p]) b.set(p, st.stones[p]);
  b.ko = st.ko == null ? -1 : st.ko;
  b.last = st.last == null ? -1 : st.last;
  b.last2 = st.last2 == null ? -1 : st.last2;
  return b;
}

/* ---------------- Benson's unconditional life ---------------- */
function bensonAlive(b, c, target) {
  const N = b.N, chainId = new Int32Array(N).fill(-1), regId = new Int32Array(N).fill(-1);
  const chains = [];
  for (let p = 0; p < N; p++) if (b.s[p] === c && chainId[p] < 0) {
    const g = b.chain(p), id = chains.length;
    for (const s of g.stones) chainId[s] = id;
    chains.push({ alive: true });
  }
  if (chainId[target] < 0) return false;
  const regs = [];
  for (let p = 0; p < N; p++) if (b.s[p] !== c && regId[p] < 0) {
    const id = regs.length, pts = [p]; regId[p] = id;
    const adj = new Set(); let emptyCount = 0;
    for (let i = 0; i < pts.length; i++) {
      const r = pts[i];
      if (b.s[r] === EMPTY) emptyCount++;
      for (const q of b.nb[r]) {
        if (b.s[q] === c) adj.add(chainId[q]);
        else if (regId[q] < 0) { regId[q] = id; pts.push(q); }
      }
    }
    // vital-to: chains k such that every empty point of region touches k
    const vital = [];
    for (const k of adj) {
      let ok = true;
      for (const r of pts) {
        if (b.s[r] !== EMPTY) continue;
        let t = false;
        for (const q of b.nb[r]) if (chainId[q] === k) { t = true; break; }
        if (!t) { ok = false; break; }
      }
      if (ok) vital.push(k);
    }
    regs.push({ adj: [...adj], vital, alive: true });
  }
  let changed = true;
  while (changed) {
    changed = false;
    const cnt = new Int32Array(chains.length);
    for (const r of regs) if (r.alive) for (const k of r.vital) cnt[k]++;
    for (let k = 0; k < chains.length; k++) if (chains[k].alive && cnt[k] < 2) { chains[k].alive = false; changed = true; }
    for (const r of regs) if (r.alive && r.adj.some(k => !chains[k].alive)) { r.alive = false; changed = true; }
  }
  return chains[chainId[target]].alive;
}

/* ---------------- Problem solver ---------------- */
// prob: {size, stones(Uint8Array), region(Uint8Array mask), mode:'tac'|'ld', attacker, target, escapeLibs, depth}
function makeSolver(prob) {
  const A = prob.attacker, D = 3 - A, T = prob.target;
  const region = prob.region, esc = prob.escapeLibs || 4, maxDepth = prob.depth || (prob.mode === 'ld' ? 24 : 40);
  const tt = new Map();
  let nodes = 0;
  const budget = prob.nodeBudget || 2e6;

  function genTac(b, c) {
    const g = b.chain(T), libs = g.libs, out = new Set();
    for (const l of libs) out.add(l);
    if (c === A) {
      if (libs.length <= 2) {
        const cnt = new Map();
        for (const l of libs) for (const q of b.nb[l]) if (b.s[q] === EMPTY && !libs.includes(q)) cnt.set(q, (cnt.get(q) || 0) + 1);
        for (const [q, k] of cnt) if (k >= 2) out.add(q);
        if (libs.length === 2) for (const l of libs) for (const q of b.dg[l]) if (b.s[q] === EMPTY) {
          // loose ladder / net: points that block both escape directions
          let t = 0; for (const r of b.nb[q]) if (libs.includes(r)) t++;
          if (t) out.add(q);
        }
      }
      // save own cutting stones in atari, or capture what threatens them
      const seen = new Set();
      for (const s of g.stones) for (const q of b.nb[s]) if (b.s[q] === A && !seen.has(q)) {
        const ag = b.chain(q); for (const x of ag.stones) seen.add(x);
        if (ag.libs.length === 1) {
          out.add(ag.libs[0]);
          for (const x of ag.stones) for (const y of b.nb[x]) if (b.s[y] === D) { const dg2 = b.chain(y); if (dg2.libs.length === 1) out.add(dg2.libs[0]); }
        }
      }
    } else {
      const seen = new Set();
      for (const s of g.stones) for (const q of b.nb[s]) if (b.s[q] === A && !seen.has(q)) {
        const ag = b.chain(q); for (const x of ag.stones) seen.add(x);
        if (ag.libs.length <= Math.max(2, libs.length)) for (const l of ag.libs) out.add(l);
      }
      // extensions of liberties (second-order) let the target run
      if (libs.length <= 2) for (const l of libs) for (const q of b.nb[l]) if (b.s[q] === EMPTY) out.add(q);
    }
    const arr = [];
    for (const p of out) if (region[p] && b.isLegal(p, c)) arr.push(p);
    return order(b, c, arr);
  }
  function genLD(b, c) {
    const arr = [];
    for (let p = 0; p < b.N; p++) if (region[p] && b.s[p] === EMPTY && b.isLegal(p, c)) arr.push(p);
    return order(b, c, arr);
  }
  function order(b, c, arr) {
    // score: attacker wants fewest target libs, defender most; prefer central eye-space points
    const sc = new Map();
    for (const p of arr) {
      const bb = b.clone(); bb.play(p, c);
      let v;
      if (bb.s[T] !== D) v = c === A ? -1000 : 1000;
      else v = bb.libCount(T, 9) * 10;
      let e = 0; for (const q of b.nb[p]) if (b.s[q] === EMPTY && region[q]) e++;
      if (bb.after && bb.lastCap) v += c === A ? -30 : 30;
      sc.set(p, (c === A ? v : -v) - e * 3);
    }
    return arr.sort((x, y) => sc.get(x) - sc.get(y));
  }
  const gen = prob.mode === 'ld' ? genLD : genTac;

  // returns true if attacker wins with c to move and d plies left
  function aw(b, c, d) {
    nodes++;
    if (b.s[T] !== D) return true;
    if (prob.mode === 'tac') { if (b.libCount(T, esc) >= esc) return false; }
    else if (bensonAlive(b, D, T)) return false;
    if (d <= 0 || nodes > budget) return false;
    const key = b.key(c), e = tt.get(key);
    if (e) { if (e.win && d >= e.d) return true; if (!e.win && d <= e.d) return false; }
    const moves = gen(b, c);
    let res;
    if (c === A) {
      res = false;
      for (const m of moves) { const bb = b.clone(); if (!bb.play(m, A)) continue; if (aw(bb, D, d - 1)) { res = true; break; } }
    } else {
      res = true;
      for (const m of moves) { const bb = b.clone(); if (!bb.play(m, D)) continue; if (!aw(bb, A, d - 1)) { res = false; break; } }
      if (res) { const bb = b.clone(); bb.play(-1, D); if (!aw(bb, A, d - 1)) res = false; }
    }
    tt.set(key, { win: res, d });
    return res;
  }
  return {
    attackerWins(b, c) { nodes = 0; return aw(b, c, maxDepth); },
    // all winning moves for side c (attacker wins if c===A, else defender holds)
    goodMoves(b, c) {
      const out = [];
      for (const m of gen(b, c)) {
        const bb = b.clone(); if (!bb.play(m, c)) continue;
        nodes = 0; const r = aw(bb, 3 - c, maxDepth - 1);
        if ((c === A) === r) out.push(m);
      }
      if (c === D) { const bb = b.clone(); bb.play(-1, c); nodes = 0; if (!aw(bb, A, maxDepth - 1)) out.push(-1); }
      return out;
    },
    // best reply for the computer playing side c
    reply(b, c) {
      let best = null, bestNodes = -1, fallback = null;
      const moves = gen(b, c);
      if (c === D) moves.push(-1);
      for (const m of moves) {
        const bb = b.clone(); if (!bb.play(m, c)) continue;
        if (fallback === null) fallback = m;
        nodes = 0; const r = aw(bb, 3 - c, maxDepth - 1);
        const good = (c === A) === r;
        if (good) return { move: m, good: true };
        if (m >= 0 && nodes > bestNodes) { bestNodes = nodes; best = m; } // longest resistance
      }
      return { move: best !== null ? best : (fallback !== null ? fallback : -1), good: false };
    },
    benson: (b) => bensonAlive(b, D, T),
    stats: () => nodes,
  };
}

// parse a drill: rows of 'X' black, 'O' white, '.' empty in play area, ',' empty outside
function parseProblem(p) {
  const n = p.rows.length, stones = new Uint8Array(n * n), region = new Uint8Array(n * n);
  p.rows.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      const ch = row[x] || ',', i = y * n + x;
      if (ch === 'X') stones[i] = BLACK; else if (ch === 'O') stones[i] = WHITE;
      region[i] = ch === ',' ? 0 : 1;
    }
  });
  const target = p.t[1] * n + p.t[0];
  const userColor = BLACK;
  const attacker = (p.goal === 'capture' || p.goal === 'kill') ? BLACK : WHITE;
  return { size: n, stones, region, target, attacker, userColor,
    mode: (p.goal === 'kill' || p.goal === 'live') ? 'ld' : 'tac',
    escapeLibs: p.esc || 4, depth: p.depth, goal: p.goal, need: p.moves || 1 };
}

const api = { EMPTY, BLACK, WHITE, Board, think, ownershipEstimate, territory, fromState, bensonAlive, makeSolver, parseProblem, nbrs };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.GoEngine = api;

// shared command handler (worker and main-thread fallback)
function handle(d) {
  const { cmd, state, opts, prob, stones, toMove } = d;
  if (cmd === 'think') return think(state, opts || {});
  if (cmd === 'own') return ownershipEstimate(state, (opts && opts.playouts) || 300);
  if (cmd === 'solve') {
    const P = parseProblem(prob), S = makeSolver(P), b = new Board(P.size);
    for (let i = 0; i < b.N; i++) if (stones[i]) b.set(i, stones[i]);
    b.ko = d.ko == null ? -1 : d.ko;
    const res = {};
    if (opts.judge) res.attackerWins = S.attackerWins(b, toMove);
    if (opts.reply) res.reply = S.reply(b, toMove);
    if (opts.hint) res.good = S.goodMoves(b, toMove);
    res.benson = b.s[P.target] ? bensonAlive(b, 3 - P.attacker, P.target) : false;
    return res;
  }
  throw new Error('unknown command ' + cmd);
}
api.handle = handle;
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof importScripts === 'function') {
  self.onmessage = (ev) => {
    try { self.postMessage({ id: ev.data.id, result: handle(ev.data) }); }
    catch (e) { self.postMessage({ id: ev.data.id, error: String(e && e.stack || e) }); }
  };
}
})(typeof self !== 'undefined' ? self : this);
