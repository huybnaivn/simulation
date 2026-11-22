(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const int = (v) => v.toLocaleString('vi-VN');
  const dec = (v, d) => v.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v) => dec(v * 100, 1) + '%';
  const rand = (n) => Math.floor(Math.random() * n);

  function palette() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    return {
      panel: g('--panel'), ink: g('--ink'), muted: g('--muted'), line: g('--line'),
      accent: g('--accent'), hit: g('--hit'), font: g('--font-data') || 'monospace',
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


  /* ───────────── Monty Hall ───────────── */
  const RATE = [1, 4, 15, 80, 500];        // ván / giây khi chạy tự động
  const HIST_MAX = 1500;                   // số điểm tối đa của mỗi đường trên đồ thị
  /* Ván đang hiện trên dãy cửa. Cửa đánh số từ 0.
     phase: 'pick' chờ chọn cửa, 'decide' người dẫn đã mở dê và chờ giữ/đổi, 'done' đã mở hết.
     car = cửa có ô tô, pick = cửa chọn lúc đầu, opened[i] = 1 nếu người dẫn đã mở cửa i,
     final = cửa chốt cuối cùng, auto = ván do máy chơi (không chạy hiệu ứng mở cửa). */
  const G = { phase: 'pick', car: 0, pick: -1, opened: null, final: -1, auto: false };
  /* Số liệu từng chiến lược: n ván, w ván thắng, hist = các điểm [số ván, tỉ lệ thắng] để vẽ đồ thị,
     stride = cứ bao nhiêu ván thì ghi một điểm (tăng gấp đôi mỗi khi hist đầy). */
  const T = { sw: null, st: null };
  const S = { n: 3, k: 1, strat: 'alt', flip: false, running: false, acc: 0, dirty: true, doorsDirty: true };
  const cv = $('m-chart');
  const doorsEl = $('m-doors');

  function reset() {
    T.sw = { n: 0, w: 0, hist: [], stride: 1 };
    T.st = { n: 0, w: 0, hist: [], stride: 1 };
    S.flip = false; S.acc = 0;
    buildDoors();
    newGame();
  }

  function newGame() {
    G.phase = 'pick'; G.car = rand(S.n); G.pick = -1; G.opened = new Uint8Array(S.n); G.final = -1; G.auto = false;
    S.doorsDirty = true; S.dirty = true;
  }

  // Người dẫn mở ngẫu nhiên k cửa dê trong số các cửa người chơi không chọn.
  function hostOpens(car, pick) {
    const cand = [];
    for (let i = 0; i < S.n; i++) if (i !== car && i !== pick) cand.push(i);
    const opened = new Uint8Array(S.n);
    for (let j = 0; j < S.k; j++) {
      const r = j + rand(cand.length - j);
      const d = cand[r]; cand[r] = cand[j];
      opened[d] = 1;
    }
    return opened;
  }

  // Đổi cửa: lấy ngẫu nhiên một cửa còn đóng khác cửa đã chọn (có n − k − 1 cửa như vậy).
  function randomOther() {
    let r = rand(S.n - S.k - 1);
    for (let i = 0; i < S.n; i++) if (i !== G.pick && !G.opened[i] && r-- === 0) return i;
    return -1;
  }

  function record(switched, won) {
    const t = switched ? T.sw : T.st;
    t.n++; if (won) t.w++;
    if (t.n % t.stride === 0) {
      t.hist.push([t.n, t.w / t.n]);
      if (t.hist.length > HIST_MAX) { t.hist = t.hist.filter((_, i) => i % 2 === 1); t.stride *= 2; }
    }
    S.dirty = true;
  }

  // Máy chơi trọn một ván theo chiến lược đang chọn và để kết quả lại trên dãy cửa.
  function autoGame() {
    const switched = S.strat === 'alt' ? (S.flip = !S.flip) : S.strat === 'sw';
    G.car = rand(S.n); G.pick = rand(S.n); G.opened = hostOpens(G.car, G.pick);
    G.final = switched ? randomOther() : G.pick;
    G.phase = 'done'; G.auto = true;
    record(switched, G.final === G.car);
    S.doorsDirty = true;
  }

  function choose(i) {
    if (S.running) return;
    if (G.phase === 'pick') {
      G.pick = i; G.opened = hostOpens(G.car, i); G.phase = 'decide';
    } else if (G.phase === 'decide' && !G.opened[i]) {
      G.final = i; G.phase = 'done';
      record(i !== G.pick, i === G.car);
    } else return;
    S.doorsDirty = true;
  }

  function buildDoors() {
    doorsEl.textContent = '';
    doorsEl.style.setProperty('--cols', Math.min(S.n, 5));
    doorsEl.classList.toggle('many', S.n > 10);          // nhiều cửa: cửa nhỏ, tự xuống hàng theo bề rộng
    for (let i = 0; i < S.n; i++) {
      const b = document.createElement('button');
      b.className = 'door';
      b.innerHTML = '<span class="behind" aria-hidden="true"></span><span class="leaf" aria-hidden="true"><span class="num">' + (i + 1) + '</span></span><span class="tag" aria-hidden="true"></span>';
      b.addEventListener('click', () => choose(i));
      doorsEl.appendChild(b);
    }
  }

  function renderDoors() {
    const done = G.phase === 'done', decide = G.phase === 'decide';
    doorsEl.classList.toggle('fast', G.auto);
    [...doorsEl.children].forEach((b, i) => {
      const open = done || (decide && G.opened[i] === 1);
      const car = i === G.car;
      const mine = done ? i === G.final : i === G.pick;
      b.classList.toggle('open', open);
      b.classList.toggle('picked', mine);
      b.classList.toggle('win', done && mine && car);
      b.classList.toggle('lose', done && mine && !car);
      b.classList.toggle('idle', S.running || done || (decide && open));
      b.querySelector('.behind').textContent = open ? (car ? '🚗' : '🐐') : '';
      b.querySelector('.tag').textContent = mine ? (done ? 'Chốt' : 'Bạn chọn') : '';
      b.setAttribute('aria-label', 'Cửa ' + (i + 1) + (open ? (car ? ', đã mở: ô tô' : ', đã mở: dê') : ', đang đóng') + (mine ? ', cửa của bạn' : ''));
    });

    const p = G.pick + 1, f = G.final + 1, c = G.car + 1;
    const left = S.n - S.k - 1;                         // số cửa còn đóng ngoài cửa đã chọn
    const o = decide && left === 1 ? randomOther() + 1 : 0;
    let msg;
    if (G.phase === 'pick') msg = 'Chọn một cánh cửa. Sau một cửa là ô tô, sau các cửa còn lại là dê.';
    else if (decide) msg = 'Bạn chọn cửa ' + p + '. Người dẫn mở ' + (S.k === 1 ? 'một cửa khác' : int(S.k) + ' cửa khác') + ': toàn dê. Giữ cửa ' + p
      + (left === 1 ? ' hay đổi sang cửa ' + o + '?' : ' hay đổi sang một trong ' + int(left) + ' cửa còn đóng? Bấm vào cửa bạn muốn.');
    else {
      const switched = G.final !== G.pick, won = G.final === G.car;
      msg = (G.auto ? 'Ván gần nhất: máy chọn cửa ' + p + ', rồi ' : 'Bạn ') + (switched ? 'đổi sang cửa ' + f : 'giữ cửa ' + f)
        + (won ? ' và trúng ô tô.' : ' và gặp dê. Ô tô ở cửa ' + c + '.');
    }
    $('m-status').textContent = msg;
    $('m-stay').hidden = $('m-switch').hidden = !decide;
    $('m-stay').textContent = 'Giữ cửa ' + p;
    $('m-switch').textContent = left === 1 ? 'Đổi sang cửa ' + o : 'Đổi ngẫu nhiên';
    $('m-next').hidden = !done || S.running;
  }

  const theorySwitch = () => (S.n - 1) / (S.n * (S.n - S.k - 1));

  function renderStats() {
    const rate = (t) => (t.n ? pct(t.w / t.n) : '—');
    $('m-rate').textContent = rate(T.sw);
    $('m-sub').textContent = 'Khi giữ cửa: ' + rate(T.st);
    $('m-sw-n').textContent = int(T.sw.n); $('m-sw-w').textContent = int(T.sw.w); $('m-sw-r').textContent = rate(T.sw);
    $('m-st-n').textContent = int(T.st.n); $('m-st-w').textContent = int(T.st.w); $('m-st-r').textContent = rate(T.st);
    $('m-total').textContent = int(T.sw.n + T.st.n);
    $('m-th-sw').textContent = pct(theorySwitch());
    $('m-th-st').textContent = pct(1 / S.n);
  }

  function drawChart() {
    const { ctx, w, h } = fit(cv);
    const P = palette();
    const L = 44, R = 12, Tp = 12, B = 24;
    const pw = w - L - R, ph = h - Tp - B;
    const maxN = Math.max(20, T.sw.n, T.st.n);
    const X = (n) => L + (n / maxN) * pw;
    const Y = (r) => Tp + (1 - r) * ph;

    ctx.font = '11px ' + P.font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const r of [0, 0.5, 1]) {
      ctx.strokeStyle = P.line; ctx.beginPath(); ctx.moveTo(L, Y(r) + 0.5); ctx.lineTo(w - R, Y(r) + 0.5); ctx.stroke();
      ctx.fillStyle = P.muted; ctx.textAlign = 'right'; ctx.fillText(r * 100 + '%', L - 8, Y(r));
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText('0', L, h - B + 7);
    ctx.textAlign = 'right'; ctx.fillText(int(maxN) + ' ván', w - R, h - B + 7);

    const series = [[T.sw, P.accent, theorySwitch()], [T.st, P.hit, 1 / S.n]];
    for (const [t, color, theory] of series) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(L, Y(theory)); ctx.lineTo(w - R, Y(theory)); ctx.stroke();
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      if (!t.n) continue;
      ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      t.hist.forEach(([n, r], i) => (i ? ctx.lineTo(X(n), Y(r)) : ctx.moveTo(X(n), Y(r))));
      const now = t.w / t.n;
      if (t.hist.length) ctx.lineTo(X(t.n), Y(now)); else ctx.moveTo(X(t.n), Y(now));
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(t.n), Y(now), 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function setRunning(on) {
    S.running = on; S.acc = 0;
    $('m-play').setAttribute('aria-pressed', on);
    $('m-play').textContent = on ? 'Tạm dừng' : 'Chạy tự động';
    S.doorsDirty = true;
  }

  function batch(k) {
    setRunning(false);
    for (let i = 0; i < k; i++) autoGame();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.running) {
      S.acc += dt * RATE[$('m-speed').value - 1];
      while (S.acc >= 1) { S.acc -= 1; autoGame(); }
    }
    if (S.doorsDirty) { S.doorsDirty = false; renderDoors(); }
    if (S.dirty) { S.dirty = false; renderStats(); drawChart(); }
    requestAnimationFrame(frame);
  }

  $('m-play').addEventListener('click', () => setRunning(!S.running));
  $('m-1').addEventListener('click', () => batch(1));
  $('m-100').addEventListener('click', () => batch(100));
  $('m-10k').addEventListener('click', () => batch(10000));
  $('m-reset').addEventListener('click', () => { setRunning(false); reset(); });
  $('m-stay').addEventListener('click', () => choose(G.pick));
  $('m-switch').addEventListener('click', () => choose(randomOther()));
  $('m-next').addEventListener('click', newGame);

  $('m-strat').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-strat]');
    if (!b) return;
    S.strat = b.dataset.strat;
    for (const x of $('m-strat').children) x.setAttribute('aria-pressed', x === b);
  });

  const SPEED = ['Rất chậm', 'Chậm', 'Vừa', 'Nhanh', 'Rất nhanh'];
  const syncSpeed = () => { $('m-speed-out').textContent = SPEED[$('m-speed').value - 1]; };
  $('m-speed').addEventListener('input', syncSpeed);
  // Đổi n thì k trở về n − 2 (chỉ chừa lại một cửa, như bài toán gốc).
  function syncDoors(resetK) {
    S.n = +$('m-n').value;
    const k = $('m-k');
    k.max = S.n - 2; k.disabled = S.n === 3;
    if (resetK) k.value = S.n - 2;
    S.k = +k.value;
    $('m-n-out').textContent = S.n;
    $('m-k-out').textContent = S.k;
  }
  $('m-n').addEventListener('input', () => { syncDoors(true); setRunning(false); reset(); });
  $('m-k').addEventListener('input', () => { syncDoors(false); setRunning(false); reset(); });

  syncSpeed();
  syncDoors(true);
  watch([cv], () => { S.dirty = true; });
  reset();
  requestAnimationFrame(frame);
})();
