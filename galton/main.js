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

  // Ảnh một viên bi có khối (điểm sáng + viền tối), vẽ sẵn một lần rồi dán lại cho nhanh.
  const sprites = new Map();
  function ballSprite(rad, color, dpr) {
    const key = rad.toFixed(2) + color + dpr;
    if (sprites.has(key)) return sprites.get(key);
    if (sprites.size > 40) sprites.clear();
    const size = Math.max(2, Math.ceil(rad * 2 * dpr));
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const x = cv.getContext('2d'), r = size / 2;
    x.beginPath(); x.arc(r, r, r, 0, Math.PI * 2); x.clip();
    x.fillStyle = color; x.fillRect(0, 0, size, size);
    const g = x.createRadialGradient(r * 0.62, r * 0.55, r * 0.05, r, r, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.28, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.65, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    x.fillStyle = g; x.fillRect(0, 0, size, size);
    sprites.set(key, cv);
    return cv;
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
  const G_FALL = [2.5, 4, 6, 9, 14];       // hàng đinh / giây
  const MAX_BALLS = 500;
  const ACROSS = 5;                        // số bi xếp vừa bề ngang một ô
  const PACK = 0.84;                       // mật độ xếp ước lượng của đống bi (để đổi số bi ra chiều cao)
  const BOUNCE = 0.35;                     // độ nảy khi bi chạm vách, đáy hoặc bi khác
  const G = { rows: 12, p: 0.5, bins: [], pmf: [], n: 0, sum: 0, sumsq: 0, balls: [], queue: 0, qacc: 0, running: false, acc: 0, dirty: true, geo: null, pile: null, showNormal: true };
  const cvG = $('g-canvas');

  function resetG() {
    const n = G.rows, p = G.p;
    G.bins = new Array(n + 1).fill(0);
    G.pmf = new Array(n + 1);
    G.pmf[0] = Math.pow(1 - p, n);
    for (let k = 0; k < n; k++) G.pmf[k + 1] = G.pmf[k] * (n - k) / (k + 1) * p / (1 - p);
    G.n = 0; G.sum = 0; G.sumsq = 0; G.balls = []; G.queue = 0; G.qacc = 0; G.acc = 0; G.dirty = true;
    G.geo = null; G.pile = null;
  }
  function land(r) { G.bins[r]++; G.n++; G.sum += r; G.sumsq += r * r; G.dirty = true; }
  function dropInstant(k) {
    for (let i = 0; i < k; i++) {
      let r = 0;
      for (let j = 0; j < G.rows; j++) if (Math.random() < G.p) r++;
      land(r);
    }
    if (G.pile) G.pile.stale = true;
  }
  function spawn() {
    if (reduceMotion || G.balls.length >= MAX_BALLS) { dropInstant(1); return; }
    const R = [0];
    for (let j = 0; j < G.rows; j++) R.push(R[j] + (Math.random() < G.p ? 1 : 0));
    G.balls.push({ R, t: -1, st: 0 });
  }

  // Kích thước bảng theo canvas hiện tại (px). Bỏ cache khi canvas đổi cỡ hoặc đổi số hàng.
  function geom() {
    const r = cvG.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const n = G.rows, padX = 12;
    const sx = (w - 2 * padX) / (n + 1);
    const top = 40, binTop = Math.round(h * 0.5), base = h - 38;   // dưới đáy: một dòng số bi, một dòng số thứ tự ô
    return G.geo = {
      w, h, n, padX, sx, cx: w / 2, top, binTop, base,
      sy: (binTop - top) / n,
      maxH: Math.max(10, base - binTop - 22),
      pr: Math.max(1.5, Math.min(4, sx * 0.09)),
      bw: Math.max(2, sx - 3),
      dMax: Math.max(3, Math.max(2, sx - 3) / (ACROSS + 0.6)),   // đường kính bi: vừa ACROSS viên xếp so le theo bề ngang ô
    };
  }
  const binLeft = (g, k) => g.cx + (k - g.n / 2) * g.sx - g.bw / 2;

  /* Đống bi trong các ô. Toạ độ tính riêng cho từng ô: x từ vách trái, y là độ cao so với đáy.
     Bi đã nằm yên được giữ nguyên tại chỗ nó dừng (xs/ys) và đưa vào lưới ô vuông để dò va chạm nhanh.
     Bi không đổi cỡ. Khi ô đông nhất sắp đầy, mỗi viên vẽ ra sẽ thay cho `unit` bi (2, 5, 10, 20, ...)
     và cả đống được xếp lại cho gọn. */
  function pileHeight(g, d, count) { return count * 0.7854 * d * d / (PACK * g.bw); }
  function gridAdd(P, k, i) {
    const gx = Math.min(P.gc - 1, Math.max(0, Math.floor(P.xs[k][i] / P.d)));
    const gy = Math.min(P.gr - 1, Math.max(0, Math.floor(P.ys[k][i] / P.d)));
    (P.grid[k][gy * P.gc + gx] || (P.grid[k][gy * P.gc + gx] = [])).push(i);
  }
  function regrid(P) {
    const g = P.geo;
    P.gc = Math.ceil(g.bw / P.d) + 1;
    P.gr = Math.ceil((g.maxH + 60) / P.d) + 1;
    P.grid = [];
    for (let k = 0; k <= g.n; k++) {
      P.grid.push(new Array(P.gc * P.gr));
      for (let i = 0; i < P.xs[k].length; i++) gridAdd(P, k, i);
    }
  }
  function ensurePile() {
    const g = G.geo || geom();
    const M = G.n || 1;
    let peak = 0;
    for (let k = 0; k <= g.n; k++) peak = Math.max(peak, G.bins[k], M * G.pmf[k]);
    // bi luôn giữ nguyên cỡ; mức L càng cao thì mỗi viên đại diện cho càng nhiều bi: 1, 2, 5, 10, 20, 50, ...
    const spec = (L) => ({ d: g.dMax, unit: L ? [2, 5, 10][(L - 1) % 3] * Math.pow(10, Math.floor((L - 1) / 3)) : 1 });
    let L = 0, sp = spec(0);
    while (pileHeight(g, sp.d, peak * 1.12 / sp.unit) > g.maxH) sp = spec(++L);
    let P = G.pile;
    if (P && !P.stale && P.geo === g) {
      // đống thật có thể nhô cao hơn ước lượng (bi dồn ở giữa ô): cũng phải lên mức
      if (L <= P.L && P.maxY > g.maxH + 12) L = P.L + 1;
      if (L <= P.L) return P;
      sp = spec(L);
    }
    // dựng lại (lúc đầu, khi lên mức, khi thả tức thời): xếp so le gọn gàng theo số bi của từng ô
    const d = sp.d, unit = sp.unit;
    P = G.pile = { geo: g, L, d, unit, stale: false, xs: [], ys: [], grid: null, gc: 0, gr: 0, maxY: 0 };
    for (let k = 0; k <= g.n; k++) {
      const xs = [], ys = [];
      {
        const cols = Math.max(1, Math.floor(g.bw / d - 0.5)), inset = (g.bw - (cols + 0.5) * d) / 2;
        const shown = Math.floor(G.bins[k] / unit);
        for (let i = 0; i < shown; i++) {
          const row = Math.floor(i / cols);
          xs.push(inset + (i % cols + (row & 1) * 0.5 + 0.5) * d);
          ys.push(d / 2 + row * d * 0.866);
          P.maxY = Math.max(P.maxY, ys[i]);
        }
      }
      P.xs.push(xs); P.ys.push(ys);
    }
    regrid(P);
    return P;
  }

  // Ghi nhận một điểm tựa có pháp tuyến (nx, ny) hướng từ vật đỡ sang bi.
  // Bi chỉ nằm yên được khi có lực nâng lên (up) và bị chặn cả bên trái (sl) lẫn bên phải (sr),
  // hoặc đứng ngay trên đỉnh một viên khác (mid) và có một bên chặn.
  function support(b, nx, ny) {
    if (ny > 0.05) b.up = true;
    if (ny > -0.3) { if (nx > 0.1) b.sl = true; else if (nx < -0.1) b.sr = true; else if (ny > 0) b.mid = true; }
  }
  const atRest = (b) => b.up && (b.sl && b.sr || b.mid && (b.sl || b.sr));
  // Vách và đáy ô. Vách chặn bi từ một phía, đáy đỡ hoàn toàn.
  function walls(b, g, r, vStop) {
    if (b.x <= r) { b.x = r; b.sl = true; if (b.vx < 0) b.vx = b.vx < -vStop ? -BOUNCE * b.vx : 0; }
    else if (b.x >= g.bw - r) { b.x = g.bw - r; b.sr = true; if (b.vx > 0) b.vx = b.vx > vStop ? -BOUNCE * b.vx : 0; }
    if (b.y <= r) {
      b.y = r; b.sl = b.sr = b.up = true;
      if (b.vy < 0) b.vy = b.vy < -vStop ? -BOUNCE * b.vy : 0;
      b.vx *= 0.97;
    }
  }
  // Độ lún sâu nhất của bi vào các bi đã nằm yên (0 = không chồng lên viên nào).
  function overlap(P, k, x, y) {
    const d = P.d, xs = P.xs[k], ys = P.ys[k], grid = P.grid[k];
    const gx = Math.floor(x / d), gy = Math.floor(y / d);
    let worst = 0;
    for (let cy = Math.max(0, gy - 1); cy <= Math.min(P.gr - 1, gy + 1); cy++) {
      for (let cx = Math.max(0, gx - 1); cx <= Math.min(P.gc - 1, gx + 1); cx++) {
        const cell = grid[cy * P.gc + cx];
        if (cell) for (const i of cell) worst = Math.max(worst, d - Math.hypot(x - xs[i], y - ys[i]));
      }
    }
    return worst;
  }

  // Một bước vật lý cho các bi đang chuyển động trong cùng một ô.
  function binStep(P, k, list, h, grav) {
    const g = P.geo, d = P.d, r = d / 2, d2 = d * d;
    const xs = P.xs[k], ys = P.ys[k], grid = P.grid[k], gc = P.gc, gr = P.gr;
    const vStop = grav * 0.004;                  // chạm nhẹ hơn mức này thì không nảy lại
    for (const b of list) {
      b.vy -= grav * h; b.x += b.vx * h; b.y += b.vy * h;
      // va vào bi đã nằm yên
      const gx = Math.floor(b.x / d), gy = Math.floor(b.y / d);
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(gr - 1, gy + 1); cy++) {
        for (let cx = Math.max(0, gx - 1); cx <= Math.min(gc - 1, gx + 1); cx++) {
          const cell = grid[cy * gc + cx];
          if (!cell) continue;
          for (let q = 0; q < cell.length; q++) {
            const i = cell[q];
            let nx = b.x - xs[i], ny = b.y - ys[i];
            const dist2 = nx * nx + ny * ny;
            if (dist2 >= d2) continue;
            const dist = Math.sqrt(dist2);
            if (dist < 1e-6) { nx = 0; ny = 1; } else { nx /= dist; ny /= dist; }
            b.x = xs[i] + nx * d; b.y = ys[i] + ny * d;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              const e = vn < -vStop ? BOUNCE : 0;
              b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
            }
            b.vx *= 0.995; b.vy *= 0.995;        // ma sát lăn
            // bi bên dưới đỡ từ phía trái (nx > 0) hay phía phải (nx < 0)
            support(b, nx, ny);
          }
        }
      }
      walls(b, g, r, vStop);
    }
    // bi đang chuyển động va vào nhau (hai bi cùng khối lượng)
    if (list.length < 2) return;
    for (let a = 0; a < list.length; a++) {
      const A = list[a];
      for (let c = a + 1; c < list.length; c++) {
        const B = list[c];
        let nx = B.x - A.x, ny = B.y - A.y;
        if (nx > d || nx < -d || ny > d || ny < -d) continue;
        const dist2 = nx * nx + ny * ny;
        if (dist2 >= d2) continue;
        const dist = Math.sqrt(dist2);
        if (dist < 1e-6) { nx = 1; ny = 0; } else { nx /= dist; ny /= dist; }
        const push = (d - dist) / 2;
        A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
        walls(A, g, r, vStop); walls(B, g, r, vStop);
        // viên nằm trên được viên nằm dưới đỡ
        support(B, nx, ny); support(A, -nx, -ny);
        const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (vn < 0) {
          const imp = (1 + (vn < -vStop ? BOUNCE : 0)) * vn / 2;
          A.vx += imp * nx; A.vy += imp * ny; B.vx -= imp * nx; B.vy -= imp * ny;
        }
      }
    }
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
    if (!G.balls.length) return;

    const F = G_FALL[sp], n = G.rows;
    let P = ensurePile();
    const g = P.geo, br = Math.max(1.5, P.d / 2);
    const grav = 4.4 * g.sy * F * F;

    // qua các hàng đinh: mỗi đinh hất bi sang phải với xác suất p
    const inBin = new Map();
    let vmax = 0;
    for (const b of G.balls) {
      if (b.st === 0) {
        b.t += F * dt;
        if (b.t < n) continue;
        // rời hàng đinh cuối: mang theo vận tốc của cú nảy cuối cùng vào ô
        b.st = 1; b.k = b.R[n]; b.age = 0; b.calm = 0;
        b.x = g.bw / 2;
        b.y = g.base - (g.top + n * g.sy - g.pr - br);
        b.vx = (b.R[n] > b.R[n - 1] ? 1 : -1) * g.sx / 2 * F * (0.5 + Math.random());
        b.vy = -3.2 * g.sy * F;
      }
      b.sl = b.sr = b.up = b.mid = false;
      vmax = Math.max(vmax, Math.abs(b.vy) + grav * dt, Math.abs(b.vx));
      const l = inBin.get(b.k);
      l ? l.push(b) : inBin.set(b.k, [b]);
    }

    if (inBin.size) {
      // chia nhỏ bước thời gian để bi không xuyên qua nhau
      const sub = Math.max(4, Math.min(30, Math.ceil(vmax * dt / (0.35 * P.d))));
      const h = dt / sub;
      for (let s = 0; s < sub; s++) for (const [k, list] of inBin) binStep(P, k, list, h, grav);
      // bi nằm yên trên đáy hoặc trên bi khác đủ lâu thì nhập vào đống
      const vth2 = Math.pow(grav * 0.035, 2);      // khoảng hai khung hình gia tốc trọng trường
      for (const b of G.balls) if (b.st === 1) {
        b.age += dt * F;
        // chỉ dừng khi được đỡ cả hai bên (nằm trong khe), nếu không bi còn lăn tiếp
        b.calm = atRest(b) && b.vx * b.vx + b.vy * b.vy < vth2 ? b.calm + 1 : 0;
        if (b.calm >= 4 || b.age > 80) {
          if (overlap(P, b.k, b.x, b.y) > P.d * 0.12) {
            // bị kẹt lún vào đống: đưa lên trên mặt đống cho rơi lại
            b.calm = 0; b.age = 0; b.y = P.maxY + P.d * 1.5; b.vx = (Math.random() - 0.5) * P.d * F; b.vy = 0;
            continue;
          }
          b.st = 2;
          if (!b.counted) land(b.k);
          if (P.xs[b.k].length >= Math.floor(G.bins[b.k] / P.unit)) continue;   // đống vừa được xếp lại, đã có viên này
          P.maxY = Math.max(P.maxY, b.y);
          P.xs[b.k].push(b.x); P.ys[b.k].push(b.y);
          gridAdd(P, b.k, P.xs[b.k].length - 1);
        } else if (P.unit > 1 && !b.counted && b.up) {
          // mỗi viên thay cho `unit` bi: bi được tính ngay khi chạm đống, chỉ viên tròn đủ `unit` mới ở lại
          b.counted = true; land(b.k);
          if (Math.floor(G.bins[b.k] / P.unit) <= P.xs[b.k].length) b.st = 2;
        }
      }
    }
    let keep = 0;
    for (const b of G.balls) if (b.st !== 2) G.balls[keep++] = b;
    G.balls.length = keep;
    G.dirty = true;
  }

  function drawGalton(c) {
    const { ctx, w } = fit(cvG);
    const P = ensurePile(), g = P.geo;
    const { n, padX, sx, cx, pr, top, binTop, sy, base, bw } = g;
    const d = P.d;
    const hOf = (count) => pileHeight(g, d, count / P.unit);   // chiều cao đống bi ứng với `count` viên
    const br = Math.max(1.5, d / 2);                  // bán kính bi đang rơi
    const dpr = cvG.width / w;
    const M = G.n || 1;

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

    // bi đã nằm yên trong từng ô
    ctx.font = '10px ' + c.font; ctx.textAlign = 'center';
    const labelStep = sx < 17 ? 2 : 1;
    ctx.fillStyle = c.accent;
    const img = d >= 3.5 ? ballSprite(d / 2, c.accent, dpr) : null;
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const left = binLeft(g, k);
      const xs = P.xs[k], ys = P.ys[k];
      for (let i = 0; i < xs.length; i++) {
        const x = left + xs[i] - d / 2, y = base - ys[i] - d / 2;
        if (img) ctx.drawImage(img, x, y, d, d);
        else ctx.rect(x + 0.3, y + 0.3, d - 0.6, d - 0.6);
      }
    }
    ctx.fill();
    // dưới mỗi ô: số bi trong ô (đậm), rồi số thứ tự ô (nhạt)
    ctx.textBaseline = 'top';
    const counts = G.bins.map((v) => int(v));
    let fs = 11;
    const widest = () => { ctx.font = '600 ' + fs + 'px ' + c.font; return Math.max(...counts.map((t) => ctx.measureText(t).width)); };
    while (fs > 7 && widest() > sx - 3) fs--;
    const countStep = widest() > sx - 3 ? 2 : 1;      // vẫn chật thì chỉ ghi các ô cách một
    ctx.fillStyle = c.ink;
    for (let k = 0; k <= n; k += countStep) ctx.fillText(counts[k], cx + (k - n / 2) * sx, base + 6);
    ctx.font = '10px ' + c.font; ctx.fillStyle = c.muted;
    for (let k = 0; k <= n; k += labelStep) ctx.fillText(String(k), cx + (k - n / 2) * sx, base + 21);

    if (P.unit > 1) {
      ctx.font = '600 12px ' + c.font; ctx.fillStyle = c.ink; ctx.textAlign = 'left';
      ctx.fillText('1 viên = ' + int(P.unit) + ' bi', padX, 10);
      ctx.textAlign = 'center';
    }

    // xấp xỉ chuẩn
    const mu = n * G.p, sigma = Math.sqrt(n * G.p * (1 - G.p));
    if (G.showNormal) {
    ctx.save();
    ctx.beginPath(); ctx.rect(padX, binTop, w - 2 * padX, base - binTop); ctx.clip();
    ctx.strokeStyle = c.hit; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const u = -0.5 + (n + 1) * i / steps;
      const val = M * Math.exp(-((u - mu) * (u - mu)) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
      const x = cx + (u - n / 2) * sx, y = base - hOf(val);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    }

    // bi đang chuyển động
    if (G.balls.length) {
      const off = pr + br;
      const fimg = ballSprite(br, c.accent, dpr);
      for (const b of G.balls) {
        let x, y;
        if (b.st) { x = binLeft(g, b.k) + b.x; y = base - b.y; }
        else if (b.t < 0) { const s = b.t + 1; x = cx; y = top - sy + sy * s * s - off; }
        else {
          const k = Math.min(n - 1, Math.floor(b.t)), s = b.t - k;
          const x0 = cx + (b.R[k] - k / 2) * sx, x1 = cx + (b.R[k + 1] - (k + 1) / 2) * sx;
          x = x0 + (x1 - x0) * s;
          y = top + k * sy + sy * (2.2 * s * s - 1.2 * s) - off;
        }
        ctx.drawImage(fimg, x - br, y - br, br * 2, br * 2);
      }
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
    } else {
      $('g-mean').textContent = '—'; $('g-sd').textContent = '—';
    }
    // bảng so sánh từng ô: số bi thật và số bi dự đoán theo công thức nhị thức
    const body = $('g-table-body');
    while (body.rows.length > n + 1) body.deleteRow(-1);
    while (body.rows.length < n + 1) {
      const tr = body.insertRow();
      tr.insertCell().textContent = String(body.rows.length - 1);
      tr.insertCell(); tr.insertCell();
    }
    for (let k = 0; k <= n; k++) {
      const cells = body.rows[k].cells;
      cells[1].textContent = int(G.bins[k]);
      cells[2].textContent = int(Math.round(G.n * G.pmf[k]));
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
  // Ô đánh dấu ở chú thích bật tắt đường xấp xỉ chuẩn.
  const readShow = () => { G.showNormal = $('g-show-normal').checked; G.dirty = true; };
  $('g-show-normal').addEventListener('change', readShow);

  /* ───────────── Vòng lặp ───────────── */
  watch([cvG], () => { G.geo = null; G.dirty = true; });

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
  gSpeedOut(); gRowsOut(); gPOut(); readShow();
  resetG();
  dropInstant(500);
  requestAnimationFrame(frame);
})();
