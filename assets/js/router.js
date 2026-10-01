/* ניווט בלי טעינה מחדש: לחיצה על קישור פנימי מחליפה רק את תוכן הדף, והנגן
   (שיושב מחוץ לתוכן) ממשיך לנגן בלי הפסקה. הכתובת, כפתור "אחורה", הכותרת
   והשיתוף עובדים כרגיל. דפים שנטענים תמיד במלואם: הניהול, ומה שנפתח בחלון
   חדש, בהורדה או עם מקש Ctrl/Cmd/Shift.

   כל דף רושם את המאזינים שלו על document/window עם RoshApp.signal, וכך
   במעבר לדף אחר הם מוסרים (אחרת כל מעבר היה מכפיל אותם).

   דפי התוכניות הסטטיים (episodes/<slug>.html, נבנים בפריסה) יושבים בתת־תיקייה
   ומתחילים ב־<base href="../">, ולכן כל הכתובות היחסיות נפתרות מול document.baseURI
   (שורש האתר), ובמעבר בין דפים גם תגית ה־<base> מתעדכנת.

   לחיצה על התראה (sw.js) שולחת לחלון הפתוח { type: 'rosh-navigate', url } —
   ועוברים לדף בלי טעינה, כך שהנגן ממשיך לנגן. */
(function () {
  'use strict';

  // הנתיב יחסית לשורש האתר: "", index.html, archive.html… או episodes/<slug>.html
  const PAGES = /^(?:(?:index|archive|episode|me|updates|negishut|guest)\.html)?$|^episodes\/[^/]+\.html$/;
  const PAGE_SCRIPT = /assets\/js\/(home|archive|episode|me|updates|negishut|guest)\.js(?:\?|$)/;
  let controller = new AbortController();
  let navigating = 0;

  const App = {
    // סקריפט דף שנטען באיחור (כבר עברו לדף אחר) מקבל את האות של הדף שלו — שכבר בוטל — ולא מצייר על הדף החדש
    get signal() { return document.currentScript?.roshSignal || controller.signal; },
    navigate,
  };
  window.RoshApp = App;

  /** שורש האתר (עם / בסוף). מחושב פעם אחת בטעינה: document.baseURI — גם בדף
      עם <base href="../"> זה השורש, ולא התיקייה episodes/. */
  const root = new URL('./', document.baseURI);

  function sameSite(url) {
    return url.origin === root.origin && url.pathname.startsWith(root.pathname) && PAGES.test(url.pathname.slice(root.pathname.length));
  }

  function internalLink(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download') || a.dataset.reload != null) return null;
    const href = a.getAttribute('href');
    // "#" / "#עוגן": קישור בתוך הדף הנוכחי, לא ניווט ("#" הוא בדרך כלל כפתור שהדף מטפל בו).
    // נפתר מול location ולא מול <base> — שבדפי התוכניות הסטטיים מצביע לשורש האתר.
    if (href.startsWith('#')) {
      if (href.length > 1 && document.querySelector('base[href]')) { e.preventDefault(); location.hash = href; }
      return null;
    }
    let url; try { url = new URL(href, document.baseURI); } catch { return null; }
    if (!sameSite(url)) return null;
    // קישור לעוגן באותו דף — הדפדפן מטפל בזה
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  /* גלילה באחורה / קדימה: הדפדפן לא משחזר אותה בעצמו (התוכן מתחלף רק אחרי שהדף החדש
     נטען, אז השחזור שלו נופל על הדף הישן) — המקום נשמר ב־history.state של כל כניסה
     ומשוחזר ב־afterRender. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let scrollTimer = 0;
  function saveScroll() {
    clearTimeout(scrollTimer);
    try { history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, ''); } catch { /* הדפדפן מגביל קריאות תכופות */ }
  }
  window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(saveScroll, 200); }, { passive: true });

  document.addEventListener('click', (e) => {
    const url = internalLink(e);
    if (!url) return;
    e.preventDefault();
    navigate(url.href);
  });
  let current = location.pathname + location.search;
  // דפים שמחליפים את הכתובת בעצמם (סינון בארכיון, ?sso= / ?handoff= ב־store.js): "הדף הנוכחי" מתעדכן איתם,
  // אחרת לחיצה על עוגן באותו דף נראית כמו מעבר לדף אחר — והדף כולו נטען ומצויר מחדש
  const replaceState = history.replaceState.bind(history);
  history.replaceState = function (state, title, u) { replaceState(state, title, u); current = location.pathname + location.search; };
  window.addEventListener('popstate', (e) => {
    clearTimeout(scrollTimer);   // שמירה שממתינה שייכת לכניסה הקודמת
    const y = e.state?.scrollY;
    if (location.pathname + location.search === current) { if (y != null) jumpTo(y); return; }   // רק העוגן השתנה
    navigate(location.href, { push: false, y });
  });

  /* לחיצה על התראה: sw.js מבקש לעבור לדף בלי לטעון מחדש */
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'rosh-navigate' || typeof d.url !== 'string') return;
    let url; try { url = new URL(d.url, document.baseURI); } catch { return; }
    if (url.origin !== location.origin) return;
    if (sameSite(url)) navigate(url.href); else location.href = url.href;
  });

  /** תגית ה־<base> של הדף החדש, בכתובת מלאה (או הסרה כשאין לו) */
  function syncBase(doc, url) {
    const next = doc.querySelector('base[href]');
    let cur = document.querySelector('base');
    if (!next) { cur?.remove(); return; }
    const href = new URL(next.getAttribute('href'), url).href;
    if (!cur) { cur = document.createElement('base'); document.head.prepend(cur); }
    if (cur.href !== href) cur.setAttribute('href', href);
  }

  /** קישור ה־canonical והנתונים המובנים (JSON-LD) של הדף החדש */
  function syncHeadLinks(doc, url) {
    const next = doc.querySelector('link[rel="canonical"]'), cur = document.querySelector('link[rel="canonical"]');
    if (next) {
      const href = new URL(next.getAttribute('href'), url).href;
      if (cur) cur.setAttribute('href', href);
      else { const l = document.createElement('link'); l.rel = 'canonical'; l.href = href; document.head.appendChild(l); }
    } else cur?.remove();
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => s.remove());
    doc.querySelectorAll('head script[type="application/ld+json"]').forEach((s) => {
      const c = document.createElement('script'); c.type = 'application/ld+json'; c.textContent = s.textContent; document.head.appendChild(c);
    });
  }

  /** קישור הדילוג לתוכן יושב מחוץ ל־.shell: מקבל את הכתובת של הדף החדש (בדף תוכנית סטטי היא מלאה, בגלל ה־<base>) */
  function syncSkipLink(doc) {
    const next = doc.querySelector('a.skip-link[href]'), cur = document.querySelector('a.skip-link');
    if (next && cur) cur.setAttribute('href', next.getAttribute('href'));
  }

  async function navigate(href, { push = true, y = null } = {}) {
    const url = new URL(href, document.baseURI);
    const ticket = ++navigating;
    // טעינה רגילה. ב"אחורה"/"קדימה" הכתובת כבר הוחלפה, ו־location.href לאותה כתובת עם #עוגן רק גולל — לא טוען
    const hard = () => { if (push) location.href = url.href; else location.reload(); };
    let html;
    try {
      const r = await fetch(url.pathname + url.search, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      html = await r.text();
    } catch { hard(); return; }   // בלי רשת או דף שלא נמצא — טעינה רגילה
    if (ticket !== navigating) return;               // לחצו בינתיים על קישור אחר
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // גרסה חדשה של האתר עלתה בינתיים (הפריסה מסמנת את קובצי העיצוב והסקריפטים ב־?v=): טעינה רגילה,
    // כדי שהדף החדש לא יצויר עם העיצוב והסקריפטים המשותפים של הגרסה הקודמת
    const build = (d) => d.querySelector('link[rel="stylesheet"][href*="rosh.css?v="]')?.getAttribute('href').split('?v=')[1] || '';
    // בזמן ניגון (גם טעינה או קפיצה בהקלטה) לא טוענים — הטעינה הייתה עוצרת את ההאזנה. מחליפים כרגיל,
    // ו־app-update.js טוען את הגרסה החדשה ברגע בטוח (כשהניגון נעצר)
    if (build(doc) !== build(document)) {
      const P = window.RoshPlayer;
      if (!P || !(typeof P.playing === 'boolean' ? P.playing : !P.paused)) { hard(); return; }
      window.RoshAppUpdate?.check();
    }
    const shell = doc.querySelector('.shell');
    const script = [...doc.querySelectorAll('script[src]')].find((s) => PAGE_SCRIPT.test(s.getAttribute('src')));
    if (!shell || !script) { hard(); return; }

    const swap = () => {
      controller.abort();
      controller = new AbortController();
      if (push) { saveScroll(); history.pushState({ rosh: 1 }, '', url.href); }   // המקום בדף הנוכחי — לחזרה אליו ב"אחורה"
      current = url.pathname + url.search;
      document.title = doc.title;
      for (const name of ['description', 'robots']) {
        const next = doc.querySelector(`meta[name="${name}"]`), cur = document.querySelector(`meta[name="${name}"]`);
        if (next && cur) cur.setAttribute('content', next.getAttribute('content'));
        else if (next) document.head.appendChild(next.cloneNode());
        else cur?.remove();
      }
      syncBase(doc, url);
      syncHeadLinks(doc, url);
      syncSkipLink(doc);
      for (const k of ['page', 'ep']) {
        if (doc.body.dataset[k]) document.body.dataset[k] = doc.body.dataset[k]; else delete document.body.dataset[k];
      }
      document.querySelector('.shell').replaceWith(document.importNode(shell, true));
      const s = document.createElement('script');
      s.roshSignal = controller.signal;
      s.src = script.getAttribute('src');
      s.onload = () => { s.remove(); if (ticket === navigating) afterRender(url, y); };
      s.onerror = () => { if (ticket === navigating) hard(); };
      document.body.appendChild(s);
    };
    const vt = document.startViewTransition && !window.RoshUI?.reduceMotion?.();
    if (vt) document.startViewTransition(swap); else swap();
  }

  /** גלילה מיידית (בלי האנימציה של scroll-behavior) למקום שנשמר. התוכן עוד מתמלא
      (תמונות, רשימות), ולכן מנסים שוב עד שהדף ארוך מספיק. */
  function jumpTo(y) {
    let tries = 0;
    const go = () => {
      try { window.scrollTo({ top: y, behavior: 'instant' }); } catch { window.scrollTo(0, y); }
      if (Math.abs(window.scrollY - y) > 2 && tries++ < 20) setTimeout(go, 60);
    };
    go();
  }

  /** אחרי שהדף החדש צויר: גלילה למקום שנשמר (אחורה / קדימה), לעוגן או לראש הדף, ופוקוס לתוכן לקוראי מסך */
  function afterRender(url, y = null) {
    const main = document.getElementById('main');
    if (y != null) jumpTo(y);
    else if (url.hash) {
      const id = decodeURIComponent(url.hash.slice(1));
      let tries = 0;
      const seek = () => {
        const el = document.getElementById(id);
        if (el && el.innerHTML.trim()) el.scrollIntoView({ block: 'start' });
        else if (tries++ < 20) setTimeout(seek, 60);
      };
      seek();
    } else window.scrollTo(0, 0);
    if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
  }
})();
