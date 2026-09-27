/* דף האורחים.
   guest.html?g=<שם>  — דף של אורח אחד: התמונה, שורת התפקיד והמילים שנכתבו עליו בניהול,
                        קישורים, וכל התוכניות שהתארח בהן (מהחדשה לישנה), עם "האזנה ברצף".
   guest.html         — כל האורחים, עם חיפוש.
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
    : `<span class="guest-avatar ${cls}" style="--h:${hueOf(g.key)}" aria-hidden="true">${esc(initials(g.name))}</span>`;
  const years = (eps) => {
    const ys = eps.map((e) => Number(String(e.date || '').slice(0, 4))).filter(Boolean);
    if (!ys.length) return '';
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  const plural = (n) => (n === 1 ? 'תוכנית אחת' : `${n} תוכניות`);

  const name = (U.qs('g') || '').trim();
  if (name) renderGuest(name); else renderAll();
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
    <p class="kicker"><a href="guest.html">האורחים שלנו</a> · אורח בתוכנית</p>
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

  function renderAll() {
    const all = S.guests();
    document.title = 'האורחים — ראש בראש';
    if (!all.length) {
      box.innerHTML = '<div class="card"><div class="state"><span class="mark">✦</span><h3>עדיין אין כאן אורחים</h3><p>כשהאורחים של התוכניות יתווספו, כל אחד יקבל כאן דף משלו.</p><div class="actions"><a class="btn primary" href="archive.html">לארכיון התוכניות <span>←</span></a></div></div></div>';
      return;
    }
    box.innerHTML = `
<section class="card">
  <div class="section-title"><div><p class="kicker">מי היה אצלנו</p><h1>האורחים</h1></div><strong id="guest-count">${all.length}</strong></div>
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
      list.innerHTML = shown.length ? shown.map((g) => `
<a class="guest-card" href="guest.html?g=${encodeURIComponent(g.name)}" style="--h:${hueOf(g.key)}">
  ${avatar(g)}
  <b>${esc(g.name)}</b>
  <small>${g.profile?.role ? `${esc(g.profile.role)} · ` : ''}${plural(g.count)}</small>
</a>`).join('') : `<div class="state"><span class="mark">?</span><h3>אין אורח שמתאים ל„${esc(q.value)}”</h3></div>`;
    };
    q.addEventListener('input', paint, { signal });
    box.querySelector('#guest-search').addEventListener('submit', (e) => e.preventDefault(), { signal });
    paint();
  }
})();
