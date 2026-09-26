/* תוספות לאתר כולו. נטען פעם אחת (כמו הנגן) ונשאר במעבר בין דפים.
   1. מצב חג — לפי הלוח העברי (שעון ישראל) האתר מתקשט לבד בחגים: ברכה מתחת לשם
      התוכנית בכותרת (בחנוכה — חנוכייה עם מספר הנרות של היום), גוון חגיגי, ופעם אחת
      בביקור — קישוט שנופל בדף הבית. ?holiday=purim בכתובת מציג חג לבדיקה (off — בלי).
   2. לשונית חיה — בזמן ניגון הכותרת בלשונית היא "▶ שם התוכנית", והאייקון הוא תקליט
      שמסתובב. בהשהיה חוזרים הכותרת והאייקון של הדף.
   3. עטיפה חיה — העטיפה של התוכנית שמתנגנת עכשיו נושמת ופועמת, בכל מקום שהיא מופיעה.
   4. נגן צף — במחשב (כרום/אדג׳): חלון נגן קטן שנשאר מעל כל החלונות
      (Document Picture-in-Picture). בדפדפן שלא תומך הכפתור לא מוצג.
   כל התנועה כבויה כשהאנימציות מופחתות. */
(function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const Pl = () => window.RoshPlayer;
  const reduce = () => !!window.RoshTheme?.reducedMotion?.() || !!window.RoshTheme?.isLite?.();
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* */ } return null; };

  /* ---------- 1. מצב חג ---------- */

  const HEB = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' });
  function hebDate(at) { const p = Object.fromEntries(HEB.formatToParts(at).map((x) => [x.type, x.value])); return { day: Number(p.day), month: String(p.month) }; }
  const NER = ['', 'נר ראשון', 'נר שני', 'נר שלישי', 'נר רביעי', 'נר חמישי', 'נר שישי', 'נר שביעי', 'זאת חנוכה'];
  const DAY = 86400000;
  /** החג היום (או null). בשנה מעוברת פורים הוא באדר ב׳. */
  function holidayOn(at = new Date()) {
    const { day, month } = hebDate(at);
    const m = month === 'Adar II' ? 'Adar' : month;
    if (m === 'Tishri') {
      if (day <= 2) return { key: 'rosh-hashana', text: 'שנה טובה ומתוקה', icon: '🍎', hue: 12, rain: ['🍎', '🍯', '✨'] };
      if (day === 9 || day === 10) return { key: 'yom-kippur', text: 'גמר חתימה טובה', icon: '✦', hue: 45, quiet: true };
      if (day >= 15 && day <= 21) return { key: 'sukkot', text: day === 15 ? 'חג סוכות שמח' : day === 21 ? 'הושענא רבה — חג שמח' : 'מועדים לשמחה', icon: '🌿', hue: 95, rain: ['🌿', '🍋', '✨'] };
      if (day === 22) return { key: 'simchat-torah', text: 'שמחת תורה שמחה', icon: '📜', hue: 48, rain: ['🎉', '✨', '📜'] };
    }
    let n = 0;
    if (m === 'Kislev' && day >= 25) n = day - 24;
    if (m === 'Tevet' && day <= 3) n = hebDate(new Date(at.getTime() - day * DAY)).day - 24 + day;   // כסלו של 29 או 30 יום
    if (n >= 1 && n <= 8) return { key: 'hanukkah', text: `חנוכה שמח · ${NER[n]}`, candles: n, hue: 42, rain: ['✨', '🕯️', '✨'] };
    if (m === 'Shevat' && day === 15) return { key: 'tu-bishvat', text: 'ט״ו בשבט שמח', icon: '🌳', hue: 110, rain: ['🌳', '🍇', '🌰'] };
    if (m === 'Adar' && (day === 14 || day === 15)) return { key: 'purim', text: 'פורים שמח!', icon: '🎭', hue: 300, rain: ['🎭', '🎉', '🎊', '✨'] };
    if (m === 'Nisan' && day >= 15 && day <= 21) return { key: 'pesach', text: day === 15 ? 'חג פסח כשר ושמח' : day === 21 ? 'שביעי של פסח — חג שמח' : 'מועדים לשמחה', icon: '🍷', hue: 350, rain: ['🍷', '✨'] };
    if (m === 'Iyar' && day === 18) return { key: 'lag-baomer', text: 'ל״ג בעומר שמח', icon: '🔥', hue: 24, rain: ['🔥', '✨'] };
    if (m === 'Sivan' && day === 6) return { key: 'shavuot', text: 'חג שבועות שמח', icon: '🌾', hue: 80, rain: ['🌾', '🌸', '✨'] };
    return null;
  }
  /* לבדיקה ולהדגמה: ?holiday=hanukkah (נשמר ללשונית), ?holiday=off — בלי חג */
  const SAMPLE = { 'rosh-hashana': '2026-09-12', 'yom-kippur': '2026-09-21', sukkot: '2026-09-27', 'simchat-torah': '2026-10-03', hanukkah: '2026-12-07', 'tu-bishvat': '2027-01-23', purim: '2027-03-23', pesach: '2027-04-22', 'lag-baomer': '2027-05-25', shavuot: '2027-06-11' };
  try { const q = new URLSearchParams(location.search).get('holiday'); if (q != null) ss('rosh:holiday', q); } catch { /* */ }
  function current() {
    const forced = ss('rosh:holiday');
    if (forced === 'off') return null;
    if (forced && SAMPLE[forced]) return holidayOn(new Date(`${SAMPLE[forced]}T12:00:00Z`));
    return holidayOn();
  }
  /** חנוכייה קטנה: שמונה נרות והשמש באמצע; הנרות של היום דולקים (מימין לשמאל) */
  function menorah(n) {
    let out = '';
    for (let i = 0; i < 8; i++) {
      const x = i < 4 ? 3 + i * 4 : 23 + (i - 4) * 4;   // שמאל → ימין
      const lit = 7 - i < n;                               // הנר הראשון בצד ימין
      out += `<rect x="${x}" y="8" width="2" height="7" rx=".6" fill="currentColor" opacity=".75"/>${lit ? `<path d="M${x + 1} 3.2c1 1.2 1.3 2.2.8 3.1a.9.9 0 0 1-1.6 0c-.5-.9-.2-1.9.8-3.1z" fill="#ffb640"/>` : ''}`;
    }
    return `<svg class="menorah" viewBox="0 0 38 20" width="34" height="18" aria-hidden="true"><rect x="18" y="5" width="2" height="10" rx=".6" fill="currentColor"/><path d="M19 0.4c1 1.2 1.3 2.2.8 3.1a.9.9 0 0 1-1.6 0c-.5-.9-.2-1.9.8-3.1z" fill="#ffb640"/><path d="M3 15.5h32M19 15.5v3M13 19h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>${out}</svg>`;
  }
  function holidayLine() {
    const h = current(); if (!h) return '';
    return `${h.candles ? menorah(h.candles) : `<span class="holiday-icon" aria-hidden="true">${h.icon}</span>`}<span>${U.esc(h.text)}</span>`;
  }
  function paintHoliday() {
    const h = current();
    const b = document.body; if (!b) return;
    [...b.classList].filter((c) => c.startsWith('holiday-')).forEach((c) => b.classList.remove(c));
    b.classList.toggle('holiday', !!h);
    if (!h) { b.style.removeProperty('--holiday-hue'); return; }
    b.classList.add(`holiday-${h.key}`);
    b.style.setProperty('--holiday-hue', String(h.hue));
  }
  /** פעם אחת בביקור, בדף הבית: קישוט חגיגי שנופל לאט ונעלם */
  function rain() {
    const h = current();
    if (!h?.rain || reduce() || !document.getElementById('hero-title')) return;
    const key = `rosh:holiday-rain:${h.key}`;
    if (ss(key)) return; ss(key, '1');
    const layer = document.createElement('div'); layer.className = 'holiday-rain'; layer.setAttribute('aria-hidden', 'true');
    const n = matchMedia('(max-width: 760px)').matches ? 10 : 18;   // בטלפון פחות קישוטים
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.textContent = h.rain[i % h.rain.length];
      s.style.cssText = `--x:${Math.round(Math.random() * 100)}vw;--d:${(Math.random() * 1.8).toFixed(2)}s;--t:${(4 + Math.random() * 2.5).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg;--s:${(.8 + Math.random() * .8).toFixed(2)}`;
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 9000);
  }
  window.RoshHoliday = { current, line: holidayLine, on: holidayOn };
  paintHoliday();
  S?.ready?.then(() => setTimeout(rain, 600));

  /* ---------- 2. לשונית חיה: כותרת ואייקון בזמן ניגון ---------- */

  const titleEl = () => document.querySelector('title');
  let pageTitle = document.title, ourTitle = '';
  let favLink = null, favHref = '', favTimer = 0, favAngle = 0;
  const fav = document.createElement('canvas'); fav.width = fav.height = 64;
  function drawFavicon(ep) {
    const x = fav.getContext('2d'), c = 32;
    x.clearRect(0, 0, 64, 64);
    x.save(); x.translate(c, c); x.rotate(favAngle);
    x.beginPath(); x.arc(0, 0, 31, 0, Math.PI * 2); x.fillStyle = '#0b0d14'; x.fill();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 1.2;
    for (const r of [26, 21, 17]) { x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); }
    x.beginPath(); x.arc(0, 0, 12, 0, Math.PI * 2); x.fillStyle = `hsl(${U.hue(ep)} 85% 60%)`; x.fill();
    x.beginPath(); x.arc(0, 0, 2.6, 0, Math.PI * 2); x.fillStyle = '#0b0d14'; x.fill();
    // ברק על התקליט — מה שמראה שהוא מסתובב
    x.beginPath(); x.arc(0, 0, 24, -.5, .35); x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3; x.lineCap = 'round'; x.stroke();
    x.restore();
    if (favLink) favLink.href = fav.toDataURL('image/png');
  }
  function favStart(ep) {
    favLink = document.querySelector('link[rel="icon"]');
    if (!favLink) return;
    if (!favHref) favHref = favLink.getAttribute('href');
    favLink.type = 'image/png';
    clearInterval(favTimer);
    drawFavicon(ep);
    if (!reduce()) favTimer = setInterval(() => { favAngle += .45; drawFavicon(ep); }, 160);
  }
  function favStop() {
    clearInterval(favTimer); favTimer = 0;
    if (favLink && favHref) { favLink.href = favHref; favLink.type = 'image/svg+xml'; }
    favHref = '';
  }
  function setTitle(t) { if (document.title !== t) { ourTitle = t; document.title = t; } }
  function paintTab() {
    const p = Pl(), ep = p?.episode, playing = !!ep && !p.paused;
    if (playing) { setTitle(`▶ ${ep.title} · ${S?.site?.name || 'ראש בראש'}`); favStart(ep); }
    else { if (ourTitle && document.title === ourTitle) setTitle(pageTitle); ourTitle = ''; favStop(); }
  }
  // הכותרת של הדף משתנה במעבר בין דפים — שומרים אותה, ומחזירים את "▶" אם מנגנים
  new MutationObserver(() => {
    if (document.title === ourTitle) return;
    pageTitle = document.title;
    if (Pl()?.episode && !Pl().paused) paintTab();
  }).observe(document.head, { subtree: true, childList: true, characterData: true });
  if (!titleEl()) document.head.appendChild(document.createElement('title'));

  /* ---------- 3. עטיפה חיה: התוכנית שמתנגנת נושמת ופועמת ---------- */

  const liveStyle = document.createElement('style');
  liveStyle.id = 'now-playing-style';
  document.head.appendChild(liveStyle);
  function paintCover() {
    const id = Pl()?.episode?.id;
    if (!id) { liveStyle.textContent = ''; return; }
    const sel = `[data-ep="${CSS.escape(id)}"]`;
    liveStyle.textContent = `body.is-playing .ep-card${sel} .ep-cover, body.is-playing .ep-card${sel} .cover-fallback, body.is-playing .featured-card${sel} .cover { animation: cover-beat var(--beat, .6s) ease-in-out infinite; }
body.is-playing .ep-card${sel}, body.is-playing .featured-card${sel} .cover { --glow: hsl(var(--h, 42) 90% 62% / .5); }`;
  }

  /* ---------- 4. נגן צף (Document Picture-in-Picture) ---------- */

  let pip = null;
  const canPip = 'documentPictureInPicture' in window && window.isSecureContext;
  const PIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 12h6v5h-6z" fill="currentColor"/></svg>';
  function addPipButton() {
    if (!canPip) return;
    const extra = document.querySelector('#dock .dock-extra');
    if (!extra || extra.querySelector('[data-pip]')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'dock-btn hide-sm'; b.dataset.pip = '';
    b.setAttribute('aria-label', 'נגן צף — חלון קטן מעל כל החלונות'); b.title = 'נגן צף — חלון קטן מעל כל החלונות';
    b.innerHTML = PIP_ICON;
    b.addEventListener('click', () => (pip ? pip.close() : openPip()));
    extra.prepend(b);
  }
  async function openPip() {
    const p = Pl(); if (!p?.episode) return;
    let w;
    try { w = await window.documentPictureInPicture.requestWindow({ width: 360, height: 200 }); }
    catch { U.notify('לא הצלחנו לפתוח נגן צף.', 'error'); return; }
    pip = w;
    const d = w.document;
    d.documentElement.lang = 'he'; d.documentElement.dir = 'rtl';
    const theme = document.documentElement.getAttribute('data-theme'); if (theme) d.documentElement.setAttribute('data-theme', theme);
    d.title = 'ראש בראש — נגן צף';
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => { const n = d.createElement('link'); n.rel = 'stylesheet'; n.href = l.href; d.head.appendChild(n); });
    d.body.className = 'pip-body';
    d.body.innerHTML = `
<div class="pip">
  <div class="pip-art" data-art></div>
  <div class="pip-main">
    <b class="pip-title" data-title></b>
    <div class="pip-bar"><i data-fill></i></div>
    <small class="pip-time" data-time></small>
    <div class="pip-controls">
      <button type="button" class="dock-btn dock-skip" data-back aria-label="15 שניות אחורה">−15</button>
      <button type="button" class="dock-play" data-toggle aria-label="ניגון או השהיה"></button>
      <button type="button" class="dock-btn dock-skip" data-fwd aria-label="15 שניות קדימה">+15</button>
      <button type="button" class="dock-btn" data-next aria-label="לתוכנית הבאה">⏭</button>
    </div>
  </div>
</div>`;
    const q = (s) => d.querySelector(s);
    q('[data-toggle]').addEventListener('click', () => Pl().toggle());
    q('[data-back]').addEventListener('click', () => Pl().seek(Pl().time - 15));
    q('[data-fwd]').addEventListener('click', () => Pl().seek(Pl().time + 15));
    q('[data-next]').addEventListener('click', () => Pl().nextEpisode());
    q('.pip-bar').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); Pl().seek(((r.right - e.clientX) / r.width) * Pl().duration); });
    w.addEventListener('pagehide', () => { pip = null; document.body.classList.remove('pip-open'); });
    document.body.classList.add('pip-open');
    paintPip(true);
  }
  function paintPip(full) {
    if (!pip) return;
    const d = pip.document, p = Pl(), ep = p?.episode; if (!ep) return;
    const q = (s) => d.querySelector(s);
    if (full || q('[data-title]').textContent !== ep.title) {
      q('[data-title]').textContent = ep.title;
      const art = q('[data-art]'); art.style.setProperty('--h', String(U.hue(ep)));
      art.innerHTML = ep.cover ? `<img src="${U.esc(ep.thumb || ep.cover)}" alt="">` : `<span>${ep.number ?? '♫'}</span>`;
    }
    const dur = p.duration || 0, t = p.time || 0;
    q('[data-fill]').style.width = `${dur ? Math.min(100, t / dur * 100) : 0}%`;
    q('[data-time]').textContent = `${U.fmtTime(t)} / ${U.fmtTime(dur)}`;
    const btn = q('[data-toggle]'); btn.textContent = p.paused ? '▶' : '❚❚'; btn.dataset.state = p.paused ? 'paused' : 'playing';
    d.body.classList.toggle('is-playing', !p.paused);
  }

  /* ---------- חיבור לנגן ---------- */

  let lastEp = '';
  window.addEventListener('rosh:player', (e) => {
    const type = e.detail?.type;
    if (type === 'time') { paintPip(); return; }
    const id = Pl()?.episode?.id || '';
    if (id !== lastEp) { lastEp = id; paintCover(); }
    if (type === 'episode') addPipButton();
    if (type === 'close' && pip) pip.close();
    paintTab(); paintPip(type === 'episode');
  });
  // שינוי בהגדרת התנועה — האייקון בלשונית מפסיק / מתחיל להסתובב
  document.addEventListener('rosh:themechange', () => { if (Pl()?.episode && !Pl().paused) favStart(Pl().episode); paintHoliday(); });
})();
