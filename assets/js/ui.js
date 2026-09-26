/* עזרי ממשק משותפים: כותרת, פוטר, הודעות, עיצוב זמנים ותאריכים,
   מקור ההשמעה של כל תוכנית, עטיפות צבעוניות, אנימציות גילוי ואור עוקב. */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const pad = (n) => String(n).padStart(2, '0');

  /** 3725 → "1:02:05", 125 → "2:05" */
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** "1:02:05" / "2:05" / "125" → seconds */
  function parseTime(str) {
    if (typeof str === 'number') return str;
    const t = String(str || '').trim();
    if (!t) return 0;
    if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t));
    const parts = t.split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }

  /** מספר שניות → "58 דקות" / "שעה ו־3 דקות". העיגול לדקות קודם לחלוקה לשעות (3599 → "שעה", לא "60 דקות") */
  function fmtDuration(sec) {
    sec = Number(sec) || 0;
    if (!sec) return '';
    const total = Math.round(sec / 60), h = Math.floor(total / 60), m = total % 60;
    if (!h) return m === 1 ? 'דקה אחת' : `${m} דקות`;
    const hw = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
    return m ? `${hw} ו${m === 1 ? 'דקה אחת' : `־${m} דקות`}` : hw;
  }

  const heDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  const heDateShort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  const heWeekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' });

  function toDate(iso) {
    if (!iso) return null;
    const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? null : d;
  }
  function fmtDate(iso, short) {
    const d = toDate(iso);
    return d ? (short ? heDateShort : heDate).format(d) : '';
  }
  /* ---------- תאריך עברי ----------
     היום, החודש והשנה נלקחים מלוח השנה העברי של הדפדפן, והמספרים נכתבים
     באותיות: 11 בתשרי 5787 → י״א בתשרי תשפ״ז. */
  const heHebrew = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });
  function gematria(n) {
    n = Math.floor(n) % 1000;
    let out = '';
    for (const [v, c] of [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק']]) while (n >= v) { out += c; n -= v; }
    if (n === 15) out += 'טו'; else if (n === 16) out += 'טז';
    else { if (n >= 10) { out += 'יכלמנסעפצ'[Math.floor(n / 10) - 1]; n %= 10; } if (n) out += 'אבגדהוזחט'[n - 1]; }
    return out.length > 1 ? `${out.slice(0, -1)}״${out.slice(-1)}` : `${out}׳`;
  }
  function fmtHebDate(iso, short = false) {
    const d = toDate(iso);
    if (!d) return '';
    try {
      const p = Object.fromEntries(heHebrew.formatToParts(d).map((x) => [x.type, x.value]));
      return short ? `${gematria(Number(p.day))} ב${p.month}` : `${gematria(Number(p.day))} ב${p.month} ${gematria(Number(p.year))}`;
    } catch { return ''; }
  }

  function fmtWeekday(iso) {
    const d = toDate(iso);
    return d ? heWeekday.format(d) : '';
  }

  function slugify(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'episode';
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  /* ---------- מקור ההשמעה ----------
     ההקלטות שמורות בקבצים משותפים (Google Drive). האתר לא מציג שום דבר
     מהממשק של Drive: הוא מחלץ את מזהה הקובץ ומזרים אותו ישירות לנגן שלו.
     driveId(ep): מזהה הקובץ אם ההקלטה שמורה בדרייב, אחרת null. */

  function isDriveUrl(value) {
    try { const u = new URL(String(value || '')); return u.protocol === 'https:' && (u.hostname === 'drive.google.com' || u.hostname === 'docs.google.com' || u.hostname === 'drive.usercontent.google.com'); }
    catch { return false; }
  }

  function driveId(ep) {
    if (ep?.audio) {
      try { if (new URL(ep.audio, location.href).hostname !== 'drive.google.com') return null; } catch { return null; }
    }
    for (const value of [ep?.audio, ...(ep?.links || []).map(l => l.url)]) {
      try {
        const u = new URL(value);
        if (u.protocol === 'https:' && u.hostname === 'drive.google.com') {
          const id = u.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] || u.searchParams.get('id');
          if (id && /^[\w-]+$/.test(id)) return id;
        }
      } catch { /* not a Drive URL */ }
    }
    return null;
  }

  /** הורדה ישירה של קובץ הדרייב (עובדת כניווט/הורדה; לא כמדיה בתוך דף). */
  const driveDirect = (id) => `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

  /** ה־Worker של אתר הסקר (data/site.json → storage.cloudflare.apiBase), אם מוגדר. */
  function apiBase() {
    const base = window.RoshStore?.site?.storage?.cloudflare?.apiBase;
    return base ? String(base).replace(/\/$/, '') : '';
  }

  /** כתובות ההזרמה לנגן, לפי סדר עדיפות. גוגל חוסם טעינת מדיה חוצת־אתרים
      (Sec-Fetch-Site: cross-site → 403), ולכן ההזרמה עוברת דרך ה־Worker
      (/api/program/stream/<id>, מעביר Range). הכתובת הישירה נשארת כגיבוי
      לדפדפנים שלא שולחים את הכותרת הזו. */
  function streamCandidates(ep) {
    const id = driveId(ep);
    if (id) {
      const base = apiBase();
      return base ? [`${base}/api/program/stream/${encodeURIComponent(id)}`, driveDirect(id)] : [driveDirect(id)];
    }
    if (ep?.audio && !isDriveUrl(ep.audio)) {
      try { const u = new URL(ep.audio, location.href); if (u.protocol === 'https:' || u.protocol === 'http:') return [ep.audio]; } catch { /* כתובת לא תקינה */ }
    }
    return [];
  }

  /** הכתובת שהנגן מנגן: קובץ ישיר אם יש, אחרת הזרמה של קובץ הדרייב, אחרת ''. */
  function streamUrl(ep) { return streamCandidates(ep)[0] || ''; }

  /** כתובת להורדת ההקלטה: מהאחסון של האתר, בשם התוכנית (לא מהדרייב). */
  function downloadUrl(ep) {
    if (!ep || !streamUrl(ep)) return '';
    const base = apiBase();
    if (base) return `${base}/api/program/download/${encodeURIComponent(ep.id)}`;
    const id = driveId(ep);
    return id ? driveDirect(id) : streamUrl(ep);
  }
  /** קישור לשיתוף: דף קטן בשרת שמציג בוואטסאפ את שם התוכנית והתמונה, ומעביר לדף התוכנית */
  function shareUrl(ep, t = 0) {
    const base = apiBase();
    const tail = t > 5 ? `?t=${Math.floor(t)}` : '';
    if (base) return `${base}/p/${encodeURIComponent(ep.slug)}${tail}`;
    return new URL(`episode.html?ep=${encodeURIComponent(ep.slug)}${t > 5 ? `&t=${Math.floor(t)}` : ''}`, location.href).href;
  }

  /** קישורים שמותר להציג לציבור — בלי קישורי דרייב (ההקלטה מנוגנת באתר). */
  function publicLinks(ep) {
    return (ep?.links || []).filter((l) => !isDriveUrl(l.url));
  }

  /* ---------- עטיפה צבעונית לכל תוכנית ----------
     אין תמונות לרוב התוכניות, אז כל אחת מקבלת גוון משלה: בסיס לפי העונה
     וסטייה קטנה לפי המזהה, כדי שהרשת תיראה כמו מדף תקליטים. */
  const seasonHue = { slater: 268, levi: 202, trio: 328, legacy: 26, sets: 158 };
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function hue(ep) {
    const base = seasonHue[ep?.season] ?? (hash(ep?.season || 'x') % 360);
    return (base + (hash(ep?.id || ep?.slug || '') % 46) - 23 + 360) % 360;
  }
  const coverVars = (ep) => `--h:${hue(ep)}`;

  /* ---------- כותרת ופוטר ---------- */

  let headerActive = '';
  function header(active, site) {
    headerActive = active;
    const user = window.RoshStore?.sb?.user || null;
    const S = window.RoshStore;
    const nav = [
      ['index.html', 'בית', 'home'],
      ['archive.html', 'הארכיון', 'archive'],
      ['index.html#sets', 'סטים', 'sets'],
      ...(S?.settings?.updates?.length ? [['updates.html', 'עדכונים', 'updates']] : []),
      ['index.html#follow', 'הקהילה', 'community'],
    ].map(([href, label, key]) =>
      `<a href="${href}" ${active === key ? 'aria-current="page"' : ''}>${label}</a>`
    ).join('');
    const first = user ? String(user.name || user.email || '').split(/[\s@]/)[0] : '';
    const me = user
      ? `<a href="me.html" class="me-link signed" ${active === 'me' ? 'aria-current="page"' : ''}>${user.picture ? `<img class="avatar" src="${esc(user.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar" aria-hidden="true">${esc(first.slice(0, 1) || '☺')}</span>`}<span>${esc(first || 'האזור האישי')}</span></a>`
      : `<a href="me.html" class="me-link" ${active === 'me' ? 'aria-current="page"' : ''}><span class="avatar" aria-hidden="true">☺</span><span>האזור האישי</span></a>`;
    // כפתור הניהול מוצג רק למי שמחובר בחשבון מנהל
    const admin = user?.isAdmin ? `<a href="admin.html" class="admin-link" ${active === 'admin' ? 'aria-current="page"' : ''}>ניהול</a>` : '';
    return `
<header class="site-header" id="site-header-bar">
  <a class="brand" href="index.html">
    <span class="logo-ring" aria-hidden="true"></span>
    <img class="logo-mark" src="assets/img/medallion.svg" alt="" width="46" height="46">
    <div><strong>${esc(site?.name || 'ראש בראש')}</strong>${window.RoshHoliday?.current?.() ? `<small class="holiday-line">${window.RoshHoliday.line()}</small>` : `<small>${esc(site?.tagline || 'מוזיקה ואקטואליה')}</small>`}</div>
  </a>
  <nav class="site-nav" aria-label="ניווט ראשי">
    ${nav}
    ${admin}
    ${me}
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="${themeLabel()}" title="${themeLabel()}"></button>
  </nav>
</header>${banner()}${voteBar(active)}${previewBar()}`;
  }

  /* ---------- מצב בהיר / כהה ותנועה (theme.js), נשמרים בהעדפות החשבון ---------- */
  const isLight = () => window.RoshTheme?.resolved?.() === 'light';
  const themeLabel = () => (isLight() ? 'מעבר למצב כהה' : 'מעבר למצב בהיר');
  function applyPrefs() {
    const S = window.RoshStore, T = window.RoshTheme;
    if (!S || !T) return;
    const theme = S.prefs.get('theme', null), motion = S.prefs.get('motion', null);
    if (theme && theme !== T.get()) T.set(theme);
    if (motion && T.setMotion && motion !== T.getMotion?.()) T.setMotion(motion);
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => { b.setAttribute('aria-label', themeLabel()); b.title = themeLabel(); });
    document.querySelectorAll('[data-motion-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(T.getMotion?.() === 'reduced')));
  }
  document.addEventListener('click', (e) => {
    const T = window.RoshTheme, S = window.RoshStore;
    if (e.target.closest('[data-theme-toggle]') && T) {
      const next = isLight() ? 'dark' : 'light';
      T.set(next); S?.prefs.set('theme', next); applyPrefs();
    }
    if (e.target.closest('[data-motion-toggle]') && T?.setMotion) {
      const next = T.getMotion() === 'reduced' ? 'full' : 'reduced';
      T.setMotion(next); S?.prefs.set('motion', next); applyPrefs();
      notify(next === 'reduced' ? 'האנימציות הופסקו.' : 'האנימציות הופעלו.', 'success');
    }
  });

  /** "הצביעו עכשיו": כשההצבעה במצעד פתוחה באתר הסקר */
  function voteBar(active) {
    const S = window.RoshStore;
    const sv = S?.settings?.survey;
    if (!sv?.open || !sv.url || active === 'admin') return '';
    return `<div class="site-banner vote" role="status"><span class="site-banner-mark" aria-hidden="true">✓</span><p>ההצבעה במצעד פתוחה${sv.name ? ` — <b>${esc(sv.name)}</b>` : ''}</p><a class="btn small primary" href="${esc(sv.url)}" target="_blank" rel="noopener">הצביעו עכשיו <span>←</span></a></div>`;
  }

  /** ההודעה בדף הבית (ובכל הדפים), אם מנהל הפעיל אותה ותאריך הסיום לא עבר */
  function banner() {
    const S = window.RoshStore;
    const b = S?.settings?.banner;
    if (!S?.bannerActive?.(b)) return '';
    const link = b.link ? `<a class="btn small" href="${esc(b.link)}" ${/^https?:/.test(b.link) ? 'target="_blank" rel="noopener"' : ''}>${esc(b.linkLabel || 'לפרטים')} <span>←</span></a>` : '';
    return `<div class="site-banner" role="status"><span class="site-banner-mark" aria-hidden="true">✦</span><p>${esc(b.text)}</p>${link}</div>`;
  }
  /** פס שמסמן שצופים בטיוטה דרך קישור תצוגה מקדימה */
  function previewBar() {
    const S = window.RoshStore;
    if (!S?.state?.preview) return '';
    return `<div class="site-banner preview" role="status"><span class="site-banner-mark" aria-hidden="true">👁</span><p>זו תצוגה מקדימה של טיוטה — כך האתר ייראה אחרי הפרסום.</p><a class="btn small" href="index.html?preview=">יציאה מהתצוגה</a></div>`;
  }

  function footer(site) {
    const links = (site?.links || []).filter((l) => !isDriveUrl(l.url)).map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
    ).join('');
    return `
<footer class="site-footer">
  <div class="footer-mark" aria-hidden="true">${esc(site?.name || 'ראש בראש')}</div>
  <div class="footer-row">
    <span>${esc(site?.name || 'ראש בראש')} · ${esc(site?.tagline || 'מוזיקה ואקטואליה')}</span>
    <nav aria-label="קישורים">${links}<a href="archive.html">הארכיון</a><a href="negishut.html">הצהרת נגישות</a><button type="button" class="chip" data-motion-toggle aria-pressed="${window.RoshTheme?.getMotion?.() === 'reduced'}">הפסקת אנימציות</button><button type="button" class="chip" data-kbd-help>קיצורי מקלדת</button></nav>
  </div>
</footer>`;
  }

  /* ---------- הודעה צפה אחת ---------- */

  let noticeTimer = null;
  function host() {
    let h = document.querySelector('.notice-host');
    if (!h) {
      h = document.createElement('div');
      h.className = 'notice-host';
      document.body.appendChild(h);
    }
    return h;
  }
  function inferTone(text) {
    if (/נכשל|שגיאה|לא הצלח|לא נמצא/.test(text)) return 'error';
    if (/נשמר|בהצלחה|הועתק|נמחק|פורסם/.test(text)) return 'success';
    if (/…$/.test(text)) return 'progress';
    return 'info';
  }
  function notify(text, tone, opts = {}) {
    tone = tone || inferTone(text);
    const h = host();
    h.innerHTML = '';
    clearTimeout(noticeTimer);
    const icon = tone === 'progress'
      ? '<span class="notice-spinner" aria-hidden="true"></span>'
      : `<span class="notice-icon" aria-hidden="true">${{ info: 'i', success: '✓', error: '!' }[tone]}</span>`;
    const el = document.createElement('div');
    el.className = `notice notice-${tone}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    el.innerHTML = `${icon}<p class="notice-text">${esc(text)}</p>${opts.action ? `<button type="button" class="btn small gold" data-action>${esc(opts.action)}</button>` : ''}<button type="button" class="notice-close" aria-label="סגירת ההודעה">×</button>`;
    h.appendChild(el);
    const close = () => { el.remove(); clearTimeout(noticeTimer); };
    el.querySelector('.notice-close').addEventListener('click', close);
    if (opts.action && opts.onAction) el.querySelector('[data-action]').addEventListener('click', () => { opts.onAction(); close(); });
    const ttl = opts.ttl ?? (tone === 'progress' ? 0 : tone === 'error' ? 8000 : 4200);
    const arm = () => { if (ttl) noticeTimer = setTimeout(close, ttl); };
    el.addEventListener('mouseenter', () => clearTimeout(noticeTimer));
    el.addEventListener('mouseleave', arm);
    arm();
    return close;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelector('.notice-host .notice-close')?.click();
  });

  /* ---------- דיאלוג קיצורי מקלדת ---------- */

  function kbdHelp() {
    let d = document.getElementById('kbd-help');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'kbd-help';
      d.className = 'sheet';
      d.innerHTML = `
<div class="section-title"><div><p class="kicker">עזרה</p><h2>קיצורי מקלדת</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><div class="kbd-list">
  <kbd>רווח</kbd><span>ניגון / השהיה</span>
  <kbd>→</kbd><span>קדימה 15 שניות</span>
  <kbd>←</kbd><span>אחורה 15 שניות</span>
  <kbd>Shift + →</kbd><span>לתוכנית הבאה</span>
  <kbd>Shift + ←</kbd><span>לתוכנית הקודמת</span>
  <kbd>0–9</kbd><span>קפיצה לאחוז מהתוכנית</span>
  <kbd>+ / −</kbd><span>מהירות</span>
  <kbd>M</kbd><span>השתקה / ביטול השתקה</span>
  <kbd>R</kbd><span>תוכנית אקראית</span>
  <kbd>/</kbd><span>חיפוש (בארכיון)</span>
  <kbd>?</kbd><span>החלון הזה</span>
</div></div>`;
      document.body.appendChild(d);
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    }
    d.showModal();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-kbd-help]')) kbdHelp();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !isTyping(e)) { e.preventDefault(); kbdHelp(); }
  });

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  /* ---------- תנועה: גילוי בגלילה, מספרים רצים, אור עוקב, כותרת דחוסה ---------- */

  const reduceMotion = () => (window.RoshTheme?.reducedMotion ? window.RoshTheme.reducedMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement?.dataset?.lite === '1';

  let revealObs = null;
  /** אנימציות שיצאו מהמסך נעצרות (האקולייזר, הסרט הנע, התקליט) — חוסך מעבד וסוללה בטלפון.
   *  כל אזור עם data-anim-zone מקבל offscreen כשהוא לא נראה. */
  let zoneIO = null;
  function pauseOffscreen(root = document) {
    if (typeof IntersectionObserver !== 'function' || typeof root?.querySelectorAll !== 'function') return;
    zoneIO ||= new IntersectionObserver((entries) => { for (const x of entries) x.target.classList.toggle('offscreen', !x.isIntersecting); }, { rootMargin: '80px 0px' });
    root.querySelectorAll('[data-anim-zone]:not([data-anim-watched])').forEach((el) => { el.setAttribute('data-anim-watched', ''); zoneIO.observe(el); });
  }

  function reveal(root = document) {
    pauseOffscreen(root);
    if (typeof root?.querySelectorAll !== 'function') return;
    const els = [...root.querySelectorAll('[data-reveal]:not(.in)')];
    if (!els.length) return;
    if (reduceMotion() || typeof IntersectionObserver !== 'function') { els.forEach((el) => el.classList.add('in')); return; }
    revealObs ||= new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revealObs.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach((el, i) => { el.style.setProperty('--i', String(i % 8)); revealObs.observe(el); });
  }

  function countUp(el, to, ms = 1400) {
    to = Number(to) || 0;
    if (reduceMotion() || !to) { el.textContent = String(to); return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** פסי אקולייזר מונפשים: n פסים עם עיכוב וגובה אקראיים אך יציבים. */
  function eqBars(n = 40, seed = 7) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const r = hash(`${seed}:${i}`);
      out += `<i style="--d:${((r % 900) / 1000).toFixed(2)}s;--p:${(.8 + (r % 700) / 1000).toFixed(2)}s;--hh:${18 + (r >> 8) % 78}%"></i>`;
    }
    return out;
  }

  function boot() {
    if (typeof document.querySelectorAll !== 'function' || !document.body) return; // סביבת בדיקה בלי DOM
    // שכבות הרקע: זוהר צפוני נע וגרעיניות עדינה
    if (!document.querySelector('.aurora')) {
      const a = document.createElement('div');
      a.className = 'aurora';
      a.setAttribute('aria-hidden', 'true');
      a.innerHTML = '<i></i><i></i><i></i><i></i>';
      document.body.prepend(a);
      const g = document.createElement('div');
      g.className = 'grain';
      g.setAttribute('aria-hidden', 'true');
      document.body.prepend(g);
    }
    // אור עוקב אחרי הסמן (רק עם עכבר)
    if (typeof matchMedia === 'function' && matchMedia('(hover:hover) and (pointer:fine)').matches && !reduceMotion()) {
      const spot = document.createElement('div');
      spot.className = 'spot';
      spot.setAttribute('aria-hidden', 'true');
      document.body.appendChild(spot);
      let raf = 0, x = 0, y = 0;
      window.addEventListener('pointermove', (e) => {
        x = e.clientX; y = e.clientY;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; spot.style.setProperty('--mx', `${x}px`); spot.style.setProperty('--my', `${y}px`); });
      }, { passive: true });
    }
    // כותרת נדחסת בגלילה
    const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    reveal();
    // כניסה / יציאה / אימות מול השרת: הכותרת מתעדכנת בלי לטעון את הדף מחדש
    // (store.js נטען אחרי הקובץ הזה, ולכן מתחברים אליו רק אחרי שכל הסקריפטים רצו)
    setTimeout(() => {
      const S = window.RoshStore;
      S?.onSession?.(() => repaintHeader());
      S?.me?.onChange?.(() => applyPrefs());
      S?.ready?.then(() => applyPrefs());
    }, 0);
  }
  function repaintHeader() {
    const h = document.getElementById('site-header');
    if (h && headerActive !== 'admin-embed' && h.innerHTML.trim()) h.innerHTML = header(headerActive, window.RoshStore?.site);
    applyPrefs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else if (document.readyState) boot();

  /* ---------- כרטיס תוכנית משותף (בית, ארכיון, אזור אישי, תצוגה מקדימה) ---------- */
  function seasonVars(seasonId) { return `--h:${seasonHue[seasonId] ?? (hash(seasonId || 'x') % 360)}`; }
  function epCard(e, { badge = '', titleHtml = null, href = null } = {}) {
    const S = window.RoshStore, Pl = window.RoshPlayer;
    const pos = S?.positions?.get(e.id);
    const total = e.duration || pos?.dur || 0;   // האורך השמור, או האורך שהנגן מדד
    const pct = pos && total ? Math.min(100, (pos.t / total) * 100) : 0;
    const playable = !!(e.stream || streamUrl(e));
    return `
<a class="ep-card${Pl?.isCurrent?.(e.id) ? ' current' : ''}" href="${href || `episode.html?ep=${encodeURIComponent(e.slug)}`}" data-ep="${esc(e.id)}" style="${coverVars(e)}">
  ${e.cover ? `<img class="ep-cover" src="${esc(e.thumb || e.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="cover-fallback num" aria-hidden="true">${e.number ?? '♫'}</span>`}
  ${e.number != null ? `<span class="ep-num">תוכנית ${e.number}</span>` : (e.season === 'sets' ? '<span class="ep-num">סט</span>' : '')}
  ${badge ? `<i class="ep-badge gold" aria-hidden="true">${badge}</i>` : (playable ? '<i class="ep-badge" aria-hidden="true">▶</i>' : '')}
  <b>${titleHtml ?? esc(e.title)}</b>
  <small>${esc(fmtDate(e.date, true))}${e.date ? ` · ${esc(fmtHebDate(e.date, true))}` : ''}${e.duration ? ` · ${esc(fmtDuration(e.duration))}` : ''}</small>
  ${pct ? `<span class="resume" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}
</a>`;
  }

  /* ---------- כפתורי פעולה לתוכנית: לאחר כך, תור, אהבתי ----------
     אותם כפתורים בדף הבית, בדף התוכנית ובאזור האישי. הלחיצה מטופלת כאן פעם
     אחת לכל האתר, וכל הכפתורים של אותה תוכנית בדף מתעדכנים יחד. */
  // כפתור עם אייקון (data-ico) — התווית קבועה, והמצב מוצג באייקון ובצבע (aria-pressed)
  function laterLabel(on, ico) { return ico ? 'לאחר כך' : on ? '✓ שמור לאחר כך' : '+ לאחר כך'; }
  function queueLabel(on, ico) { return ico ? 'לתור' : on ? '✓ בתור' : '+ לתור'; }
  /** כמה אהבו כל תוכנית — נתון שרק המנהלים רואים; למאזין מוצג רק הסימון שלו */
  function likeLabel(id, ico) { return ico ? 'אהבתי' : `${window.RoshStore?.likes?.has(id) ? '♥' : '♡'} אהבתי`; }
  /** icons: כפתורים עם אייקון ותווית (בדף התוכנית) במקום סימן בתחילת הטקסט */
  function actionButtons(e, { like = true, queue = true, icons = false } = {}) {
    const S = window.RoshStore;
    const ico = (name) => (icons ? ` data-ico="${name}"` : '');
    return `<button type="button" class="btn" data-later="${esc(e.id)}"${ico('later')} aria-pressed="${S.later.has(e.id)}">${laterLabel(S.later.has(e.id), icons)}</button>`
      + (queue && e.stream ? `<button type="button" class="btn" data-queue="${esc(e.id)}"${ico('queue')} aria-pressed="${S.queue.has(e.id)}">${queueLabel(S.queue.has(e.id), icons)}</button>` : '')
      + (like && S.sb.configured ? `<button type="button" class="btn like-btn" data-like="${esc(e.id)}"${ico('like')} aria-pressed="${S.likes.has(e.id)}">${likeLabel(e.id, icons)}</button>` : '');
  }
  function paintActions(id) {
    const S = window.RoshStore;
    document.querySelectorAll(`[data-later="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(S.later.has(id))); b.textContent = laterLabel(S.later.has(id), b.hasAttribute('data-ico')); });
    document.querySelectorAll(`[data-queue="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(S.queue.has(id))); b.textContent = queueLabel(S.queue.has(id), b.hasAttribute('data-ico')); });
    document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(S.likes.has(id))); b.innerHTML = likeLabel(id, b.hasAttribute('data-ico')); });
  }
  const accountHint = () => (window.RoshStore?.sb?.user ? '' : ' כדי שזה יישמר בחשבון, התחברו באזור האישי.');
  document.addEventListener('click', async (e) => {
    const S = window.RoshStore; if (!S) return;
    const later = e.target.closest?.('[data-later]');
    if (later && later.dataset.later) {
      const on = S.later.toggle(later.dataset.later); paintActions(later.dataset.later);
      notify((on ? 'נשמר לרשימת "לאחר כך".' : 'הוסר מרשימת "לאחר כך".') + accountHint(), 'success');
      return;
    }
    const q = e.target.closest?.('[data-queue]');
    if (q && q.dataset.queue) {
      const on = S.queue.toggle(q.dataset.queue); paintActions(q.dataset.queue);
      notify(on ? `נוסף לתור (${S.queue.list().length} בתור). כשהתוכנית הנוכחית תיגמר, היא תתחיל לבד.` : 'הוסר מהתור.', 'success');
      return;
    }
    const like = e.target.closest?.('[data-like]');
    if (like && like.dataset.like) {
      if (!S.sb.user) { notify('כדי לסמן "אהבתי" צריך להתחבר.', 'info', { action: 'להתחברות', onAction: () => (window.RoshApp ? window.RoshApp.navigate('me.html') : (location.href = 'me.html')) }); return; }
      like.disabled = true;
      try { await S.likes.toggle(like.dataset.like); paintActions(like.dataset.like); }
      catch (err) { notify(`לא הצלחנו לשמור: ${err.message}`, 'error'); }
      like.disabled = false;
    }
  });

  /* ---------- התראות לטלפון על תוכנית חדשה (Web Push) ---------- */
  const push = {
    supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:'; },
    async registration() {
      if (!navigator.serviceWorker.controller) await navigator.serviceWorker.register('sw.js').catch(() => null);
      return navigator.serviceWorker.ready;
    },
    /** 'unsupported' | 'denied' | 'on' | 'off' */
    async state() {
      if (!this.supported() || !window.RoshStore?.sb?.configured) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      try { const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise((r) => setTimeout(r, 1500))]); return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'; }
      catch { return 'off'; }
    },
    async enable() {
      const S = window.RoshStore;
      if (!this.supported()) throw new Error('הדפדפן הזה לא תומך בהתראות.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('לא ניתן אישור להתראות.');
      const reg = await this.registration();
      const { publicKey } = await S.sb.call('/api/program/push/key', { auth: false });
      const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(publicKey.length / 4) * 4, '='));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await S.sb.call('/api/program/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      return true;
    },
    async disable() {
      const S = window.RoshStore;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await S.sb.call('/api/program/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    },
  };

  /* ---------- הודעה למגישים ---------- */

  /** טופס "כתבו לנו": נשלח ל־Worker, בלי פרטים חובה מלבד הטקסט. */
  function messageForm({ episodeId = '', title = 'כתבו לנו', hint = 'שאלה, תגובה או בקשה — המגישים קוראים הכול.' } = {}) {
    const S = window.RoshStore;
    if (!S?.sb?.configured) return '';
    const u = S.sb.user;
    return `
<form class="message-form" data-message-form data-episode="${esc(episodeId)}">
  <p class="kicker">${esc(title)}</p>
  <p style="margin:0;color:var(--text-2)">${esc(hint)}</p>
  ${u ? `<p class="cue-hint" style="margin:0;font-size:12px;color:var(--muted);font-weight:700">נשלח בשם ${esc(u.name || u.email)}</p>` : '<label class="field"><span>שם (לא חובה)</span><input name="name" maxlength="80" autocomplete="name"></label>'}
  <label class="field"><span>ההודעה</span><textarea name="text" required maxlength="4000" placeholder="מה תרצו להגיד?"></textarea></label>
  <div><button type="submit" class="btn primary">שליחה <span>←</span></button></div>
</form>`;
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest?.('[data-message-form]'); if (!f) return;
    e.preventDefault();
    const S = window.RoshStore, btn = f.querySelector('button[type="submit"]');
    const text = f.elements.text.value.trim(); if (!text) return;
    btn.disabled = true;
    try {
      await S.sb.messages.send({ text, name: f.elements.name?.value || '', episodeId: f.dataset.episode || '' });
      f.innerHTML = '<p class="subscribe-state">✓ ההודעה נשלחה. תודה!</p>';
    } catch (err) { notify(`השליחה לא הצליחה: ${err.message}`, 'error'); btn.disabled = false; }
  });

  /* ---------- רשימת התפוצה: בלחיצה אחת עם חשבון Google ---------- */

  /** מריץ פעם אחת כשהאלמנט מתקרב לאזור הנראה (400px לפניו); בלי IntersectionObserver — מיד */
  function whenNear(el, fn) {
    if (!el || typeof IntersectionObserver !== 'function') { fn(); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '400px 0px' });
    io.observe(el);
  }

  /** מציג את מצב ההרשמה בתוך אלמנט: מחוברים → כפתור הצטרפות (והסרה — רק באזור האישי,
   *  data-subscribe-host="manage"); אחרת כפתור Google. */
  async function mountSubscribe(el) {
    const S = window.RoshStore;
    if (!el || !S?.sb?.configured) return;
    const u = S.sb.user;
    if (!u) {
      el.innerHTML = '<div class="subscribe-google"><span>מתחברים עם Google, וההצטרפות היא בלחיצה אחת — בלי להקליד כתובת.</span><div class="google-slot" data-google></div><a class="btn ghost small" href="#" data-subscribe-fallback>בעיה עם הכפתור? כניסה דרך אתר הסקר</a></div>';
      // הכפתור של Google (סקריפט חיצוני כבד) נטען רק כשהכרטיס מתקרב למסך — לא בטעינת הדף
      const slot = el.querySelector('[data-google]');
      whenNear(slot, async () => {
        try { await S.sb.google(slot, { onDone: () => mountSubscribe(el), onError: (err) => notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') }); }
        catch (err) { slot.innerHTML = `<span class="cue-hint">${esc(err.message)}</span>`; }
      });
      return;
    }
    el.innerHTML = '<span class="cue-hint">בודקים…</span>';
    let subscribed = false;
    try { subscribed = (await S.sb.subscribe.status()).subscribed; }
    // 401 = הטוקן של המכשיר הזה כבר לא תקף. מוחקים אותו כאן בלבד — לא S.signOut(), שמנתק את
    // החשבון מכל המכשירים ומאתר הסקר בגלל בדיקה שקטה ברקע
    catch (err) { if (err.status === 401) { S.forgetSession(); return mountSubscribe(el); } el.innerHTML = `<span class="cue-hint">${esc(err.message)}</span>`; return; }
    el.innerHTML = subscribed
      ? `<div class="subscribe-google"><span class="subscribe-state">✓ אתם ברשימת התפוצה (${esc(u.email)})</span>${el.dataset.subscribeHost === 'manage' ? '<button type="button" class="btn ghost small" data-unsubscribe>הסרה מהרשימה</button>' : ''}</div>`
      : `<div class="subscribe-google"><button type="button" class="continue btn xl primary" data-subscribe>הצטרפות לתפוצה <span>←</span></button><span class="cue-hint" style="font-size:12px;color:var(--muted);font-weight:700">הכתובת: ${esc(u.email)}. הלחיצה היא ההסכמה — בלי דואר מיותר.</span></div>`;
  }
  document.addEventListener('click', async (e) => {
    const S = window.RoshStore;
    const join = e.target.closest?.('[data-subscribe]'), leave = e.target.closest?.('[data-unsubscribe]'), fb = e.target.closest?.('[data-subscribe-fallback]');
    if (!join && !leave && !fb) return;
    e.preventDefault();
    const host = (join || leave || fb).closest('[data-subscribe-host]');
    try {
      if (join) { join.disabled = true; await S.sb.subscribe.join(); notify('נרשמתם לרשימת התפוצה.', 'success'); }
      else if (leave) { leave.disabled = true; await S.sb.subscribe.leave(); notify('הוסרתם מרשימת התפוצה.', 'success'); }
      else await S.sb.signIn();
    } catch (err) { notify(err.message, 'error'); }
    mountSubscribe(host);
  });

  window.RoshUI = { banner, messageForm, mountSubscribe, esc, fmtTime, parseTime, fmtDuration, fmtDate, fmtHebDate, fmtWeekday, slugify, qs, header, footer, repaintHeader, actionButtons, paintActions, push, notify, kbdHelp, isTyping, copy, driveId, isDriveUrl, streamUrl, streamCandidates, downloadUrl, shareUrl, publicLinks, coverVars, hue, seasonVars, epCard, reveal, pauseOffscreen, countUp, eqBars, reduceMotion, applyPrefs };
})();
