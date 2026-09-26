/* דף תוכנית: הקלטה בנגן של האתר, קישור לכל רגע, שיתוף, קודמת/הבאה,
   ועוד מאותה עונה. ההקלטה מוזרמת ישירות — בלי נגן חיצוני. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore, Pl = window.RoshPlayer;
  const { esc, fmtTime, fmtDate, fmtDuration, fmtWeekday } = U;

  /* ---------- תיאור התוכנית ----------
     (paragraphs ו־linkify מופיעים גם ב־scripts/build-episode-pages.mjs — לעדכן יחד)
     רוב התיאורים הם פסקה אחת ארוכה. כדי שייקראו בנוחות: שורה ריקה מפרידה פסקאות, ופסקה
     ארוכה מאוד מתחלקת לפסקאות קצרות בסופי משפטים. כתובות http(s) הופכות לקישורים — רק
     אחרי esc, כך ששום טקסט מהקטלוג לא נכנס לדף כ־HTML (ו־javascript: לא יכול להיות קישור). */
  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).flatMap((block) => {
      if (block.length < 480 || block.includes('\n')) return [block];
      const out = []; let cur = '';
      for (const s of block.replace(/([.!?]+)\s+/g, '$1\u0000').split('\u0000')) {
        cur = cur ? `${cur} ${s}` : s;
        if (cur.length >= 300) { out.push(cur); cur = ''; }
      }
      if (cur) { if (out.length && cur.length < 120) out[out.length - 1] += ` ${cur}`; else out.push(cur); }
      return out;
    });
  }
  // סימני פיסוק בסוף הכתובת (גם בצורתם המוברחת) נשארים מחוץ לקישור
  const URL_TAIL = /(?:&amp;|&quot;|&#39;|&lt;|&gt;|[.,;:!?)\]}״׳])+$/;
  const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[x]);
  // רק כתובת http(s) אמיתית (לפי URL) הופכת לקישור; הכתובת המוצגת מקוצרת, והמלאה ב־title
  // (אותו קוד ב־scripts/build-episode-pages.mjs — לעדכן יחד)
  function linkify(safe) {   // מקבל טקסט שכבר עבר esc
    return safe.replace(/\bhttps?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<>"'])+/gi, (m) => {   // הכתובת נגמרת ברווח או במירכאה/סוגר זווית (מוברחים)
      const tail = m.match(URL_TAIL)?.[0] || '';
      const raw = unesc(m.slice(0, m.length - tail.length));
      let u; try { u = new URL(raw); } catch { return m; }
      if (!/^https?:$/.test(u.protocol) || !u.hostname) return m;
      const shown = raw.replace(/^https?:\/\/(www\.)?/i, '');
      return `<a class="ep-link" href="${esc(u.href)}" title="${esc(u.href)}" target="_blank" rel="noopener nofollow ugc" dir="ltr">${esc(shown.length > 36 ? `${shown.slice(0, 34)}…` : shown)}</a>${tail}`;
    });
  }
  const descHtml = (text) => paragraphs(text).map((p) => `<p>${linkify(esc(p))}</p>`).join('');

  // האות נלקח לפני ההמתנה: אם עברו לדף אחר בזמן שהקטלוג נטען, הסקריפט הזה לא מצייר על הדף החדש
  const signal = window.RoshApp?.signal;
  await S.ready;
  if (signal?.aborted) return;
  const on = { signal };   // המאזינים מוסרים במעבר לדף אחר
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('episode', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const A = document.getElementById('episode');
  // ?ep=… בכתובת, או דף סטטי של התוכנית (episodes/<slug>.html) שמסמן את עצמו ב־data-ep
  const slug = U.qs('ep') || document.body.dataset.ep || '';
  const ep = slug ? S.bySlug(slug) : null;

  // תוכנית מוסתרת, או מתוזמנת שעוד לא הגיע זמנה — רק מנהלים רואים אותה
  if (!ep || ((!ep.visible || S.scheduled(ep)) && !S.sb.user?.isAdmin)) {
    document.title = `התוכנית לא נמצאה — ${site.name || 'ראש בראש'}`;
    A.innerHTML = `<div class="card"><div class="state error"><span class="mark">!</span><h3>התוכנית לא נמצאה</h3><p>${S.state.error ? 'טעינת רשימת התוכניות נכשלה. בדקו את החיבור ונסו שוב.' : 'ייתכן שהקישור ישן או שהתוכנית הוסרה מהארכיון.'}</p><div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">${S.state.error ? '<button type="button" class="btn" data-reload-page>ניסיון חוזר</button>' : ''}<a class="btn primary" href="archive.html">לארכיון התוכניות <span>←</span></a></div></div></div>`;
    A.querySelector('[data-reload-page]')?.addEventListener('click', () => location.reload());
    return;
  }

  const season = S.seasons().find((s) => s.id === ep.season);
  const stream = ep.stream;
  document.title = `${ep.title} — ${site.name || 'ראש בראש'}`;
  document.querySelector('meta[name="description"]').setAttribute('content', ep.description.slice(0, 160) || ep.title);

  // נתונים מובנים למנועי חיפוש
  document.querySelectorAll('script[type="application/ld+json"]').forEach((x) => x.remove());   // בדף הסטטי כבר יש אחד
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'RadioEpisode', name: ep.title, datePublished: ep.date || undefined,
    episodeNumber: ep.number ?? undefined, description: ep.description || undefined, image: ep.cover || undefined,
    partOfSeries: { '@type': 'RadioSeries', name: site.name || 'ראש בראש' },
    associatedMedia: stream ? { '@type': 'AudioObject', contentUrl: new URL(stream, location.href).href, duration: ep.duration ? `PT${ep.duration}S` : undefined } : undefined,
  });
  document.head.appendChild(ld);

  const links = U.publicLinks(ep);
  const survey = ep.surveyId && S.settings.survey?.id === ep.surveyId ? S.settings.survey : null;
  const privateForm = U.messageForm({ episodeId: ep.id, title: 'הודעה פרטית למגישים', hint: 'רק המגישים יקראו אותה — לא תוצג באתר.' });
  // שני חלקים: בטלפון כל אחד בשורה משלו, בלי מילה שנשארת לבד
  const kicker = `<span class="ep-kick"><span>${ep.number != null ? `תוכנית ${ep.number}` : (ep.season === 'sets' ? 'סט' : 'תוכנית')}</span>${season ? `<span class="ep-kick-sep"> · </span><span>${esc(season.title)}</span>` : ''}</span>`;
  // שורת פרטים אחת: יום ותאריך · תאריך עברי · אורך — כל תאריך מופיע פעם אחת בלבד
  const facts = [
    ep.date ? `<time datetime="${esc(ep.date)}">${esc(fmtWeekday(ep.date))}, <span class="ep-nw">${esc(fmtDate(ep.date))}</span></time>` : '',
    ep.date ? `<span>${esc(U.fmtHebDate(ep.date))}</span>` : '',
    ep.duration ? `<span>${esc(fmtDuration(ep.duration))}</span>` : '',
  ].filter(Boolean);
  const desc = descHtml(ep.description);
  const sleeveNumber = `<b>${ep.number != null ? esc(ep.number) : '♫'}</b><small>ראש בראש</small>`;
  // פרטים קטנים ליד התיאור: עונה, נושאים, קישורים חיצוניים
  const details = [
    season ? `<div><dt>עונה</dt><dd><a href="archive.html?season=${encodeURIComponent(season.id)}">${esc(season.title)} <span aria-hidden="true">←</span></a></dd></div>` : '',
    ep.tags.length ? `<div><dt>נושאים</dt><dd class="ep-tags">${ep.tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</dd></div>` : '',
    links.length ? `<div><dt>להאזנה גם ב־</dt><dd class="ep-tags">${links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</dd></div>` : '',
  ].filter(Boolean);
  const longDesc = ep.description.length > 420;
  A.style.cssText = U.coverVars(ep);
  A.innerHTML = `
<header class="ep-hero ep-album" data-anim-zone>
  <div class="ep-art" aria-hidden="true">
    <div class="ep-disc"><div class="vinyl" data-num="" style="--label:${U.hue(ep)}" data-vinyl="${esc(ep.id)}"><i></i></div></div>
    <div class="ep-sleeve${ep.cover ? ' has-cover' : ''}">${ep.cover ? `<img class="ep-sleeve-fill" src="${esc(ep.cover)}" alt=""><img src="${esc(ep.cover)}" alt="">` : sleeveNumber}</div>
  </div>
  <div class="ep-head">
    <p class="kicker">${kicker}</p>
    <h1${ep.title.length > 22 ? ' class="ep-title-long"' : ''}>${esc(ep.title)}</h1>
    ${facts.length || ep.guests.length ? `<p class="ep-facts">${facts.join('<i aria-hidden="true">·</i>')}${ep.guests.length ? `${facts.length ? '<i aria-hidden="true">·</i>' : ''}<span>עם ${ep.guests.map((g) => `<a class="guest-link" href="archive.html?guest=${encodeURIComponent(g)}" title="כל התוכניות עם ${esc(g)}">${esc(g)}</a>`).join(', ')}</span>` : ''}</p>` : ''}
  </div>
  <div class="ep-actionbar">
    ${stream ? `<button type="button" class="ep-play" data-play><span class="ep-play-disc" aria-hidden="true"><i></i></span><span class="ep-play-label">האזנה לתוכנית</span></button>` : '<span class="pill">אין עדיין הקלטה לתוכנית הזו</span>'}
    <div class="ep-tools" role="group" aria-label="עוד פעולות לתוכנית">
      ${U.actionButtons(ep, { icons: true })}
      <button type="button" class="btn" data-share data-ico="share">שיתוף</button>
      ${U.downloadUrl(ep) ? `<a class="btn" href="${esc(U.downloadUrl(ep))}" download="${esc(ep.title)}.mp3" rel="noopener" title="הורדת ההקלטה" data-ico="download">הורדה</a>` : ''}
    </div>
  </div>
  <div class="now-playing-strip ep-now" id="now-strip" hidden></div>
</header>
${survey ? `<div class="site-banner ep-survey${survey.open ? ' vote' : ''}"><span class="site-banner-mark" aria-hidden="true">${survey.open ? '✓' : '✦'}</span><p>${survey.open ? `המצעד של התוכנית הזו פתוח להצבעה${survey.name ? ` — <b>${esc(survey.name)}</b>` : ''}` : `התוכנית הזו מקושרת למצעד${survey.name ? ` "${esc(survey.name)}"` : ''} — ההצבעה הסתיימה`}</p>${survey.open ? `<a class="btn small primary" href="${esc(survey.url)}" target="_blank" rel="noopener">הצביעו עכשיו <span>←</span></a>` : ''}</div>` : ''}
<div class="ep-body">
  <section class="card card-body ep-section ep-about" aria-labelledby="ep-about-title">
    <div class="ep-about-main">
      <div class="grid-head"><div><p class="kicker">מה בתוכנית</p><h2 id="ep-about-title">על התוכנית</h2></div></div>
      ${desc ? `<div class="ep-desc${longDesc ? ' is-collapsed' : ''}" data-desc>
        <div class="ep-desc-text" id="ep-desc-text">${desc}</div>
        ${longDesc ? '<button type="button" class="ep-more" data-desc-toggle aria-expanded="false" aria-controls="ep-desc-text"><span>קראו עוד</span></button>' : ''}
      </div>` : '<p class="cue-hint">עדיין אין תיאור לתוכנית הזו.</p>'}
    </div>
    ${details.length ? `<dl class="ep-details" aria-label="פרטי התוכנית">${details.join('')}</dl>` : ''}
  </section>
  ${S.sb.configured ? '<section class="card card-body ep-section comments" id="comments" aria-labelledby="comments-title"></section>' : ''}
  ${privateForm ? `<details class="card ep-section ep-private private-msg"><summary><span class="ep-private-mark" aria-hidden="true">✉</span><span class="ep-private-txt"><b>הודעה פרטית למגישים</b><small>רק המגישים יקראו אותה — לא תוצג באתר</small></span></summary><div class="ep-private-body">${privateForm}</div></details>` : ''}
</div>
`;

  // תיאור ארוך: מקופל לכמה שורות עם "קראו עוד". הטקסט המלא נשאר בדף (גם לגוגל).
  const D = A.querySelector('[data-desc]');
  const descText = D?.querySelector('.ep-desc-text');
  const fitDesc = () => {   // נכנס בכל זאת (או שנשארה שורה אחת) — בלי קיפול. נמדד אחרי הציור, ושוב כשהגופנים נטענו
    if (!D?.querySelector('[data-desc-toggle][aria-expanded="false"]') || descText.scrollHeight > descText.clientHeight + 1.5 * parseFloat(getComputedStyle(descText).lineHeight)) return;
    D.classList.remove('is-collapsed'); D.querySelector('[data-desc-toggle]')?.remove();
  };
  if (D && longDesc) { requestAnimationFrame(fitDesc); document.fonts?.ready.then(fitDesc); }

  A.querySelector('.ep-sleeve.has-cover img:not(.ep-sleeve-fill)')?.addEventListener('error', (e) => {
    const sl = e.target.parentElement; sl.classList.remove('has-cover'); sl.innerHTML = sleeveNumber;
  });

  // קודמת / הבאה
  const nb = S.neighbors(ep.id);
  const nbDate = (e) => (e.date ? `<em>${esc(fmtDate(e.date, true))}</em>` : '');
  document.getElementById('prevnext').innerHTML = `
${nb.older ? `<a href="episode.html?ep=${encodeURIComponent(nb.older.slug)}" class="ep-nb" rel="prev"><span class="ep-nb-arrow" aria-hidden="true">→</span><span><small>התוכנית הקודמת</small><b>${esc(nb.older.title)}</b>${nbDate(nb.older)}</span></a>` : '<span></span>'}
${nb.newer ? `<a href="episode.html?ep=${encodeURIComponent(nb.newer.slug)}" class="ep-nb" rel="next"><span><small>התוכנית הבאה</small><b>${esc(nb.newer.title)}</b>${nbDate(nb.newer)}</span><span class="ep-nb-arrow" aria-hidden="true">←</span></a>` : '<span></span>'}`;

  // עוד מאותה עונה
  const more = S.episodes().filter((e) => e.id !== ep.id && e.season === ep.season).slice(0, 4);
  const M = document.getElementById('more');
  if (more.length) {
    M.setAttribute('data-reveal', '');
    M.innerHTML = `<div class="grid-head"><div><p class="kicker">${season ? esc(season.title) : 'עוד'}</p><h2>עוד מאותה תקופה</h2></div><a href="archive.html${ep.season ? `?season=${encodeURIComponent(ep.season)}` : ''}">לכל התוכניות ←</a></div><div class="ep-grid">${more.map((e) => U.epCard(e)).join('')}</div>`;
  }
  U.reveal();

  /* ---------- תגובות המאזינים ----------
     תגובה יכולה להיות על כל התוכנית או על רגע מסוים בה ("בדקה 12:34"). תגובות
     על רגע מופיעות גם כסימנים על פס ההתקדמות בנגן. המגישים מאשרים כל תגובה,
     יכולים לענות עליה, ולבחור "תגובה נבחרת" שמופיעה ראשונה. */
  const C = document.getElementById('comments');
  let comments = [], mine = [];
  const ago = (unix) => {
    const s = Math.max(0, Date.now() / 1000 - Number(unix || 0));
    if (s < 3600) return 'לפני כמה דקות';
    if (s < 86400) { const h = Math.round(s / 3600); return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`; }
    const d = Math.round(s / 86400); if (d < 30) return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
    return fmtDate(S.todayIL(new Date(unix * 1000)), true);   // התאריך בשעון ישראל (לא UTC)
  };
  const momentBtn = (at) => (at != null ? `<button type="button" class="moment-chip" data-seek="${Number(at)}" aria-label="האזנה מהרגע ${fmtTime(at)}">▶ ${fmtTime(at)}</button>` : '');
  function commentHtml(c, pending = false) {
    return `<li class="comment${c.pinned ? ' pinned' : ''}${pending ? ' pending' : ''}" id="c-${esc(c.id)}">
  <div class="comment-head"><b>${esc(c.name || 'מאזין')}</b>${c.pinned ? '<span class="pill gold">★ תגובה נבחרת</span>' : ''}${momentBtn(c.at)}<small>${pending ? 'ממתינה לאישור המגישים' : esc(ago(c.createdAt))}</small></div>
  <p>${esc(c.text)}</p>
  ${c.reply ? `<div class="comment-reply"><span>המגישים עונים</span><p>${esc(c.reply)}</p></div>` : ''}
</li>`;
  }
  function paintComments() {
    if (!C) return;
    const u = S.sb.user;
    const playingHere = Pl.isCurrent(ep.id) && Pl.time > 5;
    C.innerHTML = `
<div class="grid-head"><div><p class="kicker">מה המאזינים אומרים</p><h2 id="comments-title">תגובות${comments.length ? ` <span class="count">${comments.length}</span>` : ''}</h2></div></div>
${u ? `<form class="comment-form" data-comment-form>
  <label class="field"><span>התגובה שלכם</span><textarea name="text" required minlength="2" maxlength="1000" placeholder="מה חשבתם על התוכנית? על ויכוח, על שיר, על אורח…"></textarea></label>
  <div class="comment-form-foot">
    ${stream ? `<label class="check"><input type="checkbox" name="moment" ${playingHere ? 'checked' : ''} ${Pl.isCurrent(ep.id) ? '' : 'disabled'}> <span data-moment-label>${Pl.isCurrent(ep.id) ? `על הרגע הזה בתוכנית (${fmtTime(Pl.time)})` : 'על רגע מסוים — התחילו להאזין כדי לבחור רגע'}</span></label>` : ''}
    <button type="submit" class="btn primary">פרסום התגובה <span>←</span></button>
  </div>
  <p class="cue-hint">התגובה תופיע אחרי שהמגישים יאשרו אותה, בשם ${esc(String(u.name || '').split(' ')[0] || 'מאזין')}.</p>
</form>` : `<div class="comment-login"><p>כדי להגיב צריך להתחבר עם Google — כך התגובות נשארות נקיות ומכבדות.</p><a class="btn" href="me.html">להתחברות <span>←</span></a></div>`}
${mine.length ? `<ul class="comment-list mine">${mine.map((c) => commentHtml(c, true)).join('')}</ul>` : ''}
${comments.length ? `<ul class="comment-list">${comments.map((c) => commentHtml(c)).join('')}</ul>` : '<p class="cue-hint">עדיין אין תגובות. היו הראשונים.</p>'}`;
    Pl.setMarkers?.(ep.id, comments.filter((c) => c.at != null).map((c) => ({ at: c.at, label: `${c.name || 'מאזין'}: ${c.text.slice(0, 60)}` })));
  }
  async function loadComments() {
    if (!C) return;
    try {
      const r = await S.sb.call(`/api/program/comments?episode=${encodeURIComponent(ep.id)}`);
      comments = r.comments || []; mine = r.mine || [];
    } catch { comments = []; mine = []; }
    if (!on.signal?.aborted) paintComments();
  }
  if (C) {
    paintComments(); loadComments();
    const offSession = S.onSession(() => loadComments());
    on.signal?.addEventListener('abort', () => { offSession(); Pl.setMarkers?.(ep.id, []); });
    C.addEventListener('click', (e) => {
      const seek = e.target.closest('[data-seek]');
      if (seek) { const at = Number(seek.dataset.seek); Pl.isCurrent(ep.id) ? (Pl.seek(at), Pl.play()) : Pl.load(ep, { at }); }
    });
    C.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-comment-form]'); if (!f) return;
      e.preventDefault();
      const text = f.elements.text.value.trim(); if (text.length < 2) return;
      const at = f.elements.moment?.checked && Pl.isCurrent(ep.id) ? Math.floor(Pl.time) : undefined;
      const btn = f.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        const r = await S.sb.call('/api/program/comments', { method: 'POST', body: { episodeId: ep.id, text, at } });
        mine = [r.comment, ...mine.filter((c) => c.id !== r.comment?.id)].filter(Boolean);
        paintComments();
        U.notify('תודה! התגובה תופיע אחרי שהמגישים יאשרו אותה.', 'success');
      } catch (err) { U.notify(`התגובה לא נשלחה: ${err.message}`, 'error'); btn.disabled = false; }
    });
  }

  /* ---------- קישור עמוק לרגע ---------- */
  const tParam = Number(U.qs('t'));
  if (stream && tParam > 0) {
    Pl.load(ep, { at: tParam, autoplay: true, quiet: true });
    U.notify(`מתחילים מ־${fmtTime(tParam)}. אם הניגון לא התחיל, לחצו ▶.`, 'info');
  }

  /* ---------- אירועים ---------- */
  A.addEventListener('click', async (e) => {
    if (e.target.closest('[data-play]')) { Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    if (e.target.closest('[data-desc-toggle]')) { foldDesc(D.classList.contains('is-collapsed')); return; }
    if (e.target.closest('[data-share]')) { shareDialog(); return; }
  });
  S.likes.load().then(() => { if (!on.signal?.aborted) U.paintActions(ep.id); });

  /** חלון שיתוף: מההתחלה או מדקה מסוימת (ברירת המחדל — איפה שעומדים עכשיו בתוכנית הזו) */
  function shareDialog() {
    document.getElementById('share-dlg')?.remove();
    const here = Pl.isCurrent(ep.id) && Pl.time > 5 ? Math.floor(Pl.time) : 0;
    const d = document.createElement('dialog');
    d.id = 'share-dlg';
    d.className = 'sheet share-dlg';
    d.innerHTML = `
<div class="section-title"><div><p class="kicker">שיתוף</p><h2>שלחו לחבר</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body">
  <p class="share-title">${esc(ep.title)}</p>
  ${stream ? `<div class="share-from"><label class="check"><input type="checkbox" data-from ${here ? 'checked' : ''}> <span>להתחיל מ־</span></label><input class="input" data-at dir="ltr" inputmode="numeric" value="${fmtTime(here)}" aria-label="נקודת ההתחלה (דקות:שניות)" ${here ? '' : 'disabled'}>${Pl.isCurrent(ep.id) ? '<button type="button" class="btn ghost small" data-now>הרגע הנוכחי</button>' : ''}</div><p class="share-hint" data-hint></p>` : ''}
  <label class="field"><span>הקישור</span><input class="input" data-link readonly dir="ltr"></label>
  <div class="share-ops">
    <a class="btn primary" data-wa target="_blank" rel="noopener">וואטסאפ</a>
    <button type="button" class="btn" data-copy>העתקת הקישור</button>
    ${navigator.share ? '<button type="button" class="btn" data-sys>עוד אפשרויות…</button>' : ''}
  </div>
</div>`;
    document.body.appendChild(d);
    const $ = (sel) => d.querySelector(sel);
    const at = () => {
      if (!$('[data-from]')?.checked) return 0;
      const t = U.parseTime($('[data-at]').value);
      return Number.isFinite(t) && t > 0 ? t : NaN;
    };
    const paint = () => {
      const t = at(), bad = Number.isNaN(t) || (ep.duration && t >= ep.duration);
      if ($('[data-at]')) $('[data-at]').disabled = !$('[data-from]').checked;
      if ($('[data-hint]')) $('[data-hint]').textContent = bad ? 'כתבו זמן כמו 12:30 (דקות:שניות) או 1:05:00.' : t ? `מי שיפתח את הקישור יתחיל לשמוע מ־${fmtTime(t)}.` : 'הקישור פותח את התוכנית מההתחלה.';
      $('[data-hint]')?.classList.toggle('bad', !!bad);
      const url = U.shareUrl(ep, bad ? 0 : t);
      $('[data-link]').value = url;
      $('[data-wa]').href = `https://wa.me/?text=${encodeURIComponent(`${ep.title}${t && !bad ? ` (מ־${fmtTime(t)})` : ''}\n${url}`)}`;
    };
    paint();
    d.addEventListener('input', paint);
    d.addEventListener('change', paint);
    d.addEventListener('click', async (e) => {
      if (e.target === d || e.target.closest('[data-close]')) { d.close(); return; }
      if (e.target.closest('[data-now]')) { $('[data-from]').checked = true; $('[data-at]').value = fmtTime(Math.floor(Pl.time)); paint(); return; }
      if (e.target.closest('[data-link]')) { e.target.select(); return; }
      if (e.target.closest('[data-copy]')) { (await U.copy($('[data-link]').value)) ? U.notify('הקישור הועתק.', 'success') : U.notify('ההעתקה נכשלה. סמנו את הקישור והעתיקו.', 'error'); return; }
      if (e.target.closest('[data-sys]')) { try { await navigator.share({ title: ep.title, text: ep.description.slice(0, 120), url: $('[data-link]').value }); d.close(); } catch { /* בוטל */ } }
    });
    d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  /** פתיחה/קיפול של תיאור ארוך. בקיפול — חוזרים לראש הקטע אם הוא כבר גלל מעל המסך */
  function foldDesc(open) {
    const btn = D?.querySelector('[data-desc-toggle]'); if (!btn) return;
    D.classList.toggle('is-collapsed', !open);
    btn.setAttribute('aria-expanded', String(open));
    btn.firstElementChild.textContent = open ? 'הצג פחות' : 'קראו עוד';
    if (!open && D.getBoundingClientRect().top < 90) D.closest('section')?.scrollIntoView({ block: 'start' });
  }
  // מעבר במקלדת לקישור שמוסתר בחלק המקופל — פותחים את התיאור כדי שהמיקוד ייראה
  D?.addEventListener('focusin', (e) => { if (D.classList.contains('is-collapsed') && e.target.matches('.ep-link')) foldDesc(true); });

  /** כפתור ההאזנה והתקליט לפי מצב הנגן: האזנה / השהיה / המשך האזנה (גם מהמקום השמור מביקור קודם) */
  function paintPlay(mine) {
    const btn = A.querySelector('[data-play]');
    if (btn) {
      const on = mine && !Pl.paused;
      const p = !mine && S.positions.get(ep.id);
      const at = !on && !mine && p && p.t > 20 && (!p.dur || p.t < p.dur - 30) ? fmtTime(p.t) : '';
      const label = on ? 'השהיה' : mine || at ? 'המשך האזנה' : 'האזנה לתוכנית';
      if (btn.dataset.label !== label + at) {   // נקרא בכל עדכון של הנגן — משנים את הכפתור רק כשהמצב השתנה
        btn.dataset.label = label + at;
        btn.classList.toggle('is-playing', on);
        btn.querySelector('.ep-play-label').innerHTML = `${label}${at ? ` <span class="ep-play-time">· <bdi>${at}</bdi></span>` : ''}`;
      }
    }
    A.querySelector('[data-vinyl]')?.classList.toggle('live', mine);
    A.querySelector('.ep-art')?.classList.toggle('is-live', mine);
  }
  paintPlay(Pl.isCurrent(ep.id));

  const strip = document.getElementById('now-strip');
  window.addEventListener('rosh:player', (ev) => {
    const mine = ev.detail.episode?.id === ep.id;
    paintPlay(mine);
    document.querySelectorAll('#more .ep-card').forEach((c) => c.classList.toggle('current', c.dataset.ep === ev.detail.episode?.id));
    if (mine && ev.detail.type !== 'close') {
      strip.hidden = false;
      strip.innerHTML = `<span class="ep-eq${Pl.paused ? ' paused' : ''}" aria-hidden="true"><i></i><i></i><i></i></span><span>${Pl.paused ? 'מושהה ב־' : 'מתנגן עכשיו ·'} <b dir="ltr">${fmtTime(ev.detail.time)}</b></span>`;
    } else strip.hidden = true;
    // התווית "על הרגע הזה" מתעדכנת לפי המקום בנגן
    const ml = C?.querySelector('[data-moment-label]'), mc = C?.querySelector('input[name="moment"]');
    if (ml && mine !== null && Pl.isCurrent(ep.id)) { ml.textContent = `על הרגע הזה בתוכנית (${fmtTime(Pl.time)})`; if (mc) mc.disabled = false; }
    if (ev.detail.type === 'episode' && mine) paintMarkers();
  }, on);
  function paintMarkers() { Pl.setMarkers?.(ep.id, comments.filter((c) => c.at != null).map((c) => ({ at: c.at, label: `${c.name || 'מאזין'}: ${c.text.slice(0, 60)}` }))); }
})();
