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
  function insideFrame(p) { return p.every(([x, y]) => x >= 0 && x <= N && y >= 0 && y <= N); }
  // Tổng diện tích luôn là 144, nên nằm trọn trong khung và không chồng nhau thì chắc chắn phủ kín.
  function isSolved(polys) {
    if (!polys.every(insideFrame)) return false;
    for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (overlaps(polys[i], polys[j])) return false;
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
  // Toạ độ tính theo ô lưới, gốc là góc trên trái của khung vuông. Khay chứa mảnh nằm cạnh (hoặc dưới) khung.
  const LAYOUTS = {
    land: { x0: -1.5, y0: -3, x1: 30.5, y1: 15, tray: [14, -2, 30, 14] },
    port: { x0: -2, y0: -1.5, x1: 14, y1: 28.5, tray: [-1, 14, 13, 28] },
  };
  const SAMPLES = 48;                      // lưới điểm thử để ước lượng phần đã phủ
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
  };

  const layout = () => LAYOUTS[S.portrait ? 'port' : 'land'];
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
  function showSolution(v) {
    const from = snapshot();
    S.variant = v;
    S.pieces.forEach((p, i) => { p.pts = variantPts(i, v); });
    S.sel = -1; S.viewing = true;
    startAnim(from);
    afterChange();
  }
  // Chọn cách xếp đang khớp nhiều mảnh nhất với bàn hiện tại rồi đặt thêm một mảnh vào đúng chỗ.
  function hint() {
    let bestV = S.variant, bestN = -1;
    for (let k = 0; k < VARIANTS; k++) {
      const v = (S.variant + k) % VARIANTS;
      let n = 0;
      S.pieces.forEach((p, i) => { if (samePoly(p.pts, variantPts(i, v))) n++; });
      if (n > bestN) { bestN = n; bestV = v; }
    }
    S.variant = bestV;
    const todo = S.pieces.map((p, i) => i).filter((i) => !samePoly(S.pieces[i].pts, variantPts(i, bestV)));
    if (!todo.length) return;
    // Ưu tiên mảnh lớn trước cho dễ hình dung.
    todo.sort((a, b) => S.pieces[b].area - S.pieces[a].area);
    const id = todo[0], from = snapshot();
    S.pieces[id].pts = variantPts(id, bestV);
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
    const polys = S.pieces.map((p) => p.pts);
    S.solved = isSolved(polys);
    let cover = 0, over = 0;
    const near = polys.filter((p) => { const b = bbox(p); return b.x1 > 0 && b.x0 < N && b.y1 > 0 && b.y0 < N; });
    // Điểm thử lệch khỏi mọi đường lưới và đường chéo để không rơi đúng lên cạnh mảnh.
    for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) {
      const x = (i + 0.37) * N / SAMPLES, y = (j + 0.61) * N / SAMPLES;
      let c = 0;
      for (const p of near) if (contains(p, x, y) && ++c > 1) break;
      if (c > 0) cover++;
      if (c > 1) over++;
    }
    const total = SAMPLES * SAMPLES;
    let pc = Math.round(cover / total * 100), po = Math.round(over / total * 100);
    if (S.solved) { pc = 100; po = 0; } else if (pc === 100) pc = 99;
    const inside = polys.filter(insideFrame).length;
    $('s-cover').textContent = pc + '%';
    $('s-sub').textContent = S.solved ? '144 / 144 ô' : `khoảng ${int(Math.round(cover / total * 144))} / 144 ô`;
    $('s-over').textContent = po + '%';
    $('s-in').textContent = `${inside} / ${polys.length}`;
    $('s-moves').textContent = int(S.moves);
    const st = $('s-status');
    st.classList.toggle('done', S.solved);
    if (S.solved && S.viewing) st.textContent = `Cách xếp ${S.variant + 1}/${VARIANTS}${S.variant === 0 ? ' (lời giải gốc của Archimedes)' : ''}. Bấm Xáo trộn để tự thử.`;
    else if (S.solved) st.textContent = `Hoàn thành! 14 mảnh đã ghép kín hình vuông sau ${int(S.moves)} lần di chuyển.`;
    else if (inside === polys.length) st.textContent = 'Cả 14 mảnh đã ở trong khung nhưng còn chồng lên nhau.';
    else st.textContent = 'Kéo các mảnh vào khung để ghép kín hình vuông 12 × 12.';
    updateSelection();
    S.dirty = true;
  }


  /* ───────────── Vẽ ───────────── */
  function computeView(w, h) {
    const portrait = h > w * 1.1;
    if (S.portrait !== portrait) {
      const first = S.portrait === null;
      S.portrait = portrait;
      if (!first) {
        // Đổi bố cục ngang/dọc: giữ các mảnh đang nằm trong khung, rải lại phần còn lại vào khay mới.
        const out = S.pieces.map((_, i) => i).filter((i) => !insideFrame(S.pieces[i].pts));
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

    // Khung vuông
    ctx.fillStyle = pal.plank;
    ctx.fillRect(X(0), Y(0), N * unit, N * unit);
    if (S.showGrid) {
      ctx.strokeStyle = pal.line; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < N; i++) {
        const a = Math.round(X(i)) + 0.5, b = Math.round(Y(i)) + 0.5;
        ctx.moveTo(a, Y(0)); ctx.lineTo(a, Y(N));
        ctx.moveTo(X(0), b); ctx.lineTo(X(N), b);
      }
      ctx.stroke();
      ctx.fillStyle = pal.line;
      const d = Math.max(1.5, unit * 0.07);
      for (let x = Math.ceil(L.x0); x <= Math.floor(L.x1); x++) for (let y = Math.ceil(L.y0); y <= Math.floor(L.y1); y++) {
        if (x >= 0 && x <= N && y >= 0 && y <= N) continue;
        ctx.fillRect(X(x) - d / 2, Y(y) - d / 2, d, d);
      }
    }
    ctx.strokeStyle = S.solved ? pal.accent : pal.muted;
    ctx.lineWidth = 2;
    ctx.strokeRect(X(0), Y(0), N * unit, N * unit);

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
  $('s-grid').addEventListener('change', (e) => { S.showGrid = e.target.checked; S.dirty = true; });
  $('s-labels').addEventListener('change', (e) => { S.showLabels = e.target.checked; S.dirty = true; });

  // Khởi động: bày lời giải gốc để người xem thấy hình vuông hoàn chỉnh trước khi xáo trộn.
  buildTable();
  {
    const r = cv.getBoundingClientRect();
    S.portrait = r.height > r.width * 1.1;
  }
  S.viewing = true;
  afterChange();
  watch([cv], () => { S.dirty = true; });

  function frame(now) {
    if (S.dirty || S.anim) { S.dirty = false; draw(now); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
