(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const int = (v) => v.toLocaleString('vi-VN');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function palette() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    const panel = g('--panel');
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(panel);
    const dark = m ? (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3 < 128 : false;
    return {
      bg: g('--bg'), panel, plank: g('--plank'), ink: g('--ink'), muted: g('--muted'),
      line: g('--line'), accent: g('--accent'), hit: g('--hit'),
      font: g('--font-data') || 'monospace', dark,
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


  /* ───────────── Hình học (toàn số nguyên) ───────────── */
  /* geo:start */
  const N = 12;                            // cạnh hình vuông tính theo ô lưới
  // 14 mảnh theo cách chia của Archimedes, trục y hướng lên như hình vẽ quen thuộc.
  // Nửa trái (7 mảnh đầu) và nửa phải (7 mảnh sau) đều là hình chữ nhật 6 × 12.
  const BASE = [
    [[0, 0], [2, 10], [0, 12]],
    [[0, 0], [4, 8], [2, 10]],
    [[0, 12], [4, 8], [6, 12]],
    [[0, 0], [3, 0], [2, 4]],
    [[3, 0], [3, 6], [2, 4]],
    [[3, 0], [6, 0], [6, 6], [4, 8], [3, 6]],
    [[4, 8], [6, 6], [6, 12]],
    [[6, 0], [8, 4], [6, 6]],
    [[6, 6], [8, 4], [9, 6], [6, 12]],
    [[6, 0], [12, 0], [8, 4]],
    [[8, 4], [12, 0], [9, 6]],
    [[9, 6], [12, 0], [12, 6]],
    [[9, 6], [12, 6], [12, 8]],
    [[6, 12], [9, 6], [12, 8], [12, 12]],
  ].map((p) => p.map(([x, y]) => [x, N - y]));   // sang toạ độ màn hình (y hướng xuống)
  const HALF = 7;
  const VARIANTS = 32;

  function area2(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s);
  }
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function boundaryPoints(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += gcd(b[0] - a[0], b[1] - a[1]); }
    return s;
  }
  function bbox(p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  }
  // Hai đa giác lồi có phần trong giao nhau không (chạm cạnh không tính). Dùng trục tách.
  function overlaps(a, b) {
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const nx = p[1] - q[1], ny = q[0] - p[0];
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const v of a) { const d = v[0] * nx + v[1] * ny; if (d < a0) a0 = d; if (d > a1) a1 = d; }
        for (const v of b) { const d = v[0] * nx + v[1] * ny; if (d < b0) b0 = d; if (d > b1) b1 = d; }
        if (a1 <= b0 || b1 <= a0) return false;
      }
    }
    return true;
  }
  function contains(p, x, y) {
    let sign = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (c !== 0) { const s = c > 0 ? 1 : -1; if (sign && s !== sign) return false; sign = s; }
    }
    return true;
  }
  // Cách xếp thứ v: lật dọc / lật ngang từng nửa (2 bit mỗi nửa) rồi có thể đổi chỗ hai nửa (bit 4).
  function variantPts(i, v) {
    const left = i < HALF, x0 = left ? 0 : 6;
    const bits = left ? v & 3 : (v >> 2) & 3, swap = (v >> 4) & 1;
    return BASE[i].map(([x, y]) => {
      if (bits & 1) y = N - y;
      if (bits & 2) x = 2 * x0 + 6 - x;
      if (swap) x += left ? 6 : -6;
      return [x, y];
    });
  }
  function samePoly(a, b) {
    const key = (p) => p.map((v) => v[0] + ',' + v[1]).sort().join(';');
    return key(a) === key(b);
  }
  /* geo:end */

  function distToPoly(p, x, y) {
    if (contains(p, x, y)) return 0;
    let best = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return best;
  }


  /* ───────────── Trạng thái ───────────── */
  // Hình con vật: toạ độ đích của từng mảnh (cùng thứ tự đỉnh với BASE), góc trên trái của hình là (0, 0).
  const ANIMALS = [
    { name: 'Thiên nga', polys: [[[0,12],[10,14],[12,12]],[[0,12],[8,16],[10,14]],[[12,12],[8,16],[12,18]],[[0,12],[3,12],[2,8]],[[3,12],[3,6],[2,8]],[[21,12],[24,12],[24,6],[22,4],[21,6]],[[22,4],[24,6],[24,0]],[[6,12],[10,10],[12,12]],[[12,12],[10,10],[12,9],[18,12]],[[24,6],[24,0],[28,4]],[[28,4],[24,0],[30,3]],[[18,15],[24,12],[18,12]],[[18,15],[18,12],[16,12]],[[12,18],[18,15],[16,12],[12,12]]] },
    { name: 'Vịt', polys: [[[18,9],[8,11],[6,9]],[[18,9],[10,13],[8,11]],[[6,9],[10,13],[6,15]],[[6,0],[6,3],[2,2]],[[6,3],[0,3],[2,2]],[[3,3],[6,3],[6,9],[4,11],[3,9]],[[4,11],[6,9],[6,15]],[[6,9],[10,7],[12,9]],[[12,9],[10,7],[12,6],[18,9]],[[18,15],[18,9],[22,13]],[[22,13],[18,9],[24,12]],[[12,12],[6,15],[12,15]],[[12,12],[12,15],[14,15]],[[18,9],[12,12],[14,15],[18,15]]] },
    { name: 'Voi', polys: [[[18,3],[8,5],[6,3]],[[18,3],[10,7],[8,5]],[[6,3],[10,7],[6,9]],[[18,3],[18,6],[14,5]],[[18,6],[12,6],[14,5]],[[18,6],[18,9],[12,9],[10,7],[12,6]],[[10,7],[12,9],[6,9]],[[0,15],[2,11],[0,9]],[[0,9],[2,11],[3,9],[0,3]],[[6,6],[6,0],[2,4]],[[2,4],[6,0],[0,3]],[[15,9],[18,15],[18,9]],[[18,6],[18,3],[20,3]],[[12,9],[9,15],[6,13],[6,9]]] },
    { name: 'Cá', polys: [[[0,6],[10,4],[12,6]],[[0,6],[8,2],[10,4]],[[12,6],[8,2],[12,0]],[[12,12],[12,9],[8,10]],[[12,9],[6,9],[8,10]],[[12,9],[12,6],[6,6],[4,8],[6,9]],[[4,8],[6,6],[0,6]],[[27,12],[25,8],[27,6]],[[27,6],[25,8],[24,6],[27,0]],[[12,6],[18,6],[14,10]],[[14,10],[18,6],[15,12]],[[18,3],[24,6],[18,6]],[[18,3],[18,6],[16,6]],[[12,0],[18,3],[16,6],[12,6]]] },
    { name: 'Thỏ', polys: [[[18,12],[8,14],[6,12]],[[18,12],[10,16],[8,14]],[[6,12],[10,16],[6,18]],[[21,18],[18,18],[19,14]],[[18,18],[18,12],[19,14]],[[9,12],[6,12],[6,6],[8,4],[9,6]],[[8,4],[6,6],[6,0]],[[9,12],[11,8],[9,6]],[[9,6],[11,8],[12,6],[9,0]],[[6,15],[6,9],[2,13]],[[2,13],[6,9],[0,12]],[[12,15],[6,18],[12,18]],[[12,15],[12,18],[14,18]],[[18,12],[12,15],[14,18],[18,18]]] },
    { name: 'Chó', polys: [[[21,6],[11,8],[9,6]],[[21,6],[13,10],[11,8]],[[9,6],[13,10],[9,12]],[[18,12],[21,12],[20,16]],[[21,12],[21,18],[20,16]],[[9,6],[6,6],[6,12],[8,14],[9,12]],[[8,14],[6,12],[6,18]],[[21,12],[23,8],[21,6]],[[21,6],[23,8],[24,6],[21,0]],[[6,9],[6,3],[2,7]],[[2,7],[6,3],[0,6]],[[15,9],[9,12],[15,12]],[[15,9],[15,12],[17,12]],[[21,6],[15,9],[17,12],[21,12]]] },
    { name: 'Hươu cao cổ', polys: [[[18,14],[8,16],[6,14]],[[18,14],[10,18],[8,16]],[[6,14],[10,18],[6,20]],[[15,20],[18,20],[17,24]],[[18,20],[18,26],[17,24]],[[9,14],[6,14],[6,8],[8,6],[9,8]],[[8,6],[6,8],[6,2]],[[18,20],[14,18],[12,20]],[[12,20],[14,18],[12,17],[6,20]],[[18,20],[18,14],[14,18]],[[14,18],[18,14],[12,17]],[[9,20],[6,26],[6,20]],[[3,2],[6,2],[6,0]],[[0,2],[3,8],[6,6],[6,2]]] },
  ];

  const STEP = 0.25;                       // khoảng cách các điểm thử để ước lượng phần đã phủ
  const ANIM_MS = 650;
  const cv = $('s-canvas');
  const S = {
    pieces: BASE.map((p) => {
      const a = area2(p) / 2, B = boundaryPoints(p);
      return { pts: p.map((v) => v.slice()), area: a, B, I: a - B / 2 + 1 };
    }),
    order: BASE.map((_, i) => i),          // thứ tự vẽ, mảnh cuối nằm trên cùng
    sel: -1, drag: null, anim: null, variant: 0, moves: 0, dirty: true,
    showGrid: true, showLabels: true, portrait: null, view: null,
    solved: false, viewing: false, dark: null,
    mode: 'square',                        // 'square' | 'free' | chỉ số trong ANIMALS
    T: null,                               // hình đích: các đa giác tạo nên bóng, kích thước, điểm thử
    L: null,                               // bố cục bàn: biên vùng làm việc và khay chứa mảnh
  };

  const isSquare = () => S.mode === 'square';
  const lower = (s) => s.toLocaleLowerCase('vi');
  // Vị trí đúng của mảnh i trong hình đích hiện tại.
  function solution(i) {
    return isSquare() ? variantPts(i, S.variant) : ANIMALS[S.mode].polys[i].map((v) => v.slice());
  }
  function makeTarget() {
    if (S.mode === 'free') return null;
    const shape = isSquare() ? [[[0, 0], [N, 0], [N, N], [0, N]]] : ANIMALS[S.mode].polys;
    let w = 0, h = 0;
    for (const p of shape) for (const [x, y] of p) { if (x > w) w = x; if (y > h) h = y; }
    // Điểm thử lệch khỏi mọi đường lưới và đường chéo để không rơi đúng lên cạnh mảnh.
    const samples = [];
    for (let i = 0; i < w / STEP; i++) for (let j = 0; j < h / STEP; j++) {
      const x = (i + 0.37) * STEP, y = (j + 0.61) * STEP;
      if (shape.some((p) => contains(p, x, y))) samples.push([x, y]);
    }
    return { shape, w, h, samples, label: isSquare() ? 'hình vuông' : 'hình ' + lower(ANIMALS[S.mode].name) };
  }
  const inTarget = (x, y) => S.T.shape.some((p) => contains(p, x, y));
  // Mảnh nằm trọn trong hình đích: thử mọi đỉnh và trung điểm cạnh (với hình vuông thì phép thử này chính xác).
  function pieceInside(p) {
    if (!S.T) return false;
    return p.every((a, n) => { const b = p[(n + 1) % p.length]; return inTarget(a[0], a[1]) && inTarget((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); });
  }
  // Toạ độ tính theo ô lưới, gốc là góc trên trái của hình đích. Khay chứa mảnh nằm cạnh (hoặc dưới) hình đích.
  function computeLayout() {
    const T = S.T;
    if (!T) return S.portrait ? { x0: -2, y0: -1.5, x1: 14, y1: 28.5, tray: [-1, -1, 13, 28] } : { x0: -1.5, y0: -3, x1: 30.5, y1: 15, tray: [-1, -2, 30, 14] };
    if (S.portrait) {
      const W = Math.max(T.w, N) + 4, x0 = -(W - T.w) / 2;
      return { x0, y0: -1.5, x1: x0 + W, y1: T.h + 16.5, tray: [Math.ceil(x0 + 0.5), T.h + 2, Math.floor(x0 + W - 0.5), T.h + 16] };
    }
    const trayW = T.w > 20 ? 13 : 16, H = Math.max(18, T.h + 3), y0 = -(H - T.h) / 2;
    return { x0: -1.5, y0, x1: T.w + 2 + trayW + 0.5, y1: y0 + H, tray: [T.w + 2, Math.ceil(y0 + 0.5), T.w + 2 + trayW, Math.floor(y0 + H - 0.5)] };
  }
  const layout = () => S.L;
  const rnd = (n) => Math.floor(Math.random() * (n + 1));
  function pieceColor(i, dark) {
    const h = Math.round(((i * 5) % 14) * 360 / 14 + 8);
    return dark ? `hsl(${h} 44% 56%)` : `hsl(${h} 56% 63%)`;
  }

  function translate(pts, dx, dy) { for (const v of pts) { v[0] += dx; v[1] += dy; } }
  function clamp(pts) {
    const L = layout(), b = bbox(pts);
    const lx = Math.ceil(L.x0), hx = Math.floor(L.x1), ly = Math.ceil(L.y0), hy = Math.floor(L.y1);
    let dx = 0, dy = 0;
    if (b.x0 < lx) dx = lx - b.x0; else if (b.x1 > hx) dx = hx - b.x1;
    if (b.y0 < ly) dy = ly - b.y0; else if (b.y1 > hy) dy = hy - b.y1;
    translate(pts, dx, dy);
  }
  function center(pts) { const b = bbox(pts); return [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)]; }
  function rotate(pts) { const [cx, cy] = center(pts); for (const v of pts) { const x = v[0], y = v[1]; v[0] = cx - (y - cy); v[1] = cy + (x - cx); } }
  function flip(pts) { const [cx] = center(pts); for (const v of pts) v[0] = 2 * cx - v[0]; }

  // Rải các mảnh vào khay, thử nhiều vị trí và chọn chỗ ít đè lên mảnh khác nhất.
  function scatter(ids, spin) {
    const T = layout().tray;
    const placed = [];
    S.pieces.forEach((p, i) => { if (!ids.includes(i)) placed.push(bbox(p.pts)); });
    ids = ids.slice().sort(() => Math.random() - 0.5);
    for (const id of ids) {
      const pts = S.pieces[id].pts;
      if (spin) { for (let k = rnd(3); k > 0; k--) rotate(pts); if (rnd(1)) flip(pts); }
      const b = bbox(pts), w = b.x1 - b.x0, h = b.y1 - b.y0;
      let best = null;
      for (let t = 0; t < 120; t++) {
        const x = T[0] + rnd(Math.max(0, T[2] - T[0] - w)), y = T[1] + rnd(Math.max(0, T[3] - T[1] - h));
        let score = 0;
        for (const o of placed) {
          const ox = Math.min(x + w, o.x1) - Math.max(x, o.x0), oy = Math.min(y + h, o.y1) - Math.max(y, o.y0);
          if (ox > 0 && oy > 0) score += ox * oy;
        }
        if (!best || score < best.score) best = { x, y, score };
        if (score === 0) break;
      }
      translate(pts, best.x - b.x0, best.y - b.y0);
      placed.push(bbox(pts));
    }
  }

  function startAnim(from) {
    S.anim = reduceMotion ? null : { from, t0: performance.now() };
  }
  const snapshot = () => S.pieces.map((p) => p.pts.map((v) => v.slice()));

  function shuffle() {
    const from = snapshot();
    scatter(S.pieces.map((_, i) => i), true);
    S.moves = 0; S.sel = -1; S.viewing = false;
    startAnim(from);
    afterChange();
  }
  function setMode(mode) {
    const from = snapshot();
    S.mode = mode; S.variant = 0;
    S.T = makeTarget(); S.L = computeLayout();
    scatter(S.pieces.map((_, i) => i), true);
    S.moves = 0; S.sel = -1; S.viewing = false;
    startAnim(from);
    afterChange();
  }
  function showSolution(v) {
    if (!S.T) return;
    const from = snapshot();
    S.variant = v;
    S.pieces.forEach((p, i) => { p.pts = solution(i); });
    S.sel = -1; S.viewing = true;
    startAnim(from);
    afterChange();
  }
  // Chọn cách xếp đang khớp nhiều mảnh nhất với bàn hiện tại rồi đặt thêm một mảnh vào đúng chỗ.
  function hint() {
    if (!S.T) return;
    let bestV = S.variant, bestN = -1;
    for (let k = 0; isSquare() && k < VARIANTS; k++) {
      const v = (S.variant + k) % VARIANTS;
      let n = 0;
      S.pieces.forEach((p, i) => { if (samePoly(p.pts, variantPts(i, v))) n++; });
      if (n > bestN) { bestN = n; bestV = v; }
    }
    S.variant = bestV;
    const todo = S.pieces.map((p, i) => i).filter((i) => !samePoly(S.pieces[i].pts, solution(i)));
    if (!todo.length) return;
    // Ưu tiên mảnh lớn trước cho dễ hình dung.
    todo.sort((a, b) => S.pieces[b].area - S.pieces[a].area);
    const id = todo[0], from = snapshot();
    S.pieces[id].pts = solution(id);
    select(id);
    S.moves++;
    startAnim(from);
    afterChange();
  }

  function select(id) {
    S.sel = id;
    if (id >= 0) { S.order.splice(S.order.indexOf(id), 1); S.order.push(id); }
    S.dirty = true;
    updateSelection();
  }
  function act(fn) {
    if (S.sel < 0) return;
    S.anim = null;
    const pts = S.pieces[S.sel].pts;
    fn(pts); clamp(pts);
    S.moves++; S.viewing = false;
    afterChange();
  }


  /* ───────────── Số đo ───────────── */
  const rows = [];
  function buildTable() {
    const body = $('s-table-body');
    S.pieces.forEach((p, i) => {
      const g = gcd(p.area, N * N);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="chip"></span>${i + 1}</td><td>${p.B}</td><td>${p.I}</td><td>${p.area}</td><td>${p.area / g}/${N * N / g}</td>`;
      tr.addEventListener('click', () => select(S.sel === i ? -1 : i));
      body.appendChild(tr);
      rows.push(tr);
    });
  }
  function updateSelection() {
    rows.forEach((tr, i) => tr.classList.toggle('sel', i === S.sel));
    $('s-rot').disabled = $('s-flip').disabled = S.sel < 0;
  }

  function afterChange() {
    const polys = S.pieces.map((p) => p.pts), T = S.T;
    const st = $('s-status');
    $('s-moves').textContent = int(S.moves);
    $('s-hint').disabled = $('s-solve').disabled = !T;
    $('s-next').disabled = !isSquare();
    updateSelection();
    S.dirty = true;
    if (!T) {
      S.solved = false;
      $('s-cover-label').textContent = 'Chế độ tự do';
      $('s-cover').textContent = '14 mảnh';
      $('s-sub').textContent = 'không có hình đích';
      $('s-over').textContent = $('s-in').textContent = '—';
      st.classList.remove('done');
      st.textContent = 'Xếp 14 mảnh thành bất kỳ hình nào bạn thích: con vật, ngôi nhà, con thuyền…';
      return;
    }
    const inside = polys.filter(pieceInside).length;
    let clean = inside === polys.length;
    for (let i = 0; clean && i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (overlaps(polys[i], polys[j])) { clean = false; break; }
    const boxes = polys.map(bbox);
    let cover = 0, over = 0;
    for (const [x, y] of T.samples) {
      let c = 0;
      for (let i = 0; i < polys.length && c < 2; i++) {
        const b = boxes[i];
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && contains(polys[i], x, y)) c++;
      }
      if (c > 0) cover++;
      if (c > 1) over++;
    }
    const total = T.samples.length;
    // Tổng diện tích luôn là 144: nằm trọn trong hình, không chồng nhau và phủ hết điểm thử thì đã ghép kín.
    S.solved = clean && cover === total;
    let pc = Math.round(cover / total * 100), po = Math.round(over / total * 100);
    if (S.solved) { pc = 100; po = 0; } else if (pc === 100) pc = 99;
    $('s-cover-label').textContent = 'Đã phủ kín ' + T.label;
    $('s-cover').textContent = pc + '%';
    $('s-sub').textContent = S.solved ? '144 / 144 ô' : `khoảng ${int(Math.round(cover / total * 144))} / 144 ô`;
    $('s-over').textContent = po + '%';
    $('s-in').textContent = `${inside} / ${polys.length}`;
    st.classList.toggle('done', S.solved);
    if (S.solved && S.viewing && isSquare()) st.textContent = `Cách xếp ${S.variant + 1}/${VARIANTS}${S.variant === 0 ? ' (lời giải gốc của Archimedes)' : ''}. Bấm Xáo trộn để tự thử.`;
    else if (S.solved && S.viewing) st.textContent = `Lời giải cho ${T.label}. Bấm Xáo trộn để tự thử.`;
    else if (S.solved) st.textContent = `Hoàn thành! 14 mảnh đã ghép kín ${T.label} sau ${int(S.moves)} lần di chuyển.`;
    else if (inside === polys.length) st.textContent = 'Cả 14 mảnh đã ở trong hình nhưng còn chồng lên nhau.';
    else if (isSquare()) st.textContent = 'Kéo các mảnh vào khung để ghép kín hình vuông 12 × 12.';
    else st.textContent = `Kéo các mảnh vào bóng để ghép thành ${T.label}.`;
  }


  /* ───────────── Vẽ ───────────── */
  function computeView(w, h) {
    const portrait = h > w * 1.1;
    if (S.portrait !== portrait) {
      const first = S.portrait === null;
      S.portrait = portrait;
      S.L = computeLayout();
      if (!first) {
        // Đổi bố cục ngang/dọc: giữ các mảnh đang nằm trong hình đích, rải lại phần còn lại vào khay mới.
        const out = S.pieces.map((_, i) => i).filter((i) => !pieceInside(S.pieces[i].pts));
        S.anim = null;
        scatter(out, false);
        afterChange();
      }
    }
    const L = layout();
    const unit = Math.min(w / (L.x1 - L.x0), h / (L.y1 - L.y0));
    S.view = {
      unit,
      ox: (w - (L.x1 - L.x0) * unit) / 2 - L.x0 * unit,
      oy: (h - (L.y1 - L.y0) * unit) / 2 - L.y0 * unit,
    };
  }

  function shownPts(i, k) {
    const p = S.pieces[i].pts;
    if (S.anim) { const f = S.anim.from[i]; return p.map((v, n) => [f[n][0] + (v[0] - f[n][0]) * k, f[n][1] + (v[1] - f[n][1]) * k]); }
    if (S.drag && S.drag.id === i) return p.map((v) => [v[0] + S.drag.dx, v[1] + S.drag.dy]);
    return p;
  }

  function draw(now) {
    const { ctx, w, h } = fit(cv);
    const pal = palette();
    computeView(w, h);
    if (S.dark !== pal.dark) { S.dark = pal.dark; rows.forEach((tr, i) => { tr.querySelector('.chip').style.background = pieceColor(i, pal.dark); }); }
    const { unit, ox, oy } = S.view, L = layout();
    const X = (x) => ox + x * unit, Y = (y) => oy + y * unit;

    let k = 1;
    if (S.anim) {
      const t = Math.min(1, (now - S.anim.t0) / ANIM_MS);
      k = 1 - Math.pow(1 - t, 3);
      if (t >= 1) S.anim = null;
    }

    // Điểm lưới trên cả bàn
    if (S.showGrid) {
      ctx.fillStyle = pal.line;
      const d = Math.max(1.5, unit * 0.07);
      for (let x = Math.ceil(L.x0); x <= Math.floor(L.x1); x++) for (let y = Math.ceil(L.y0); y <= Math.floor(L.y1); y++) ctx.fillRect(X(x) - d / 2, Y(y) - d / 2, d, d);
    }
    // Bóng của hình đích: viền ngoài, nền, rồi lưới ô vuông cắt theo bóng
    const T = S.T;
    if (T) {
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const p of T.shape) { p.forEach((v, n) => (n ? ctx.lineTo(X(v[0]), Y(v[1])) : ctx.moveTo(X(v[0]), Y(v[1])))); ctx.closePath(); }
      ctx.strokeStyle = S.solved ? pal.accent : pal.muted; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle = pal.plank; ctx.lineWidth = 1; ctx.fill(); ctx.stroke();
      if (S.showGrid) {
        ctx.save(); ctx.clip();
        ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= T.w; i++) { const a = Math.round(X(i)) + 0.5; ctx.moveTo(a, Y(0)); ctx.lineTo(a, Y(T.h)); }
        for (let i = 0; i <= T.h; i++) { const b = Math.round(Y(i)) + 0.5; ctx.moveTo(X(0), b); ctx.lineTo(X(T.w), b); }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Các mảnh
    const fs = Math.max(10, Math.min(15, unit * 0.52));
    ctx.font = `600 ${fs}px ${pal.font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const i of S.order) {
      const pts = shownPts(i, k);
      const lifted = S.drag && S.drag.id === i;
      ctx.beginPath();
      pts.forEach((v, n) => (n ? ctx.lineTo(X(v[0]), Y(v[1])) : ctx.moveTo(X(v[0]), Y(v[1]))));
      ctx.closePath();
      if (lifted) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4; }
      ctx.globalAlpha = lifted ? 0.92 : 1;
      ctx.fillStyle = pieceColor(i, pal.dark);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (lifted) ctx.restore();
      if (i === S.sel) { ctx.strokeStyle = pal.ink; ctx.lineWidth = 2.5; }
      else { ctx.strokeStyle = pal.panel; ctx.lineWidth = 1.25; }
      ctx.stroke();
      if (S.showLabels) {
        // Trọng tâm của đa giác lồi, để nhãn nằm gọn trong mảnh.
        let a = 0, cx = 0, cy = 0;
        for (let n = 0; n < pts.length; n++) {
          const p = pts[n], q = pts[(n + 1) % pts.length], c = p[0] * q[1] - q[0] * p[1];
          a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
        }
        ctx.fillStyle = '#10212A';
        ctx.fillText(String(S.pieces[i].area), X(cx / (3 * a)), Y(cy / (3 * a)) + 0.5);
      }
    }
  }


  /* ───────────── Tương tác ───────────── */
  function toWorld(e) {
    const r = cv.getBoundingClientRect(), v = S.view;
    return [(e.clientX - r.left - v.ox) / v.unit, (e.clientY - r.top - v.oy) / v.unit];
  }
  function pick(x, y, slack) {
    for (let n = S.order.length - 1; n >= 0; n--) if (contains(S.pieces[S.order[n]].pts, x, y)) return S.order[n];
    // Mảnh nhỏ khó bấm trúng bằng ngón tay: nhận cả khi bấm sát cạnh.
    let best = -1, bd = slack;
    for (let n = S.order.length - 1; n >= 0; n--) {
      const d = distToPoly(S.pieces[S.order[n]].pts, x, y);
      if (d < bd) { bd = d; best = S.order[n]; }
    }
    return best;
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!S.view || (e.pointerType === 'mouse' && e.button !== 0)) return;
    S.anim = null;
    const [x, y] = toWorld(e);
    const id = pick(x, y, e.pointerType === 'mouse' ? 0.15 : 0.7);
    select(id);
    if (id < 0) return;
    S.drag = { id, sx: x, sy: y, dx: 0, dy: 0, pointer: e.pointerId };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
    e.preventDefault();
    cv.focus({ preventScroll: true });
  });
  cv.addEventListener('pointermove', (e) => {
    if (!S.drag || S.drag.pointer !== e.pointerId) return;
    const [x, y] = toWorld(e);
    S.drag.dx = x - S.drag.sx; S.drag.dy = y - S.drag.sy;
    S.dirty = true;
  });
  function endDrag(e) {
    if (!S.drag || S.drag.pointer !== e.pointerId) return;
    const d = S.drag, pts = S.pieces[d.id].pts;
    S.drag = null;
    cv.classList.remove('dragging');
    const before = pts[0].slice();
    translate(pts, Math.round(d.dx), Math.round(d.dy));   // hít vào điểm lưới gần nhất
    clamp(pts);
    if (pts[0][0] !== before[0] || pts[0][1] !== before[1]) { S.moves++; S.viewing = false; }
    afterChange();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = toWorld(e);
    if (S.sel >= 0 && distToPoly(S.pieces[S.sel].pts, x, y) < 0.7) act(rotate);
  });
  cv.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const step = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (key === ' ') select((S.sel + 1) % S.pieces.length);
    else if (S.sel < 0) return;
    else if (step) act((pts) => translate(pts, step[0], step[1]));
    else if (key === 'r') act(rotate);
    else if (key === 'f') act(flip);
    else if (key === 'escape') select(-1);
    else return;
    e.preventDefault();
  });

  $('s-shuffle').addEventListener('click', shuffle);
  $('s-rot').addEventListener('click', () => act(rotate));
  $('s-flip').addEventListener('click', () => act(flip));
  $('s-hint').addEventListener('click', hint);
  $('s-solve').addEventListener('click', () => showSolution(S.variant));
  $('s-next').addEventListener('click', () => showSolution(S.viewing && S.solved ? (S.variant + 1) % VARIANTS : S.variant));
  const modeSel = $('s-mode');
  ANIMALS.forEach((a, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = a.name; $('s-animals').appendChild(o); });
  modeSel.value = 'square';
  modeSel.addEventListener('change', () => { const v = modeSel.value; setMode(v === 'square' || v === 'free' ? v : Number(v)); });
  $('s-grid').addEventListener('change', (e) => { S.showGrid = e.target.checked; S.dirty = true; });
  $('s-labels').addEventListener('change', (e) => { S.showLabels = e.target.checked; S.dirty = true; });

  // Khởi động: bày lời giải gốc để người xem thấy hình vuông hoàn chỉnh trước khi xáo trộn.
  buildTable();
  {
    const r = cv.getBoundingClientRect();
    S.portrait = r.height > r.width * 1.1;
  }
  S.T = makeTarget();
  S.L = computeLayout();
  S.viewing = true;
  afterChange();
  watch([cv], () => { S.dirty = true; });

  function frame(now) {
    if (S.dirty || S.anim) { S.dirty = false; draw(now); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
