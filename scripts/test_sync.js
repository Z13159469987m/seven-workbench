/* scripts/test_sync.js — 验证跨设备同步链路（mock Gist 服务，无需真实 GitHub 账号）
 * 尝试1：手机端写入→push→电脑端 pull→一致（并反向）
 * 尝试2：导出/导入 JSON 往返一致
 */
const http = require('http');
const SyncCore = require('../data/sync-core.js');

// ---- mock GitHub Gist 服务 ----
const gists = {};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const url = req.url;
    if (req.method === 'POST' && url === '/gists') {
      const id = 'gist_' + Math.random().toString(36).slice(2, 10);
      const parsed = JSON.parse(body || '{}');
      gists[id] = { files: parsed.files || {} };
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, files: gists[id].files }));
    } else if (req.method === 'PATCH' && url.startsWith('/gists/')) {
      const id = url.split('/')[2];
      const parsed = JSON.parse(body || '{}');
      if (parsed.files) gists[id].files = parsed.files;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, files: gists[id].files }));
    } else if (req.method === 'GET' && url.startsWith('/gists/')) {
      const id = url.split('/')[2];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, files: (gists[id] && gists[id].files) || {} }));
    } else { res.writeHead(404); res.end('nope'); }
  });
});

function memStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)),
    _dump: () => Object.fromEntries(m)
  };
}
let failed = false;
function assert(cond, msg) { if (!cond) { console.error('  ❌ FAIL:', msg); failed = true; } else console.log('  ✅', msg); }

const httpFor = (url, opts) => fetch(String(url).replace('https://api.github.com', 'http://127.0.0.1:8787'), opts);

server.listen(8787, '127.0.0.1', async () => {
  try { await run(); }
  catch (e) { console.error('TEST ERROR', e); failed = true; }
  finally { server.close(); process.exit(failed ? 1 : 0); }
});

async function run() {
  const TOKEN = 'test_token';

  // ===== 手机端 =====
  const A = memStorage();
  const syncA = SyncCore.createSync({
    storage: A, http: httpFor,
    getCfg: () => JSON.parse(A.getItem('wb_sync_cfg') || 'null'),
    setCfg: (c) => A.setItem('wb_sync_cfg', JSON.stringify(c))
  });
  A.setItem('wb_marks', JSON.stringify({ a1: { hl: true, fav: true, category: '小说推文' } }));
  A.setItem('wb_favgroups', JSON.stringify([{ id: 'g1', items: [{ id: 'i1', title: '测试收藏' }] }]));
  A.setItem('wb_potions', JSON.stringify([{ id: 'p1', title: '灵感A' }]));
  A.setItem('wb_sync_cfg', JSON.stringify({ token: TOKEN, gistId: '' }));

  console.log('尝试1 · 手机端创建 Gist + 上传：');
  const created = await syncA.ensureGist();
  assert(created.ok && created.gistId, 'ensureGist 创建成功并返回 gistId');
  A.setItem('wb_marks', JSON.stringify({ a1: { hl: true, fav: true, category: '小说推文' }, a2: { hl: false, fav: true, category: '热点改编' } }));
  const pushed = await syncA.push();
  assert(pushed.ok, '手机端 push 成功');

  // ===== 电脑端（同一 gistId） =====
  const cfgA = JSON.parse(A.getItem('wb_sync_cfg'));
  const B = memStorage();
  const syncB = SyncCore.createSync({
    storage: B, http: httpFor,
    getCfg: () => JSON.parse(B.getItem('wb_sync_cfg') || 'null'),
    setCfg: (c) => B.setItem('wb_sync_cfg', JSON.stringify(c))
  });
  B.setItem('wb_sync_cfg', JSON.stringify({ token: TOKEN, gistId: cfgA.gistId }));

  console.log('尝试1 · 电脑端拉取手机端数据：');
  const pulled = await syncB.pull();
  assert(pulled.ok, '电脑端 pull 成功');
  const am = JSON.parse(A.getItem('wb_marks'));
  const bm = JSON.parse(B.getItem('wb_marks'));
  const af = JSON.parse(A.getItem('wb_favgroups'));
  const bf = JSON.parse(B.getItem('wb_favgroups'));
  assert(JSON.stringify(am) === JSON.stringify(bm), '两设备 wb_marks 完全一致');
  assert(JSON.stringify(af) === JSON.stringify(bf), '两设备 wb_favgroups 完全一致');
  assert(bm.a2 && bm.a2.category === '热点改编', '电脑端能看到手机新增的 a2');

  console.log('尝试1 · 反向：电脑端改数据，手机端拉取：');
  B.setItem('wb_potions', JSON.stringify([{ id: 'p1', title: '灵感A' }, { id: 'p2', title: '电脑新增灵感' }]));
  await syncB.push();
  await syncA.pull();
  const ap = JSON.parse(A.getItem('wb_potions'));
  assert(ap.some(x => x.id === 'p2'), '手机端能看到电脑新增的 p2（双向同步成立）');

  // ===== 尝试2：导出/导入 JSON 往返 =====
  console.log('尝试2 · 导出/导入 JSON 往返：');
  const exp = {};
  for (const k of SyncCore.SYNC_KEYS) { const raw = A.getItem(k); if (raw !== null) exp[k] = JSON.parse(raw); }
  const C = memStorage();
  for (const k in exp) { if (SyncCore.SYNC_KEYS.indexOf(k) >= 0) C.setItem(k, JSON.stringify(exp[k])); }
  assert(JSON.stringify(JSON.parse(C.getItem('wb_favgroups'))) === JSON.stringify(af), '导出→导入后 wb_favgroups 一致');
  assert(JSON.stringify(JSON.parse(C.getItem('wb_potions'))) === JSON.stringify(ap), '导出→导入后 wb_potions 一致');

  console.log(failed ? '\n=== 存在失败项 ===' : '\n=== 全部验证通过 ✅ ===');
}
