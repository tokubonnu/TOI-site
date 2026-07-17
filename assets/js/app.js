/* TOI app — スプレッド進行のステートマシン */
(function () {
  "use strict";

  // 鮮度チェック：デプロイ版数がズレてたら1回だけ自動で読み直す（スマホの手動キャッシュクリア不要化 2026-07-16）
  (function () {
    const meta = document.querySelector('meta[name="toi-ver"]');
    const cur = meta ? meta.content : "dev";
    if (cur === "dev") return; // ローカル開発中は何もしない
    fetch("/version.txt?ts=" + Date.now(), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : cur))
      .then((v) => {
        v = String(v).trim();
        if (v && v !== cur && sessionStorage.getItem("toi_fresh") !== v) {
          sessionStorage.setItem("toi_fresh", v); // 読み直しは1版につき1回だけ（ループ保険）
          const u = new URL(location.href);
          u.searchParams.set("fresh", v);
          location.replace(u.href);
        }
      })
      .catch(() => {});
  })();

  const $ = (s) => document.querySelector(s);
  const home = $("#home"), stage = $("#stage");
  const table = $("#table"), slotsEl = $("#slots"), guide = $("#guide");
  const stopBtn = $("#stopBtn"), skipBtn = $("#skipBtn"), homeBtn = $("#homeBtn");
  const reading = $("#reading"), readingTitle = $("#readingTitle"), readingBody = $("#readingBody");
  const resultCards = $("#resultCards");
  const headKicker = $(".result-kicker"), headName = $(".result-name"), headDesc = $(".result-description");
  function fillHeading(kicker, name, desc) {
    headKicker.textContent = kicker;
    headName.textContent = name;
    headDesc.textContent = desc;
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const IMG = "/assets/img";
  const BACK = `${IMG}/card_back.webp`;
  const SITE = "https://toi.bibon.net";

  let CARDS = null;
  let SUMMARY = null; // 総括エンジン部品（data/summary_ja.json）
  let VOICE = null; // クロちゃん素材（決め文＋短詩＋フル解説・data/kuro_voice.json）
  let state = null; // 現在の進行

  const SPREADS = {
    today: { n: 1, title: "TODAY ─ 今日の一枚", intro: "今日のあなたに、一枚。", fan: 10,
      en: "TODAY", ja: "今日の一枚", desc: "日が変わるまで、あなたの一枚",
      pos: [["TODAY", "今日"]] },
    yesno: { n: 1, title: "YES / NO", intro: "聞きたいことを、心の中でひとつ。", fan: 10,
      en: "YES / NO", ja: "その迷いに、ひとつの返事を", desc: "1枚で、今の問いを読む",
      pos: [["YES / NO", "結果"]] },
    choice: { n: 2, title: "TWO PATHS ─ ふたつの道", intro: "ふたつの道を、心に思い描いて", fan: 12,
      en: "TWO PATHS", ja: "ふたつの道", desc: "選んだ先を、ふたつ見比べる",
      stayGuide: "左にひとつめ、右にふたつめの道を。",
      pos: [["PATH A", "ひとつめの道"], ["PATH B", "ふたつめの道"]] },
    ppf: { n: 3, title: "PAST · PRESENT · FUTURE", intro: "いまの物語を、三枚で。", fan: 12,
      en: "PAST · PRESENT · FUTURE", ja: "過去・現在・未来", desc: "3枚で、いまの物語を読む",
      pos: [["PAST", "過去", "ここまでの流れ"], ["PRESENT", "現在", "いまの立ち位置"], ["FUTURE", "未来", "このまま進んだ先"]] },
    hex: { n: 6, title: "DEEP INSIGHT ─ 深く読み解く", intro: "深く知りたいことを、ひとつ。", fan: 14,
      en: "DEEP INSIGHT", ja: "深く読み解く", desc: "6枚で、状況をぐるりと見渡す",
      pos: [["PAST", "過去", "この状況の背景"], ["PRESENT", "現在", "いまの空気"], ["NEAR FUTURE", "近い未来", "数週間先の流れ"], ["INNER SELF", "心の奥", "自分でも気づいてない本音"], ["AROUND YOU", "まわり", "周囲の人や環境の影響"], ["OUTCOME", "行き先", "この流れのたどり着く先"]],
      fields: ["past", "present", "future", "inner", "around", "outcome"] },
  };

  const YN_WORD = { yes: "YES", lean_yes: "YES 寄り", open: "五分五分", lean_no: "NO 寄り", no: "NO ─ 今はまだ" };

  /* ===== RNG ===== */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cryptoShuffle(arr) {
    const a = arr.slice();
    const buf = new Uint32Array(a.length);
    crypto.getRandomValues(buf);
    for (let i = a.length - 1; i > 0; i--) {
      const j = buf[i] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function todayCard() {
    let salt = localStorage.getItem("toi_salt");
    if (!salt) {
      salt = String(crypto.getRandomValues(new Uint32Array(1))[0]);
      localStorage.setItem("toi_salt", salt);
    }
    const d = new Date();
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}|${salt}`;
    const rng = mulberry32(xmur3(key)());
    return CARDS[Math.floor(rng() * CARDS.length)];
  }

  /* ===== util ===== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 80) : ms));
  function setGuide(text) {
    guide.classList.remove("on");
    if (text) {
      setTimeout(() => { guide.textContent = text; guide.classList.add("on"); }, 300);
    }
  }
  function cardImg(c) { return `${IMG}/cards/${c.id}.webp`; }
  function preload(src) {
    return new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = src; });
  }
  function centerY() { return innerHeight * 0.46; }
  function tableY() { return Math.min(innerHeight * 0.60, innerHeight - 220); }

  function makeCardEl() {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<div class="halo"></div><div class="card-inner">
      <div class="face back"><img src="${BACK}" alt=""></div>
      <div class="face front"></div></div>`;
    table.appendChild(el);
    return el;
  }
  function setT(el, x, y, rot, scale) {
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot || 0}deg) scale(${scale || 1})`;
  }
  function cardW() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-w")) ||
      Math.min(innerWidth * 0.21, 120);
  }

  /* ===== 画面遷移 ===== */
  function showScreen(el) {
    for (const s of [home, stage]) {
      s.classList.toggle("show", s === el);
      s.classList.remove("fading");
    }
    topBtnWatch();
  }

  /* ===== ページトップへ戻る ===== */
  const topBtn = $("#topBtn");
  function activeScroller() {
    return stage.classList.contains("show") ? reading : home;
  }
  function topBtnWatch() {
    // 閾値はスクロール可能量に応じて可変（浅い結果ページでも出る・ほぼ動かないページでは出ない）
    const el = activeScroller();
    const max = el.scrollHeight - el.clientHeight;
    const t = Math.min(240, innerHeight * 0.3, Math.max(48, max * 0.35));
    topBtn.classList.toggle("on", max > 40 && el.scrollTop > t);
  }
  home.addEventListener("scroll", topBtnWatch, { passive: true });
  reading.addEventListener("scroll", topBtnWatch, { passive: true });
  topBtn.addEventListener("click", () => {
    activeScroller().scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  });
  function resetStage() {
    table.innerHTML = "";
    slotsEl.innerHTML = "";
    reading.classList.remove("show");
    readingBody.innerHTML = "";
    readingBody.removeAttribute("data-n");
    resultCards.innerHTML = "";
    fillHeading("", "", "");
    stopBtn.classList.add("hidden");
    skipBtn.classList.add("hidden");
    setGuide("");
    reading.scrollTop = 0;
    document.querySelectorAll(".card-title").forEach((n) => n.remove());
  }

  /* ===== スクロールでふわっと出す ===== */
  let ioAlive = false; // IOは observe 直後に必ず初回コールバックが来る。来ない環境では即表示に切替
  const io = ("IntersectionObserver" in window) && !reduced
    ? new IntersectionObserver((entries) => {
        ioAlive = true;
        for (const en of entries) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        }
      }, { threshold: 0.1, rootMargin: "0px 0px -28px 0px" })
    : null;
  function revealNow(list) {
    list.forEach((el) => {
      el.classList.add("rv");
      if (!io) { el.classList.add("in"); return; }
      io.observe(el);
    });
    if (io && !ioAlive) {
      setTimeout(() => {
        if (!ioAlive) list.forEach((el) => el.classList.add("in"));
      }, 1000);
    }
  }

  /* ===== メインフロー ===== */
  async function run(spreadKey) {
    const spec = SPREADS[spreadKey];
    const token = { cancelled: false };
    // 引く札を先に確定（today はシード・他は暗号乱数）
    let drawn;
    if (spreadKey === "today") drawn = [todayCard()];
    else drawn = cryptoShuffle(CARDS).slice(0, spec.n);
    drawn.forEach((c) => preload(cardImg(c)));

    state = { spreadKey, spec, token, drawn, els: [], finished: false };
    resetStage();
    showScreen(stage);
    renderResult(); // 結果パネルは先に組んでおく（非表示のまま・カードの着地座標の測定に使う）
    skipBtn.classList.remove("hidden");

    try {
      await phaseIntro(spec, token);
      await phaseShuffle(spec, token);
      await phaseFanPick(spec, token);
      await phaseReveal(spec, token);
      finishReading(false);
    } catch (e) {
      if (e !== "skip") throw e;
      finishReading(true);
    }
  }
  const bail = (token) => { if (token.cancelled) throw "skip"; };

  async function phaseIntro(spec, token) {
    setGuide(spec.intro);
    await sleep(1900);
    bail(token);
  }

  /* --- シャッフル：楕円軌道で回す --- */
  async function phaseShuffle(spec, token) {
    /* stayGuide がある時は「最後に残る行＝一番大事な情報」方式（2026-07-17 クロ確定・TWO PATHSの左右割り当て） */
    setGuide(spec.stayGuide || "カードを、まぜています");
    const N = 12;
    const els = [];
    for (let i = 0; i < N; i++) {
      const el = makeCardEl();
      el.classList.add("orbiting");
      els.push(el);
    }
    const cw = cardW();
    const rx = Math.min(innerWidth * 0.36, 250);
    const ry = Math.min(innerHeight * 0.14, 110);
    const cy = tableY() - centerY() + (centerY() - innerHeight / 2);
    // 中心座標（tableは全画面基準・カードは50%,50%起点）
    const ox = 0, oy = tableY() - innerHeight / 2;
    let t = 0, running = true, speed = reduced ? 0 : 0.035;

    const loop = () => {
      if (!running) return;
      t += speed;
      els.forEach((el, i) => {
        const a = t + (i * Math.PI * 2) / N;
        const x = ox + Math.cos(a) * rx;
        const y = oy + Math.sin(a) * ry - Math.sin(a * 2 + i) * 8;
        setT(el, x, y, Math.sin(a + i) * 14, 0.92);
        el.style.zIndex = 21 + Math.round(Math.sin(a) * 5 + 5);
      });
      requestAnimationFrame(loop);
    };
    loop();

    await sleep(700);
    if (!token.cancelled) {
      stopBtn.classList.remove("hidden");
      if (!spec.stayGuide) setGuide("よいところで、とめてください");
      await new Promise((res) => {
        const onStop = () => { stopBtn.classList.add("hidden"); res(); };
        stopBtn.addEventListener("click", onStop, { once: true });
        token.onSkip = () => { stopBtn.removeEventListener("click", onStop); stopBtn.classList.add("hidden"); res(); };
        if (reduced) setTimeout(onStop, 400);
      });
    }
    running = false;
    els.forEach((el) => el.remove());
    bail(token);
  }

  /* --- 扇形に配って選ばせる --- */
  async function phaseFanPick(spec, token) {
    const N = spec.fan;
    const need = spec.n;
    const cw = cardW();
    const els = [];
    const oy = tableY() - innerHeight / 2;
    const arcR = Math.min(innerWidth * 0.60, 430);
    const spread = Math.min(Math.PI * 0.62, (Math.PI * 0.9 * innerWidth) / 900);

    setGuide("");
    for (let i = 0; i < N; i++) {
      const el = makeCardEl();
      const a = -spread / 2 + (spread * i) / (N - 1);
      const x = Math.sin(a) * arcR;
      const y = oy + (1 - Math.cos(a)) * arcR * 0.55 - 10;
      el.style.transition = "none";
      setT(el, 0, oy - innerHeight * 0.7, 0, 0.9); // 上から
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.style.transition = `transform 0.9s cubic-bezier(0.22,0.9,0.3,1) ${i * 70}ms, opacity 0.5s ease ${i * 70}ms`;
        el.style.opacity = "1";
        setT(el, x, y, (a * 180) / Math.PI * 0.55, 0.9);
      });
      el.dataset.fx = x; el.dataset.fy = y; el.dataset.fr = (a * 180) / Math.PI * 0.55;
      els.push(el);
    }
    await sleep(900 + N * 70);
    bail(token);
    els.forEach((el) => el.classList.add("floaty", "pickable"));
    setGuide(need === 1 ? "一枚、えらんでください" : `${["", "", "二", "三", "", "", "六"][need]}枚、えらんでください`);

    const picked = [];
    await new Promise((res) => {
      token.onSkip = () => res();
      els.forEach((el) => {
        el.addEventListener("click", function onPick() {
          if (token.cancelled || el.classList.contains("picked") || picked.length >= need) return;
          el.classList.remove("floaty", "pickable");
          el.classList.add("picked");
          const y = parseFloat(el.dataset.fy) - 26;
          el.style.transition = "transform 0.45s cubic-bezier(0.3,0,0.3,1)";
          setT(el, parseFloat(el.dataset.fx), y, parseFloat(el.dataset.fr), 0.94);
          picked.push(el);
          if (navigator.vibrate && !reduced) navigator.vibrate(8);
          if (picked.length === need) setTimeout(res, 420);
          else setGuide(`のこり ${need - picked.length} 枚`);
        });
      });
    });
    bail(token);

    // 選ばれなかった札は散って消える（ダイナミックに掃ける）
    setGuide("");
    els.filter((el) => !picked.includes(el)).forEach((el, i) => {
      const dir = parseFloat(el.dataset.fx) >= 0 ? 1 : -1;
      el.style.transition = `transform 0.8s cubic-bezier(0.5,0,0.8,0.4) ${i * 45}ms, opacity 0.7s ease ${i * 45 + 120}ms`;
      setT(el, dir * innerWidth * 0.85, parseFloat(el.dataset.fy) - 60 - Math.random() * 120, dir * 70, 0.8);
      el.style.opacity = "0";
    });
    await sleep(950);
    els.filter((el) => !picked.includes(el)).forEach((el) => el.remove());
    state.els = picked;
    bail(token);
  }

  /* --- 一枚ずつ：中央へ→めくり→ズーム→バースト→結果ページのカード位置へ --- */
  async function phaseReveal(spec, token) {
    const picked = state.els;
    const drawn = state.drawn;
    const cw = cardW();
    const zoom = Math.min(2.1, (innerHeight * 0.52) / (cw * 12 / 7));
    const rcImgs = resultCards.querySelectorAll(".rc img");

    for (let i = 0; i < picked.length; i++) {
      bail(token);
      const el = picked[i];
      const c = drawn[i];
      el.querySelector(".face.front").innerHTML = `<img src="${cardImg(c)}" alt="${c.name_en}">`;
      await preload(cardImg(c));

      // 中央へ
      el.style.zIndex = 60;
      el.style.transition = "transform 0.75s cubic-bezier(0.3,0,0.25,1)";
      setT(el, 0, centerY() - innerHeight / 2, 0, 1.06);
      await sleep(800);
      bail(token);

      // めくり＋ズーム
      el.classList.add("revealing");
      el.querySelector(".card-inner").style.transition = "transform 0.9s cubic-bezier(0.3,0,0.25,1)";
      el.classList.add("flipped");
      el.style.transition = "transform 0.9s cubic-bezier(0.3,0,0.25,1)";
      setT(el, 0, centerY() - innerHeight / 2, 0, zoom);
      await sleep(480);
      window.fxBurst && fxBurst(innerWidth / 2, centerY());
      await sleep(520);
      bail(token);

      // カード名
      const title = document.createElement("div");
      title.className = "card-title";
      title.style.top = `${centerY() + (cw * 12 / 7) * zoom * 0.5 + 30}px`;
      title.innerHTML = `<span class="t-en">${c.name_en}</span><span class="t-ja">${c.name_ja}</span>`;
      stage.appendChild(title);
      requestAnimationFrame(() => title.classList.add("on"));
      await sleep(reduced ? 200 : 1500);
      title.classList.remove("on");
      setTimeout(() => title.remove(), 700);
      bail(token);

      // 結果ページのカード位置へ「ふわーっ」と移動（結果表示と同座標＝クロスフェードで繋がる）
      const rb = rcImgs[i].getBoundingClientRect();
      const tb = table.getBoundingClientRect();
      const rh = rb.height || rb.width * 12 / 7;
      el.classList.remove("revealing");
      el.style.transition = "transform 0.9s cubic-bezier(0.35,0,0.2,1)";
      el.style.zIndex = 30;
      setT(el,
        rb.left + rb.width / 2 - (tb.left + tb.width / 2),
        rb.top + rh / 2 - (tb.top + tb.height / 2),
        0, rb.width / cw);
      await sleep(650);
    }
    await sleep(300);
  }

  /* ===== ニックネーム（端末内のみ・サーバー送信なし） ===== */
  const NICK_KEY = "toi_nick";
  function getNick() {
    try { return (localStorage.getItem(NICK_KEY) || "").trim().slice(0, 12); } catch (e) { return ""; }
  }
  function setNick(v) {
    try { v ? localStorage.setItem(NICK_KEY, v.trim().slice(0, 12)) : localStorage.removeItem(NICK_KEY); } catch (e) {}
  }
  function nickCall() { const n = getNick(); return n ? `${n}さん` : "あなた"; }

  /* ===== 総括エンジンv3（トーン軌道9型・部品はsummary_ja.json・正本=docs/summary_v3_writing_method.md） ===== */
  function buildSummary(drawn) {
    window.TOI_DEBUG = { summaryLoaded: !!SUMMARY, drawn: drawn.map((c) => c.id) };
    if (!SUMMARY) { window.TOI_DEBUG.fail = "SUMMARY未ロード"; return null; }
    const map = {};
    SUMMARY.cards.forEach((c) => (map[c.id] = c));
    const sel = drawn.map((c) => map[c.id]);
    if (sel.some((c) => !c)) { window.TOI_DEBUG.fail = "カードID不一致"; return null; }
    const pattern = SUMMARY.patterns[sel[0].tone + sel[2].tone];
    if (!pattern) { window.TOI_DEBUG.fail = "パターン不一致"; return null; }
    window.TOI_DEBUG.fail = null;
    const nick = getNick();
    const opener = SUMMARY.meta.opener.replace("{name}", nick ? `${nick}さん、` : "");
    /* 三文式＋3レール（2026-07-17確定）：現在は行き先が重い型なら影側変種、未来レールは型のfut_railで選ぶ */
    const now = sel[2].tone === "重" ? sel[1].sum_now_heavy : sel[1].sum_now_light;
    const futTpl = pattern.fut_rail === "wait" ? SUMMARY.meta.fut_wait : SUMMARY.meta.fut_see;
    const echoLines = [sel[0].sum_past, now, futTpl.replace("{x}", sel[2].sum_future)];
    return { opener, echoLines, echoTail: SUMMARY.meta.echo_tail, paras: pattern.paras, you: pattern.you, close: pattern.close };
  }
  function summaryHtml(drawn) {
    const s = buildSummary(drawn);
    if (!s) return "";
    const nickRow = getNick()
      ? `<button type="button" class="nick-btn" id="nickBtn">呼び名を変える</button>`
      : `<button type="button" class="nick-btn" id="nickBtn">名前で呼んでほしい時は</button>`;
    return `<section class="summary-box" id="summaryBox">
      <h3 class="summary-title">3枚からのメッセージ</h3>
      <p class="summary-text">${sentLines(s.opener)}</p>
      <p class="summary-text">${s.echoLines.map((t) => `<span class="sent">${t}</span>`).join("")}</p>
      <p class="summary-text">${s.echoTail}</p>
      ${s.paras.map((t) => `<p class="summary-text">${sentLines(t)}</p>`).join("")}
      ${s.you ? `<p class="summary-text">${sentLines(s.you)}</p>` : ""}
      <div class="summary-underline" aria-hidden="true"></div>
      <p class="summary-core">${sentLines(s.close)}</p>
      <div class="nick-row" id="nickRow">${nickRow}
        <span class="nick-edit hidden" id="nickEdit">
          <input type="text" id="nickInput" maxlength="12" placeholder="ニックネーム" value="">
          <button type="button" class="nick-save" id="nickSave">保存</button>
        </span>
        <span class="nick-note">この端末の中だけに保存されます</span>
      </div>
    </section>`;
  }

  /* ===== 読み解き ===== */
  /* 文（「。」区切り）ごとに1行で表示する＝意味のまとまりで改行（BUBU指定・データには改行を持たない） */
  function sentLines(t) {
    return (t.match(/[^。]+。?/g) || [t]).map((s) => `<span class="sent">${s.trim()}</span>`).join("");
  }

  function block(en, ja, c, text, i, hint) {
    const hintHtml = hint ? `<span class="pl-hint">${hint}</span>` : "";
    return `<div class="pos-block" style="transition-delay:${Math.min(i, 5) * 110}ms">
      <div class="pos-label"><span class="pl-en">${en}</span><span class="pl-ja">${ja}</span>${hintHtml}</div>
      <div class="pos-card">${c.name_en}<span class="pj">${c.name_ja}</span></div>
      <div class="pos-text">${sentLines(text)}</div></div>`;
  }

  /* 段落つき本文ブロック（今日の一枚のクロ素材フル解説用・段落ごとに pos-text を分ける） */
  function blockParas(en, ja, c, paras, i) {
    return `<div class="pos-block" style="transition-delay:${Math.min(i, 5) * 110}ms">
      <div class="pos-label"><span class="pl-en">${en}</span><span class="pl-ja">${ja}</span></div>
      <div class="pos-card">${c.name_en}<span class="pj">${c.name_ja}</span></div>
      ${paras.map((t) => `<div class="pos-text">${sentLines(t)}</div>`).join("")}</div>`;
  }

  /* 複数枚スプレッド用ブロック：カード名＋詩版の決め文＋「くわしく」で短詩4行を開閉
     （2026-07-17 配線図確定＝方向別読み解き文は全撤去・クロ詩版に差し替え。総括が締めを担う） */
  function blockPoem(en, ja, c, i, hint) {
    const hintHtml = hint ? `<span class="pl-hint">${hint}</span>` : "";
    const v = VOICE && VOICE[c.id];
    const kime = v ? v.kime : c.one;
    const body = v ? v.poem.join("<br>") : `<span class="sent">${c.one}</span>`;
    return `<div class="pos-block pos-compact" style="transition-delay:${Math.min(i, 5) * 110}ms">
      <div class="pos-label"><span class="pl-en">${en}</span><span class="pl-ja">${ja}</span>${hintHtml}</div>
      <div class="pos-card">${c.name_en}<span class="pj">${c.name_ja}</span></div>
      <div class="pos-one">「${kime}」</div>
      <button type="button" class="pos-more">くわしく読む</button>
      <div class="pos-text pos-full pos-poem hidden">${body}</div></div>`;
  }

  function renderStrip(items) {
    resultCards.dataset.n = items.length;
    resultCards.innerHTML = items.map(({ c, en, ja }) => `<figure class="rc">
      <figcaption class="rc-label"><span class="rl-en">${en}</span><span class="rl-ja">${ja}</span></figcaption>
      <img src="${cardImg(c)}" alt="${c.name_en} ${c.name_ja}">
    </figure>`).join("");
  }

  /* 結果パネルの中身を組む（表示はしない） */
  function renderResult() {
    const { spreadKey, spec, drawn } = state;
    readingTitle.textContent = spec.title;
    fillHeading(spec.en, spec.ja, spec.desc);
    renderStrip(drawn.map((c, i) => ({ c, en: spec.pos[i][0], ja: spec.pos[i][1] })));
    readingBody.dataset.n = spec.n;
    let html = "";

    if (spreadKey === "today") {
      const c = drawn[0];
      const nick = getNick();
      const v = VOICE && VOICE[c.id];
      if (nick) html += `<p class="today-hello">── ${nick}さんの今日の一枚</p>`;
      if (v) {
        /* クロちゃん素材のフル解説のみ（2026-07-17 配線図確定＝1枚をじっくり読む場に三段は盛りすぎ・決め文短詩は複数枚側へ） */
        html += blockParas("TODAY", "今日", c, v.full, 0);
      } else {
        html += `<p class="one-line" style="animation:rise-in 0.9s ease both">「${c.one}」</p>`;
        html += block("TODAY", "今日", c, c.present, 0);
      }
      html += `<p class="disclaimer">今日の一枚は日替わりの占いです。この端末では、日が変わるまで何度引いても同じカードが出ます。</p>`;
    } else if (spreadKey === "yesno") {
      const c = drawn[0];
      html += `<div class="yn-word" style="animation:rise-in 0.9s ease both">${YN_WORD[c.yn]}</div>`;
      html += `<p class="yn-sub">${sentLines(c.yn_text)}</p>`;
      html += block("YES / NO", "いまの空気", c, c.present, 0);
    } else if (spreadKey === "choice") {
      drawn.forEach((c, i) => { html += blockPoem(spec.pos[i][0], spec.pos[i][1], c, i); });
      html += `<p class="disclaimer">どちらの流れにも、あなたの選び直す余地が残っています。</p>`;
    } else if (spreadKey === "ppf") {
      drawn.forEach((c, i) => { html += blockPoem(spec.pos[i][0], spec.pos[i][1], c, i, spec.pos[i][2]); });
      html += summaryHtml(drawn);
    } else if (spreadKey === "hex") {
      drawn.forEach((c, i) => { html += blockPoem(spec.pos[i][0], spec.pos[i][1], c, i, spec.pos[i][2]); });
    }
    readingBody.innerHTML = html;
    // 今日の一枚は日替わり固定なので「もういちど引く」を出さない（同じカードが出て混乱するため）
    $("#againBtn").classList.toggle("hidden", spreadKey === "today");
  }

  function finishReading(skipped) {
    if (state.finished) return;
    state.finished = true;
    if (skipped) {
      table.innerHTML = "";
      document.querySelectorAll(".card-title").forEach((n) => n.remove());
    }
    skipBtn.classList.add("hidden");
    stopBtn.classList.add("hidden");
    setGuide("");
    reading.classList.add("show");
    reading.scrollTop = 0;
    revealNow(readingBody.querySelectorAll(".pos-block, .summary-box"));
  }

  /* ===== シェア ===== */
  function shareData() {
    const { spreadKey, drawn, spec } = state || {};
    if (!drawn) return null;
    const c = drawn[0];
    if (spreadKey === "today" || spreadKey === "yesno" || !spreadKey) {
      const head = spreadKey === "yesno" ? `YES/NOで引いたら「${YN_WORD[c.yn]}」` : `今日の一枚は ${c.name_en}（${c.name_ja}）`;
      return { text: `${head}\n「${c.one}」\n#TOI 問いのタロット`, url: `${SITE}/cards/${c.id}.html` };
    }
    const names = drawn.map((x) => x.name_en).join(" / ");
    return { text: `${spec.title} で引いた ─ ${names}\n#TOI 問いのタロット`, url: SITE + "/" };
  }
  function doShare(kind) {
    const s = shareData();
    if (!s) return;
    const t = encodeURIComponent(s.text), u = encodeURIComponent(s.url);
    if (kind === "x") open(`https://x.com/intent/post?text=${t}&url=${u}`, "_blank", "noopener");
    else if (kind === "threads") open(`https://www.threads.net/intent/post?text=${t}%0A${u}`, "_blank", "noopener");
    else if (kind === "line") open(`https://social-plugins.line.me/lineit/share?url=${u}&text=${t}`, "_blank", "noopener");
    else if (kind === "copy") {
      navigator.clipboard.writeText(`${s.text}\n${s.url}`).then(() => {
        const b = document.querySelector('[data-share="copy"]');
        b.textContent = "コピーしました";
        setTimeout(() => (b.textContent = "コピー"), 1600);
      });
    }
  }

  /* ===== 共有リンクで来た人（?c=id） ===== */
  function landFromShare(cid) {
    const c = CARDS.find((x) => x.id === cid);
    if (!c) return false;
    state = { spreadKey: "today", spec: SPREADS.today, drawn: [c], els: [], finished: true, token: { cancelled: true } };
    resetStage();
    showScreen(stage);
    readingTitle.textContent = "SHARED CARD";
    fillHeading("SHARED CARD", "シェアされた一枚", "この一枚から、あなたも引けます");
    renderStrip([{ c, en: "CARD", ja: "この一枚" }]);
    readingBody.dataset.n = 1;
    readingBody.innerHTML =
      `<p class="one-line" style="animation:rise-in 0.9s ease both">「${c.one}」</p>` +
      block("CARD", "この一枚", c, c.present, 0) +
      `<div class="again-row"><button class="gold-btn small" id="tryBtn">自分も引いてみる</button></div>`;
    reading.classList.add("show");
    revealNow(readingBody.querySelectorAll(".pos-block"));
    document.getElementById("tryBtn").addEventListener("click", goHome);
    return true;
  }

  /* ===== ナビ ===== */
  function goHome() {
    state && (state.token.cancelled = true);
    resetStage();
    showScreen(home);
    history.replaceState(null, "", "/");
  }
  document.querySelectorAll("[data-spread]").forEach((b) =>
    b.addEventListener("click", () => run(b.dataset.spread)));
  skipBtn.addEventListener("click", () => {
    if (!state || state.finished) return;
    state.token.cancelled = true;
    state.token.onSkip && state.token.onSkip();
  });
  homeBtn.addEventListener("click", goHome);
  $("#againBtn").addEventListener("click", () => run(state.spreadKey));
  $("#menuBtn").addEventListener("click", goHome);
  document.querySelectorAll(".share-btn").forEach((b) =>
    b.addEventListener("click", () => doShare(b.dataset.share)));

  /* くわしく開閉＋ニックネーム設定（結果パネル内は動的生成なので委譲で拾う） */
  readingBody.addEventListener("click", (e) => {
    const more = e.target.closest(".pos-more");
    if (more) {
      const full = more.parentElement.querySelector(".pos-full");
      const open = full.classList.toggle("hidden");
      more.textContent = open ? "くわしく読む" : "とじる";
      return;
    }
    if (e.target.closest("#nickBtn")) {
      const edit = $("#nickEdit");
      edit.classList.toggle("hidden");
      if (!edit.classList.contains("hidden")) {
        const input = $("#nickInput");
        input.value = getNick();
        input.focus();
      }
      return;
    }
    if (e.target.closest("#nickSave")) {
      setNick($("#nickInput").value);
      const y = reading.scrollTop;
      renderResult(); // 名前を差し替えて総括を組み直す
      revealNow(readingBody.querySelectorAll(".pos-block, .summary-box"));
      reading.scrollTop = y;
    }
  });

  /* ===== 起動 ===== */
  Promise.all([
    fetch("/data/cards_ja.json").then((r) => r.json()),
    fetch("/data/summary_ja.json?v=1784300777", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("/data/kuro_voice.json?v=1784300777", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])
    .then(([data, summary, voice]) => {
      CARDS = data;
      SUMMARY = summary;
      VOICE = voice;
      preload(BACK);
      revealNow(document.querySelectorAll("#home .menu-item, #home .feat-row"));
      const cid = new URLSearchParams(location.search).get("c");
      if (cid && landFromShare(cid)) return;
      showScreen(home);
    })
    .catch(() => {
      document.body.innerHTML = '<p style="color:#d4b567;text-align:center;margin-top:40vh;font-family:serif">読み込みに失敗しました。再読み込みしてください。</p>';
    });
})();
