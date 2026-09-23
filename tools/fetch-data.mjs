// 从上游仓库拉取词表与词频数据
//
// 为什么数据不直接放进仓库：词表内容的原始版权属于出版方，
// 且词频表是 CC BY-NC-SA 4.0（禁止商用、衍生须同协议），
// 与代码的 MIT 许可放一起会产生冲突。所以数据由使用者自行获取。
//
// 用法：node tools/fetch-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'data-src');

const SOURCES = [
  {
    file: 'redbook_words.json',
    label: '红宝书词表与释义',
    url: 'https://raw.githubusercontent.com/3056810551/2027-kaoyan-english-redbook-json/main/words.json',
    repo: 'https://github.com/3056810551/2027-kaoyan-english-redbook-json',
    license: 'MIT（仓库作者对其整理成果的授权）',
    note: '词表内容的原始版权归出版方，请仅作个人学习使用',
  },
  {
    file: 'netem_full_list.json',
    label: '真题词频与分类',
    url: 'https://raw.githubusercontent.com/exam-data/NETEMVocabulary/master/netem_full_list.json',
    repo: 'https://github.com/exam-data/NETEMVocabulary',
    license: 'CC BY-NC-SA 4.0',
    note: '禁止商业用途；如二次分发须保留署名并以相同协议共享',
  },
];

fs.mkdirSync(DEST, { recursive: true });

const force = process.argv.includes('--force');
let failed = 0;

for (const s of SOURCES) {
  const out = path.join(DEST, s.file);
  if (fs.existsSync(out) && !force) {
    console.log(`跳过 ${s.file}（已存在，加 --force 可重新下载）`);
    continue;
  }
  process.stdout.write(`下载 ${s.label} … `);
  try {
    const res = await fetch(s.url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const json = JSON.parse(text);              // 确认拿到的是合法 JSON，避免存下错误页
    fs.writeFileSync(out, text, 'utf8');
    console.log(`完成  ${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(0)} KB  许可：${s.license}`);
    console.log(`         来源：${s.repo}`);
    if (s.note) console.log(`         注意：${s.note}`);
    void json;
  } catch (e) {
    failed++;
    console.log('失败  ' + (e.message || e));
    console.log('         可手动下载后放到 ' + path.relative(ROOT, out));
  }
}

if (failed) {
  console.error(`\n${failed} 个文件获取失败，检查网络后重试。`);
  process.exit(1);
}
console.log('\n数据就绪，接着执行：node tools/build.mjs');
