// 生成可直接上传的部署目录（带 PWA：可装到手机桌面，之后完全离线可用）
// 源产物仍是单文件 HTML，这里只做托管增强，源模板保持干净
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '考研词汇训练器.html');
const DIST = path.join(ROOT, 'deploy');

if (!fs.existsSync(SRC)) {
  console.error('找不到 考研词汇训练器.html，先跑 node tools/build.mjs');
  process.exit(1);
}
fs.mkdirSync(DIST, { recursive: true });

let html = fs.readFileSync(SRC, 'utf8');

// 用内容哈希做缓存版本，词库更新后老缓存会自动失效
const stamp = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="104" fill="#1b1815"/>
<text x="256" y="366" font-size="320" text-anchor="middle" fill="#fcf9f3" font-family="Georgia,serif">词</text>
</svg>`;

const MANIFEST = {
  name: '考研词汇训练器',
  short_name: '考研词汇',
  description: '考研英语红宝书词汇 · 主动回忆 + 间隔重复',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f2ebe0',
  theme_color: '#f2ebe0',
  icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
};

const SW = `// 离线缓存：装到手机桌面后可断网使用。版本随构建内容变化
const CACHE = 'kaoyan-vocab-${stamp}';
const ASSETS = ['./', './index.html', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
`;

// 注入 PWA 声明与注册代码，源模板保持不变
html = html.replace('</head>', [
  '<link rel="manifest" href="./manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="./icon.svg">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="考研词汇">',
  '</head>',
].join('\n'));
html = html.replace('</body>', [
  '<script>',
  "if ('serviceWorker' in navigator && location.protocol === 'https:') {",
  "  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));",
  '}',
  '</script>',
  '</body>',
].join('\n'));

fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(DIST, 'sw.js'), SW, 'utf8');
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2), 'utf8');
fs.writeFileSync(path.join(DIST, 'icon.svg'), ICON, 'utf8');

// Cloudflare Pages / Netlify 读取
// 入口 HTML 给短缓存（内容改了要尽快生效），sw.js 必须不缓存，静态资源可以长缓存
fs.writeFileSync(path.join(DIST, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '',
  '/index.html',
  '  Cache-Control: public, max-age=300',
  '',
  '/sw.js',
  '  Cache-Control: no-cache',
  '',
  '/icon.svg',
  '  Cache-Control: public, max-age=604800',
  '',
  '/manifest.webmanifest',
  '  Cache-Control: public, max-age=86400',
  '',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');

fs.writeFileSync(path.join(DIST, 'README.txt'), [
  '静态托管部署包，入口是 index.html。',
  '',
  '把整个目录上传即可（Cloudflare Pages 拖拽上传最省事，详见项目根目录「部署指南.md」）。',
  '',
  '关于进度数据：学习记录存在浏览器 localStorage，按域名隔离。',
  '换网址后进度不会自动跟过去——先在旧地址的「数据」页导出 JSON，再到新地址导入。',
  '',
].join('\n'), 'utf8');

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log('部署包已生成：deploy/');
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', '_headers', 'robots.txt', 'README.txt']) {
  console.log('  ' + f.padEnd(22) + kb(path.join(DIST, f)));
}
console.log('\n缓存版本号：' + stamp + '（词库有变动时会自动换新）');
