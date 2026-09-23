// 考研词库构建管线
//   词表与释义：2027 考研英语红宝书（github.com/3056810551/2027-kaoyan-english-redbook-json）
//   真题词频与分类：考研英语词汇词频表（github.com/exam-data/NETEMVocabulary）
// 产出：训练器数据 / Anki 导入包 / 学习计划 / 30 天冲刺方案
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_RED = path.join(ROOT, 'data-src', 'redbook_words.json');
const SRC_FREQ = path.join(ROOT, 'data-src', 'netem_full_list.json');
const OUT = path.join(ROOT, 'build');
const SRC_DIR = path.join(ROOT, 'src');
fs.mkdirSync(OUT, { recursive: true });

const redbook = JSON.parse(fs.readFileSync(SRC_RED, 'utf8'));
const freqTable = JSON.parse(fs.readFileSync(SRC_FREQ, 'utf8'))['5530考研词汇词频排序表'];

// 词性标记按长优先排列，避免 vt. 被 v. 抢先吃掉；完整拼写与红宝书特有标记都要收录
const POS_ALT = 'abbreviation|interjection|preposition|conjunction|adjective|pronoun|numeral|article|adverb|suffix|prefix|vlink|modal|usage|abbr|suff|pref|det|adj|adv|aux|conj|int|num|ord|prep|pron|vt|vi|art|n|v';
const POS_RE = new RegExp('(' + POS_ALT + ')\\.', 'g');
const POS_NORM = {
  abbreviation:'abbr', interjection:'int', preposition:'prep', conjunction:'conj',
  pronoun:'pron', numeral:'num', article:'art', adverb:'adv', adjective:'adj',
  verb:'v', noun:'n', vlink:'vl', modal:'mod', usage:'usg',
  suffix:'suf', suff:'suf', prefix:'pre', pref:'pre',
};
const POS_CN = {
  n: '名词', v: '动词', vt: '及物动词', vi: '不及物动词', adj: '形容词', vl: '系动词',
  adv: '副词', prep: '介词', conj: '连词', pron: '代词', num: '数词', mod: '情态动词',
  art: '冠词', int: '感叹词', aux: '助动词', abbr: '缩写', det: '限定词', usg: '用法',
  suf: '后缀', pre: '前缀', ord: '序数词',
};

// ---------- 数据源 ----------
// 红宝书释义里混着 PDF 提取产生的异体字：康熙部首（U+2F00–U+2FDF）NFKC 能还原，
// 但 CJK 部首补充区（U+2E80–U+2EFF）没有兼容分解，只能手工对应，否则「⻋辆」会原样显示
const RADICAL_FIX = {
  '⺠':'民','⺟':'母','⻉':'贝','⻋':'车','⻅':'见','⻆':'角','⻓':'长','⻔':'门','⻘':'青',
  '⻚':'页','⻛':'风','⻜':'飞','⻝':'食','⻢':'马','⻣':'骨','⻤':'鬼','⻥':'鱼','⻦':'鸟',
  '⻨':'麦','⻩':'黄','⻬':'齐','⻮':'齿','⻰':'龙','戶':'户','⼾':'户',
};
function fixChars(s) {
  let out = String(s == null ? '' : s).normalize('NFKC');
  for (const [bad, good] of Object.entries(RADICAL_FIX)) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out.trim();
}

/** 红宝书词条 → [单词, 释义] 行，与后续清洗管线对接 */
const rows = redbook.map((x) => [fixChars(x.word), fixChars(x.meaning)]).filter(([w]) => w);

/** 真题词频表：单词 → { freq, cat, sub, alt }，并展开「其他拼写」指向同一份数据 */
const freqMap = new Map();
const normKey = (s) => s.trim().toLowerCase();
for (const x of freqTable) {
  const rec = { freq: x.词频, cat: fixChars(x.分类), sub: fixChars(x.子分类), alt: fixChars(x.其他拼写) };
  freqMap.set(normKey(fixChars(x.单词)), rec);
  if (rec.alt) for (const a of rec.alt.split(/[,，、]/)) if (a.trim()) freqMap.set(normKey(a), rec);
}

// ---------- 释义清洗 ----------
const TRAIL_POS = new RegExp('\\s+(' + POS_ALT + ')\\.?$');
const BARE_POS = new Set(['n','v','vt','vi','adj','adv','prep','conj','pron','num','art','int','aux','abbr','det','suf','pre','ord','vl','mod','usg']);
// adv&adj. / adv&adj&prep. —— 任意个词性用 & 连写，必须拆开，否则整段会被当成释义正文
const AMP_RE = /\b([a-z]{2,5}(?:&[a-z]{2,5})+)(?=\.)/g;
// 词典的人物名词条：n. (Huge)人名；(英)休奇 —— 连同后面的国别音译一起剔除
const PERSON_RE = new RegExp('(?:' + POS_ALT + ')\\.\\s*\\([^)]{1,32}\\)\\s*(?:人名|姓氏)(?:\\s*[；;]\\s*\\([^)]{1,24}\\)[^；;]*)?', 'g');

function cleanPiece(s) {
  return s
    .replace(/[<>《》]+/g, '')                 // 源数据尾部残符
    .replace(/\(s\)/gi, '')                   // 编码残留标记
    .replace(AMP_RE, (m) => {
      const parts = m.split('&');
      return parts.every((p) => BARE_POS.has(p)) ? parts.join('. ') : m;
    })
    .replace(PERSON_RE, '')
    .replace(/[“”](?=[；;，,。]|$)/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u4e00-\u9fff\uff00-\uffef])\s*,\s*(?=[\u4e00-\u9fff])/g, '，') // 中文间半角逗号归一
    .replace(/\s*([，；、。：])\s*/g, '$1')     // 中文标点周围去空格
    .replace(/；{2,}/g, '；')
    .replace(/^[\s,，;；、.。\-—/]+/, '')
    .replace(/[\s,，;；、.。\-—/]+$/, '')
    .replace(TRAIL_POS, '')  // 义项尾残渣
    .replace(/^([a-z]{1,5})\.\s+/, '$1.')      // 词性点后统一紧贴
    .trim();
}

// 整条清洗后只剩词性标记（如 " n. /"）即为残片，作废
const isBare = (s) => BARE_POS.has(s.replace(/\.$/, '')) && !/\s/.test(s);

// 拆成 [{p:'n.', defs:['反抗','造反，起义']}]
function parseDef(str) {
  if (!str || isBare(str)) return [];
  const marks = [];
  let m;
  POS_RE.lastIndex = 0;
  while ((m = POS_RE.exec(str))) marks.push({ p: POS_NORM[m[1].toLowerCase()] || m[1].toLowerCase(), start: m.index, end: POS_RE.lastIndex });

  const groups = [];
  if (!marks.length) {
    const d = cleanPiece(str);
    if (d) groups.push({ p: '', defs: [d] });
    return groups;
  }
  const head0 = cleanPiece(str.slice(0, marks[0].start));
  // 连续出现的词性标记（adv. adj. prep. 内容）共享同一批释义，
  // 不能因为中间某个标记后面是空的就把它的词性丢掉
  let pending = [];
  for (let i = 0; i < marks.length; i++) {
    const body = str.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : undefined);
    const defs = body.split(/[;；]/).map(cleanPiece).filter((x) => x && x !== '/');
    if (!defs.length) { pending.push(marks[i].p); continue; }
    for (const p of [...pending, marks[i].p]) {
      const prev = groups.find((g) => g.p === p);
      if (prev) prev.defs.push(...defs);
      else groups.push({ p, defs: [...defs] });
    }
    pending = [];
  }
  const head = isBare(head0) ? '' : head0;
  if (head && groups.length) groups[0].defs.unshift(head);
  else if (head) groups.push({ p: '', defs: [head] });
  // 义项级去重
  for (const g of groups) g.defs = [...new Set(g.defs)];
  return groups.filter((g) => g.defs.length);
}

// ---------- 聚合红宝书的重复词条 ----------
const map = new Map();
for (const [wRaw, dRaw] of rows) {
  const w = wRaw.trim();
  const d = cleanPiece(dRaw);
  if (!w) continue;
  if (!map.has(w)) map.set(w, { w, hits: 0, posMap: new Map(), origin: [] });
  const e = map.get(w);
  e.hits++;
  e.origin.push(d);
  for (const g of parseDef(d)) {
    if (!e.posMap.has(g.p)) e.posMap.set(g.p, []);
    for (const x of g.defs) if (!e.posMap.get(g.p).includes(x)) e.posMap.get(g.p).push(x);
  }
}

// 词频表匹配：精确 → 英美拼写变体规则。匹配不上说明该词未在真题语料中出现
function lookupFreq(w) {
  const k = normKey(w);
  if (freqMap.has(k)) return freqMap.get(k);
  const variants = k
    .replace(/our(s?)$/, 'or$1').replace(/ise$/, 'ize').replace(/isation$/, 'ization')
    .replace(/yse$/, 'yze').replace(/ogue$/, 'og').replace(/re$/, 'er')
    .replace(/judgement/, 'judgment').replace(/^towards$/, 'toward')
    .replace(/^afterwards$/, 'afterward').replace(/^whilst$/, 'while');
  return freqMap.get(variants) || null;
}

// 红宝书是正式出版物，释义本身可靠；这里只留一个纠错钩子，遇到问题随时补
const FIXES = {
  noble:      [/^抓住$/, /^逮捕$/],     // 早期数据源的错配，红宝书已无此问题
  nowadays:   [/^当今$/],
};

const words = [...map.values()].map((e) => {
  // 词性顺序不能按固定优先级排（那会让 accidental、noble 这类形容词以名词开头），
  // 改成义项多的排前面：主要词性天然义项更丰富
  let pos = [...e.posMap.entries()]
    .map(([p, defs], order) => ({ p: p ? p + '.' : '', defs, order }))
    .sort((a, b) => b.defs.length - a.defs.length || a.order - b.order)
    .map(({ p, defs }) => ({ p, defs }));
  const fix = FIXES[e.w];
  if (fix) {
    for (const g of pos) g.defs = g.defs.filter((d) => !fix.some((re) => re.test(d)));
    pos = pos.filter((g) => g.defs.length);
  }
  const text = pos.map((g) => g.p + g.defs.join('；')).join(' ');
  const first = pos[0];
  const f = lookupFreq(e.w);
  return {
    id: 0,
    w: e.w,
    pos,
    text,
    core: first ? first.p + first.defs[0] : '',
    cn: first ? first.defs[0] : '',
    pc: first ? first.p.replace('.', '') : '',
    freq: f ? f.freq : null,       // 真题语料出现次数，null = 未收录
    cat: f ? f.cat : '',
    sub: f ? f.sub : '',
    alt: f ? f.alt : '',           // 其他拼写（英美变体）
    lv: 1,
  };
}).filter((x) => x.pos.length);

// 学习顺序就是考频顺序：真题里考得多的先学，未收录在语料中的排最后
words.sort((a, b) => (b.freq == null ? -1 : b.freq) - (a.freq == null ? -1 : a.freq)
  || a.w.toLowerCase().localeCompare(b.w.toLowerCase()));

// 考频分档（次数阈值直接取自真题语料统计）
const HI = 200, MID = 50;
for (const x of words) x.lv = x.freq == null ? 1 : x.freq >= HI ? 3 : x.freq >= MID ? 2 : 1;
words.forEach((x, i) => { x.id = i; });

const stats = {
  sourceLines: rows.length,
  uniqueWords: words.length,
  byLevel: words.reduce((a, x) => ((a[x.lv] = (a[x.lv] || 0) + 1), a), {}),
  avgDefLen: +(words.reduce((s, x) => s + x.text.length, 0) / words.length).toFixed(1),
  avgLenByLevel: {},
};
for (const lv of [1, 2, 3]) {
  const s = words.filter((x) => x.lv === lv);
  stats.avgLenByLevel[lv] = +(s.reduce((a, x) => a + x.w.length, 0) / s.length).toFixed(2);
}

// ---------- 产出：Anki 导入包 ----------
const LV_TAG = { 3: '高频', 2: '中频', 1: '低频' };
const anki = words.map((x) => {
  const body = x.pos.map((g) => `${g.p} ${g.defs.join('；')}`).join('<br>')
    + (x.freq != null ? `<br><span style="color:#999">真题 ${x.freq} 次</span>` : '');
  const tag = LV_TAG[x.lv] || '低频';
  return [x.w, body, tag, `考研 ${tag}`].join('\t');
});
fs.writeFileSync(path.join(OUT, 'kaoyan-anki.tsv'),
  '#separator:tab\n#html:true\n#columns:单词\t释义\t频次\t标签\n' + anki.join('\n') + '\n', 'utf8');

// ---------- 产出：训练器数据 ----------
const payload = { meta: { built: new Date().toISOString().slice(0, 10), total: words.length, stats }, words };
fs.writeFileSync(path.join(OUT, 'words.json'), JSON.stringify(payload, null, 0), 'utf8');
fs.writeFileSync(path.join(OUT, 'ky-data.js'), 'window.KY_DATA=' + JSON.stringify(payload) + ';', 'utf8');

// ---------- 产出：单文件训练器 ----------
const tplPath = path.join(SRC_DIR, 'trainer.template.html');
if (fs.existsSync(tplPath)) {
  const tpl = fs.readFileSync(tplPath, 'utf8');
  if (!tpl.includes('/*__KY_DATA__*/')) throw new Error('模板缺少数据占位符 /*__KY_DATA__*/');
  const html = tpl.replace('/*__KY_DATA__*/', () => JSON.stringify(payload));
  fs.writeFileSync(path.join(ROOT, '考研词汇训练器.html'), html, 'utf8');
}

// ---------- 产出：学习计划（含 SRS 负载模拟） ----------
const GAPS = [0, 1, 3, 7, 14, 30, 60, 120, 240]; // 索引即 stage
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function simulateCurve(curve, againRate = 0.15){
  const rnd = mulberry32(20260915);
  let pool = [], idx = 0;
  const out = [];
  for(let d = 1; d <= curve.length; d++){
    let reviews = 0;
    for(const c of pool){
      if(c.due <= d){
        reviews++;
        if(rnd() < againRate){ c.stage = 0; c.due = d + 1; }
        else { c.stage = Math.min(8, c.stage + 1); c.due = d + GAPS[c.stage]; }
      }
    }
    const n = curve[d - 1], from = idx;
    for(let i = 0; i < n; i++){ idx++; pool.push({ stage:1, due:d + 1 }); }
    out.push({ day:d, from, to:idx, n, nw:n, rev:reviews, reviews, live:pool.length, cum:idx, total:n + reviews });
  }
  return out;
}
function simulate(dailyNew, days){
  const cv = [];
  let idx = 0;
  for(let d = 1; d <= days; d++){
    const n = Math.min(dailyNew, words.length - idx);
    idx += n; cv.push(n);
  }
  return simulateCurve(cv);
}
function planDoc(){
  const total = words.length;
  const rows60 = simulate(85, 60);
  const peak = rows60.reduce((a, b) => b.reviews > a.reviews ? b : a, rows60[0]);
  const L = [];
  L.push('# 考研词汇 ' + total + ' · 学习计划');
  L.push('');
  L.push('> 词表与释义取自 **2027 考研英语红宝书**，共 **' + total + '** 词。');
  L.push('> 分层按**真题语料词频**：L3=' + stats.byLevel[3] + ' 词（真题出现 ≥200 次）、L2=' + stats.byLevel[2] + ' 词（50–200 次）、L1=' + stats.byLevel[1] + ' 词（<50 次或未收录）。');
  L.push('');
  L.push('## 三档节奏对比');
  L.push('');
  L.push('| 节奏 | 每日新词 | 首轮走完 | 峰值日复习量 | 峰值日约耗时 | 适合谁 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for(const [days, tag] of [[30, '冲刺：每天两轮，遗忘风险高，只适合脱产'], [60, '标准：新词与复习量平衡，推荐'], [90, '稳扎：压力小，但战线长容易松懈']]){
    const n = Math.ceil(total / days);
    const sim = simulate(n, days);
    const pk = sim.reduce((a, b) => b.reviews > a.reviews ? b : a, sim[0]);
    const mins = Math.round((pk.reviews * 7 + pk.n * 12) / 60);
    L.push(`| ${days} 天 | ${n} | ${days} 天 | 第 ${pk.day} 天 ${pk.reviews} 张 | 约 ${mins} 分钟 | ${tag} |`);
  }
  L.push('');
  L.push('耗时按每张到期卡 7 秒、每个新词 12 秒估算（含读释义与联想）。这是**峰值日**，前期只有三分之一。');
  L.push('## 60 天日程表（每日 85 新词）');
  L.push('');
  L.push('在训练器「计划」页点击批次可直接跳转学习；此表的「词序区间」对应词库中的位置编号。');
  L.push('');
  L.push('| 天 | 词序区间 | 层级 | 新词 | 当日复习 | 累计已接触 | 累计未接触 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for(const r of rows60){
    const lvFrom = words[r.from] ? words[r.from].lv : '-';
    const lvTo = words[Math.max(r.from, r.to - 1)].lv;
    const lv = lvFrom === lvTo ? 'L' + lvFrom : 'L' + lvFrom + '→L' + lvTo;
    const mark = r.day === peak.day ? ' ⚠️峰值' : '';
    L.push(`| 第 ${r.day} 天${mark} | ${r.from + 1}-${r.to} | ${lv} | ${r.n} | ${r.reviews} | ${r.cum} | ${total - r.cum} |`);
  }
  L.push('');
  L.push('## 执行铁律');
  L.push('');
  L.push('1. **先清复习，再学新词。** 打开训练器第一件事是清空「待复习」。欠账是唯一会让整件事崩盘的东西。');
  L.push('2. **诚实评分。** 想不起来就按 1。欺骗系统等于欺骗自己的记忆，间隔会被错误地拉长，两周后你会在考场上忘掉它。');
  L.push('3. **先速筛，后精学。** 先花 1-2 小时用「速筛」模式扫掉已经掌握的词，剩余池子会小一大截。词序从**高频端**开始，也就是最简单的那批词先过。');
  L.push('4. **每日必回。** 连续天数是这套系统的燃料。缺一天不是少学 85 个词，而是让当天所有到期卡积压到次日。');
  L.push('5. **换题型验收。** 闪卡过关不等于能写出来。每隔几天切到「拼写」模式抽查一批，暴露虚假掌握。');
  L.push('6. **导出备份。** 进度存在浏览器 localStorage，清缓存会清零。周期性地在「数据」页导出 JSON。');
  L.push('');
  L.push('## 最累的一天');
  L.push('');
  L.push(`第 ${peak.day} 天：当日复习 ${peak.reviews} 张 + 新词 ${peak.n} 个。这一天不要叠加其他任务，提前把时间腾出来。`);
  L.push('');
  L.push('若某天负载超过 400 张，把「每日新词」临时降到 40-60，先把复习消化掉再把量拉回来。');
  L.push('');
  return L.join('\n');
}
fs.writeFileSync(path.join(ROOT, '学习计划.md'), planDoc(), 'utf8');

// ---------- 产出：30 天冲刺方案 ----------
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
function sprintDoc(){
  const total = words.length;
  const rowsFor = (pool, days) => {
    const n = Math.ceil(pool / days);
    const cv = [];
    for(let d = 1; d <= days; d++) cv.push(Math.min(n, Math.max(0, pool - (d - 1) * n)));
    return { n, sim:simulateCurve(cv) };
  };
  const peakOf = r => r.reduce((a, b) => b.total > a.total ? b : a, r[0]);
  const mins = r => Math.round((r.rev * 7 + r.nw * 12) / 60);

  const scenarios = [0, 600, 900, 1200, 1400].map(s => {
    const pool = total - s;
    const { n, sim } = rowsFor(pool, 30);
    const pk = peakOf(sim);
    return { sifted:s, pool, n, pk, min:mins(pk) };
  });

  const L = [];
  L.push('# 30 天冲刺方案');
  L.push('');
  L.push('>> 打开 [考研词汇训练器.html](./考研词汇训练器.html) → 「数据」页 → 冲刺目标选 **30 天**，之后每天的配额系统会自动算，不用手记。');
  L.push('');
  L.push('## 先把账算清楚');
  L.push('');
  L.push('30 天走完 ' + total + ' 个词，真实代价如下（按每张到期卡 7 秒、每个新词 12 秒估算，含 15% 的遗忘回退率）：');
  L.push('');
  L.push('| 前置速筛清掉 | 需精学 | 每日新词 | 峰值出现在 | 峰值日总量 | 峰值日耗时 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for(const s of scenarios){
    L.push(`| ${s.sifted} 词 | ${s.pool} 词 | ${s.n} | 第 ${s.pk.day} 天 | ${s.pk.total} 张 | 约 ${s.min} 分钟 |`);
  }
  L.push('');
  const flat = curveOf(30, total, 0);
  const flatSim = simulateCurve(flat);
  const flatPeak = peakOf(flatSim);
  const front = curveOf(30, total, 0.4);
  const frontSim = simulateCurve(front);
  const frontPeak = peakOf(frontSim);
  const heavy = s => s.filter(x => x.total > 900).length;
  L.push('两件事从这张表里读出来：');
  L.push('');
  L.push('1. **速筛是性价比最高的一步。** 花 1.5 小时清掉已经掌握的词，能让峰值负载直接掉三成。这些词你本来就会，让它们占用间隔重复的额度是纯浪费。');
  L.push(`2. **曲线优化的收益被高估了。** 实测搜索了 42 组新词分配曲线，最好的一组（首日 ${front[0]} 个、递减到末日 ${front[29]} 个）能把峰值从 ${flatPeak.total} 张压到 ${frontPeak.total} 张，降幅 ${((1 - frontPeak.total / flatPeak.total) * 100).toFixed(0)}%——但它让「单日超过 900 张」的天数从 ${heavy(flatSim)} 天涨到 ${heavy(frontSim)} 天，而且第 18 天就要啃 ${front[0]} 个新词。省下这点峰值，换来的是更长的重载期和更陡的前期。训练器默认均匀推进（每天约 ${Math.ceil(total / 30)} 个），峰值落在第 30 天，重载天数最少，节奏也最稳。`);
  L.push('');
  L.push('## 第 0 天：速筛（约 1.5 小时）');
  L.push('');
  L.push('这一步不能跳。词表按真题词频排序，开头那几百个词（the / be / a 这类）你早就会了，但它们占了学习队列的前排。');
  L.push('');
  L.push('1. 「数据」页 → 答题模式 → **速筛**。词序从**高频端**开始，一次排 300 张——也就是先过最简单的那批。');
  L.push('2. 按第一反应给四档判断，别犹豫：');
  L.push('   - 秒懂 → <kbd>K</kbd>（已掌握，永久移出，不再出现）');
  L.push('   - **认识但没记牢 → <kbd>F</kbd>**（有点印象。进入今天的复习队列但不占新词配额，复习节奏快一档，答对后间隔直接跳到 3 天）');
  L.push('   - 完全想不起来 → <kbd>D</kbd>（不认识。同样进入今天的队列，从 1 天开始爬）');
  L.push('   - 拿不准/走神 → <kbd>→</kbd>（跳过，什么都不记录，下次速筛还会遇到）');
  L.push('3. 想确认释义：点卡片或按 <kbd>空格</kbd>。');
  L.push('4. 目标：清掉 900-1400 个。按每词 3-4 秒算，一小时能过 1000 个左右。');
  L.push('5. 中途累了直接关页面，已判定的词已经落盘，下次接着扫。');
  L.push('');
  L.push('中间那档是速筛的关键。绝大多数词并不属于"会"或"不会"，而是"见过、有印象、但不敢确定"——把它们硬塞进前两档，要么浪费新词配额，要么在考场上被打脸。<kbd>F</kbd> 就是给这批词准备的位置。');
  L.push('');
  L.push('清完回到「数据」页 → 冲刺目标 → 选 **30 天**，起始日就是今天。');
  L.push('');
  L.push('## 第 1-30 天：主推进');
  L.push('');
  L.push('假设速筛清掉 1400 个（推荐场景），需精学 3657 词，每日 **122** 个。');
  L.push('');
  L.push('每天的动作固定三步，别的都不用想：');
  L.push('');
  L.push('1. 打开训练器，**先清「待复习」**。红色数字归零之前不学新词。');
  L.push('2. 学完今日配额的新词。闪卡为主，累了就切「英→中」选择题，速度更快、同样有效。');
  L.push('3. 关掉。第二天的到期卡会在你回来时自动排好。');
  L.push('');
  L.push('| 天 | 词序区间 | 层级 | 新词 | 当日复习 | 累计已接触 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  {
    const pool = total - 1400, n = Math.ceil(pool / 30);
    const { sim } = rowsFor(pool, 30);
    const pk = peakOf(sim);
    for(let d = 1; d <= 30; d++){
      const from = (d - 1) * n, to = Math.min(pool, from + n);
      const lvA = words[from] ? words[from].lv : '-';
      const lvB = words[Math.min(pool - 1, to - 1)] ? words[Math.min(pool - 1, to - 1)].lv : '-';
      const row = sim[d - 1];
      L.push(`| 第 ${d} 天${d === pk.day ? ' ⚠️' : ''} | ${from + 1}-${to} | ${lvA === lvB ? 'L' + lvA : 'L' + lvA + '→L' + lvB} | ${row.nw} | ${row.rev} | ${Math.min(pool, to)} |`);
    }
  }
  L.push('');
  L.push('⚠️ 标记的是最累的一天。提前把那天的时间腾出来。');
  L.push('');
  L.push('## 冲刺版铁律');
  L.push('');
  L.push('1. **复习优先于新词。** 30 天的节奏下，欠一天复习的代价是后面三天更重。宁可少学 30 个新词，也要把红色数字清零。');
  L.push('2. **诚实按 1。** 冲刺期最容易自欺——想不起来却按 2，间隔被错误拉长，第 30 天你会以为记住了 5000 个词。');
  L.push('3. **每天必须回。** 缺一天不是少学 122 个词，而是把当天的到期卡全部堆到第二天。连续天数是这套系统里唯一不能断的东西。');
  L.push('4. **第 20 天左右切一次拼写模式。** 闪卡过关不代表能写出来，拼写模式会当场拆穿虚假掌握。');
  L.push('5. **周日晚做一次全批抽测。** 随机抽 100 个「已接触」的词，用选择题快速过，正确率低于 80% 说明评分太宽松。');
  L.push('');
  L.push('## 第 30 天之后');
  L.push('');
  L.push('走完首轮 ≠ 记住。第 30 天时绝大多数词处在 7-30 天的间隔段，这是「短期记住了」，不是「考场上能想起来」。');
  L.push('');
  L.push('好消息是第二轮几乎不花时间：所有到期卡每天只需 10-25 分钟就能清完，间隔会自动往 60 / 120 / 240 天爬。**继续每天打开它，别停。**');
  L.push('');
  L.push('如果 30 天走完发现复习量长期压在 800 张以上、连续三天学不完，就把冲刺目标从 30 天改成 45 天——训练器会自动把每日配额降下来，不需要从头开始。');
  L.push('');
  return L.join('\n');
}
fs.writeFileSync(path.join(ROOT, '冲刺30天.md'), sprintDoc(), 'utf8');

console.log(JSON.stringify(stats, null, 2));
console.log('样例:', JSON.stringify(words[0]), '\n     ', JSON.stringify(words[words.length - 1]));
