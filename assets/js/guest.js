/* דף המגישים והאורחים.
   guest.html            — המגישים (מהניהול, בסדר שנקבע שם) ומתחתם כל האורחים, עם חיפוש.
   guest.html?host=<שם>  — דף של מגיש: התמונה, התפקיד, המילים עליו, קישורים, והתוכניות מהעונות שהגיש.
   guest.html?g=<שם>     — דף של אורח אחד: התמונה, שורת התפקיד והמילים שנכתבו עליו בניהול,
                           קישורים, וכל התוכניות שהתארח בהן (מהחדשה לישנה), עם "האזנה ברצף".
   האורחים נגזרים מהתוכניות הציבוריות (RoshStore.guests); הפרופיל נכתב בניהול (settings.guests). */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const { esc, fmtDate } = U;
  const signal = window.RoshApp?.signal;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('guest', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);
  const box = document.getElementById('guest');

  /** צבע קבוע לכל אורח (לעיגול עם האות הראשונה, כשאין תמונה) */
  const hueOf = (key) => { let h = 2166136261; for (const c of key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 360; };
  const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('');
  const avatar = (g, cls = '') => g.profile?.photo
    ? `<img class="guest-avatar ${cls}" src="${esc(g.profile.photo)}" alt="" loading="lazy" decoding="async">`
    : `<img class="guest-avatar ${cls}" src="assets/img/anonymous-profile.svg" alt="" loading="lazy">`;
  const hostAvatar = (h, cls = '') => h.photo
    ? `<img class="guest-avatar ${cls}" src="${esc(h.photo)}" alt="" loading="lazy" decoding="async">`
    : `<img class="guest-avatar ${cls}" src="assets/img/anonymous-profile.svg" alt="" loading="lazy">`;
  const years = (eps) => {
    const ys = eps.map((e) => Number(String(e.date || '').slice(0, 4))).filter(Boolean);
    if (!ys.length) return '';
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  const plural = (n) => (n === 1 ? 'תוכנית אחת' : `${n} תוכניות`);

  const name = (U.qs('g') || '').trim(), hostName = (U.qs('host') || '').trim();
  if (hostName) renderHost(hostName); else if (name) renderGuest(name); else renderAll();
  U.reveal();

  function renderGuest(wanted) {
    const g = S.guest(wanted);
    if (!g) {
      document.title = 'אורח לא נמצא — ראש בראש';
      box.innerHTML = `<div class="card"><div class="state"><span class="mark">?</span><h3>לא מצאנו אורח בשם „${esc(wanted)}”</h3><p>ייתכן שהשם נכתב אחרת. אפשר לחפש ברשימת כל האורחים.</p><div class="actions"><a class="btn primary" href="guest.html">לכל האורחים <span>←</span></a></div></div></div>`;
      return;
    }
    document.title = `${g.name} — אורח בראש בראש`;
    const p = g.profile || {};
    const playable = g.episodes.filter((e) => e.stream || U.streamUrl(e));
    const first = g.episodes[g.episodes.length - 1], last = g.episodes[0];
    const facts = [plural(g.count), years(g.episodes), last?.date ? `לאחרונה: ${fmtDate(last.date)}` : ''].filter(Boolean);
    box.innerHTML = `
<article class="card guest-hero" style="--h:${hueOf(g.key)}" data-reveal>
  <div class="guest-hero-media">${avatar(g, 'xl')}</div>
  <div class="guest-hero-text">
    <p class="kicker"><a href="guest.html">המגישים והאורחים</a> · ${g.panelist ? 'חבר פאנל' : 'אורח בתוכנית'}</p>
    <h1>${esc(g.name)}</h1>
    ${p.role ? `<p class="guest-role">${esc(p.role)}</p>` : ''}
    <p class="guest-facts">${facts.map(esc).join('<i aria-hidden="true">·</i>')}</p>
    ${p.bio ? `<div class="guest-bio">${p.bio.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
    <div class="actions">
      ${playable.length ? `<button type="button" class="btn primary" data-play-all>▶ ${playable.length > 1 ? `האזנה ברצף ל־${playable.length} התוכניות` : 'האזנה לתוכנית'}</button>` : ''}
      ${(p.links || []).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || new URL(l.url).hostname.replace(/^www\./, ''))} ↗</a>`).join('')}
      <button type="button" class="btn ghost" data-share-guest>שיתוף הדף</button>
    </div>
  </div>
</article>
<section class="grid-section">
  <div class="grid-head"><div><p class="kicker">${first && first !== last && first.date ? `מאז ${esc(fmtDate(first.date))}` : 'להאזנה'}</p><h2>התוכניות עם ${esc(g.name)}</h2></div><a href="archive.html?guest=${encodeURIComponent(g.name)}">בארכיון ←</a></div>
  <div class="ep-grid">${g.episodes.map((e) => U.epCard(e)).join('')}</div>
</section>`;

    box.querySelector('[data-play-all]')?.addEventListener('click', () => {
      // הראשונה מתנגנת עכשיו, והשאר נכנסות לתור לפי הסדר — מהישנה לחדשה, כמו שהיו בשידור
      const [head, ...rest] = playable.slice().reverse();
      rest.forEach((e) => S.queue.add(e.id));
      window.RoshPlayer?.load(head);
      if (rest.length) U.notify(`${rest.length === 1 ? 'תוכנית נוספת נכנסה' : `${rest.length} תוכניות נוספות נכנסו`} לתור.`, 'success');
    }, { signal });
    box.querySelector('[data-share-guest]')?.addEventListener('click', async () => {
      const url = new URL(`guest.html?g=${encodeURIComponent(g.name)}`, document.baseURI).href;
      if (navigator.share) { try { await navigator.share({ title: `${g.name} בראש בראש`, url }); return; } catch { /* בוטל — ממשיכים להעתקה */ } }
      const copied = await U.copy(url);
      U.notify(copied ? 'הקישור לדף הועתק.' : url, copied ? 'success' : 'info');
    }, { signal });
  }

  /** "האזנה ברצף": הראשונה מתנגנת עכשיו, והשאר נכנסות לתור — מהישנה לחדשה, כמו שהיו בשידור */
  function playAll(list) {
    const [head, ...rest] = list.slice().reverse();
    rest.forEach((e) => S.queue.add(e.id));
    window.RoshPlayer?.load(head);
    if (rest.length) U.notify(`${rest.length === 1 ? 'תוכנית נוספת נכנסה' : `${rest.length} תוכניות נוספות נכנסו`} לתור.`, 'success');
  }
  async function share(url, title) {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { /* בוטל — ממשיכים להעתקה */ } }
    const copied = await U.copy(url);
    U.notify(copied ? 'הקישור לדף הועתק.' : url, copied ? 'success' : 'info');
  }

  function renderHost(wanted) {
    const h = S.host(wanted);
    if (!h) {
      document.title = 'מגיש לא נמצא — ראש בראש';
      box.innerHTML = `<div class="card"><div class="state"><span class="mark">?</span><h3>לא מצאנו מגיש בשם „${esc(wanted)}”</h3><div class="actions"><a class="btn primary" href="guest.html">למגישים ולאורחים <span>←</span></a></div></div></div>`;
      return;
    }
    document.title = `${h.name} — מגיש בראש בראש`;
    const eps = h.episodes;
    const playable = eps.filter((e) => e.stream || U.streamUrl(e));
    const seasons = S.seasons().filter((s) => h.seasons.includes(s.id));
    const facts = [h.current ? 'מגיש כיום' : 'מגיש לשעבר', eps.length ? plural(eps.length) : '', years(eps)].filter(Boolean);
    box.innerHTML = `
<article class="card guest-hero host-hero" style="--h:${hueOf(h.key)}" data-reveal>
  <div class="guest-hero-media">${hostAvatar(h, 'xl')}</div>
  <div class="guest-hero-text">
    <p class="kicker"><a href="guest.html">המגישים והאורחים</a> · ${h.current ? 'מגיש התוכנית' : 'מגיש לשעבר'}</p>
    <h1>${esc(h.name)}</h1>
    ${h.role ? `<p class="guest-role">${esc(h.role)}</p>` : ''}
    <p class="guest-facts">${facts.map(esc).join('<i aria-hidden="true">·</i>')}</p>
    ${h.bio ? `<div class="guest-bio">${h.bio.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
    ${seasons.length ? `<p class="host-seasons">${seasons.map((s) => `<a class="chip" href="archive.html?season=${encodeURIComponent(s.id)}" style="${U.seasonVars(s.id)}">${esc(s.title)}</a>`).join('')}</p>` : ''}
    <div class="actions">
      ${playable.length ? `<button type="button" class="btn primary" data-play-all>▶ ${playable.length > 1 ? `האזנה ברצף ל־${playable.length} התוכניות` : 'האזנה לתוכנית'}</button>` : ''}
      ${h.links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || new URL(l.url).hostname.replace(/^www\./, ''))} ↗</a>`).join('')}
      <button type="button" class="btn ghost" data-share-host>שיתוף הדף</button>
    </div>
  </div>
</article>
${eps.length ? `<section class="grid-section">
  <div class="grid-head"><div><p class="kicker">להאזנה</p><h2>התוכניות עם ${esc(h.name)}</h2></div></div>
  <div class="ep-grid">${eps.slice(0, 24).map((e) => U.epCard(e)).join('')}</div>
  ${eps.length > 24 ? `<p class="cue-hint">ועוד ${eps.length - 24} — ${seasons.map((s) => `<a href="archive.html?season=${encodeURIComponent(s.id)}">${esc(s.title)}</a>`).join(' · ')}</p>` : ''}
</section>` : ''}`;
    box.querySelector('[data-play-all]')?.addEventListener('click', () => playAll(playable), { signal });
    box.querySelector('[data-share-host]')?.addEventListener('click', () => share(new URL(`guest.html?host=${encodeURIComponent(h.name)}`, document.baseURI).href, `${h.name} בראש בראש`), { signal });
  }

  /** חלק המגישים בראש הדף: המגישים כיום, ואחריהם מי שהגיש בעבר */
  function hostsHtml() {
    const list = S.hosts();
    if (!list.length) return '';
    const card = (h) => `
<a class="host-card${h.current ? '' : ' past'}" href="guest.html?host=${encodeURIComponent(h.name)}" style="--h:${hueOf(h.key)}">
  ${hostAvatar(h, 'lg')}
  <span class="host-card-text"><b>${esc(h.name)}</b><small>${esc(h.role || (h.current ? 'מגיש' : 'מגיש לשעבר'))}</small>${h.bio ? `<span class="host-card-bio">${esc(h.bio.length > 140 ? `${h.bio.slice(0, 140).trim()}…` : h.bio)}</span>` : ''}<em>${h.count ? plural(h.count) : ''}</em></span>
</a>`;
    const now = list.filter((h) => h.current), past = list.filter((h) => !h.current);
    return `
<section class="card hosts-section" data-reveal>
  <div class="section-title"><div><p class="kicker">מאחורי המיקרופון</p><h1>המגישים</h1></div></div>
  <div class="card-body">
    ${now.length ? `<div class="host-grid">${now.map(card).join('')}</div>` : ''}
    ${past.length ? `${now.length ? '<p class="kicker host-past-title">הגישו בעבר</p>' : ''}<div class="host-grid">${past.map(card).join('')}</div>` : ''}
  </div>
</section>`;
  }

  function renderAll() {
    const all = S.guests();
    const hostsBlock = hostsHtml();
    document.title = 'המגישים והאורחים — ראש בראש';
    if (!all.length) {
      box.innerHTML = hostsBlock + '<div class="card"><div class="state"><span class="mark">✦</span><h3>עדיין אין כאן אורחים</h3><p>כשהאורחים של התוכניות יתווספו, כל אחד יקבל כאן דף משלו.</p><div class="actions"><a class="btn primary" href="archive.html">לארכיון התוכניות <span>←</span></a></div></div></div>';
      return;
    }
    box.innerHTML = `${hostsBlock}
<section class="card">
  <div class="section-title"><div><p class="kicker">מי היה אצלנו</p><${hostsBlock ? 'h2' : 'h1'} class="guests-title">האורחים וחברי הפאנל</${hostsBlock ? 'h2' : 'h1'}></div><strong id="guest-count">${all.length}</strong></div>
  <div class="card-body">
    <form class="search-box" role="search" id="guest-search"><span class="search-glyph" aria-hidden="true">♫</span><label for="guest-q" class="visually-hidden">חיפוש אורח</label><input id="guest-q" type="search" placeholder="חפשו אורח…" autocomplete="off"></form>
    <div class="guest-grid" id="guest-list"></div>
  </div>
</section>`;
    const list = box.querySelector('#guest-list'), q = box.querySelector('#guest-q'), count = box.querySelector('#guest-count');
    const paint = () => {
      const k = S.guestKey(q.value);
      const shown = k ? all.filter((g) => g.key.includes(k) || (g.profile?.role || '').toLowerCase().includes(k)) : all;
      count.textContent = shown.length;
      const card = (g) => `
<a class="guest-card" href="guest.html?g=${encodeURIComponent(g.name)}" style="--h:${hueOf(g.key)}">
  ${avatar(g)}
  <b>${esc(g.name)}</b>
  <small>${g.profile?.role ? `${esc(g.profile.role)} · ` : ''}${plural(g.count)}</small>
</a>`;
      list.innerHTML = shown.length ? [
        ['אורחים', shown.filter((g) => !g.panelist)],
        ['חברי פאנל', shown.filter((g) => g.panelist)],
      ].filter(([, people]) => people.length).map(([heading, people]) => `<h3 class="guest-group-title">${heading}</h3>${people.map(card).join('')}`).join('') : `<div class="state"><span class="mark">?</span><h3>אין אדם שמתאים ל„${esc(q.value)}”</h3></div>`;
    };
    q.addEventListener('input', paint, { signal });
    box.querySelector('#guest-search').addEventListener('submit', (e) => e.preventDefault(), { signal });
    paint();
  }
})();
