// 词库质量诊断：源数据里哪些东西不该出现在考研词表里
// 用法：node tools/audit-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const red = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-src', 'redbook_words.json'), 'utf8'));
const freq = JSON.parse(fs.readFileSync(path.join(ROOT, 'data-src', 'netem_full_list.json'), 'utf8'))['5530考研词汇词频排序表'];
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/words.json'), 'utf8'));
const W = D.words;

const line = (s) => console.log(s);
const head = (s) => console.log('\n' + s);

head('=== 源数据 ===');
line(`  红宝书 ${red.length} 条　真题词频表 ${freq.length} 条　成品词条 ${W.length}`);
const withFreq = W.filter((w) => w.freq != null).length;
line(`  匹配到真题词频 ${withFreq} 条（${(withFreq / W.length * 100).toFixed(1)}%），其余未收录于真题语料`);
const lvN = {};
for (const w of W) lvN[w.lv] = (lvN[w.lv] || 0) + 1;
line(`  分层：高频 ${lvN[3]}　中频 ${lvN[2]}　低频 ${lvN[1]}`);

// —— 已在构建管线里清洗掉的噪声，这里用来确认没有漏网 ——
head('=== 不该出现在成品里的东西 ===');
const checks = [
  ['人物名词条', /\([^)]{1,32}\)\s*(人名|姓氏)/, 'n. (Huge)人名；(英)休奇'],
  ['缩写词条噪声', /abbr\./, 'bite: 机内测试设备'],
  ['合写词性未拆', /(adj|adv|n|v|prep|pron|vt|vi)&/, 'outside: adv&adj&prep.'],
  ['完整拼写词性', /(interjection|preposition|conjunction|pronoun|numeral|article|adverb|adjective|verb|noun)\./i, 'pardon: interjection.'],
  ['异体字残留', /[\u2E80-\u2FDF]/, '⻋辆 / ⽬标（PDF 提取残留）'],
  ['编码残符', /[<>《》“”]/, '源数据里的 A / < 分隔残留'],
  ['悬空分号', /；{2,}|；\s*$/, '—'],
];
for (const [name, re, eg] of checks) {
  const hit = W.filter(w => re.test(w.text));
  const tag = hit.length === 0 ? 'OK  ' : '注意';
  line(`  [${tag}] ${name.padEnd(14)} ${hit.length} 条` + (hit.length ? '　例：' + hit.slice(0, 3).map(x => x.w).join(', ') : ''));
}

// —— 词性解析是否完整 ——
head('=== 词性解析 ===');
const dist = {};
for (const w of W) { const p = w.pos[0].p || '(无标记)'; dist[p] = (dist[p] || 0) + 1; }
line('  首义词性分布: ' + Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' '));
const multi = W.filter(w => w.pos.length >= 3);
line(`  含 3 个以上词性的词: ${multi.length} 条　例：${multi.slice(0, 5).map(w => w.w + '(' + w.pos.length + ')').join(', ')}`);
const noPos = W.filter(w => w.pos.some(g => !g.p));
line(`  有释义但缺词性标记的词: ${noPos.length} 条`);

// —— 释义长度分布，用来发现异常短/长 ——
head('=== 释义长度 ===');
const lens = W.map(w => w.text.length).sort((a, b) => a - b);
line(`  最短 ${lens[0]}　中位 ${lens[Math.floor(lens.length / 2)]}　最长 ${lens[lens.length - 1]}`);
line('  最短的 5 条: ' + W.slice().sort((a, b) => a.text.length - b.text.length).slice(0, 5).map(w => w.w + '=' + w.text).join(' | '));
line('  最长的 3 条: ' + W.slice().sort((a, b) => b.text.length - a.text.length).slice(0, 3).map(w => w.w + '(' + w.text.length + ')').join(' | '));

// —— 已知的源词典错配，靠人工确认后写进 FIXES ——
head('=== 需要人工核对的疑似错配 ===');
line('  红宝书释义本身可靠，这类问题基本不会出现；若背诵中发现可疑条目，');
line('  可加进 tools/build.mjs 的 FIXES 表逐条剔除（当前为空）。');
