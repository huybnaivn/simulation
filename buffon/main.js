(() => {
  'use strict';
  const { $, int, dec, reduceMotion, palette, fit, bindPlay, watch } = Sim;

  /* ───────────── Kim Buffon ───────────── */
  const ROWS = 5;            // số dải ván giữa các vạch
  const FLOOR_W = 9;         // bề ngang vùng rơi, đơn vị d
  const MAX_DRAWN = 2500;
  const MAX_FLYING = 350;
  const B_RATE = [2, 10, 50, 300, 3000];   // kim / giây
  const B = { ratio: 1, n: 0, hits: 0, slots: [], ptr: 0, flying: [], recent: [], keep: 20, hist: [], nextCp: 1, running: false, acc: 0, dirty: true };
  const cvB = $('b-canvas'), cvC = $('b-conv'), cv3 = $('b-3d');
  let V = null;              // cảnh 3D (null nếu không có WebGL)

  function resetB() {
    B.n = 0; B.hits = 0; B.slots = new Array(MAX_DRAWN).fill(null); B.ptr = 0; B.flying = []; B.recent = [];
    B.hist = []; B.nextCp = 1; B.acc = 0; B.dirty = true;
    if (V) V.clear();
  }

  function count(hit) {
    B.n++;
    if (hit) B.hits++;
    if (B.n >= B.nextCp) {
      if (B.hits > 0) B.hist.push([B.n, 2 * B.ratio * B.n / B.hits]);
      B.nextCp = Math.max(B.nextCp + 1, Math.ceil(B.nextCp * 1.04));
    }
  }
  function settle(nd) {
    nd.landed = true; nd.hidden = false;
    count(nd.hit);
    if (V) V.setLanded(nd);
    B.recent.push(nd);
    if (B.recent.length > MAX_DRAWN) B.recent.shift();
    const o = B.recent[B.recent.length - B.keep - 1];   // cây vừa trượt khỏi nhóm "gần nhất"
    if (o && B.slots[o.slot] === o) { o.hidden = true; if (V) V.hide(o); }
  }
  // Bàn chỉ hiện B.keep kim rơi gần nhất. Kim bị ẩn vẫn được tính trong N và H.
  function setKeep(k) {
    B.keep = k;
    const cut = B.recent.length - k;
    B.recent.forEach((nd, i) => {
      if (B.slots[nd.slot] !== nd) return;
      const h = i < cut;
      if (h !== !!nd.hidden) { nd.hidden = h; if (V) { if (h) V.hide(nd); else V.setLanded(nd); } }
    });
    B.dirty = true;
  }

  // Vị trí và góc rơi được rút ngẫu nhiên đều trước; đường bay 3D chỉ là hoạt cảnh dẫn tới tư thế đó,
  // nên thống kê không phụ thuộc vào cách tung.
  // from = { x, y, z, dx, dz }: điểm buông tay và quãng bay thêm khi ném. Kim văng quanh điểm đến trong đúng
  // ±1 d theo chiều cắt vạch và được gập lại ở mép bàn (mép trùng vạch), nên kim luôn nằm trên bàn và vị trí
  // so với vạch vẫn phân phối đều dù buông hay ném thế nào.
  const fold = (v, L) => { v = ((v % (2 * L)) + 2 * L) % (2 * L); return v > L ? 2 * L - v : v; };
  function throwNeedles(k, animate, from) {
    animate = !!animate && !!V && !reduceMotion;
    const half = B.ratio / 2;
    for (let i = 0; i < k; i++) {
      let xN = Math.random();
      let y = Math.random() * ROWS;            // tâm kim, đơn vị d
      if (from) {
        const spread = k > 1 ? 1.2 : 0.35;
        xN = fold(from.x + from.dx + FLOOR_W / 2 + (Math.random() * 2 - 1) * spread, FLOOR_W) / FLOOR_W;
        y = fold(from.z + from.dz + ROWS / 2 + (Math.random() * 2 - 1), ROWS);
      }
      const th = Math.random() * Math.PI;      // góc nghiêng
      const dy = Math.sin(th) * half;
      const hit = Math.floor(y - dy) !== Math.floor(y + dy);
      if (k - i > MAX_DRAWN) { count(hit); continue; }
      const nd = { x: xN, y, th, hit, landed: false, slot: B.ptr };
      const old = B.slots[B.ptr];
      if (old && !old.landed) { old.landed = true; count(old.hit); }
      B.slots[B.ptr] = nd;
      B.ptr = (B.ptr + 1) % MAX_DRAWN;
      if (animate && B.flying.length < MAX_FLYING) {
        const phi = Math.random() * Math.PI * 2;
        nd.t = k > 1 ? -Math.random() * 0.35 : 0;
        nd.dur = 0.95 + Math.random() * 0.5;
        nd.ox = (Math.random() - 0.5) * 1.2; nd.oz = (Math.random() - 0.5) * 1.2;
        nd.oy = 3 + Math.random() * 1.2;
        nd.v0 = Math.random() * 1.6;
        nd.hb = 0.1 + Math.random() * 0.16;
        nd.ax = Math.cos(phi); nd.ay = (Math.random() - 0.5) * 0.6; nd.az = Math.sin(phi);
        nd.A = 8 + Math.random() * 10;
        if (from) {
          nd.t = k > 1 ? -Math.random() * 0.25 : 0;
          const far = Math.hypot(from.dx, from.dz);
          nd.dur = 0.7 + far * 0.06 + Math.random() * 0.3;
          nd.ox = from.x + (Math.random() - 0.5) * 0.3; nd.oz = from.z + (Math.random() - 0.5) * 0.3;
          nd.oy = from.y; nd.v0 = 0.2 + far * 0.4;
        }
        B.flying.push(nd);
        V.setFlying(nd);
      } else settle(nd);
    }
    B.dirty = true;
  }

  function stepFlight(dt) {
    let keep = 0;
    for (const nd of B.flying) {
      if (nd.landed || B.slots[nd.slot] !== nd) continue;
      nd.t += dt;
      if (nd.t >= nd.dur) { settle(nd); continue; }
      if (nd.t >= 0) V.setPose(nd, nd.t / nd.dur);
      B.flying[keep++] = nd;
    }
    B.flying.length = keep;
    B.dirty = true;
  }

  function initView3D() {
    const T = window.THREE;
    if (!T) return null;
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas: cv3, antialias: true }); } catch (e) { return null; }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const scene = new T.Scene();
    const FOV = 48;
    const camera = new T.PerspectiveCamera(FOV, 1.6, 0.5, 80);
    scene.add(new T.AmbientLight(0xffffff, 0.5));
    const sun = new T.DirectionalLight(0xffffff, 0.65);
    sun.position.set(-6, 8.4, 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.01;
    const sc = sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30;
    scene.add(sun);

    // Sàn là một tấm ván dày: mỗi dải ván là một khối hộp, khe giữa hai ván chính là vạch kẻ.
    const SLAB = 0.32, GAP = 0.06;
    const box = (wd, ht, dp, mat, y, z) => {
      const m = new T.Mesh(new T.BoxGeometry(wd, ht, dp), mat);
      m.position.set(0, y, z); m.receiveShadow = true; m.castShadow = true;
      scene.add(m);
    };
    const floorMat = new T.MeshLambertMaterial();
    const plankMat = new T.MeshLambertMaterial();
    const lineMat = new T.MeshBasicMaterial();
    const groundMat = new T.MeshLambertMaterial();
    const ground = new T.Mesh(new T.PlaneGeometry(80, 80), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -SLAB; ground.receiveShadow = true;
    scene.add(ground);
    box(FLOOR_W + 1 - 0.02, SLAB - 0.03, ROWS + 1 - 2 * GAP, lineMat, -SLAB / 2 - 0.005, 0);
    for (let k = -1; k <= ROWS; k++) {
      const z0 = Math.max(k, -0.5) + GAP / 2, z1 = Math.min(k + 1, ROWS + 0.5) - GAP / 2;
      box(FLOOR_W + 1, SLAB, z1 - z0, k % 2 === 0 ? plankMat : floorMat, -SLAB / 2, (z0 + z1) / 2 - ROWS / 2);
    }

    // Kim thon nhọn một đầu, bóng kim loại.
    const R = 0.032;
    const needleMat = new T.MeshPhongMaterial({ color: 0xffffff, specular: 0x777777, shininess: 70 });
    const mesh = new T.InstancedMesh(new T.CylinderGeometry(R * 0.2, R, 1, 12), needleMat, MAX_DRAWN);
    mesh.castShadow = true; mesh.frustumCulled = false;
    scene.add(mesh);

    const cHit = new T.Color(), cMiss = new T.Color(), cFly = new T.Color();
    const UP = new T.Vector3(0, 1, 0), dir = new T.Vector3(), pos = new T.Vector3(), scl = new T.Vector3();
    const axis = new T.Vector3(), qF = new T.Quaternion(), qT = new T.Quaternion(), m4 = new T.Matrix4();
    const ZERO = new T.Matrix4().makeScale(0, 0, 0);
    let touched = true, themeKey = '';

    function clear() {
      for (let i = 0; i < MAX_DRAWN; i++) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, cFly); }
      touched = true;
    }
    function finalQuat(nd) { dir.set(Math.cos(nd.th), 0, Math.sin(nd.th)); return qF.setFromUnitVectors(UP, dir); }
    const fx = (nd) => nd.x * FLOOR_W - FLOOR_W / 2;
    const fz = (nd) => nd.y - ROWS / 2;
    function setLanded(nd) {
      finalQuat(nd);
      m4.compose(pos.set(fx(nd), R, fz(nd)), qF, scl.set(1, B.ratio, 1));
      mesh.setMatrixAt(nd.slot, m4);
      mesh.setColorAt(nd.slot, nd.hit ? cHit : cMiss);
      touched = true;
    }
    function hide(nd) { mesh.setMatrixAt(nd.slot, ZERO); touched = true; }
    function setFlying(nd) {
      mesh.setMatrixAt(nd.slot, ZERO);
      mesh.setColorAt(nd.slot, cFly);
      touched = true;
    }
    function setPose(nd, u) {
      const p = 1 - Math.pow(1 - u, 1.6);
      let y;
      if (u < 0.8) { const s = u / 0.8; y = nd.oy * (1 - s * s) + nd.v0 * s * (1 - s); }
      else { const s = (u - 0.8) / 0.2; y = nd.hb * 4 * s * (1 - s); }
      finalQuat(nd);
      qT.setFromAxisAngle(axis.set(nd.ax, nd.ay, nd.az).normalize(), nd.A * Math.pow(1 - u, 1.5));
      qT.multiply(qF);
      dir.copy(UP).applyQuaternion(qT);
      y = Math.max(y + R, Math.abs(dir.y) * B.ratio / 2 + R);   // đầu kim không chui xuống sàn
      pos.set(nd.ox + (fx(nd) - nd.ox) * p, y, nd.oz + (fz(nd) - nd.oz) * p);
      m4.compose(pos, qT, scl.set(1, B.ratio, 1));
      mesh.setMatrixAt(nd.slot, m4);
      touched = true;
    }

    // Bàn cố định: máy quay không xoay.
    // Chỉ có hai góc nhìn đặt sẵn: thẳng đứng từ trên xuống và nghiêng nhẹ.
    const az = 0, POL_TOP = 0.02, POL_TILT = 0.5;
    let pol = POL_TILT, polT = POL_TILT;
    const viewBtns = { top: $('b-view-top'), tilt: $('b-view-tilt') };
    const setView = (name) => {
      polT = name === 'top' ? POL_TOP : POL_TILT;
      viewBtns.top.setAttribute('aria-pressed', String(name === 'top'));
      viewBtns.tilt.setAttribute('aria-pressed', String(name === 'tilt'));
    };
    viewBtns.top.addEventListener('click', () => setView('top'));
    viewBtns.tilt.addEventListener('click', () => setView('tilt'));

    // Kim cầm trên tay: chọn trong khay, nhấn giữ trên bàn, kéo đi, rồi buông (thả) hoặc vung (ném).
    const HOLD_Y = 1.0, HEADROOM = 0.5;
    const heldMat = new T.MeshPhongMaterial({ specular: 0x777777, shininess: 70 });
    const held = new T.Group();
    held.visible = false;
    for (let i = 0; i < 6; i++) {
      const m = new T.Mesh(mesh.geometry, heldMat);
      m.castShadow = true;
      if (i === 0) m.rotation.set(0.5, 0, 1.1);
      else {
        m.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.5);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      }
      held.add(m);
    }
    scene.add(held);
    const ray = new T.Raycaster(), ndc = new T.Vector2(), hitPt = new T.Vector3();
    const floorPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
    let hold = null;

    function pointAt(e) {
      const r = cv3.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(floorPlane, hitPt);
    }
    function beginHold(n, src) {
      hold = { n, src, ok: false, samples: [] };
      held.children.forEach((m, i) => { m.visible = i < n; m.scale.set(1, B.ratio, 1); });
    }
    function moveHold(e) {
      const p = pointAt(e);
      hold.ok = !!p;
      if (p) {
        held.position.set(clamp(p.x, FLOOR_W / 2), HOLD_Y, clamp(p.z, ROWS / 2));   // tay không ra khỏi mặt bàn
        hold.samples.push([performance.now(), held.position.x, held.position.z]);
        while (hold.samples.length > 60 || hold.samples[hold.samples.length - 1][0] - hold.samples[0][0] > 250) hold.samples.shift();
      }
      held.visible = hold.ok || hold.src === 'floor';
      B.dirty = true;
    }
    function releaseHold() {
      const h = hold;
      hold = null; held.visible = false; B.dirty = true;
      // Vận tốc tay lúc buông (đơn vị d / giây) quyết định kim rơi tại chỗ hay bay đi.
      let dx = 0, dz = 0;
      const s = h.samples;
      if (s.length >= 2) {
        const last = s[s.length - 1];
        // Lấy đoạn nhanh nhất trong 0,2 giây cuối, để tay chậm lại ngay trước khi buông vẫn tính là ném.
        if (performance.now() - last[0] < 150) {
          let best = 0;
          for (const q of s) {
            const dt = (last[0] - q[0]) / 1000;
            if (dt < 0.03 || dt > 0.2) continue;
            const vx = (last[1] - q[1]) / dt, vz = (last[2] - q[2]) / dt, v = Math.hypot(vx, vz);
            if (v > best) { best = v; dx = vx * 0.6; dz = vz * 0.6; }
          }
          const len = Math.hypot(dx, dz);
          if (len < 0.4) { dx = 0; dz = 0; }
          else if (len > 9) { dx *= 9 / len; dz *= 9 / len; }
        }
      }
      throwNeedles(h.n, true, { x: held.position.x, y: HOLD_Y, z: held.position.z, dx, dz });
    }

    // Khay kim là bộ chọn: 1 kim hoặc 10 kim. Mọi thao tác kéo, thả, ném diễn ra trên bàn.
    let tool = '1';
    const trayBtns = Array.from(document.querySelectorAll('#b-tray .tray-item'));
    const setTool = (t) => {
      tool = t;
      trayBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
      cv3.style.cursor = 'grab';
    };
    trayBtns.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    setTool('1');

    cv3.addEventListener('pointerdown', (e) => {
      if (hold) return;
      const p = pointAt(e);
      if (!p) return;
      beginHold(+tool, 'floor');
      e.preventDefault();
      moveHold(e);
      cv3.style.cursor = 'grabbing';
      try { cv3.setPointerCapture(e.pointerId); } catch (err) {}
    });
    cv3.addEventListener('pointermove', (e) => {
      if (hold) moveHold(e);
    });
    const endFloor = () => {                 // kim đang cầm luôn quay lại bàn
      if (!hold) return;
      releaseHold();
      cv3.style.cursor = 'grab';
    };
    cv3.addEventListener('pointerup', endFloor);
    cv3.addEventListener('pointercancel', endFloor);

    function tick(dt) {
      if (hold && held.visible) { held.rotation.y += dt * 1.6; B.dirty = true; }
      if (Math.abs(polT - pol) > 1e-3) {
        pol += (polT - pol) * (reduceMotion ? 1 : Math.min(1, dt * 7));
        B.dirty = true;
      }
    }

    function render(c) {
      const key = c.ink + c.panel + c.hit;
      if (key !== themeKey) {
        themeKey = key;
        renderer.setClearColor(new T.Color(c.bg), 1);
        floorMat.color.set(c.panel); plankMat.color.set(c.plank); lineMat.color.set(c.ink); groundMat.color.set(c.bg);
        cHit.set(c.hit); cMiss.set(c.muted); cFly.set(c.ink); heldMat.color.set(c.accent);
        for (let i = 0; i < MAX_DRAWN; i++) {
          const nd = B.slots[i];
          mesh.setColorAt(i, !nd || !nd.landed ? cFly : nd.hit ? cHit : cMiss);
        }
        touched = true;
      }
      if (touched) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        touched = false;
      }
      const r = cv3.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      const tan = Math.tan(FOV * Math.PI / 360);
      const dist = Math.max((FLOOR_W / 2 + 1) / (tan * (w / h)), (ROWS / 2 + 1) / tan) * 1.2;
      camera.aspect = w / h;
      camera.position.set(dist * Math.sin(pol) * Math.sin(az), dist * Math.cos(pol), dist * Math.sin(pol) * Math.cos(az));
      // Dời tâm ngắm về phía máy quay để nửa sàn gần không tràn khỏi khung.
      const tx = Math.sin(az) * Math.sin(pol) * 1.3, tz = Math.cos(az) * Math.sin(pol) * 1.3;
      camera.position.x += tx; camera.position.z += tz;
      camera.lookAt(tx, 0, tz);
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      // Cắt khung hình vừa khít quanh bàn (kèm một khoảng trống phía trên cho kim đang cầm), để bàn chiếm trọn khung.
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [-SLAB, HEADROOM]) {
        pos.set(sx * (FLOOR_W + 1) / 2, y, sz * (ROWS + 1) / 2).project(camera);
        if (y < 0) { x0 = Math.min(x0, pos.x); x1 = Math.max(x1, pos.x); }   // bề ngang chỉ tính theo mặt bàn
        y0 = Math.min(y0, pos.y); y1 = Math.max(y1, pos.y);
      }
      const half = Math.max((x1 - x0) / 2, (y1 - y0) / 2) * 1.03;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      camera.setViewOffset(w, h, (mx - half + 1) / 2 * w, (1 - (my + half)) / 2 * h, half * w, half * h);
      renderer.render(scene, camera);
    }

    clear();
    return { clear, setLanded, hide, setFlying, setPose, tick, render };
  }

  function drawBuffon(c) {
    const { ctx, w, h } = fit(cvB);
    const d = h / (ROWS + 1), pad = d / 2;
    ctx.fillStyle = c.plank;
    for (let k = 0; k < ROWS; k += 2) ctx.fillRect(0, pad + k * d, w, d);
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.75;
    ctx.beginPath();
    for (let k = 0; k <= ROWS; k++) { const y = Math.round(pad + k * d) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    const L = B.ratio * d / 2;
    const landed = B.slots.filter((nd) => nd && nd.landed && !nd.hidden);
    const few = landed.length < 400;
    ctx.lineCap = 'round';
    ctx.lineWidth = few ? 1.8 : 1.2;
    for (const pass of [false, true]) {
      ctx.strokeStyle = pass ? c.hit : c.muted;
      ctx.globalAlpha = pass ? 0.95 : (few ? 0.8 : 0.5);
      ctx.beginPath();
      for (const nd of landed) {
        if (nd.hit !== pass) continue;
        const cx = pad + nd.x * (w - 2 * pad), cy = pad + nd.y * d;
        const ax = Math.cos(nd.th) * L, ay = Math.sin(nd.th) * L;
        ctx.moveTo(cx - ax, cy - ay); ctx.lineTo(cx + ax, cy + ay);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawConv(c) {
    const { ctx, w, h } = fit(cvC);
    const m = { l: 40, r: 26, t: 12, b: 26 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const nMax = Math.max(100, B.n);
    const lmax = Math.log10(nMax);
    const Y0 = 2.4, Y1 = 3.9;
    const X = (n) => m.l + Math.log10(Math.max(1, n)) / lmax * pw;
    const Y = (v) => m.t + (Y1 - v) / (Y1 - Y0) * ph;

    ctx.font = '11px ' + c.font;
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line; ctx.fillStyle = c.muted;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [2.5, 3.0, 3.5]) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.fillText(dec(v, 1), m.l - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const stepK = lmax > 5 && w < 520 ? 2 : 1;
    for (let k = 0; k <= Math.floor(lmax + 1e-9); k += stepK) {
      const x = Math.round(X(Math.pow(10, k))) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
      ctx.fillText(int(Math.pow(10, k)), x, m.t + ph + 6);
    }

    // đường π
    const yPi = Y(Math.PI);
    ctx.strokeStyle = c.hit; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, yPi); ctx.lineTo(m.l + pw, yPi); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.hit; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px ' + c.font;
    ctx.fillText('π', m.l + pw + 7, yPi);

    // đường ước lượng
    const pts = B.hist.slice();
    if (B.hits > 0) pts.push([B.n, 2 * B.ratio * B.n / B.hits]);
    if (pts.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
      ctx.strokeStyle = c.accent; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([n, v], i) => { const x = X(n), y = Y(Math.max(0, Math.min(8, v))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      const [ln, lv] = pts[pts.length - 1];
      ctx.fillStyle = c.accent;
      ctx.beginPath(); ctx.arc(X(ln), Y(Math.max(Y0, Math.min(Y1, lv))), 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function statsB() {
    $('b-n').textContent = int(B.n);
    $('b-h').textContent = int(B.hits);
    $('b-freq').textContent = B.n ? dec(B.hits / B.n, 4) : '—';
    $('b-theory').textContent = dec(2 * B.ratio / Math.PI, 4);
    if (B.hits > 0) {
      const est = 2 * B.ratio * B.n / B.hits;
      const err = est - Math.PI;
      $('b-pi').textContent = dec(est, 5);
      $('b-err').textContent = 'Lệch ' + (err >= 0 ? '+' : '−') + dec(Math.abs(err), 5) + ' (' + dec(Math.abs(err) / Math.PI * 100, 2) + '%)';
    } else {
      $('b-pi').textContent = '—';
      $('b-err').textContent = 'Chưa có kim nào cắt vạch';
    }
  }

  bindPlay($('b-play'), B);
  $('b-1').addEventListener('click', () => throwNeedles(1, true));
  $('b-100').addEventListener('click', () => throwNeedles(100, true));
  $('b-10k').addEventListener('click', () => throwNeedles(10000, false));
  $('b-reset').addEventListener('click', resetB);
  const readKeep = () => Math.max(0, Math.min(MAX_DRAWN, parseInt($('b-keep').value, 10) || 0));
  $('b-keep').addEventListener('input', () => setKeep(readKeep()));
  const bSpeedOut = () => { $('b-speed-out').textContent = int(B_RATE[$('b-speed').value - 1]) + ' kim/giây'; };
  $('b-speed').addEventListener('input', bSpeedOut);
  const bRatioOut = () => { $('b-ratio-out').textContent = dec(+$('b-ratio').value, 2); };
  $('b-ratio').addEventListener('input', () => { B.ratio = +$('b-ratio').value; bRatioOut(); resetB(); });

  /* ───────────── Vòng lặp ───────────── */
  watch([cvB, cv3, cvC], () => { B.dirty = true; });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (B.running) {
      B.acc += dt * B_RATE[$('b-speed').value - 1];
      const k = Math.floor(B.acc);
      if (k > 0) { B.acc -= k; throwNeedles(k, true); }
    }
    if (B.flying.length) stepFlight(dt);
    if (V) V.tick(dt);
    if (B.dirty) {
      const c = palette();
      if (V) V.render(c); else drawBuffon(c);
      drawConv(c); statsB(); B.dirty = false;
    }
    requestAnimationFrame(frame);
  }

  // Đồng bộ thanh trượt (trình duyệt có thể khôi phục giá trị cũ), rồi mở đầu bằng một lượt thả sẵn.
  B.keep = readKeep(); B.ratio = +$('b-ratio').value;
  bSpeedOut(); bRatioOut();
  V = initView3D();
  $('b-wrap').hidden = !V; $('b-viewbar').hidden = !V; cvB.hidden = !!V;
  resetB();
  throwNeedles(300, false);
  requestAnimationFrame(frame);
})();
