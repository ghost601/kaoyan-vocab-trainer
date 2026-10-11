/**
 * 考研词汇训练器 · 进度同步服务
 *
 * 设计要点：
 * 1. 无账号系统。用一段随机同步码作为路径，等同于"知道地址才能访问"的密钥，
 *    服务端不存任何身份信息。同步码长度 26 位（base32，约 130 bit），无法猜测。
 * 2. 合并而非覆盖。两台设备各自背过的词都要保留，按每个词的最后操作时间取新，
 *    而不是让后同步的那台整体覆盖前面的。否则手机上背一半、电脑上背一半，一同步就丢一半。
 * 3. 不解析释义，只处理调度数据（stage / 到期时间 / 次数），所以体积很小。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 同步码：26 位 base32（去掉容易看错的 I O 0 1）
const ID_RE = /^[A-HJ-NP-Z2-9]{26}$/;
const MAX_BYTES = 4 * 1024 * 1024;   // 进度数据通常几十 KB，4 MB 是安全上限

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

/** 某个词条的最后操作时间：评分写 last，移出写 bt */
const stamp = (r) => (r && (r.last || r.bt)) || 0;

/** 合并两份进度：逐词取较新的记录，统计值取较大者 */
export function mergeProgress(a = {}, b = {}) {
  const aw = a.words || {};
  const bw = b.words || {};
  const words = {};

  for (const id of new Set([...Object.keys(aw), ...Object.keys(bw)])) {
    const x = aw[id], y = bw[id];
    if (!x) { words[id] = y; continue; }
    if (!y) { words[id] = x; continue; }
    words[id] = stamp(y) > stamp(x) ? y : x;
  }

  // 今日计数：同一天取较大的，不同天以更新的那天为准
  const at = a.today || {}, bt = b.today || {};
  let today;
  if (!at.d) today = bt;
  else if (!bt.d) today = at;
  else if (at.d === bt.d) {
    today = {
      d: at.d,
      ids: [...new Set([...(at.ids || []), ...(bt.ids || [])])],
      rev: Math.max(at.rev || 0, bt.rev || 0),
      ok: Math.max(at.ok || 0, bt.ok || 0),
      quota: at.quota ?? bt.quota ?? null,
    };
  } else {
    today = (at.d > bt.d) ? at : bt;
  }

  return {
    words,
    today,
    streak: Math.max(a.streak || 0, b.streak || 0),
    last: [a.last, b.last].filter(Boolean).sort().pop() || '',
    exportedFor: Math.max(a.exportedFor || 0, b.exportedFor || 0) || undefined,
  };
}

function mergePayload(incoming, stored) {
  const cfgOut = { ...(stored?.cfg || {}), ...(incoming?.cfg || {}) };   // 配置以本次设备为准
  return {
    cfg: cfgOut,
    state: mergeProgress(stored?.state, incoming?.state),
    syncedAt: new Date().toISOString(),
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/p\/([^/]+)$/);
    if (!m) return json({ error: 'not found' }, 404);

    const id = m[1];
    if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);

    const key = 'p:' + id;

    if (request.method === 'GET') {
      const raw = await env.KY_PROGRESS.get(key);
      if (!raw) return json({ empty: true });
      return new Response(raw, { headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413);

      let incoming;
      try { incoming = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }

      // 先读后写，把两端都有的词合起来，避免互相覆盖
      let stored = null;
      try {
        const raw = await env.KY_PROGRESS.get(key);
        if (raw) stored = JSON.parse(raw);
      } catch { /* 存储里的旧数据坏了就按没有处理 */ }

      const merged = mergePayload(incoming, stored);
      await env.KY_PROGRESS.put(key, JSON.stringify(merged));
      return json(merged);
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
