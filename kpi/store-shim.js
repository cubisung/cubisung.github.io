/* ===== Kết nối kho dữ liệu chung (Google Sheets qua Apps Script) =====
 * Thay cho kho dữ liệu của Claude: cung cấp cùng giao diện db.collection().onSnapshot / db.doc().set|update|delete
 * - Chạy trong Apps Script (trang mở từ link /exec): gọi google.script.run.api(...)
 * - Chạy trên hosting riêng: gọi fetch(KPI_API_URL) – khai báo trong config.js
 * Mã truy cập Phòng (nếu đặt ACCESS_KEY trong Apps Script) được hỏi một lần và nhớ trên máy.
 */
(function () {
  var POLL_MS = 20000, KEY_STORE = 'kpi_access_key';
  var listeners = {}; // col -> [fn]
  var cache = {};     // col -> {id: data}
  var timer = null, inflight = null;

  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, k); } catch (e) {} }

  function call(req) {
    req.key = getKey();
    if (window.google && google.script && google.script.run) {
      return new Promise(function (res, rej) {
        google.script.run.withSuccessHandler(res).withFailureHandler(function (e) { rej({ code: 'unavailable', message: String(e && e.message || e) }); }).api(req);
      }).then(check);
    }
    var url = window.KPI_API_URL;
    if (!url) return Promise.resolve(localApi(req)); // chưa nối Google Sheet: lưu tạm trên máy này
    // text/plain để tránh preflight CORS với Apps Script
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), redirect: 'follow' })
      .then(function (r) { return r.json(); }, function (e) { throw { code: 'unavailable', message: String(e) }; })
      .then(check);
  }
  // Kho tạm trên máy (localStorage) – cùng cách trả lời như Code.gs
  var LOCAL = 'kpi_local_db';
  function localApi(req) {
    var all; try { all = JSON.parse(localStorage.getItem(LOCAL) || '{}'); } catch (e) { all = {}; }
    if (req.op === 'listAll') { var data = {}; (req.cols || []).forEach(function (c) { data[c] = all[c] || {}; }); return { data: data }; }
    var c = req.col, id = req.id; all[c] = all[c] || {};
    if (req.op === 'delete') delete all[c][id];
    else if (req.op === 'update') { if (!all[c][id]) return { error: 'Không tìm thấy dữ liệu để cập nhật' }; all[c][id] = merge(all[c][id], req.data); }
    else all[c][id] = req.data;
    try { localStorage.setItem(LOCAL, JSON.stringify(all)); } catch (e) {}
    return { ok: true, doc: req.op === 'delete' ? null : all[c][id] };
  }
  function merge(a, b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
    var o = (a && typeof a === 'object' && !Array.isArray(a)) ? JSON.parse(JSON.stringify(a)) : {};
    Object.keys(b).forEach(function (k) { o[k] = merge(o[k], b[k]); }); return o;
  }
  window.KPI_LOCAL_MODE = function () { return !(window.google && google.script && google.script.run) && !window.KPI_API_URL; };
  function check(res) {
    if (res && res.error === 'key') { return askKey(res.message).then(function () { throw { code: 'retry' }; }); }
    if (res && res.error) throw { code: 'invalid_argument', message: res.error };
    return res;
  }
  var asking = null;
  function askKey(msg) {
    if (asking) return asking;
    asking = new Promise(function (resolve) {
      var o = document.createElement('div');
      o.setAttribute('style', 'position:fixed;inset:0;z-index:999;background:rgba(8,18,32,.6);display:grid;place-items:center;padding:16px');
      o.innerHTML = '<form style="background:var(--surface,#fff);color:var(--ink,#000);border-radius:16px;padding:20px;max-width:360px;width:100%;display:flex;flex-direction:column;gap:12px;font-family:inherit">' +
        '<b style="font-size:1.1rem">Mã truy cập của Phòng</b><span style="font-size:.9rem;opacity:.8">' + (msg || 'Nhập mã truy cập do lãnh đạo Phòng cung cấp. Máy này sẽ ghi nhớ mã.') + '</span>' +
        '<input id="kpiKeyIn" type="password" autocomplete="off" style="font-size:16px;padding:10px;border:1px solid #ccd;border-radius:10px">' +
        '<button style="min-height:44px;border:0;border-radius:10px;background:var(--accent,#0a8f6a);color:#fff;font-weight:600;font-size:15px">Tiếp tục</button></form>';
      document.body.appendChild(o);
      var inp = o.querySelector('input'); setTimeout(function () { inp.focus(); }, 50);
      o.querySelector('form').onsubmit = function (e) { e.preventDefault(); setKey(inp.value.trim()); o.remove(); asking = null; resolve(); setTimeout(refresh, 60); };
    });
    return asking;
  }

  function snapshotOf(col) {
    var m = cache[col] || {};
    var docs = Object.keys(m).map(function (id) { var d = m[id]; return { id: id, exists: true, data: function () { return d; }, metadata: { fromCache: false, hasPendingWrites: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function emit(col) { (listeners[col] || []).forEach(function (l) { try { l.next(snapshotOf(col)); } catch (e) { console.error(e); } }); }

  function refresh() {
    var cols = Object.keys(listeners);
    if (!cols.length) return Promise.resolve();
    if (inflight) return inflight;
    inflight = call({ op: 'listAll', cols: cols }).then(function (res) {
      cols.forEach(function (c) {
        var next = res.data[c] || {};
        if (JSON.stringify(next) !== JSON.stringify(cache[c] || {}) || !cache.__seen || !cache.__seen[c]) {
          cache[c] = next; cache.__seen = cache.__seen || {}; cache.__seen[c] = 1; emit(c);
        }
      });
    }).catch(function (e) {
      if (e && e.code === 'retry') return;
      cols.forEach(function (c) { (listeners[c] || []).forEach(function (l) { if (l.error) l.error(e); }); });
    }).then(function () { inflight = null; });
    return inflight;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(function () { if (!document.hidden) refresh(); schedule(); }, POLL_MS); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

  function split(path) { var p = path.split('/'); return { col: p[0], id: p.slice(1).join('/') }; }
  function write(op, path, data) {
    var s = split(path);
    // cập nhật ngay trên máy, rồi gửi lên kho chung
    cache[s.col] = cache[s.col] || {};
    if (op === 'delete') delete cache[s.col][s.id];
    else if (op === 'set') cache[s.col][s.id] = JSON.parse(JSON.stringify(data));
    return call({ op: op, col: s.col, id: s.id, data: data }).then(function (r) {
      if (r && r.doc !== undefined) { if (r.doc === null) delete cache[s.col][s.id]; else cache[s.col][s.id] = r.doc; }
      emit(s.col);
    }, function (e) { if (e && e.code === 'retry') return write(op, path, data); throw e; });
  }

  var db = {
    collection: function (col) {
      return {
        onSnapshot: function (next, error) {
          (listeners[col] = listeners[col] || []).push({ next: next, error: error });
          refresh(); schedule();
          return function () { listeners[col] = (listeners[col] || []).filter(function (l) { return l.next !== next; }); };
        },
        doc: function (id) { return db.doc(col + '/' + id); }
      };
    },
    doc: function (path) {
      return {
        set: function (d) { return write('set', path, d); },
        update: function (d) { return write('update', path, d); },
        delete: function () { return write('delete', path); },
        get: function () { var s = split(path), d = (cache[s.col] || {})[s.id]; return Promise.resolve({ id: s.id, exists: !!d, data: function () { return d; } }); }
      };
    }
  };
  window.claude = { use: function (name) { return Promise.resolve(name === 'db' ? db : null); } };
  window.KPI_STORE = { refresh: refresh };
})();
