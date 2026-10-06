/* 相談先の選び方（/compare/）の送客リンク（2026-10-06）
   リンクの出所は /data/affiliates.json だけ（HTML に URL を直書きしない）。
   compare.slots に入っている枠で、data-slot と pid が合う物にだけボタンを出す。
   enabled が true でない・URL が無い・http(s) 以外 → その会社のボタンは出さない（表は残る）。
   GA4：compare_view（ページを開いた）／aff_view（ボタンが画面に入った）／aff_click（押した）。placement は "compare"。
   運営者・自動の見回り（window.TOI_INTERNAL）では afb の表示用の画像を読まない＝表示数を自分で増やさない。
   2026-10-06 Astra 再レビュー：内部の端末では href も外す（自分で押してクリックを増やさない）／
   URL の中の案件番号（a=r7674L… の数字）と data-pid が違えば出さない／aff_view は 50% 以上見えた時だけ。 */
(function () {
  "use strict";
  function track(name, params) {
    try { if (typeof window.toiTrack === "function") window.toiTrack(name, params || {}); } catch (e) {}
  }
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u == null ? "" : u).trim()) ? String(u).trim() : "");

  track("compare_view", { placement: "compare" });

  function seen(el, cb) {
    if (!("IntersectionObserver" in window)) { cb(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting && en.intersectionRatio >= 0.5)) { io.disconnect(); cb(); }
    }, { threshold: 0.5 });
    io.observe(el);
  }

  fetch("/data/affiliates.json?v=1791286246", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((aff) => {
      if (!aff || aff.enabled !== true) return;
      const allowed = ((aff.compare || {}).slots) || [];
      document.querySelectorAll(".cmp-go").forEach((box) => {
        const key = box.dataset.slot;
        if (!allowed.includes(key)) return;
        const slot = (aff.slots || {})[key];
        if (!slot || String(slot.pid || "") !== box.dataset.pid) return; // 枠の中身が別の会社に替わっていたら出さない
        const href = safeUrl(slot.url);
        if (!href) return;
        const m = /[?&]a=[A-Za-z](\d+)[A-Za-z]/.exec(href); // afb の原稿URLに入っている案件番号
        if (m && m[1] !== box.dataset.pid) return; // URL だけ別の案件に替わっていたら出さない
        const internal = window.TOI_INTERNAL === true;
        const meta = { slot: key, pid: String(slot.pid), placement: "compare" };
        const label = `${esc(box.dataset.name)}の公式サイトを見る`;
        let h = internal
          ? `<a class="cp-btn cmp-link" aria-disabled="true" title="運営者の端末のため、リンクを外しています">${label}</a><span class="cmp-pr">［PR］</span>`
          : `<a class="cp-btn cmp-link" href="${esc(href)}" target="_blank" rel="sponsored nofollow noopener">${label}</a><span class="cmp-pr">［PR］</span>`;
        const imgUrl = safeUrl(slot.img);
        if (imgUrl && !internal) h += `<img src="${esc(imgUrl)}" width="1" height="1" alt="" style="border:none;position:absolute;left:-9999px" />`;
        box.innerHTML = h;
        if (!internal) box.querySelector(".cmp-link").addEventListener("click", () => track("aff_click", meta));
        seen(box, () => track("aff_view", meta));
      });
    });
})();
