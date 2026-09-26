/* האזור האישי: כל אחד מתחבר עם Google ורואה את מה שלו — ממשיכים מאיפה
   שעצרתם, התור, "לאחר כך", היסטוריית האזנה והעדפות. הכול נשמר בחשבון בלבד
   (לא במכשיר), ולכן זהה בכל מכשיר שמתחברים בו. רק מי שמוגדר כמנהל רואה
   "מעבר לניהול". */
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
  const paintHeader = () => { document.getElementById('site-header').innerHTML = U.header('me', site); };
  paintHeader();
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const P = document.getElementById('me-profile');
  const $ = (id) => document.getElementById(id);

  function firstName(u) { return String(u?.name || u?.email || '').split(/[\s@]/)[0] || ''; }

  function renderProfile(checking) {
    const u = S.sb.user;
    if (!u) {
      P.innerHTML = `
<div class="profile-hero">
  <div class="profile-avatar" aria-hidden="true">☺</div>
  <div class="profile-copy">
    <p class="kicker">האזור האישי</p>
    <h1>שלום, מאזין.</h1>
    <p class="desc">${S.sb.configured ? 'התחברו עם Google, והאזור האישי יישמר בחשבון שלכם: איפה עצרתם, התור, "לאחר כך", ההיסטוריה וההעדפות — זהה בטלפון ובמחשב. בלי התחברות שום דבר לא נשמר, ומה שעשיתם בביקור הזה יתווסף לחשבון ברגע שתתחברו.' : 'ההתחברות אינה מוגדרת באתר הזה, ולכן שום דבר אישי לא נשמר.'}</p>
    <div class="actions">${S.sb.configured ? '<div class="google-slot" data-google></div>' : ''}<a class="btn" href="archive.html">לארכיון</a></div>
    ${S.sb.configured ? '<p class="cue-hint" style="margin-top:10px;font-size:12px;color:var(--muted);font-weight:700"><a href="#" data-login>בעיה עם הכפתור? כניסה דרך אתר הסקר</a></p>' : ''}
  </div>
</div>`;
      if (S.sb.configured) S.sb.google(P.querySelector('[data-google]'), { onDone: (who) => { renderAll(); U.notify(`שלום, ${firstName(who) || 'מאזין'}. התחברתם.`, 'success'); }, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') })
        .catch((err) => { const g = P.querySelector('[data-google]'); if (g) g.innerHTML = `<button type="button" class="btn xl primary" data-login>התחברות עם Google <span>←</span></button><small class="cue-hint">${esc(err.message)}</small>`; });
      return;
    }
    const name = firstName(u);
    P.innerHTML = `
<div class="profile-hero">
  ${u.picture ? `<img class="profile-avatar" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : `<div class="profile-avatar" aria-hidden="true">${esc(name.slice(0, 1) || '☺')}</div>`}
  <div class="profile-copy">
    <p class="kicker">האזור האישי${u.isAdmin ? ' · <span class="pill gold" style="vertical-align:middle">מנהל</span>' : ''}</p>
    <h1>שלום, ${esc(name || 'מאזין')}.</h1>
    <p class="desc">${esc(u.email || '')}${checking ? ' · מאמתים…' : ' · הכול כאן שמור בחשבון, בכל מכשיר'}</p>
    <div class="actions">
      ${u.isAdmin ? '<a class="btn xl primary" href="admin.html" data-reload>מעבר לניהול <span>←</span></a>' : ''}
      <a class="btn" href="archive.html">לארכיון</a>
      <button type="button" class="btn ghost" data-logout>התנתקות</button>
    </div>
  </div>
</div>`;
  }

  /** רשימת התפוצה באזור האישי: הצטרפות או הסרה בלחיצה */
  function renderSubscription() {
    const box = $('me-subscribe'); if (!box) return;
    if (!S.sb.configured || !S.sb.user) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title"><div><p class="kicker">רשימת התפוצה</p><h2>התוכנית החדשה במייל</h2></div></div><div class="card-body"><div data-subscribe-host="manage"></div></div>`;
    U.mountSubscribe(box.querySelector('[data-subscribe-host]'));
  }

  const row = (e, { cue, at, sub, action }) => `
  <div class="row" data-ep="${esc(e.id)}" style="${U.coverVars(e)}">
    ${cue ? `<button type="button" class="row-main" data-cue="${esc(e.id)}" data-at="${at || 0}">` : `<a class="row-main" href="episode.html?ep=${encodeURIComponent(e.slug)}">`}
      <i aria-hidden="true" style="background:hsl(var(--h) 70% var(--hue-bg-l) / .5);border-color:hsl(var(--h) 80% 60% / .6)">${cue ? '▶' : (e.number ?? '♫')}</i>
      <span class="txt"><b>${esc(e.title)}</b><small>${sub}</small></span>
    ${cue ? '</button>' : '</a>'}
    ${action || ''}
  </div>`;

  function renderLists() {
    const resumable = S.positions.resumable();
    const later = S.later.list().map((id) => S.byId(id)).filter((e) => e && e.visible && !S.scheduled(e));
    const queue = S.queue.list().map((id) => S.byId(id)).filter((e) => e && e.visible && !S.scheduled(e));
    const heard = S.history.list().map((h) => ({ ...h, episode: S.byId(h.id) })).filter((h) => h.episode && h.episode.visible);
    const secs = S.listening.seconds;
    const hours = secs / 3600;
    const time = secs >= 3600
      ? { n: hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : Math.round(hours), label: hours < 1.05 ? 'שעת האזנה' : 'שעות האזנה' }
      : { n: Math.round(secs / 60), label: Math.round(secs / 60) === 1 ? 'דקת האזנה' : 'דקות האזנה' };
    const finished = S.listening.finished.filter((id) => S.byId(id)).length;

    $('me-stats').innerHTML = `
<div class="stats">
  <div class="stat"><b>${heard.length}</b><small>תוכניות ששמעתם</small></div>
  <div class="stat"><b>${time.n}</b><small>${time.label}</small></div>
  <div class="stat"><b>${finished}</b><small>שמעתם עד הסוף</small></div>
  <div class="stat"><b>${later.length}</b><small>לאחר כך</small></div>
</div>`;

    $('me-resume').innerHTML = resumable.length ? `
<div class="grid-head"><div><p class="kicker">ממשיכים</p><h2>מאיפה שעצרתם</h2></div><button type="button" class="chip" data-clear-positions>ניקוי</button></div>
<div class="row-list">${resumable.map((r) => row(r.episode, { cue: true, at: r.t, sub: `נשארו ${esc(fmtDuration(Math.max(60, (r.dur || r.episode.duration) - r.t)))}${r.episode.date ? ` · ${esc(fmtDate(r.episode.date, true))}` : ''}`, action: `<span class="time">${fmtTime(r.t)}</span>` })).join('')}</div>` : '';

    $('me-queue').innerHTML = queue.length ? `
<div class="grid-head"><div><p class="kicker">מה הלאה</p><h2>התור שלכם</h2></div><div class="actions" style="margin:0"><button type="button" class="chip" data-queue-play>▶ ניגון התור</button><button type="button" class="chip" data-queue-clear>ניקוי</button></div></div>
<p class="cue-hint" style="margin:-6px 0 12px">כשתוכנית נגמרת, הבאה בתור מתחילה לבד.</p>
<div class="row-list">${queue.map((e, i) => row(e, { sub: `${i + 1} בתור${e.duration ? ` · ${esc(fmtDuration(e.duration))}` : ''}`, action: `<button type="button" class="icon-btn" data-queue="${esc(e.id)}" aria-label="הסרה מהתור: ${esc(e.title)}">✕</button>` })).join('')}</div>` : '';

    $('me-later').innerHTML = later.length ? `
<div class="grid-head"><div><p class="kicker">שמרתם</p><h2>לאחר כך</h2></div><a href="archive.html?later=1">בארכיון ←</a></div>
<div class="ep-grid">${later.map((e) => U.epCard(e)).join('')}</div>
<div class="actions">${later.map((e) => `<button type="button" class="chip" data-unlater="${esc(e.id)}">✕ ${esc(e.title)}</button>`).join('')}</div>` : `
<div class="grid-head"><div><p class="kicker">שמרתם</p><h2>לאחר כך</h2></div></div>
<div class="card"><div class="state"><span class="mark">+</span><h3>הרשימה ריקה</h3><p>לחצו "+ לאחר כך" בכל תוכנית כדי לשמור אותה כאן.</p></div></div>`;

    // התוכניות שסימנתם "אהבתי"
    const loved = [...S.likes.mine].map((id) => S.byId(id)).filter((e) => e && e.visible && !S.scheduled(e));
    $('me-loved').innerHTML = loved.length ? `
<div class="grid-head"><div><p class="kicker">♥</p><h2>תוכניות שאהבתי</h2></div></div>
<div class="ep-grid">${loved.map((e) => U.epCard(e)).join('')}</div>` : '';

    // הרגעים שסימנתם ♥ בנגן — לכל תוכנית, קפיצה ישירה לכל רגע
    const mom = S.moments.all().map(([id, list]) => ({ e: S.byId(id), list })).filter((x) => x.e && x.e.visible);
    $('me-moments').innerHTML = mom.length ? `
<div class="grid-head"><div><p class="kicker">♥ ברגע</p><h2>הרגעים שסימנתם</h2></div></div>
<p class="cue-hint" style="margin:-6px 0 12px">בזמן האזנה, לחצו "♡ הרגע הזה" בנגן — והרגע יישמר כאן.</p>
<div class="moments-list">${mom.map(({ e, list }) => `<div class="moments-row" style="${U.coverVars(e)}"><a href="episode.html?ep=${encodeURIComponent(e.slug)}"><b>${esc(e.title)}</b></a><div class="moments-chips">${list.map((at) => `<span class="moment-pair"><button type="button" class="moment-chip" data-cue="${esc(e.id)}" data-at="${at}">▶ ${fmtTime(at)}</button><button type="button" class="moment-del" data-unmoment="${esc(e.id)}" data-at="${at}" aria-label="הסרת הרגע ${fmtTime(at)}">✕</button></span>`).join('')}</div></div>`).join('')}</div>` : '';

    const when = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
    $('me-history').innerHTML = heard.length ? `
<div class="grid-head"><div><p class="kicker">שמעתם</p><h2>היסטוריית האזנה</h2></div><button type="button" class="chip" data-clear-history>ניקוי</button></div>
<div class="row-list">${heard.slice(0, 30).map((h) => row(h.episode, { sub: `${esc(when.format(new Date(h.at)))}${S.listening.finished.includes(h.id) ? ' · ✓ עד הסוף' : ''}`, action: h.episode.stream ? `<button type="button" class="icon-btn solid" data-play="${esc(h.episode.id)}" aria-label="האזנה ל${esc(h.episode.title)}">▶</button>` : '' })).join('')}</div>
${heard.length > 30 ? `<p class="cue-hint">ועוד ${heard.length - 30} תוכניות.</p>` : ''}` : '';

    renderPrefs();
    document.querySelectorAll('#me-resume, #me-queue, #me-later, #me-loved, #me-moments, #me-history').forEach((el) => { if (el.innerHTML.trim()) el.setAttribute('data-reveal', ''); });
    U.reveal();
  }

  async function renderPrefs() {
    const rate = Number(S.prefs.get('rate', 1));
    const theme = window.RoshTheme?.get?.() || 'system';
    const motion = window.RoshTheme?.getMotion?.() || 'system';
    const push = await U.push.state();
    if (on.signal?.aborted) return;
    $('me-prefs').innerHTML = `
<div class="section-title"><div><p class="kicker">העדפות</p><h2>ככה אתם אוהבים</h2></div></div>
<div class="card-body">
  <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
    <label class="field"><span>מהירות ניגון קבועה</span><select class="input" data-pref-rate>${Pl.RATES.map((r) => `<option value="${r}" ${rate === r ? 'selected' : ''}>${r === 1 ? 'רגילה' : `${r}×`}</option>`).join('')}</select></label>
    <label class="field"><span>מראה</span><select class="input" data-pref-theme><option value="system" ${theme === 'system' ? 'selected' : ''}>לפי הגדרות המכשיר</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>כהה</option><option value="light" ${theme === 'light' ? 'selected' : ''}>בהיר</option></select></label>
    <label class="field"><span>אנימציות</span><select class="input" data-pref-motion><option value="system" ${motion === 'system' ? 'selected' : ''}>לפי הגדרות המכשיר</option><option value="full" ${motion === 'full' ? 'selected' : ''}>מופעלות</option><option value="reduced" ${motion === 'reduced' ? 'selected' : ''}>מופסקות</option></select></label>
    <div class="field"><span>התראה כשתוכנית חדשה עולה</span>${push === 'unsupported' ? '<small>הדפדפן הזה לא תומך בהתראות. באייפון: הוסיפו את האתר למסך הבית (שיתוף ← "הוספה למסך הבית") ופתחו אותו משם.</small>' : push === 'denied' ? '<small>ההתראות חסומות בהגדרות הדפדפן לאתר הזה. אפשרו אותן שם ונסו שוב.</small>' : `<div class="actions" style="margin-top:6px"><button type="button" class="btn small${push === 'on' ? '' : ' primary'}" data-push aria-pressed="${push === 'on'}">${push === 'on' ? '✓ ההתראות פעילות — כיבוי' : 'הפעלת התראות'}</button></div><small>ההתראות פועלות במכשיר שבו הפעלתם אותן.</small>`}</div>
  </div>
  ${S.sb.user ? `<div class="field" style="margin-top:16px"><span>הנתונים שלכם</span><small>הכול שמור בחשבון Google שלכם, ולא במכשיר.</small><div class="actions" style="margin-top:6px"><button type="button" class="btn small" data-clear-positions>מחיקת מיקומי האזנה</button><button type="button" class="btn small danger" data-clear-all>מחיקת כל הנתונים האישיים</button></div></div>` : ''}
</div>`;
  }

  const renderAll = () => { if (on.signal?.aborted) return; renderProfile(false); paintHeader(); renderLists(); renderSubscription(); };

  /* ---------- התחלה ---------- */
  renderProfile(!!S.sb.user);
  renderLists();
  renderSubscription();
  if (S.sb.user) { await S.state.verified; if (on.signal?.aborted) return; renderProfile(false); }
  // כניסה, יציאה, או נתונים שהגיעו מהחשבון — הכול מצויר מחדש
  const offSession = S.onSession(renderAll);
  S.likes.load().then(() => { if (!on.signal?.aborted) renderLists(); });
  const offData = S.me.onChange(() => { clearTimeout(renderLists.t); renderLists.t = setTimeout(() => { if (!on.signal?.aborted) renderLists(); }, 300); });
  on.signal?.addEventListener('abort', () => { offSession(); offData(); });

  /* ---------- אירועים ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-login]')) {
      e.preventDefault();
      const b = e.target.closest('[data-login]'); b.disabled = true;
      try { const u = await S.sb.signIn(); renderAll(); U.notify(`שלום, ${firstName(u) || 'מאזין'}. התחברתם.`, 'success'); }
      catch (err) { U.notify(`ההתחברות נכשלה: ${err.message}`, 'error'); b.disabled = false; }
      return;
    }
    if (e.target.closest('[data-logout]')) { S.signOut(); U.notify('התנתקתם.', 'success'); return; }
    const play = e.target.closest('[data-play]');
    if (play) { const ep = S.byId(play.dataset.play); if (ep) Pl.isCurrent(ep.id) ? Pl.toggle() : Pl.load(ep); return; }
    const cue = e.target.closest('[data-cue]');
    if (cue) { const ep = S.byId(cue.dataset.cue); if (!ep) return; const at = Number(cue.dataset.at) || 0; Pl.isCurrent(ep.id) ? (Pl.seek(at), Pl.play()) : Pl.load(ep, { at }); return; }
    if (e.target.closest('[data-queue-play]')) { const next = S.queue.shift(Pl.episode?.id); if (next) Pl.load(next, { at: 0 }); return; }
    if (e.target.closest('[data-queue-clear]')) { S.queue.clear(); U.notify('התור נוקה.', 'success'); return; }
    const um = e.target.closest('[data-unmoment]');
    if (um) { await S.moments.toggle(um.dataset.unmoment, Number(um.dataset.at)).catch(() => {}); U.notify('הרגע הוסר.', 'success'); return; }
    const un = e.target.closest('[data-unlater]');
    if (un) { S.later.toggle(un.dataset.unlater); U.notify('הוסר מרשימת "לאחר כך".', 'success'); return; }
    if (e.target.closest('[data-clear-history]')) { S.history.clear(); U.notify('ההיסטוריה נמחקה.', 'success'); return; }
    if (e.target.closest('[data-clear-positions]')) { if (!confirm('למחוק את כל מיקומי ההאזנה השמורים?')) return; S.positions.clearAll(); U.notify('מיקומי ההאזנה נמחקו.', 'success'); return; }
    if (e.target.closest('[data-clear-all]')) {
      if (!confirm('למחוק מהחשבון את כל הנתונים האישיים (האזנה, תור, לאחר כך, היסטוריה והעדפות)?')) return;
      try { await S.sb.call('/api/program/userdata', { method: 'DELETE' }); S.me.clear(); U.notify('הנתונים האישיים נמחקו.', 'success'); }
      catch (err) { U.notify(`המחיקה לא הצליחה: ${err.message}`, 'error'); }
      return;
    }
    const pushBtn = e.target.closest('[data-push]');
    if (pushBtn) {
      pushBtn.disabled = true;
      try {
        if (pushBtn.getAttribute('aria-pressed') === 'true') { await U.push.disable(); U.notify('ההתראות כובו.', 'success'); }
        else { await U.push.enable(); U.notify('מעולה! תקבלו התראה כשתוכנית חדשה עולה.', 'success'); }
      } catch (err) { U.notify(err.message, 'error'); }
      renderPrefs();
    }
  }, on);
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-pref-rate]')) { Pl.setRate(Number(e.target.value)); U.notify('המהירות נשמרה.', 'success'); }
    if (e.target.matches('[data-pref-theme]')) { window.RoshTheme?.set(e.target.value); S.prefs.set('theme', e.target.value); U.applyPrefs(); }
    if (e.target.matches('[data-pref-motion]')) { window.RoshTheme?.setMotion?.(e.target.value); S.prefs.set('motion', e.target.value); U.applyPrefs(); }
  }, on);
  window.addEventListener('rosh:player', (ev) => {
    const id = ev.detail.episode?.id;
    document.querySelectorAll('[data-ep]').forEach((c) => { c.classList.toggle('current', c.dataset.ep === id); c.classList.toggle('selected', c.classList.contains('row') && c.dataset.ep === id); });
  }, on);
})();
