/* הודעות קופצות: ההגדרה של כל הודעה מגיעה עם הקטלוג (settings.popups — נערכות בניהול ומתפרסמות
   כמו ההודעה בדף הבית). אותו ציור באתר ובתצוגה המקדימה בניהול (admin-popups.js).

   ארבעה סוגים: חלון במרכז (modal), מגירה מלמטה (sheet), הודעה בפינה (toast) ופס צף למעלה (bar).
   כל הודעה בוחרת באילו דפים (ריק — בכולם), למי (מחוברים / לא מחוברים, ביקור ראשון / חוזרים),
   כמה פעמים (פעם אחת, פעם בביקור, פעם ביום, בכל דף), ומתי לקפוץ (אחרי כמה שניות, אחרי גלילה,
   או כשהעכבר יוצא מהחלון — בטלפון במקום זה אחרי 15 שניות). מה שכבר הוצג נשמר במכשיר.
   בכל רגע מוצגת רק הודעה חוסמת אחת (חלון או מגירה) ופס אחד; הודעות בפינה — עד שלוש.
   ?popup=<מזהה> בכתובת מציג הודעה מיד, בלי הכללים — לבדיקה. */
(function () {
  'use strict';
  const U = window.RoshUI;
  const S = window.RoshStore;
  const esc = (s) => U.esc(s);

  const SEEN = 'rosh:popups-seen';        // { [id]: { rev, at: "YYYY-MM-DD" } } — במכשיר
  const SESSION = 'rosh:popups-session';  // [id@rev] — בלשונית הזו
  const VISITED = 'rosh:visited';         // הביקור הראשון במכשיר
  const FIRST = 'rosh:first-session';     // הלשונית הזו היא הביקור הראשון
  const read = (store, key, fallback) => { try { return JSON.parse(store.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
  const write = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch { /* מצב פרטי */ } };

  // ביקור ראשון: אין סימון במכשיר — הלשונית כולה נחשבת "ביקור ראשון"
  try {
    if (!localStorage.getItem(VISITED)) { localStorage.setItem(VISITED, String(Date.now())); sessionStorage.setItem(FIRST, '1'); }
  } catch { /* */ }
  const firstVisit = () => { try { return sessionStorage.getItem(FIRST) === '1'; } catch { return false; } };

  const PAGE_NAMES = { home: 'דף הבית', archive: 'הארכיון', episode: 'דפי התוכניות', me: 'האזור האישי', updates: 'העדכונים', other: 'שאר הדפים' };
  /** הדף הנוכחי, לפי הכתובת */
  function pageKey(path = location.pathname) {
    const f = path.split('/').pop() || 'index.html';
    if (f === 'index.html' || f === '') return 'home';
    if (f === 'archive.html') return 'archive';
    if (f === 'episode.html' || /\/episodes\/[^/]+$/.test(path)) return 'episode';
    if (f === 'me.html') return 'me';
    if (f === 'updates.html') return 'updates';
    return 'other';
  }
  const OFF_PAGES = new Set(['admin', 'mail', 'offline']);

  const hasContent = (p) => !!(p.title.trim() || p.text.trim() || p.image);
  const started = (p, t) => !p.from || p.from <= t;
  const ended = (p, t) => !!p.until && p.until <= t;

  function seenBefore(p) {
    if (p.freq === 'always') return false;
    if (p.freq === 'session') return read(sessionStorage, SESSION, []).includes(`${p.id}@${p.rev}`);
    const s = read(localStorage, SEEN, {})[p.id];
    if (!s || s.rev !== p.rev) return false;
    return p.freq === 'once' || s.at === S.todayIL();
  }
  function markSeen(p) {
    const all = read(localStorage, SEEN, {});
    all[p.id] = { rev: p.rev, at: S.todayIL() };
    // הודעות שנמחקו לא נשארות לנצח במכשיר
    const live = new Set((S.settings.popups || []).map((x) => x.id));
    for (const k of Object.keys(all)) if (!live.has(k) && k !== p.id) delete all[k];
    write(localStorage, SEEN, all);
    const ses = read(sessionStorage, SESSION, []);
    if (!ses.includes(`${p.id}@${p.rev}`)) write(sessionStorage, SESSION, [...ses, `${p.id}@${p.rev}`].slice(-60));
  }

  /** ההודעה מתאימה לדף ולמבקר הזה עכשיו? */
  function eligible(p, page = pageKey(), t = S.nowIL()) {
    if (!p?.enabled || !hasContent(p) || !started(p, t) || ended(p, t)) return false;
    if (p.pages.length && !p.pages.includes(page)) return false;
    const signed = !!S.sb?.user;
    if (p.audience === 'signed' && !signed) return false;
    if (p.audience === 'guest' && signed) return false;
    if (p.visitors === 'new' && !firstVisit()) return false;
    if (p.visitors === 'returning' && firstVisit()) return false;
    return !seenBefore(p);
  }

  /* ---------- ציור ---------- */
  const ICON = { gold: '✦', violet: '✧', teal: 'ℹ', success: '✓', danger: '!', night: '☾' };
  const internal = (url) => !/^(https?:|mailto:|tel:)/i.test(url) || url.startsWith(location.origin);
  function buttonHtml(b, i) {
    const cls = b.style === 'ghost' ? 'btn ghost' : i === 0 ? 'btn primary' : 'btn gold';
    const arrow = b.url && b.style !== 'ghost' ? ' <span aria-hidden="true">←</span>' : '';
    if (!b.url) return `<button type="button" class="${cls}" data-pop-close>${esc(b.label)}</button>`;
    const nt = b.newTab || !internal(b.url);
    return `<a class="${cls}" href="${esc(b.url)}" data-pop-go${nt ? ' target="_blank" rel="noopener"' : ''}>${esc(b.label)}${arrow}</a>`;
  }
  /** ה־HTML של ההודעה עצמה (בלי המעטפת): אותו דבר באתר ובתצוגה המקדימה */
  function body(p) {
    const mark = p.icon || ICON[p.tone] || '✦';
    const text = p.text.trim() ? `<div class="rpop-text">${p.kind === 'bar' ? `<p>${U.updateText(p.text.split('\n')[0]).replace(/^<p>|<\/p>$/g, '')}</p>` : U.updateText(p.text)}</div>` : '';
    const img = p.image && p.kind !== 'bar' ? `<div class="rpop-img"><img src="${esc(p.image)}" alt="" loading="lazy"></div>` : '';
    const btns = p.buttons.filter((b) => b.label).map(buttonHtml).join('');
    return `${img}
<div class="rpop-main">
  <span class="rpop-mark" aria-hidden="true">${esc(mark)}</span>
  <div class="rpop-copy">
    ${p.title.trim() ? `<h2 class="rpop-title" id="rpop-t-${esc(p.id)}">${esc(p.title)}</h2>` : ''}
    ${text}
    ${btns ? `<div class="rpop-actions">${btns}</div>` : ''}
  </div>
</div>
<button type="button" class="rpop-x" data-pop-close aria-label="סגירה">✕</button>
${p.autoClose && (p.kind === 'toast' || p.kind === 'bar') ? `<i class="rpop-timer" style="--rpop-t:${p.autoClose}s" aria-hidden="true"></i>` : ''}`;
  }
  function element(p, { preview = false } = {}) {
    const blocking = p.kind === 'modal' || p.kind === 'sheet';
    const el = document.createElement(blocking && !preview ? 'dialog' : 'div');
    el.className = `rpop rpop-${p.kind} rpop-tone-${p.tone}${p.image ? ' has-img' : ''}${preview ? ' is-preview' : ''}`;
    el.dataset.popup = p.id;
    if (p.title.trim()) el.setAttribute('aria-labelledby', `rpop-t-${p.id}`); else el.setAttribute('aria-label', 'הודעה');
    if (!blocking) { el.setAttribute('role', p.tone === 'danger' ? 'alert' : 'status'); }
    el.innerHTML = body(p);
    return el;
  }

  /** תצוגה מקדימה בניהול: מצייר בתוך מסגרת, בלי לשמור שהוצג ובלי לחסום את הדף */
  function preview(container, p) {
    if (!container) return false;
    container.innerHTML = '';
    if (!hasContent(p)) return false;
    const el = element(p, { preview: true });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-pop-go]')) e.preventDefault(); });
    container.appendChild(el);
    return true;
  }

  /* ---------- הצגה באתר ---------- */
  const open = new Map();   // id → { el, p, timer }
  let pending = [];         // מנקים במעבר דף: טיימרים ומאזינים שמחכים לקפוץ
  let waiting = [];         // הודעות חוסמות שמחכות שהחלון הנוכחי ייסגר
  const busy = (kind) => [...open.values()].some((o) => (kind === 'block' ? (o.p.kind === 'modal' || o.p.kind === 'sheet') : o.p.kind === kind));
  const toasts = () => [...open.values()].filter((o) => o.p.kind === 'toast').length;

  function zone() {
    let z = document.getElementById('rpop-zone');
    if (!z) { z = document.createElement('div'); z.id = 'rpop-zone'; z.className = 'rpop-zone'; document.body.appendChild(z); }
    return z;
  }

  function show(p, { force = false } = {}) {
    if (open.has(p.id)) return;
    const blocking = p.kind === 'modal' || p.kind === 'sheet';
    // חלון חוסם לא נפתח מעל חלון אחר (גם בבדיקה עם ?popup=) — הוא מחכה שהדרך תתפנה
    if (blocking && (busy('block') || document.querySelector('dialog[open]:not(.rpop)'))) { wait(p, force); return; }
    if (!force) {
      if (p.kind === 'bar' && busy('bar')) return;
      if (p.kind === 'toast' && toasts() >= 3) return;
    }
    const el = element(p);
    const rec = { el, p, timer: 0 };
    open.set(p.id, rec);
    if (!force) markSeen(p);
    if (blocking) {
      document.body.appendChild(el);
      el.addEventListener('cancel', (e) => { e.preventDefault(); close(p.id); });
      // לחיצה על הרקע סוגרת
      el.addEventListener('click', (e) => { if (e.target === el) close(p.id); });
      try { el.showModal(); } catch { el.setAttribute('open', ''); }
      el.querySelector('.rpop-actions .btn, .rpop-x')?.focus({ preventScroll: true });
    } else if (p.kind === 'bar') document.body.appendChild(el);
    else zone().appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pop-close]')) { close(p.id); return; }
      const go = e.target.closest('[data-pop-go]');
      if (!go) return;
      const href = go.getAttribute('href');
      close(p.id);
      if (!go.target && window.RoshApp?.navigate && internal(href)) { e.preventDefault(); window.RoshApp.navigate(href); }
    });
    if (p.autoClose && !blocking) {
      const arm = () => { clearTimeout(rec.timer); rec.timer = setTimeout(() => close(p.id), p.autoClose * 1000); el.classList.remove('paused'); };
      el.addEventListener('mouseenter', () => { clearTimeout(rec.timer); el.classList.add('paused'); });
      el.addEventListener('mouseleave', arm);
      el.addEventListener('focusin', () => { clearTimeout(rec.timer); el.classList.add('paused'); });
      arm();
    }
  }

  function close(id) {
    const rec = open.get(id); if (!rec) return;
    open.delete(id);
    clearTimeout(rec.timer);
    const { el } = rec;
    el.classList.remove('in');
    el.classList.add('out');
    const done = () => { try { el.close?.(); } catch { /* */ } el.remove(); };
    if (U.reduceMotion?.()) done(); else setTimeout(done, 260);
    // הבאה בתור מחכה רגע, שלא יקפצו שתי הודעות ברצף
    if ((rec.p.kind === 'modal' || rec.p.kind === 'sheet') && waiting.length && !waitTimer) { const w = waiting.shift(); wait(w.p, w.force); }
  }

  /** הודעה חוסמת מחכה: חלון אחר פתוח (הודעה אחרת, או חלון של האתר — למשל ההזמנה להתחבר).
      בודקים שוב כל שנייה וחצי, עד שהדרך פנויה */
  let waitTimer = 0;
  function wait(p, force = false) {
    if (!waiting.some((w) => w.p === p)) waiting.push({ p, force });
    if (waitTimer) return;
    waitTimer = setInterval(() => {
      if (busy('block') || document.querySelector('dialog[open]:not(.rpop)')) return;
      clearInterval(waitTimer); waitTimer = 0;
      const next = waiting.shift();
      if (next && (next.force || eligible(next.p))) show(next.p, { force: next.force });
      if (waiting.length) { const w = waiting.shift(); wait(w.p, w.force); }
    }, 1500);
  }
  function cancelPending() { pending.forEach((off) => off()); pending = []; waiting = []; clearInterval(waitTimer); waitTimer = 0; }

  function arm(p) {
    const fire = () => { if (eligible(p)) show(p); };
    const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    if (p.trigger === 'scroll') {
      const check = () => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const pct = max > 0 ? (scrollY / max) * 100 : 100;
        if (pct >= p.scroll) { off(); fire(); }
      };
      const off = () => removeEventListener('scroll', check);
      addEventListener('scroll', check, { passive: true });
      pending.push(off);
      setTimeout(check, 400);   // דף קצר שאין בו לאן לגלול
      return;
    }
    if (p.trigger === 'exit' && !touch) {
      const out = (e) => { if (!e.relatedTarget && e.clientY <= 4) { off(); fire(); } };
      const off = () => document.removeEventListener('mouseout', out);
      // לא קופצים ברגע הראשון — רק אחרי כמה שניות בדף
      const t = setTimeout(() => document.addEventListener('mouseout', out), Math.max(3, p.delay) * 1000);
      pending.push(() => { clearTimeout(t); off(); });
      return;
    }
    const wait = p.trigger === 'exit' ? 15 : p.delay;
    const t = setTimeout(fire, wait * 1000);
    pending.push(() => clearTimeout(t));
  }

  /** בכל דף: ההודעות שמתאימות לדף מתוזמנות לפי הסדר (הסדר בניהול הוא העדיפות) */
  function run() {
    cancelPending();
    if (OFF_PAGES.has(document.body.dataset.page)) return;
    const page = pageKey();
    const list = S.settings.popups || [];
    // הודעות פתוחות שלא שייכות לדף החדש — נסגרות
    for (const [id, rec] of open) if (rec.p.pages.length && !rec.p.pages.includes(page)) close(id);
    const forced = new URLSearchParams(location.search).get('popup');
    if (forced) { const p = list.find((x) => x.id === forced); if (p && hasContent(p)) { show(p, { force: true }); return; } }
    list.filter((p) => eligible(p, page)).forEach(arm);
  }

  document.addEventListener('rosh:page', () => S.ready.then(run));
  S.ready.then(() => { run(); S.onSession?.(() => run()); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const last = [...open.values()].reverse().find((o) => o.p.kind === 'toast' || o.p.kind === 'bar');
    if (last && !document.querySelector('dialog[open]')) close(last.p.id);
  });

  window.RoshPopups = { preview, show, close, run, eligible, pageKey, PAGE_NAMES, ICON };
})();
