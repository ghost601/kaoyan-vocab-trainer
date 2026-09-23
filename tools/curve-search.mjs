// 曲线搜索：找 30 天内每日总负载峰值最小的新词分配
const GAPS = [0, 1, 3, 7, 14, 30, 60, 120, 240];
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function sim(curve, againRate = 0.15){
  const rnd = mulberry32(20260915);
  let pool = [], out = [];
  for(let d = 1; d <= curve.length; d++){
    let rev = 0;
    for(const c of pool){
      if(c.due <= d){
        rev++;
        if(rnd() < againRate){ c.stage = 0; c.due = d + 1; }
        else { c.stage = Math.min(8, c.stage + 1); c.due = d + GAPS[c.stage]; }
      }
    }
    const n = curve[d - 1];
    for(let i = 0; i < n; i++) pool.push({ stage:1, due:d + 1 });
    out.push({ day:d, nw:n, rev, total:n + rev });
  }
  return out;
}
const peakOf = r => r.reduce((a, b) => b.total > a.total ? b : a, r[0]);
const mins = r => Math.round((r.rev * 7 + r.nw * 12) / 60);

function curveOf(T, total, p, cap = 1e9){
  const w = [];
  for(let d = 1; d <= T; d++) w.push(Math.pow(T - d + 0.5, p));
  const s = w.reduce((a, b) => a + b, 0);
  const c = w.map(x => Math.min(cap, Math.round(x / s * total)));
  let diff = total - c.reduce((a, b) => a + b, 0), guard = 0;
  while(diff !== 0 && guard++ < 5000){
    const step = diff > 0 ? 1 : -1;
    for(let i = 0; i < T && diff !== 0; i++){
      if(step > 0 && c[i] < cap){ c[i]++; diff--; }
      else if(step < 0 && c[i] > 1){ c[i]--; diff++; }
    }
  }
  return c;
}

const T = 30, TOTAL = 5057;
const rows = [];
let dropped = 0;
for(const cap of [1e9, 300, 250, 220, 200, 180, 160, 140, 120]){
  for(const p of [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.3]){
    const cv = curveOf(T, TOTAL, p, cap);
    // cap 太小装不下全部词时曲线会被截断，这类组合不具可比性
    if(cv.reduce((a, b) => a + b, 0) !== TOTAL){ dropped++; continue; }
    const r = sim(cv), pk = peakOf(r);
    const heavy = r.filter(x => x.total > 900).length;
    rows.push({ cap: cap === 1e9 ? '∞' : cap, p, first:cv[0], last:cv[T - 1], peak:pk.total, day:pk.day, min:mins(pk), heavy });
  }
}
console.log(`有效组合 ${rows.length} 组，丢弃 ${dropped} 组（cap×30 装不下 ${TOTAL} 词）\n`);
rows.sort((a, b) => a.peak - b.peak);
console.log('按峰值升序');
console.log('cap    p    首日  末日  峰值   峰值日  耗时  >900张天数');
for(const r of rows.slice(0, 12)){
  console.log(`${String(r.cap).padStart(4)}  ${r.p.toFixed(1)}  ${String(r.first).padStart(4)}  ${String(r.last).padStart(4)}  ${String(r.peak).padStart(5)}   第${String(r.day).padStart(2)}天   ${String(r.min).padStart(3)}分   ${r.heavy}`);
}
console.log('\n最差 4 组');
for(const r of rows.slice(-4)){
  console.log(`${String(r.cap).padStart(4)}  ${r.p.toFixed(1)}  ${String(r.first).padStart(4)}  ${String(r.last).padStart(4)}  ${String(r.peak).padStart(5)}   第${String(r.day).padStart(2)}天   ${String(r.min).padStart(3)}分   ${r.heavy}`);
}
const uni = rows.find(r => r.cap === '∞' && r.p === 0);
console.log(`\n均匀基准: 峰值 ${uni.peak} 张 @第${uni.day}天, ${uni.min} 分钟, >900张 ${uni.heavy} 天`);
const best = rows[0];
console.log(`最优: cap=${best.cap} p=${best.p}（首日${best.first} 末日${best.last}）峰值 ${best.peak} @第${best.day}天, ${best.min} 分钟, 较均匀降 ${((1 - best.peak / uni.peak) * 100).toFixed(1)}%, >900张 ${best.heavy} 天`);
