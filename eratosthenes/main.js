(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const int = (v) => v.toLocaleString('vi-VN');
  const dec = (v, d) => v.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function palette() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    return {
      bg: g('--bg'), panel: g('--panel'), plank: g('--plank'), ink: g('--ink'), muted: g('--muted'),
      line: g('--line'), accent: g('--accent'), accentInk: g('--accent-ink'), hit: g('--hit'), ok: g('--ok'), bad: g('--bad'),
      font: g('--font-data') || 'monospace',
    };
  }

  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Gọi markDirty mỗi khi cần vẽ lại: đổi kích thước canvas, đổi theme, font tải xong.
  function watch(canvases, markDirty) {
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(markDirty);
      canvases.forEach((cv) => ro.observe(cv));
    } else window.addEventListener('resize', markDirty);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', markDirty);
    new MutationObserver(markDirty).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(markDirty);
  }


  /* ───────────── Sàng Eratosthenes ───────────── */
  const RATE = [2, 6, 20, 60, 200];        // bước / giây khi chạy tự động
  const FADE = 450;                        // ms: ô vừa bị gạch còn sáng màu bao lâu
  const MARK = 900;                        // ms: ô tự gạch nháy xanh (đúng) hoặc đỏ (sai) bao lâu
  const MAX_CELL_H = 44;                   // px: ô không cao quá mức này dù cột có rộng
  /* by[k] = số nguyên tố đã gạch k (0 = chưa bị gạch).
     p = số đang sàng (1 = chưa chọn số nào), m = bội kế tiếp sẽ xét; m > N nghĩa là xong lượt của p.
     spf[k] = ước nguyên tố nhỏ nhất của k, dùng để chấm khi người dùng tự gạch; total = số hợp số ≤ N.
     markT[k], markOk[k] = lúc người dùng bấm vào ô k và bấm đúng hay sai.
     rounds = nhật ký từng lượt: { p, n } với n là số ô lượt đó gạch mới. */
  const S = { N: 100, cols: 10, by: null, flash: null, spf: null, total: 0, markT: null, markOk: null, ok: 0, bad: 0, cw: 1, ch: 1, p: 1, m: 0, lastM: 0, struck: 0, rounds: [], done: false, running: false, acc: 0, dirty: true, fading: false };
  const cv = $('e-canvas');

  function reset() {
    S.by = new Uint16Array(S.N + 1);
    S.flash = new Float64Array(S.N + 1);
    S.markT = new Float64Array(S.N + 1);
    S.markOk = new Uint8Array(S.N + 1);
    S.spf = new Uint16Array(S.N + 1);
    S.total = 0; S.ok = 0; S.bad = 0;
    for (let i = 2; i <= S.N; i++) {
      if (S.spf[i]) { S.total++; continue; }
      for (let j = i; j <= S.N; j += i) if (!S.spf[j]) S.spf[j] = i;
      S.spf[i] = 0;                                   // số nguyên tố: không có ước nào nhỏ hơn chính nó
    }
    S.p = 1; S.m = S.N + 1; S.lastM = 0; S.struck = 0; S.rounds = []; S.done = false; S.acc = 0; S.dirty = true;
  }

  // Một bước: hoặc chọn số nguyên tố kế tiếp, hoặc xét một bội của số đang sàng.
  function step(now) {
    if (S.done) return;
    S.dirty = true;
    if (S.m > S.N) {
      let q = S.p + 1;
      while (S.by[q]) q++;
      S.lastM = 0;
      if (q * q > S.N) { S.done = true; S.p = 0; return; }
      S.p = q; S.m = q * q;
      S.rounds.push({ p: q, n: 0 });
      return;
    }
    const m = S.m;
    if (!S.by[m]) { S.by[m] = S.p; S.struck++; S.rounds[S.rounds.length - 1].n++; }
    S.flash[m] = now;
    S.lastM = m; S.m += S.p;
  }
  // Người dùng tự gạch ô k: hợp số thì gạch thật, số nguyên tố hoặc số 1 thì chỉ báo sai.
  function mark(k, now) {
    if (S.by[k]) return;                              // đã gạch rồi
    const ok = S.spf[k] > 0;
    if (ok) { S.by[k] = S.spf[k]; S.struck++; S.ok++; } else S.bad++;
    S.markT[k] = now; S.markOk[k] = ok ? 1 : 0;
    S.dirty = true;
  }
  function finishRound(now) { do step(now); while (!S.done && S.m <= S.N); }
  function finishAll(now) { while (!S.done) step(now); }

  function draw(c, now) {
    const N = S.N, cols = S.cols, rows = Math.ceil(N / cols);
    // chiều cao canvas đi theo số hàng
    const cssW = Math.max(1, Math.round(cv.getBoundingClientRect().width));
    const cw = cssW / cols, ch = Math.min(cw, MAX_CELL_H);
    const hpx = Math.ceil(rows * ch) + 'px';
    if (cv.style.height !== hpx) cv.style.height = hpx;
    const { ctx } = fit(cv);
    S.cw = cw; S.ch = ch;

    const digits = String(N).length;
    const fs = Math.min(15, ch * 0.44, (cw - 3) / (digits * 0.62));
    const showText = fs >= 6.5;
    const gap = cw >= 10 ? 1 : 0.5;
    const slash = ch >= 9;
    const slashW = Math.max(1.25, Math.min(2.5, ch * 0.06));
    const pp = S.p * S.p;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    S.fading = false;

    for (let k = 1; k <= N; k++) {
      const x = ((k - 1) % cols) * cw, y = Math.floor((k - 1) / cols) * ch;
      const bx = x + gap / 2, by = y + gap / 2, bw = cw - gap, bh = ch - gap;
      let fg = c.ink, bold = false, strike = null;
      if (k === 1) {
        fg = c.line;                                   // 1 không phải số nguyên tố, cũng không phải hợp số
      } else if (S.by[k]) {
        ctx.fillStyle = c.plank; ctx.fillRect(bx, by, bw, bh);
        fg = c.muted; strike = c.ink;
        let a = 0;
        if (k === S.lastM) a = 1;
        else if (!reduceMotion && S.flash[k]) a = 1 - (now - S.flash[k]) / FADE;
        if (a > 0) {
          if (a < 1) S.fading = true;
          ctx.globalAlpha = a; ctx.fillStyle = c.hit; ctx.fillRect(bx, by, bw, bh); ctx.globalAlpha = 1;
          if (a > 0.5) fg = strike = c.panel;
        }
      } else if (k === S.p) {
        ctx.fillStyle = c.hit; ctx.fillRect(bx, by, bw, bh);
        fg = c.panel; bold = true;
      } else if (S.done || k < pp) {
        // mọi số chưa bị gạch và nhỏ hơn p² chắc chắn là số nguyên tố
        ctx.fillStyle = c.accent; ctx.fillRect(bx, by, bw, bh);
        fg = c.accentInk; bold = true;
      } else if (cw >= 6) {
        ctx.strokeStyle = c.line; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      }
      if (S.markT[k]) {
        const age = now - S.markT[k];
        if (age < MARK) {
          const a = reduceMotion ? 1 : 1 - age / MARK;
          S.fading = true;
          ctx.globalAlpha = a; ctx.fillStyle = S.markOk[k] ? c.ok : c.bad; ctx.fillRect(bx, by, bw, bh); ctx.globalAlpha = 1;
          if (a > 0.5) { fg = c.panel; if (strike) strike = c.panel; }
        }
      }
      if (showText) {
        ctx.font = (bold ? '600 ' : '') + fs + 'px ' + c.font;
        ctx.fillStyle = fg;
        ctx.fillText(String(k), x + cw / 2, y + ch / 2 + 0.5);
      }
      // nét gạch chéo đè lên số, từ góc dưới trái lên góc trên phải
      if (strike && slash) {
        ctx.strokeStyle = strike; ctx.lineWidth = slashW; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx + bw * 0.14, by + bh * 0.86); ctx.lineTo(bx + bw * 0.86, by + bh * 0.14); ctx.stroke();
        ctx.lineWidth = 1; ctx.lineCap = 'butt';
      }
    }
  }

  function stats() {
    const N = S.N;
    $('e-left').textContent = int(N - 1 - S.struck);
    $('e-status').textContent = S.done
      ? 'Xong: có ' + int(N - 1 - S.struck) + ' số nguyên tố ≤ ' + int(N)
      : S.struck === S.total ? 'Đã gạch hết hợp số, còn lại toàn số nguyên tố'
      : S.p > 1 ? 'Đang gạch các bội của ' + S.p : 'Chưa bắt đầu';
    $('e-p').textContent = S.done ? 'xong' : S.p > 1 ? String(S.p) : '—';
    $('e-m').textContent = S.lastM ? int(S.lastM) + ' = ' + S.p + ' × ' + (S.lastM / S.p) : '—';
    $('e-struck').textContent = int(S.struck);
    $('e-ok').textContent = int(S.ok);
    $('e-bad').textContent = int(S.bad);
    $('e-sqrt').textContent = dec(Math.sqrt(N), 2);
    $('e-approx').textContent = dec(N / Math.log(N), 1);
    // bảng từng lượt sàng
    const body = $('e-table-body');
    while (body.rows.length > S.rounds.length) body.deleteRow(-1);
    while (body.rows.length < S.rounds.length) {
      const tr = body.insertRow();
      tr.insertCell(); tr.insertCell(); tr.insertCell();
    }
    S.rounds.forEach((r, i) => {
      const cells = body.rows[i].cells;
      cells[0].textContent = String(r.p);
      cells[1].textContent = int(r.p * r.p);
      cells[2].textContent = int(r.n);
    });
  }

  const playBtn = $('e-play');
  function setRunning(on) {
    S.running = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? 'Tạm dừng' : 'Chạy tự động';
  }
  playBtn.addEventListener('click', () => {
    if (!S.running && S.done) reset();              // đã sàng xong: chạy lại từ đầu
    setRunning(!S.running);
  });
  $('e-step').addEventListener('click', () => step(performance.now()));
  $('e-round').addEventListener('click', () => finishRound(performance.now()));
  $('e-all').addEventListener('click', () => finishAll(performance.now()));
  $('e-reset').addEventListener('click', () => { setRunning(false); reset(); });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / S.cw), row = Math.floor((e.clientY - r.top) / S.ch);
    const k = row * S.cols + col + 1;
    if (col >= 0 && col < S.cols && row >= 0 && k <= S.N) mark(k, performance.now());
  });
  const speedOut = () => { $('e-speed-out').textContent = int(RATE[$('e-speed').value - 1]) + ' bước/giây'; };
  const nOut = () => { $('e-n-out').textContent = int(S.N); };
  const colsOut = () => { $('e-cols-out').textContent = String(S.cols); };
  $('e-speed').addEventListener('input', speedOut);
  $('e-n').addEventListener('input', () => { S.N = +$('e-n').value; nOut(); reset(); });
  $('e-cols').addEventListener('input', () => { S.cols = +$('e-cols').value; colsOut(); S.dirty = true; });

  /* ───────────── Vòng lặp ───────────── */
  watch([cv], () => { S.dirty = true; });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (S.running) {
      S.acc += dt * RATE[$('e-speed').value - 1];
      const k = Math.floor(S.acc); S.acc -= k;
      for (let i = 0; i < k && !S.done; i++) step(now);
      if (S.done) setRunning(false);
    }
    if (S.dirty || S.fading) { draw(palette(), now); stats(); S.dirty = false; }
    requestAnimationFrame(frame);
  }

  // Đồng bộ thanh trượt (trình duyệt có thể khôi phục giá trị cũ).
  S.N = +$('e-n').value; S.cols = +$('e-cols').value;
  speedOut(); nOut(); colsOut();
  reset();
  requestAnimationFrame(frame);
})();
