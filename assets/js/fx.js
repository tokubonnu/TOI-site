/* TOI fx — 金の粒子（常時の漂い＋めくり時のバースト）。モバイル軽量設計 */
(function () {
  const canvas = document.getElementById("fx");
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobile = matchMedia("(max-width: 720px)").matches;
  const AMBIENT_N = reduced ? 0 : (mobile ? 46 : 90);
  let W = 0, H = 0, dpr = 1;
  const ambient = [];
  const bursts = [];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  function mkAmbient() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.7 + Math.random() * 2.3,
      vx: (Math.random() - 0.5) * 0.12,
      vy: -0.06 - Math.random() * 0.16,
      tw: Math.random() * Math.PI * 2,
      tws: 0.008 + Math.random() * 0.02,
    };
  }
  for (let i = 0; i < AMBIENT_N; i++) ambient.push(mkAmbient());

  /* めくった瞬間の金の飛沫 */
  window.fxBurst = function (x, y, n) {
    if (reduced) return;
    n = n || (mobile ? 26 : 44);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 3.4;
      bursts.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.8,
        r: 0.8 + Math.random() * 2.0,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
      });
    }
  };

  function tick() {
    if (W !== innerWidth || H !== innerHeight) resize();
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const p of ambient) {
      p.x += p.vx; p.y += p.vy; p.tw += p.tws;
      if (p.y < -4 || p.x < -4 || p.x > W + 4) Object.assign(p, mkAmbient(), { y: H + 4 });
      const a = 0.25 + Math.sin(p.tw) * 0.22;
      if (p.r > 1.9) {
        // 大きい粒だけ、まわりに薄いにじみ（光ってる感）
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(212,181,103,${Math.max(a, 0.04) * 0.18})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(212,181,103,${Math.max(a, 0.04)})`;
      ctx.fill();
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const p = bursts[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.045; p.vx *= 0.985;
      p.life -= p.decay;
      if (p.life <= 0) { bursts.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,196,120,${0.85 * p.life})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(tick);
  }
  if (!reduced || true) requestAnimationFrame(tick); // reducedでもバースト無しの静止粒子0なので実質軽量
})();
