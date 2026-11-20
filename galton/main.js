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
      line: g('--line'), accent: g('--accent'), hit: g('--hit'),
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

  function bindPlay(btn, state) {
    btn.addEventListener('click', () => {
      state.running = !state.running;
      btn.setAttribute('aria-pressed', String(state.running));
      btn.textContent = state.running ? 'Tạm dừng' : 'Chạy tự động';
    });
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


  /* ───────────── Bảng Galton ───────────── */
  const G_RATE = [2, 6, 20, 60, 200];      // bi / giây khi chạy tự động
  const G_FALL = [5, 8, 12, 18, 28];       // hàng đinh / giây
  const MAX_BALLS = 500;
  const G = { rows: 12, p: 0.5, bins: [], pmf: [], n: 0, sum: 0, sumsq: 0, balls: [], queue: 0, qacc: 0, running: false, acc: 0, dirty: true };
  const cvG = $('g-canvas');

  function resetG() {
    const n = G.rows, p = G.p;
    G.bins = new Array(n + 1).fill(0);
    G.pmf = new Array(n + 1);
    G.pmf[0] = Math.pow(1 - p, n);
    for (let k = 0; k < n; k++) G.pmf[k + 1] = G.pmf[k] * (n - k) / (k + 1) * p / (1 - p);
    G.n = 0; G.sum = 0; G.sumsq = 0; G.balls = []; G.queue = 0; G.qacc = 0; G.acc = 0; G.dirty = true;
  }
  function land(r) { G.bins[r]++; G.n++; G.sum += r; G.sumsq += r * r; G.dirty = true; }
  function dropInstant(k) {
    for (let i = 0; i < k; i++) {
      let r = 0;
      for (let j = 0; j < G.rows; j++) if (Math.random() < G.p) r++;
      land(r);
    }
  }
  function spawn() {
    if (reduceMotion || G.balls.length >= MAX_BALLS) { dropInstant(1); return; }
    const R = [0];
    for (let j = 0; j < G.rows; j++) R.push(R[j] + (Math.random() < G.p ? 1 : 0));
    G.balls.push({ R, t: -1 });
  }

  function stepG(dt) {
    const sp = $('g-speed').value - 1;
    let emit = 0;
    if (G.running) { G.acc += dt * G_RATE[sp]; const k = Math.floor(G.acc); G.acc -= k; emit += k; }
    if (G.queue > 0) {
      G.qacc += dt * Math.max(60, G_RATE[sp]);
      const k = Math.min(G.queue, Math.floor(G.qacc)); G.qacc -= k; G.queue -= k; emit += k;
    }
    for (let i = 0; i < emit; i++) spawn();
    if (G.balls.length) {
      const v = G_FALL[sp] * dt;
      let keep = 0;
      for (const b of G.balls) {
        b.t += v;
        if (b.t >= G.rows) land(b.R[G.rows]); else G.balls[keep++] = b;
      }
      G.balls.length = keep;
      G.dirty = true;
    }
  }

  function drawGalton(c) {
    const { ctx, w, h } = fit(cvG);
    const n = G.rows, padX = 12;
    const sx = (w - 2 * padX) / (n + 1);
    const cx = w / 2;
    const pr = Math.max(1.5, Math.min(4, sx * 0.09));
    const br = Math.max(2, Math.min(6.5, sx * 0.17));
    const top = 40;
    const binTop = Math.round(h * 0.5);
    const sy = (binTop - top) / n;
    const base = h - 24;
    const maxH = base - binTop - 22;

    // phễu
    ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 30, 4); ctx.lineTo(cx - br - 3, 20);
    ctx.moveTo(cx + 30, 4); ctx.lineTo(cx + br + 3, 20);
    ctx.stroke();

    // đinh
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    for (let r = 0; r < n; r++) for (let j = 0; j <= r; j++) {
      const x = cx + (j - r / 2) * sx, y = top + r * sy;
      ctx.moveTo(x + pr, y); ctx.arc(x, y, pr, 0, Math.PI * 2);
    }
    ctx.fill();

    // vách ngăn ô
    ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= n + 1; i++) { const x = Math.round(padX + i * sx) + 0.5; ctx.moveTo(x, binTop); ctx.lineTo(x, base); }
    ctx.stroke();
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padX, base + 0.5); ctx.lineTo(w - padX, base + 0.5); ctx.stroke();

    // cột số bi
    const M = G.n || 1;
    let peak = 0;
    for (let k = 0; k <= n; k++) peak = Math.max(peak, G.bins[k], M * G.pmf[k]);
    const scale = peak * 1.12 || 1;
    const bw = sx * 0.76;
    ctx.font = '10px ' + c.font; ctx.textAlign = 'center';
    const labelStep = sx < 17 ? 2 : 1;
    for (let k = 0; k <= n; k++) {
      const x = cx + (k - n / 2) * sx;
      const bh = G.bins[k] / scale * maxH;
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.82;
      ctx.fillRect(x - bw / 2, base - bh, bw, bh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.muted; ctx.textBaseline = 'top';
      if (k % labelStep === 0) ctx.fillText(String(k), x, base + 7);
    }

    // xấp xỉ chuẩn
    const mu = n * G.p, sigma = Math.sqrt(n * G.p * (1 - G.p));
    ctx.save();
    ctx.beginPath(); ctx.rect(padX, binTop, w - 2 * padX, base - binTop); ctx.clip();
    ctx.strokeStyle = c.hit; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const u = -0.5 + (n + 1) * i / steps;
      const val = M * Math.exp(-((u - mu) * (u - mu)) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
      const x = cx + (u - n / 2) * sx, y = base - val / scale * maxH;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // kỳ vọng nhị thức
    const dr = Math.max(2, Math.min(3.5, sx * 0.12));
    ctx.fillStyle = c.panel; ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5;
    for (let k = 0; k <= n; k++) {
      const x = cx + (k - n / 2) * sx, y = base - M * G.pmf[k] / scale * maxH;
      ctx.beginPath(); ctx.arc(x, y, dr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // bi đang rơi
    if (G.balls.length) {
      const off = pr + br;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      for (const b of G.balls) {
        let x, y;
        if (b.t < 0) { const s = b.t + 1; x = cx; y = top - sy + sy * s * s; }
        else {
          const k = Math.min(n - 1, Math.floor(b.t)), s = b.t - k;
          const x0 = cx + (b.R[k] - k / 2) * sx, x1 = cx + (b.R[k + 1] - (k + 1) / 2) * sx;
          x = x0 + (x1 - x0) * s;
          y = top + k * sy + sy * (2.2 * s * s - 1.2 * s);
        }
        y -= off;
        ctx.moveTo(x + br, y); ctx.arc(x, y, br, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  function statsG() {
    const n = G.rows, p = G.p;
    $('g-n').textContent = int(G.n);
    $('g-mu').textContent = dec(n * p, 3);
    $('g-sigma').textContent = dec(Math.sqrt(n * p * (1 - p)), 3);
    if (G.n > 0) {
      const mean = G.sum / G.n;
      $('g-mean').textContent = dec(mean, 3);
      $('g-sd').textContent = dec(Math.sqrt(Math.max(0, G.sumsq / G.n - mean * mean)), 3);
      let best = 0;
      for (let k = 1; k <= n; k++) if (G.bins[k] > G.bins[best]) best = k;
      $('g-mode').textContent = 'Ô đông nhất: ô ' + best + ' (' + int(G.bins[best]) + ' bi)';
    } else {
      $('g-mean').textContent = '—'; $('g-sd').textContent = '—';
      $('g-mode').textContent = 'Chưa có bi nào rơi';
    }
  }

  bindPlay($('g-play'), G);
  $('g-1').addEventListener('click', spawn);
  $('g-100').addEventListener('click', () => { if (reduceMotion) dropInstant(100); else G.queue += 100; });
  $('g-10k').addEventListener('click', () => dropInstant(10000));
  $('g-reset').addEventListener('click', resetG);
  const gSpeedOut = () => { $('g-speed-out').textContent = int(G_RATE[$('g-speed').value - 1]) + ' bi/giây'; };
  $('g-speed').addEventListener('input', gSpeedOut);
  const gRowsOut = () => { $('g-rows-out').textContent = $('g-rows').value; };
  const gPOut = () => { $('g-p-out').textContent = dec(+$('g-p').value, 2); };
  $('g-rows').addEventListener('input', () => { G.rows = +$('g-rows').value; gRowsOut(); resetG(); });
  $('g-p').addEventListener('input', () => { G.p = +$('g-p').value; gPOut(); resetG(); });

  /* ───────────── Vòng lặp ───────────── */
  watch([cvG], () => { G.dirty = true; });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    stepG(dt);
    if (G.dirty) { drawGalton(palette()); statsG(); G.dirty = false; }
    requestAnimationFrame(frame);
  }

  // Đồng bộ thanh trượt (trình duyệt có thể khôi phục giá trị cũ), rồi mở đầu bằng một lượt thả sẵn.
  G.rows = +$('g-rows').value; G.p = +$('g-p').value;
  gSpeedOut(); gRowsOut(); gPOut();
  resetG();
  dropInstant(500);
  requestAnimationFrame(frame);
})();
