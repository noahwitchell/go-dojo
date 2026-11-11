const G=require('./engine.js'), P=require('./problems.js');
const name=(p,n)=>p<0?'pass':`(${p%n},${(p/n)|0})`;
for(const pr of P){
  const S0=G.parseProblem(pr), S=G.makeSolver(S0), b=new G.Board(S0.size);
  for(let i=0;i<b.N;i++) if(S0.stones[i]) b.set(i,S0.stones[i]);
  const t=Date.now();
  // does the defender survive if Black passes (problem must be needed)?
  const good=S.goodMoves(b,G.BLACK);
  const bp=b.clone(); bp.play(-1,G.BLACK);
  const passRes=S.attackerWins(bp,G.WHITE);
  console.log(pr.id.padEnd(16), 'good:', good.map(m=>name(m,S0.size)).join(' ')||'NONE', '| pass->attackerWins', passRes, '|', Date.now()-t,'ms');
}
