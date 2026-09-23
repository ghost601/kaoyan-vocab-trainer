// 在 jsdom 中真实驱动训练器：翻卡、评分、选择题、拼写、视图切换
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, '考研词汇训练器.html'), 'utf8');

let fail = 0, total = 0;
const ok = (cond, label, extra) => {
  total++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) fail++;
};

// ---- 1. 语法 ----
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('[1] 脚本语法');
blocks.forEach((b, i) => {
  try { new vm.Script(b); ok(true, `块${i} 语法 (${b.length}B)`); }
  catch (e) { ok(false, `块${i} 语法`, e.message); }
});

// ---- 2. 数据 ----
console.log('[2] 数据结构');
const sb = { window: {} };
vm.createContext(sb);
vm.runInContext(blocks[0] + ';window.KY_DATA=DATA;', sb);
const D = sb.window.KY_DATA, W = D.words;
ok(D.meta.total === W.length, '总量一致', W.length);
ok(W.every(w => w.pos.length > 0), '每词至少一条释义', W.filter(w => !w.pos.length).length + ' 条异常');
ok(W.every(w => w.w && w.cn), '单词与首义非空');
ok(!W.some(w => /[\u4e00-\u9fff\t]/.test(w.w)), '单词字段不含中文/制表符');
const odd = W.filter(w => /[^A-Za-z\-'. ]/.test(w.w));
ok(odd.length <= 3, '非 ASCII 单词在合理范围', odd.map(x => x.w).join(',') || '无');
ok(W.every(w => w.w === w.w.trim()), '单词字段无首尾空格');
const noisy = W.filter(w => w.pos.some(g => g.defs.some(d => /^[A-Za-z]$/.test(d))));
ok(noisy.length === 0, '无整条只剩单个字母的义项', noisy.slice(0, 4).map(x => x.w).join(', ') || '无');
ok(W.some(w => /X 射线/.test(w.text)), 'X-ray 这类合法单字母未被误删');
ok(!W.some(w => /[\u2E80-\u2FDF]/.test(w.text + w.w)), '无 PDF 提取残留的异体字（⻋→车、⽬→目）');
ok(!W.some(w => /[<>《》“”]/.test(w.text)), '释义无编码残符');
ok(!W.some(w => /\(s\)/i.test(w.text)), '释义无 (s) 残留');
ok(W[0].lv === 3 && W[W.length - 1].lv === 1, '排序：难词在前');
ok(!W.some(w => /\/\s*$/.test(w.text) || w.text.length < 3), '无残破释义');

// 词典噪声与词性解析（这些曾真实污染过词库）
console.log('[2b] 数据质量');
const personNoise = W.filter(w => /\([^)]{1,32}\)\s*(人名|姓氏)/.test(w.text));
ok(personNoise.length === 0, '无人物名词条残留（n. (Huge)人名；(英)休奇）', personNoise.slice(0, 3).map(x => x.w + '/' + x.text.slice(0, 40)).join(' | ') || '无');
ok(W.filter(w => /abbr\./.test(w.text)).length <= 1, '无缩写词条噪声',
  W.filter(w => /abbr\./.test(w.text)).map(w => w.w).join(',') || '无');
const ampNoise = W.filter(w => /(adj|adv|n|v|prep|pron|vt|vi)&/.test(w.text));
ok(ampNoise.length === 0, '合写词性已拆开（adv&adj&prep.）', ampNoise.slice(0, 3).map(x => x.w).join(',') || '无');
const fullPos = W.filter(w => /(interjection|preposition|conjunction|pronoun|numeral|article|adverb|adjective|verb|noun)\./i.test(w.text));
ok(fullPos.length === 0, '完整拼写的词性已归一', fullPos.slice(0, 3).map(x => x.w).join(',') || '无');
ok(!W.some(w => /[\u4e00-\u9fff][A-Za-z](?=[\s；;，,]|$)/.test(w.text)), '无紧贴中文的孤立字母');
ok(!W.some(w => /；{2,}|；$/.test(w.text)), '无连续或悬空的分号');
// 多词性共享同一批释义时，每个词性都要保留
{
  const out = W.find(w => w.w === 'outside');
  ok(out && out.pos.length >= 3, 'adv&adj&prep 三个词性都保留', out ? out.pos.map(g => g.p).join(' ') : '缺词');
  const below = W.find(w => w.w === 'below');
  ok(below && below.pos.length === 2, 'adv&prep 两个词性都保留', below ? below.pos.map(g => g.p).join(' ') : '缺词');
}
// 针对已修复的错配数据做定点校验
{
  const cases = [
    ['pop', /砰的一声/, /卖点广告/],
    ['costly', /昂贵的/, /科斯特利/],
    ['sly', /狡猾/, /斯莱/],
    ['huge', /巨大的/, /休奇/],
    ['noble', /高尚/, /抓住/],
    ['nowadays', /现今/, /^n\./],
    ['pardon', /原谅/, null],
  ];
  let bad = 0;
  for (const [word, must, mustNot] of cases) {
    const x = W.find(v => v.w === word);
    if (!x || !must.test(x.text) || (mustNot && mustNot.test(x.text))) { bad++; console.log('         ↳ ' + word + ' = ' + (x ? x.text.slice(0, 70) : '缺失')); }
  }
  ok(bad === 0, '已修正的词条保持正确', bad ? bad + ' 条不符' : '7/7 正确');
}

// ---- 2c. 部署包（跑过 prepare-deploy.mjs 才校验）----
{
  const D2 = path.join(ROOT, 'deploy');
  const distFile = path.join(D2, 'index.html');
  if (fs.existsSync(distFile)) {
    console.log('[2c] 部署包');
    const dh = fs.readFileSync(distFile, 'utf8');
    ok(fs.existsSync(path.join(D2, 'sw.js')), '含 service worker');
    ok(fs.existsSync(path.join(D2, 'manifest.webmanifest')), '含 PWA manifest');
    ok(dh.includes('manifest.webmanifest'), 'index.html 引用了 manifest');
    ok(dh.includes("navigator.serviceWorker.register('./sw.js')"), 'index.html 注册了 service worker');
    ok(/const DATA = \{/.test(dh), '部署版数据仍内嵌，无外部依赖');
    ok(dh.length > html.length && dh.length - html.length < 4000, '部署版仅在原文件上做注入', '+' + (dh.length - html.length) + ' 字节');
    const mf = JSON.parse(fs.readFileSync(path.join(D2, 'manifest.webmanifest'), 'utf8'));
    ok(mf.display === 'standalone' && mf.start_url === './', 'manifest 可安装且用相对路径', 'display=' + mf.display);
    const sw = fs.readFileSync(path.join(D2, 'sw.js'), 'utf8');
    ok(/kaoyan-vocab-[0-9a-f]{10}/.test(sw), '缓存名带内容哈希，更新后自动失效', (sw.match(/kaoyan-vocab-\w+/) || [''])[0]);
  }
}

// ---- 3. jsdom 交互 ----
console.log('[3] jsdom 交互');
// jsdom 是交互测试的依赖，装在项目内 .test-deps（临时目录会被系统清理，不能放那儿）
const { JSDOM } = (() => {
  const cands = [
    path.join(ROOT, '.test-deps', 'node_modules', 'jsdom'),
    path.join(process.env.TEMP || '', 'ky-test', 'node_modules', 'jsdom'),
  ];
  for (const c of cands) { try { return require(c); } catch (e) { /* 换下一个 */ } }
  console.error('\n未找到 jsdom，无法运行交互测试。安装一次即可：');
  console.error('  cd .test-deps && npm install jsdom');
  console.error('（若 .test-deps 不存在：mkdir .test-deps 后再执行上面命令）\n');
  process.exit(1);
})();
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom, doc = window.document;
const $ = s => doc.querySelector(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

ok(!!$('#view-study'), '学习视图挂载');
ok(!$('#view-study').hidden && $('#view-stats').hidden, '默认显示学习视图');
const word0 = $('.word') ? $('.word').textContent : '';
ok(!!word0, '卡片渲染出单词', word0);
ok($('.word').textContent === W[0].w, '首卡是词频最高的词', $('.word').textContent + ' · 真题 ' + W[0].freq + ' 次');
ok(/高频/.test($('.pill').textContent), '高频词带对应层级标签', $('.pill').textContent);
ok(/真题 \d+ 次/.test(doc.querySelector('.tagrow').textContent), '卡片显示真题词频', doc.querySelector('.tagrow').textContent.trim().slice(0, 40));
ok(!$('.defs'), '未翻面时不显示释义');
ok($('#dock').classList.contains('flipmode'), '未翻面时评分按钮被禁用');

$('#gflip').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!!$('.defs'), '翻面后出现释义区');
const chips = doc.querySelectorAll('.dchip');
ok(chips.length > 0, '释义 chip 渲染', chips.length + ' 个');
ok(chips[0].classList.contains('first'), '首义高亮');

$('#g3').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
const word1 = $('.word') ? $('.word').textContent : '';
ok(word1 && word1 !== word0, '评分后进入下一张', word0 + ' → ' + word1);
const st = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
ok(st && Object.keys(st.words).length === 1, 'localStorage 写入 1 条记录');
const rec0 = Object.values(st.words)[0];
ok(rec0.s === 1 && rec0.due > Date.now(), 'GOOD 后 stage=1 且 due 推后', JSON.stringify(rec0));

// 答错：间隔应回退
$('#gflip').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
$('#g1').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
const st2 = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
const vals = Object.values(st2.words);
ok(vals.some(r => r.s === 0 && r.e === 1), 'AGAIN 后 stage 归零并计错', JSON.stringify(vals.map(r => ({ s:r.s, e:r.e }))));
ok(st2.today.rev === 2, '今日计数累加', st2.today.rev);

// 队列重现机制
const qlen = doc.querySelector('.q-pos').textContent;
ok(/\/\d+/.test(qlen), '进度指示存在', qlen.trim());

// 视图切换
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!$('#view-stats').hidden && $('#view-study').hidden, '切到数据视图');
ok(doc.querySelectorAll('#view-stats .tile').length >= 3, '数据视图渲染卡片', doc.querySelectorAll('#view-stats .tile').length);
ok($('#dock').style.display === 'none', '非学习视图隐藏评分坞');

doc.querySelector('.tabs button[data-view="plan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const expBatch = Math.ceil(W.length / 100);
ok(doc.querySelectorAll('#view-plan .batch button').length === expBatch, `计划视图 ${expBatch} 个批次`, doc.querySelectorAll('#view-plan .batch button').length);
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!$('#view-study').hidden, '切回学习视图');
ok(!!$('.word'), '切回后卡片仍在');

// 模式：英→中
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-mode="en2cn"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(doc.querySelectorAll('.opt').length === 4, '英→中给出 4 个选项', doc.querySelectorAll('.opt').length);
const texts = [...doc.querySelectorAll('.opt span')].map(x => x.textContent);
ok(new Set(texts).size === 4, '选项互不重复', texts.join(' | '));
const curWord = $('.word') ? $('.word').textContent : '';
const curW = D.words.find(w => w.w === curWord);
ok(texts.includes(curW.cn), '选项中包含该词的正确释义', curWord + ' → ' + curW.cn);
const stemOf = () => ($('.word') ? $('.word').textContent : '') + '|' + ($('.hint') ? $('.hint').textContent : '');
const stem1 = stemOf();
doc.querySelectorAll('.opt')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(doc.querySelectorAll('.opt.locked').length === 4, '点击后选项锁定');
ok(doc.querySelectorAll('.opt.right').length === 1, '标出唯一正确答案');
await wait(1800);
ok(stemOf() !== stem1, '自动进入下一题', stem1 + ' → ' + stemOf());

// 模式：拼写
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-mode="spell"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!!$('#spell'), '拼写题渲染输入框');
const sp1 = stemOf();
$('#spell').value = 'zzzz';
$('#spell').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await wait(40);
ok(!!doc.querySelector('.diff'), '拼写错误给出逐字母对照');
ok($('#spell').classList.contains('wrong'), '输入框标记为错误');
await wait(1900);
ok(stemOf() !== sp1, '拼写题自动进入下一题', sp1 + ' → ' + stemOf());

// 模式：速筛
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-mode="scan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(!!$('.word'), '速筛模式渲染单词');
ok(!$('.defs'), '速筛模式默认不显示释义');
const scanWord = $('.word').textContent;
const st3 = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
const scanId = W.findIndex(w => w.w === scanWord);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
await wait(20);
const st4 = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
ok(st4.words[scanId] && st4.words[scanId].k === 1, 'K 键永久移出该词', scanWord);

// 撤销
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(20);
const st5 = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
ok(!st5.words[scanId], 'Ctrl+Z 撤销了移出操作');

// 速筛四档：有点印象 / 不认识 / 跳过
console.log('[4] 速筛四档分类');
const readNow = () => JSON.parse(window.localStorage.getItem('ky.srs.v2')).words;
ok(/不认识/.test($('#g1').textContent) && /有点印象/.test($('#g2').textContent), '按钮：不认识 / 有点印象', $('#g1').textContent.trim() + ' | ' + $('#g2').textContent.trim());
ok(/已掌握/.test($('#g3').textContent) && /跳过/.test($('#gflip').textContent), '按钮：已掌握 / 跳过');
ok(!!$('#spk'), '速筛卡片上有发音按钮');
ok($('#t-speak').style.display !== 'none', '速筛模式保留 dock 的发音入口');
ok($('#t-bury').style.display === 'none', '速筛模式隐藏冗余的移出键（已有「已掌握」按钮）');
$('#spk').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
ok(!$('.defs'), '点发音按钮不会连带展开释义');

const wF = $('.word').textContent, idF = W.findIndex(x => x.w === wF);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
await wait(20);
const recF = readNow()[idF];
ok(!!recF && recF.f === 1, 'F → 标记「有点印象」', wF);
ok(recF.s === 1, '起始档位高一档（答对后间隔 3 天）', 'stage=' + recF.s);
ok(recF.due <= Date.now() && !recF.k, '立刻进入今天的队列，不占新词配额');

const wD = $('.word').textContent, idD = W.findIndex(x => x.w === wD);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'd', bubbles: true }));
await wait(20);
const recD = readNow()[idD];
ok(!!recD && !recD.f && !recD.k, 'D → 标记「不认识」，不写移出标记', wD);
ok(recD.s === 0, '从零档开始（答对后间隔 1 天）', 'stage=' + recD.s);
ok(recD.due <= Date.now(), '同样立刻进入今天的队列');
ok(!!readNow()[idD], '「不认识」留下记录 → 不会再出现在速筛队列里');

const wS = $('.word').textContent, idS = W.findIndex(x => x.w === wS);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: '4', bubbles: true }));
await wait(20);
ok(!readNow()[idS], '跳过的词不写记录，下次速筛仍会出现', wS);

// 卡片可点开释义（移动端没有键盘）
$('#card').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
ok(!!$('.defs'), '点击卡片显示释义');

// 撤销入口
console.log('[5] 撤销按钮');
ok($('#undoBtn').hidden === false, '有可回退操作时常驻显示', $('#undoBtn').textContent.trim().replace(/\s+/g, ' '));
ok(/撤销/.test($('#undoBtn').textContent), '按钮文案清晰');
const stepsShown = +($('#undoN').textContent || 1);
$('#undoBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
ok($('.word') && $('.word').textContent === wS, '撤销后回到被跳过的那个词', $('.word').textContent);
ok($('#toast').classList.contains('on'), '撤销后给出反馈', $('#toast').textContent.trim().slice(0, 24));
{
  const m = /还能回退 (\d+) 步/.exec($('#toast').textContent);
  ok(m && +m[1] === stepsShown - 1, '按钮显示的步数与实际回退一致', stepsShown + ' → ' + (m ? m[1] : '无'));
}

// 连续撤销：依次回退更早的操作，并把数据完整还原
$('#undoBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
ok($('.word').textContent === wD, '连续撤销回到上一张卡', $('.word').textContent);
ok(!readNow()[idD], '「不认识」标记被撤销，记录已清除');
$('#undoBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
ok($('.word').textContent === wF, '再撤销回到更早的卡片', $('.word').textContent);
ok(!readNow()[idF], '「有点印象」标记被完整还原为未接触');

// 撤销栈清空 → 按钮自动消失
ok($('#undoBtn').hidden === true, '所有操作撤销完后按钮自动隐藏');

// 视图切换时的显隐（先制造一次可撤销操作）
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
await wait(30);
ok($('#undoBtn').hidden === false, '产生新操作后按钮重新出现');
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
ok($('#undoBtn').hidden === true, '非学习视图隐藏撤销按钮');
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(20);
ok($('#undoBtn').hidden === false, '切回学习视图恢复显示');
$('#undoBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // 还原状态
await wait(30);

// 冲刺模式
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-mode="card"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-sprint="30"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const brand = doc.querySelector('.brand span').textContent;
ok(/冲刺 第 1 天 \/ 30 天/.test(brand), '开启 30 天冲刺后显示天数进度', brand);
const learnedNow = Object.keys(JSON.parse(window.localStorage.getItem('ky.srs.v2')).words).filter(k => !JSON.parse(window.localStorage.getItem('ky.srs.v2')).words[k].k).length;
const expectQ = Math.min(400, Math.max(5, Math.ceil((W.length - learnedNow) / 30)));
const todayTxt = $('#k-today').textContent;
ok(todayTxt.endsWith('/' + expectQ), '今日配额 = 剩余词数 ÷ 剩余天数', todayTxt + ' (期望 ' + expectQ + ')');
ok(expectQ >= 50 && expectQ <= 400, '30 天档配额落在合理区间', todayTxt);

doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
const qpos = doc.querySelector('.q-pos') ? doc.querySelector('.q-pos').textContent : '';
ok(!!qpos && /\/\d+/.test(qpos), '冲刺队列已构建', qpos.trim());
const qtotal = +qpos.split('/')[1];
ok(qtotal > 100 && qtotal <= expectQ, '首轮队列等于今日新词配额', qtotal + ' vs ' + expectQ);

doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-sprint="0"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(doc.querySelector('.brand span').textContent === 'active recall · srs', '关闭冲刺后恢复默认副标题');
ok(!/冲刺进度/.test($('#view-stats').textContent), '关闭后冲刺面板消失');

// 已移出：切回速筛模式，复现用户的真实现场
console.log('[6] 已移出与恢复');
window.confirm = () => true;
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('[data-mode="scan"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(40);
const w3 = $('.word').textContent;
const id3 = W.findIndex(x => x.w === w3);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
await wait(30);
const readS = () => JSON.parse(window.localStorage.getItem('ky.srs.v2')).words;
ok($('#toast').classList.contains('on'), '移出后弹出提示条');
ok(/撤销/.test($('#toast').textContent), '提示条带撤销入口', $('#toast').textContent.trim());
ok(readS()[id3].k === 1, '词已移出', w3);
ok(!!readS()[id3].bt, '记录了移出时间戳');
ok(readS()[id3].bp === null, '从未学过的词，快照为空');
$('#toast button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
ok(readS()[id3] && !readS()[id3].k, '点撤销后词已恢复');
ok(readS()[id3].due <= Date.now(), '恢复后立刻到期，回到今日队列');
ok(readS()[id3].s === 0 && !readS()[id3].bp && !readS()[id3].bt, '恢复为干净的全新状态');

// 数据页的已移出面板
const w4 = $('.word').textContent;
const id4 = W.findIndex(x => x.w === w4);
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
await wait(30);
doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(30);
ok(!!$('#buried-list'), '数据页出现已移出面板');
ok($('#buried-total').textContent === '1', '移出计数正确', $('#buried-total').textContent);
ok(doc.querySelectorAll('#buried-list .brow').length === 1, '列表渲染该词');
ok($('#buried-list').textContent.includes(w4), '列表内容匹配', w4);

$('#bq').value = 'zzzznotexist';
$('#bq').dispatchEvent(new window.Event('input', { bubbles: true }));
ok(/没有匹配/.test($('#buried-list').textContent), '搜索无结果时给出提示');
$('#bq').value = w4;
$('#bq').dispatchEvent(new window.Event('input', { bubbles: true }));
ok(doc.querySelectorAll('#buried-list .brow').length === 1, '搜索可精确定位');
$('#bq').value = W[id4].cn.slice(0, 2);
$('#bq').dispatchEvent(new window.Event('input', { bubbles: true }));
ok(doc.querySelectorAll('#buried-list .brow').length >= 1, '支持用中文释义搜索', W[id4].cn.slice(0, 2));

doc.querySelector('#buried-list [data-restore]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(420);
ok($('#buried-total').textContent === '0', '单个恢复后计数归零');
ok(readS()[id4] && !readS()[id4].k, '恢复后不再是移出状态');
ok(readS()[id4].due <= Date.now(), '恢复的词立刻进入待复习');

// 批量恢复
const before = [];
for(let i = 0; i < 3; i++){
  const w = $('.word') ? $('.word').textContent : null;
  doc.querySelector('.tabs button[data-view="study"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
  const cur = $('.word').textContent;
  before.push(W.findIndex(x => x.w === cur));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
  await wait(20);
  doc.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
}
ok($('#buried-total').textContent === '3', '累计移出 3 个词', $('#buried-total').textContent);
$('#res-all').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(60);
ok($('#buried-total').textContent === '0', '全部恢复后计数归零');
ok(before.every(id => readS()[id] && !readS()[id].k), '批量恢复的每个词都已回到队列');

// 已学过的词被误移出：进度必须完整还原
console.log('[7] 已学词误移出后的进度还原');
{
  const snap = JSON.parse(window.localStorage.getItem('ky.srs.v2'));
  const tid = W.length - 1;
  snap.words[tid] = { s:3, n:4, e:1, f:1, due:Date.now() - 60000, last:Date.now() - 86400000 };
  const cfg = { dailyNew:85, mode:'card', batchSize:100, speak:false, targetDays:0, startDate:'' };
  const dom2 = new JSDOM(html, {
    runScripts:'dangerously', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){
      w.localStorage.setItem('ky.srs.v2', JSON.stringify(snap));
      w.localStorage.setItem('ky.cfg.v2', JSON.stringify(cfg));
    },
  });
  const w2 = dom2.window, d2 = w2.document;
  const hitWord = d2.querySelector('.word') ? d2.querySelector('.word').textContent : '';
  ok(hitWord === W[tid].w, '预置的已学词排进复习队列首位', hitWord + ' vs ' + W[tid].w);
  ok(/速筛存疑/.test(d2.querySelector('.tagrow').textContent), '复习时标出速筛存疑的词');
  const read2 = () => JSON.parse(w2.localStorage.getItem('ky.srs.v2')).words[tid];
  d2.dispatchEvent(new w2.KeyboardEvent('keydown', { key:'k', bubbles:true }));
  const after = read2();
  ok(after.k === 1, '已学词被移出', W[tid].w);
  ok(after.bp && after.bp.s === 3 && after.bp.n === 4 && after.bp.e === 1,
    '移出时快照保留了完整进度', JSON.stringify(after.bp));
  ok(!!after.bt, '移出时间戳已记录');
  const ub = d2.querySelector('#toast button');
  ok(!!ub, '提示条提供撤销入口');
  ub.dispatchEvent(new w2.MouseEvent('click', { bubbles:true }));
  const back = read2();
  ok(!back.k && back.s === 3 && back.n === 4 && back.e === 1,
    '撤销后 stage / 复习次数 / 错误数完整还原', JSON.stringify(back));
  ok(back.due <= Date.now(), '还原后立即可复习，不必等到原定日期');
}

// 数据安全：自动备份
console.log('[8] 持久化与自动备份');
{
  const cfg = { dailyNew:3, mode:'card', batchSize:100, speak:false, targetDays:0, startDate:'', autoExport:false };
  const written = [];
  let downloads = 0;
  const fakeHandle = {
    name:'ky-test.json',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({ write: async b => { written.push(await b.text()); }, close: async () => {} }),
    getFile: async () => ({ text: async () => written[written.length - 1] || '' }),
  };
  const dom3 = new JSDOM(html, {
    runScripts:'dangerously', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){
      w.localStorage.setItem('ky.cfg.v2', JSON.stringify(cfg));
      w.showSaveFilePicker = async () => fakeHandle;
      w.URL.createObjectURL = () => { downloads++; return 'blob:fake'; };
      w.URL.revokeObjectURL = () => {};
    },
  });
  const w3 = dom3.window, d3 = w3.document;
  const $3 = s => d3.querySelector(s);
  const wait3 = ms => new Promise(r => setTimeout(r, ms));

  ok(typeof w3.showSaveFilePicker === 'function', '备份句柄 API 可用（注入模拟）');
  ok($3('#dock').classList.contains('flipmode') !== null, '页面正常启动');

  // 关闭自动朗读后应无 TTS 调用，且队列只有 3 张新词
  const total = +$3('.q-pos').textContent.split('/')[1];
  ok(total === 3, '每日新词 3 → 队列正好 3 张', total);

  d3.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(30);
  ok(!!$3('#view-stats').textContent.match(/浏览器自动保存/), '数据页出现「数据安全」面板');
  ok(/未绑定/.test($3('#view-stats').textContent), '初始状态显示未绑定备份');

  $3('[data-act="bind"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(80);
  ok(written.length >= 1, '绑定后立即写入一次备份', written.length + ' 次');
  const first = JSON.parse(written[0]);
  ok(!!first.state && !!first.cfg && !!first.savedAt, '备份内容含 state / cfg / savedAt');
  ok(/已绑定/.test($3('#toast').textContent), '提示条反馈绑定成功', $3('#toast').textContent.trim());

  // 自动下载开关
  $3('[data-act="auto"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(20);
  const cfgNow = JSON.parse(w3.localStorage.getItem('ky.cfg.v2'));
  ok(cfgNow.autoExport === true, '自动下载备份已开启');

  // 学完 3 张 → 结算 → 触发自动下载
  d3.querySelector('.tabs button[data-view="study"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(30);
  for(let i = 0; i < 3; i++){
    if(i === 1){
      const el = $3('.word');
      const len = el.textContent.length;
      const scaled = /calc\(var\(--wsize\)/.test(el.getAttribute('style') || '');
      ok(scaled === (len >= 9), '长单词才自动缩档', el.textContent + '(' + len + ' 字符) 缩放=' + scaled);
    }
    $3('#gflip').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
    $3('#g3').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
    await wait3(20);
  }
  ok(!!d3.querySelector('.finish'), '三轮后进入结算页');
  await wait3(40);
  ok(downloads >= 1, '清空队列后自动导出备份', downloads + ' 次下载');
  const st3b = JSON.parse(w3.localStorage.getItem('ky.srs.v2'));
  ok(Object.keys(st3b.words).length === 3, '进度已落盘 3 个词', Object.keys(st3b.words).length);
  ok(st3b.exportedFor === 3, '记录了已导出的进度快照，避免重复下载', st3b.exportedFor);

  // 备份文件内容应随进度更新
  d3.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(30);
  $3('[data-act="now"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(120);
  ok(written.length >= 2, '「立即写入」强制写盘，绕过节流', written.length + ' 次');
  const last = JSON.parse(written[written.length - 1]);
  ok(Object.keys(last.state.words).length === 3, '备份文件内容与最新进度一致', Object.keys(last.state.words).length);

  // 解绑
  $3('[data-act="unbind"]').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(30);
  ok(/未绑定/.test($3('#view-stats').textContent), '解绑后状态回到未绑定');
  ok(Object.keys(JSON.parse(w3.localStorage.getItem('ky.srs.v2')).words).length === 3, '解绑不影响浏览器内的进度');

  // 单词字号档位
  const root = d3.documentElement;
  ok(/54px/.test(root.style.getPropertyValue('--wsize')), '默认档位为中', root.style.getPropertyValue('--wsize') || '未设置');
  ok(!!$3('.ws-preview'), '设置页提供字号预览');
  const sizeBtn = k => $3('[data-wordsize="' + k + '"]');
  sizeBtn('xl').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(20);
  ok(/96px/.test(root.style.getPropertyValue('--wsize')), '切到特大档即时生效', root.style.getPropertyValue('--wsize'));
  ok(JSON.parse(w3.localStorage.getItem('ky.cfg.v2')).wordSize === 'xl', '字号选择已持久化');
  ok(sizeBtn('xl').classList.contains('on') && !sizeBtn('m').classList.contains('on'), '选中状态正确');
  sizeBtn('s').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(20);
  ok(/40px/.test(root.style.getPropertyValue('--wsize')), '切到小档即时生效', root.style.getPropertyValue('--wsize'));
  ok(/13\.5px/.test(root.style.getPropertyValue('--dsize')), '释义字号随档位联动', root.style.getPropertyValue('--dsize'));
  sizeBtn('m').dispatchEvent(new w3.MouseEvent('click', { bubbles:true }));
  await wait3(20);
  ok(/54px/.test(root.style.getPropertyValue('--wsize')), '切回中档');
}

// 发音：手动入口必须无视「自动朗读」开关
console.log('[9] 发音');
{
  const spoken = [];
  const cfg = { dailyNew:3, mode:'card', batchSize:100, speak:false, targetDays:0, startDate:'', autoExport:false, wordSize:'m' };
  const dom4 = new JSDOM(html, {
    runScripts:'dangerously', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){
      w.localStorage.setItem('ky.cfg.v2', JSON.stringify(cfg));
      const fakeVoices = [
        { name:'Microsoft Huihui - Chinese (Simplified)', lang:'zh-CN' },
        { name:'Microsoft Zira - English (United States)', lang:'en-US' },
      ];
      w.speechSynthesis = {
        paused:false, speaking:false, pending:false,
        getVoices: () => fakeVoices,
        speak: u => spoken.push(u.text + '@' + u.lang),
        cancel(){}, resume(){},
      };
      w.SpeechSynthesisUtterance = function(t){ this.text = t; this.lang = ''; this.rate = 1; this.volume = 1; };
    },
  });
  const w4 = dom4.window, d4 = w4.document;
  const $4 = s => d4.querySelector(s);
  const wait4 = ms => new Promise(r => setTimeout(r, ms));
  await wait4(60);

  const word = $4('.word').textContent;
  ok(!!word, '页面正常启动', word);

  $4('#spk').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  ok(spoken.length === 1 && spoken[0].startsWith(word), '「自动朗读」关闭时，点卡片 🔊 依然发声', JSON.stringify(spoken));
  ok(/@en-US$/.test(spoken[0]), '按英文语种朗读', spoken[0]);

  d4.dispatchEvent(new w4.KeyboardEvent('keydown', { key:'s', bubbles:true }));
  ok(spoken.length === 2, 'S 键同样发声', spoken.length + ' 次');
  $4('#t-speak').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  ok(spoken.length === 3, '评分栏 🔊 同样发声', spoken.length + ' 次');

  const n = spoken.length;
  $4('#gflip').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  $4('#g3').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  await wait4(60);
  ok(spoken.length === n, '自动朗读关闭时，翻面与评分不发声', spoken.length + ' vs ' + n);

  d4.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  await wait4(40);
  const stText = $4('#view-stats').textContent;
  ok(/Zira/.test(stText), '自动挑选英文语音（跳过中文语音）', (stText.match(/Microsoft [^(·]*/) || [''])[0].trim());
  ok(/2 个语音/.test(stText), '设置页显示可用语音总数');
  ok(!!$4('[data-act="tts"]'), '提供试听按钮');

  const before = spoken.length;
  $4('[data-act="tts"]').dispatchEvent(new w4.MouseEvent('click', { bubbles:true }));
  await wait4(40);
  ok(spoken.length === before + 1, '试听按钮可发声', spoken.length + ' 次');
}

// 「自动朗读」状态必须一眼可见、一点即切
console.log('[10] 自动朗读状态');
{
  const cfg = { dailyNew:3, mode:'card', batchSize:100, speak:false, targetDays:0, startDate:'', autoExport:false, wordSize:'m' };
  const spoken = [];
  const dom5 = new JSDOM(html, {
    runScripts:'dangerously', url:'http://localhost/', pretendToBeVisual:true,
    beforeParse(w){
      w.localStorage.setItem('ky.cfg.v2', JSON.stringify(cfg));
      w.speechSynthesis = {
        paused:false, speaking:false, pending:false,
        getVoices: () => [{ name:'Zira - English (United States)', lang:'en-US' }],
        speak: u => spoken.push(u.text), cancel(){}, resume(){},
      };
      w.SpeechSynthesisUtterance = function(t){ this.text = t; this.lang = ''; };
    },
  });
  const w5 = dom5.window, d5 = w5.document;
  const $5 = s => d5.querySelector(s);
  const wait5 = ms => new Promise(r => setTimeout(r, ms));
  await wait5(60);

  const tag = $5('#t-auto');
  ok(!!tag, '卡片上出现「自动朗读」状态开关');
  ok(!tag.classList.contains('on'), '关闭状态：无高亮', tag.textContent.trim() + ' | class=' + tag.className);
  ok(/已关闭/.test(tag.getAttribute('title') || ''), '悬停提示说明当前为关闭', tag.getAttribute('title'));
  ok(!!$5('#t-auto .dot'), '用圆点表示开/关');

  tag.dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  ok(tag.classList.contains('on'), '点击后变为开启状态（高亮）');
  ok(/已开启/.test(tag.getAttribute('title')), '提示同步更新', tag.getAttribute('title'));
  ok(JSON.parse(w5.localStorage.getItem('ky.cfg.v2')).speak === true, '状态已持久化');
  ok($5('#toast').classList.contains('on'), '切换时给出反馈', $5('#toast').textContent.trim().slice(0, 20));

  // 开启后，翻面与判分应自动发音
  const n0 = spoken.length;
  $5('#gflip').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  $5('#g3').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(60);
  ok(spoken.length > n0, '开启后评分会自动发音', n0 + ' → ' + spoken.length);

  // 再点一次关掉
  const tag2 = $5('#t-auto');
  tag2.dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  ok(!tag2.classList.contains('on'), '再次点击恢复关闭状态');
  ok(JSON.parse(w5.localStorage.getItem('ky.cfg.v2')).speak === false, '关闭状态同样持久化');

  // 从设置页切换后，回到学习页要同步
  d5.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  $5('[data-act="speak"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  d5.querySelector('.tabs button[data-view="study"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  ok($5('#t-auto').classList.contains('on'), '在设置页打开后，卡片上的状态同步为开启');

  // 切换状态不应影响手动发音
  const n1 = spoken.length;
  $5('#spk').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  ok(spoken.length === n1 + 1, '无论开关状态，手动 🔊 始终可用');

  // 无英文题干的模式仍应显示状态
  d5.querySelector('.tabs button[data-view="stats"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(30);
  $5('[data-mode="spell"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(30);
  d5.querySelector('.tabs button[data-view="study"]').dispatchEvent(new w5.MouseEvent('click', { bubbles:true }));
  await wait5(40);
  ok(!!$5('#t-auto'), '拼写模式也显示自动朗读状态');
  ok(!$5('#spk'), '拼写模式没有可读的英文题干，不显示发音键');
}

console.log('\n' + (fail ? `✗ ${fail} / ${total} 项失败` : `✓ 全部通过（${total} 项）`));
process.exitCode = fail ? 1 : 0;
