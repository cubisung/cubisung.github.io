/* Mở khóa số liệu: dữ liệu KPI trong trang được mã hóa AES-256-GCM, khóa sinh từ mã truy cập Phòng (PBKDF2-SHA256).
 * Đúng mã → giải mã → khởi động app; mã được nhớ trên máy (dùng chung làm mã truy cập kho dữ liệu). */
(function () {
  var KEY = 'kpi_access_key';
  function un64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function norm(p) { return String(p || '').trim().toUpperCase(); }
  async function decrypt(pass) {
    var E = window.KPI_ENC, enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(norm(pass)), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: un64(E.salt), iterations: E.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(E.iv) }, key, un64(E.ct));
    return JSON.parse(new TextDecoder().decode(buf));
  }
  async function start(pass) {
    try { SEED = await decrypt(pass); } catch (e) { return false; }
    try { localStorage.setItem(KEY, norm(pass)); } catch (e) {}
    window.__startApp();
    return true;
  }
  function ask(msg) {
    var o = document.createElement('div');
    o.setAttribute('style', 'position:fixed;inset:0;z-index:999;background:var(--bg,#eef2f6);display:grid;place-items:center;padding:16px');
    o.innerHTML = '<form style="background:var(--surface,#fff);color:var(--ink,#0f1b2d);border:1px solid var(--line,#e1e7ef);border-radius:18px;padding:22px;max-width:380px;width:100%;display:flex;flex-direction:column;gap:12px;font-family:inherit">' +
      '<b style="font-size:1.2rem">KPI Quý 4/2026 – Phòng</b>' +
      '<span style="font-size:.92rem;color:var(--ink-2,#44536a)">Nhập mã truy cập của Phòng (do lãnh đạo Phòng cung cấp). Máy này sẽ ghi nhớ mã.</span>' +
      '<input id="bootKey" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="KPI-XXXXX-XXXXX" style="font-size:17px;padding:12px;border:1px solid var(--line,#ccd);border-radius:12px;letter-spacing:.05em">' +
      '<span id="bootMsg" style="color:var(--bad,#b4322c);font-size:.9rem;min-height:1.2em">' + (msg || '') + '</span>' +
      '<button style="min-height:48px;border:0;border-radius:12px;background:var(--accent,#0a8f6a);color:#fff;font-weight:600;font-size:16px">Mở app</button></form>';
    document.body.appendChild(o);
    var inp = o.querySelector('input'), btn = o.querySelector('button');
    setTimeout(function () { inp.focus(); }, 60);
    o.querySelector('form').onsubmit = async function (e) {
      e.preventDefault(); btn.disabled = true; btn.textContent = 'Đang mở…';
      if (await start(inp.value)) { o.remove(); return; }
      btn.disabled = false; btn.textContent = 'Mở app';
      o.querySelector('#bootMsg').textContent = 'Mã truy cập chưa đúng. Kiểm tra lại (không phân biệt chữ hoa/thường).';
    };
  }
  (async function () {
    if (!window.crypto || !crypto.subtle) { document.getElementById('app').innerHTML = '<div class="panel">Trình duyệt này không hỗ trợ mở khóa dữ liệu. Hãy dùng Safari/Chrome bản mới.</div>'; return; }
    var saved = ''; try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (saved && await start(saved)) return;
    ask(saved ? 'Mã truy cập đã đổi, hãy nhập mã mới.' : '');
  })();
})();
