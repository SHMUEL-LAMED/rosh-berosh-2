/* דף הבית: גיבור עם אקולייזר וסרט נע, התוכנית האחרונה על תקליט, המשך האזנה,
   תוכניות אחרונות, סטים, מספרים רצים והקהילה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration } = U;

  // האות נלקח לפני ההמתנה: אם עברו לדף אחר בזמן שהקטלוג נטען, הסקריפט הזה לא מצייר על הדף החדש
  const signal = window.RoshApp?.signal;
  await S.ready;
  if (signal?.aborted) return;
  const on = { signal };   // המאזינים מוסרים במעבר לדף אחר
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('home', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  document.title = `${site.name || 'ראש בראש'} — ${site.tagline || 'מוזיקה ואקטואליה'}`;
  for (const [sel, key] of [['[data-site-name]', 'name'], ['[data-site-tagline]', 'tagline'], ['[data-site-description]', 'description']]) {
    const el = document.querySelector(sel); if (el && site[key]) { el.textContent = site[key]; if (el.dataset.text != null) el.dataset.text = site[key]; }
  }

  if (S.state.loadedFrom === 'json-fallback') U.notify('החיבור למקור הנתונים נכשל — מוצג העותק השמור באתר.', 'info', { ttl: 6000 });
  else if (S.state.error && S.state.loadedFrom !== 'json-slow') U.notify('טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => location.reload(), ttl: 0 });

  const list = S.episodes();
  const feat = S.featured();
  const shows = list.filter((e) => e.season !== 'sets');

  /* ---------- גיבור ---------- */
  document.getElementById('hero-eq').innerHTML = U.eqBars(56, 3);
  const live = document.getElementById('hero-live');
  if (feat) {
    live.hidden = false;
    live.querySelector('[data-live-label]').textContent = feat.featured && feat.id !== S.latest()?.id ? 'מומלץ עכשיו' : 'התוכנית האחרונה';
    live.querySelector('[data-live-title]').textContent = feat.number != null ? `תוכנית ${feat.number} · ${feat.title}` : feat.title;
  }
  const playLatest = document.querySelector('[data-play-latest]');
  const latestPlayable = (feat?.stream ? feat : null) || shows.find((e) => e.stream) || null;
  if (!latestPlayable) playLatest.hidden = true;

  // סרט נע: כל התוכניות בלולאה, פעמיים כדי שהמעבר יהיה חלק. קישוט בלבד (aria-hidden) —
  // ולכן הקישורים מחוץ לסדר המעבר במקלדת, אבל עדיין אפשר ללחוץ עליהם בעכבר
  const tick = shows.slice(0, 40).map((e) => `<a href="episode.html?ep=${encodeURIComponent(e.slug)}" tabindex="-1">${e.number != null ? `<small>${e.number}</small>` : ''}<b>${esc(e.title)}</b></a>`).join('');
  const ticker = document.getElementById('ticker');
  ticker.innerHTML = tick ? `<div class="ticker-track">${tick}${tick}</div>` : '';

  /* ---------- התוכנית האחרונה ---------- */
  const F = document.getElementById('featured');
  if (!feat) {
    // קישור לניהול מוצג רק למנהלים
    F.innerHTML = `<div class="card"><div class="state"><span class="mark">♫</span><h3>עדיין אין תוכניות</h3><p>${S.sb.user?.isAdmin ? 'הוסיפו את התוכנית הראשונה מאזור הניהול.' : 'התוכניות יעלו לכאן בקרוב.'}</p>${S.sb.user?.isAdmin ? '<a class="btn primary" href="admin.html">לאזור הניהול <span>←</span></a>' : ''}</div></div>`;
  } else {
    const season = S.seasons().find((s) => s.id === feat.season);
    F.innerHTML = `
<article class="card featured-card" data-ep="${esc(feat.id)}" style="${U.coverVars(feat)}">
  <div class="section-title">
    <div><p class="kicker">${feat.featured ? 'התוכנית המומלצת' : 'התוכנית האחרונה'}${season ? ` · ${esc(season.title)}` : ''}</p><h2>${esc(feat.title)}</h2></div>
    ${feat.number != null ? `<strong>תוכנית ${feat.number}</strong>` : ''}
  </div>
  <div class="ep-hero">
    <div class="cover">${feat.cover ? `<img src="${esc(feat.cover)}" alt="" fetchpriority="high" decoding="async">` : `<div class="vinyl live" data-num="${feat.number ?? '♫'}" style="--label:${U.hue(feat)}" data-vinyl="${esc(feat.id)}"><i></i></div>`}</div>
    <div>
      <div class="meta">
        ${feat.date ? `<span class="pill">${esc(U.fmtWeekday(feat.date))}, ${esc(fmtDate(feat.date))}</span><span class="pill">${esc(U.fmtHebDate(feat.date))}</span>` : ''}
        ${feat.duration ? `<span class="pill teal">${esc(fmtDuration(feat.duration))}</span>` : ''}
        ${feat.guests.length ? `<span class="pill navy">עם ${esc(feat.guests.join(', '))}</span>` : ''}
        ${feat.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}
      </div>
      <p class="desc">${esc(feat.description)}</p>
      <div class="actions">
        ${feat.stream ? `<button type="button" class="btn xl primary" data-play="${esc(feat.id)}">האזנה לתוכנית <span>▶</span></button>` : '<span class="pill">אין עדיין הקלטה לתוכנית הזו</span>'}
        <a class="btn" href="episode.html?ep=${encodeURIComponent(feat.slug)}">לדף התוכנית</a>
        ${U.actionButtons(feat)}
      </div>
    </div>
  </div>
</article>`;
  }

  /* ---------- המשך האזנה ----------
     מצויר שוב כשהנתונים האישיים משתנים — גם כשהם מגיעים מהחשבון אחרי שהדף כבר צויר
     (ready לא מחכה להם יותר מ־2.5 שניות). */
  const R = document.getElementById('resume');
  let resumeHtml = '';
  function renderResume() {
    const resumable = S.positions.resumable().filter((r) => r.episode.id !== feat?.id).slice(0, 4);
    const html = resumable.length ? `
<div class="grid-head"><div><p class="kicker">ממשיכים</p><h2>מאיפה שעצרתם</h2></div><a href="me.html">לאזור האישי ←</a></div>
<div class="row-list">
  ${resumable.map((r) => `
  <div class="row" data-ep="${esc(r.episode.id)}">
    <button type="button" class="row-main" data-cue="${esc(r.episode.id)}" data-at="${r.t}">
      <i aria-hidden="true">▶</i>
      <span class="txt"><b>${esc(r.episode.title)}</b><small>נשארו ${esc(fmtDuration(Math.max(60, (r.dur || r.episode.duration) - r.t)))}</small></span>
    </button>
    <span class="time">${fmtTime(r.t)}</span>
  </div>`).join('')}
</div>` : '';
    if (html === resumeHtml) return;
    resumeHtml = html;
    const focused = R.contains(document.activeElement) ? document.activeElement.dataset.cue : null;
    R.classList.toggle('grid-section', !!html);
    if (html) R.setAttribute('data-reveal', '');
    R.innerHTML = html;
    if (focused) R.querySelector(`[data-cue="${CSS.escape(focused)}"]`)?.focus();   // הפוקוס לא הולך לאיבוד בציור מחדש
  }
  renderResume();
  const offData = S.me.onChange(() => {
    clearTimeout(renderResume.t);
    renderResume.t = setTimeout(() => {
      if (on.signal?.aborted) return;
      renderResume(); U.reveal();
      if (feat) U.paintActions(feat.id);   // "לאחר כך" / "בתור" של התוכנית המומלצת
    }, 300);
  });
  on.signal?.addEventListener('abort', () => { offData(); clearTimeout(renderResume.t); });

  /* ---------- תוכניות אחרונות ---------- */
  const recent = shows.filter((e) => e.id !== feat?.id).slice(0, 8);
  const Rc = document.getElementById('recent');
  Rc.setAttribute('data-reveal', '');
  Rc.innerHTML = recent.length ? `
<div class="grid-head"><div><p class="kicker">ארכיון</p><h2>תוכניות אחרונות</h2></div><a href="archive.html">לכל ${list.length} התוכניות ←</a></div>
<div class="ep-grid">${recent.map((e) => U.epCard(e)).join('')}</div>` : '';

  // הסימון "אהבתי" של המאזין (כמה אהבו בסך הכול — רק המנהלים רואים)
  S.likes.load().then(() => { if (!on.signal?.aborted && feat) U.paintActions(feat.id); });

  /* ---------- סטים ---------- */
  const sets = list.filter((e) => e.season === 'sets');
  const Se = document.getElementById('sets');
  Se.setAttribute('data-reveal', '');
  Se.innerHTML = sets.length ? `<div class="grid-head"><div><p class="kicker">רק המוזיקה</p><h2>סטים מיוחדים</h2></div><a href="archive.html?season=sets">לכל הסטים ←</a></div><div class="ep-grid">${sets.map((e) => U.epCard(e)).join('')}</div>` : '';

  /* ---------- מספרים ---------- */
  const St = document.getElementById('stats');
  const nShows = list.filter((e) => e.season !== 'sets' && e.season !== 'legacy').length;
  St.setAttribute('data-reveal', '');
  St.innerHTML = list.length ? `
<div class="stats">
  <div class="stat"><b data-count="${nShows}">0</b><small>תוכניות ופרקי בונוס</small></div>
  <div class="stat"><b data-count="${sets.length}">0</b><small>סטים מיוחדים</small></div>
</div>` : '';

  /* ---------- הקהילה: פרטי הקשר נערכים בניהול ---------- */
  const ICONS = {
    phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
    chat: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4.3 3.4A.5.5 0 0 1 4 20V5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8.5" cy="10.5" r="1.3"/><circle cx="12" cy="10.5" r="1.3"/><circle cx="15.5" cy="10.5" r="1.3"/>',
    write: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const icon = (k) => `<span class="way-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[k]}</svg></span>`;
  function communityHtml() {
    const c = S.settings.contacts || {};
    const tel = (n) => String(n || '').replace(/[^\d+]/g, '');
    const mail = (subject) => (c.email ? `mailto:${esc(c.email)}?subject=${encodeURIComponent(subject)}` : '');
    const phone = c.phone || c.phone2 || c.phoneNote ? `
  <article class="way" style="--way:var(--gold-rgb)">${icon('phone')}
    <p class="kicker">קו התוכן</p><h3>גם בטלפון</h3>
    ${c.phoneNote ? `<p>${esc(c.phoneNote)}</p>` : ''}
    <div class="way-foot">${c.phone ? `<a class="btn primary way-phone" href="tel:${tel(c.phone)}" dir="ltr">${esc(c.phone)}</a>` : ''}${c.phone2 ? `<small>מספר נוסף: <a href="tel:${tel(c.phone2)}" dir="ltr">${esc(c.phone2)}</a></small>` : ''}</div>
  </article>` : '';
    const chat = c.hostsNote || c.email || c.chatNote ? `
  <article class="way" style="--way:var(--violet-rgb)">${icon('chat')}
    <p class="kicker">מדברים איתנו</p><h3>הקול שלכם</h3>
    ${c.hostsNote ? `<p>${esc(c.hostsNote)}</p>` : ''}
    <div class="way-foot">${c.email ? `<a class="btn" href="${mail("צרף לצ'אט")}">בקשת הצטרפות לצ׳אט <span>←</span></a>` : ''}${c.chatNote ? `<small>${esc(c.chatNote)}</small>` : ''}</div>
  </article>` : '';
    const form = U.messageForm({ title: '', hint: 'שאלה, תגובה, בקשה לשיר או רעיון לפרק — המגישים קוראים כל הודעה.' });
    const write = form ? `
  <article class="way way-write" style="--way:56 225 255">${icon('write')}
    <p class="kicker">כתבו כאן</p><h3>ישר למגישים</h3>${form}
  </article>` : '';
    return `<div class="community-ways">${phone}${chat}${write}</div>`;
  }

  /* ---------- הקהילה ---------- */
  const links = U.publicLinks({ links: site.links || [] });
  const Fo = document.getElementById('follow');
  Fo.setAttribute('data-reveal', '');
  Fo.innerHTML = `
<div class="community">
  <header class="community-head">
    <p class="kicker">הקהילה</p>
    <h2>בואו להיות חלק מהשיחה</h2>
    <p>ראש בראש נבנית גם מהמאזינים: השאלות, התגובות והבקשות שלכם מגיעות לשידור. בחרו איך הכי נוח לכם להיות בקשר.</p>
  </header>
  <section class="subscribe-card">
    <div class="subscribe-copy"><b>נשארים בראש</b><small>התוכנית החדשה ישירות למייל, בכל שבועיים.${S.sb.configured ? '' : ' שלחו בקשת הצטרפות לתפוצה.'}</small></div>
    ${S.sb.configured ? '<div data-subscribe-host></div>' : `<a class="continue btn xl primary" href="mailto:${esc(S.settings.contacts?.email || '')}?subject=${encodeURIComponent('צרף')}">הצטרפות לתפוצה</a>`}
  </section>
  ${communityHtml()}
  ${links.length ? `<nav class="community-links" aria-label="עוד מקומות לעקוב">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</nav>` : ''}
</div>`;
  U.mountSubscribe(Fo.querySelector('[data-subscribe-host]'));

  U.reveal();

  // מספרים רצים כשהלוח נכנס למסך
  const counters = [...document.querySelectorAll('[data-count]')];
  if (counters.length) {
    const run = () => counters.forEach((el) => U.countUp(el, Number(el.dataset.count)));
    if (typeof IntersectionObserver === 'function' && !U.reduceMotion()) {
      const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { run(); io.disconnect(); } }, { threshold: .2 });
      io.observe(St);
    } else run();
  }

  /* ---------- אירועים ---------- */
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-play-latest]')) { if (latestPlayable) Pl.isCurrent(latestPlayable.id) ? Pl.toggle() : Pl.load(latestPlayable); return; }
    if (e.target.closest('[data-random]')) { Pl.random(); return; }
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    const cue = e.target.closest('[data-cue]');
    if (cue) {
      const ep = S.byId(cue.dataset.cue); if (!ep) return;
      const at = Number(cue.dataset.at) || 0;
      if (Pl.isCurrent(ep.id)) { Pl.seek(at); Pl.play(); } else Pl.load(ep, { at });
      return;
    }
  }, on);

  window.addEventListener('rosh:player', (ev) => {
    const { episode } = ev.detail;
    document.querySelectorAll('.ep-card').forEach((c) => c.classList.toggle('current', !!episode && c.dataset.ep === episode.id));
    if (feat && episode?.id === feat.id) {
      const btn = F.querySelector('[data-play]');
      if (btn) btn.innerHTML = Pl.paused ? 'האזנה לתוכנית <span>▶</span>' : 'השהיה <span>■</span>';
    }
    if (latestPlayable && episode?.id === latestPlayable.id) playLatest.innerHTML = Pl.paused ? 'האזנה לתוכנית האחרונה <span>▶</span>' : 'מתנגן עכשיו <span>■</span>';
    document.querySelectorAll('[data-vinyl]').forEach((v) => v.classList.toggle('live', !!episode && v.dataset.vinyl === episode.id));
  }, on);
})();
