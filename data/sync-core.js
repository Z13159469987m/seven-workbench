/* data/sync-core.js — 跨设备同步核心（UMD：浏览器挂 window.SyncCore，Node 可 require 测试）
 * 同步中枢：GitHub Gist（免费、可设私密、无需自有服务器）
 * 设计：把工作台所有业务数据聚合推到同一个 Gist 文件；手机端/电脑端读写同一份 => 自动互通
 * 冲突策略：last-write-wins（个人单用户多设备，基本不会同时编辑冲突）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 需要跨设备同步的所有 localStorage key
  const SYNC_KEYS = [
    'wb_marks',          // 日报收藏/高亮标记
    'wb_weeks',          // 周计划
    'wb_lab',            // 试验田
    'wb_favgroups',      // 收藏小屋分组+条目
    'wb_potions',        // 进阶魔药(灵感)
    'wb_potion_overrides',
    'wb_rock_logs',      // 炫彩屋日志
    'wb_rock_plan',      // 炫彩屋计划
    'wb_rock_flows',     // 炫彩屋工作流程轴
    'wb_lab_checkin',   // 试验田每日打卡
    'wb_hidden_quotes'   // 已关闭的语录
  ];
  const GIST_FILENAME = 'workbench-sync.json';
  const API = 'https://api.github.com/gists';

  function safeParse(s){ try { return JSON.parse(s); } catch (e) { return undefined; } }

  function createSync(opts){
    const storage = opts.storage;                                   // {getItem,setItem}
    const http = opts.http || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const getCfg = opts.getCfg || (() => safeParse(storage.getItem('wb_sync_cfg')));
    const setCfg = opts.setCfg || ((c) => storage.setItem('wb_sync_cfg', JSON.stringify(c)));
    let dirty = new Set();
    let timer = null;
    let pushing = false;

    function markDirty(k){ if (SYNC_KEYS.indexOf(k) >= 0) { dirty.add(k); schedulePush(); } }
    function schedulePush(delay){ if (timer) clearTimeout(timer); timer = setTimeout(() => push(), delay || 1200); }

    function authHeaders(token){ return { 'Authorization': 'token ' + token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' }; }
    function bodyFor(dataObj){
      return JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify({ updatedAt: Date.now(), data: dataObj }, null, 2) } } });
    }
    function collect(){
      const o = {};
      for (const k of SYNC_KEYS){ const raw = storage.getItem(k); if (raw !== null) o[k] = safeParse(raw); }
      return o;
    }

    // push：有 gistId 则 PATCH，否则 POST 新建并把返回的 id 存回 cfg
    async function push(){
      const cfg = getCfg();
      if (!cfg || !cfg.token) return { ok:false, reason:'no-cfg' };
      if (pushing) return { ok:false, reason:'in-flight' };
      pushing = true;
      try {
        const data = collect();
        const method = cfg.gistId ? 'PATCH' : 'POST';
        const url = cfg.gistId ? API + '/' + cfg.gistId : API;
        const res = await http(url, { method, headers: authHeaders(cfg.token), body: bodyFor(data) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const gistId = cfg.gistId || (json && json.id);
        setCfg(Object.assign({}, cfg, { gistId, lastPushAt: Date.now() }));
        dirty.clear();
        return { ok:true, gistId, method };
      } catch (e) {
        return { ok:false, reason:String((e && e.message) || e) };
      } finally { pushing = false; }
    }

    // 深度合并：把 b 合并进 a（冲突处 b 优先）；带 id 的数组按 id 取并集，普通对象按 key 取并集，普通数组去重拼接。做到「两遍数据都不丢」。
    function isPlainObject(x){ return x && typeof x==='object' && !Array.isArray(x); }
    function hasId(x){ return isPlainObject(x) && typeof x.id !== 'undefined'; }
    function mergeDeep(a, b){
      if(Array.isArray(a) && Array.isArray(b)){
        if(a.length && hasId(a[0])){
          const map=new Map();
          for(const it of a) map.set(it.id, it);
          for(const it of b){
            if(map.has(it.id)) map.set(it.id, mergeDeep(map.get(it.id), it));
            else map.set(it.id, it);
          }
          return Array.from(map.values());
        }
        const seen=new Set(a.map(x=>JSON.stringify(x)));
        return a.concat(b.filter(x=>{ const k=JSON.stringify(x); if(seen.has(k)) return false; seen.add(k); return true; }));
      }
      if(isPlainObject(a) && isPlainObject(b)){
        const out=Object.assign({}, a);
        for(const k of Object.keys(b)) out[k] = (k in out) ? mergeDeep(out[k], b[k]) : b[k];
        return out;
      }
      return (b!==undefined && b!==null) ? b : a;
    }

    // mergePull：拉取远端并与本地合并（并集，不丢数据），结果写回本地 storage；返回 {ok, updatedAt, merged}
    async function mergePull(){
      const cfg=getCfg();
      if(!cfg||!cfg.token||!cfg.gistId) return {ok:false, reason:'no-cfg'};
      try{
        const res=await http(API+'/'+cfg.gistId, { headers: authHeaders(cfg.token) });
        if(!res.ok) throw new Error('HTTP '+res.status);
        const json=await res.json();
        const file=json.files && json.files[GIST_FILENAME];
        if(!file||!file.content) return {ok:false, reason:'no-file'};
        const parsed=safeParse(file.content)||{};
        const remote=parsed.data||{};
        const merged={};
        for(const k of SYNC_KEYS){
          const raw=storage.getItem(k);
          const local = raw!==null ? safeParse(raw) : undefined;
          const rv = (k in remote) ? remote[k] : undefined;
          if(rv!==undefined && local!==undefined) merged[k]=mergeDeep(local, rv);
          else if(rv!==undefined) merged[k]=rv;
          else if(local!==undefined) merged[k]=local;
        }
        for(const k of SYNC_KEYS){ if(k in merged && merged[k]!==undefined) storage.setItem(k, JSON.stringify(merged[k])); }
        setCfg(Object.assign({}, cfg, { lastPullAt:Date.now(), remoteUpdatedAt:parsed.updatedAt }));
        return {ok:true, updatedAt:parsed.updatedAt, merged};
      }catch(e){ return {ok:false, reason:String((e&&e.message)||e)}; }
    }

    // pull：拉取远端覆盖本地（直接写 storage，不经过 store.set，避免触发回写死循环）
    async function pull(){
      const cfg = getCfg();
      if (!cfg || !cfg.token || !cfg.gistId) return { ok:false, reason:'no-cfg' };
      const res = await http(API + '/' + cfg.gistId, { headers: authHeaders(cfg.token) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const file = json.files && json.files[GIST_FILENAME];
      if (!file || !file.content) return { ok:false, reason:'no-file' };
      const parsed = safeParse(file.content) || {};
      const data = parsed.data || {};
      for (const k of SYNC_KEYS){ if (k in data) storage.setItem(k, JSON.stringify(data[k])); }
      setCfg(Object.assign({}, cfg, { lastPullAt: Date.now(), remoteUpdatedAt: parsed.updatedAt }));
      return { ok:true, updatedAt: parsed.updatedAt };
    }

    // 确保 gistId 存在（首次使用自动创建私密 Gist）
    async function ensureGist(){
      const cfg = getCfg();
      if (!cfg || !cfg.token) return { ok:false, reason:'no-token' };
      if (cfg.gistId) return { ok:true, gistId: cfg.gistId };
      return await push();
    }

    return { SYNC_KEYS, markDirty, schedulePush, push, pull, mergePull, ensureGist, collect, mergeDeep };
  }

  return { createSync, SYNC_KEYS, GIST_FILENAME };
});
