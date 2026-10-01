/* הדף "טיוטת מייל" (mail.html?ep=… או ?kind=digest / ?kind=note) — מעביר לדף הניהול (ראו למטה). מגיעים אליו מדף הניהול המשותף — עם קוד
   מעבר, בלי כניסה נוספת — או ישירות. התוכניות: מה שבאתר (כולל מוסתרות ומתוזמנות, למנהלים)
   ועוד הטיוטה המשותפת של הניהול, כך שאפשר להכין מייל גם לתוכנית שעוד לא פורסמה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  await S.ready;
  /* עורך טיוטת המייל עבר לדף הניהול של אתר הסקר (החלק „מייל למאזינים”). קישורים ישנים לכאן עוברים
     לשם — עם קוד מעבר, בלי כניסה נוספת, ועל אותה תוכנית. ?standalone=1 משאיר את העורך כאן (לבדיקות). */
  if (S.state.source === 'cloudflare' && !U.qs('standalone')) {
    const origin = new URL(S.sb.cfg.apiBase).origin;
    const q = new URLSearchParams();
    if (U.qs('ep')) q.set('mail', U.qs('ep'));
    if (U.qs('kind')) q.set('kind', U.qs('kind'));
    document.getElementById('mail-gate-text').textContent = 'עוברים לדף הניהול…';
    let target = `${origin}/admin${q.size ? `?${q}` : ''}#prog-mail`;
    if (S.sb.session?.token) { try { target = `${await S.sb.handoff.toSurvey()}${q.size ? `?${q}` : ''}#prog-mail`; } catch { /* נכנסים שם עם Google */ } }
    location.replace(target);
    return;
  }
  const site = S.site || {};
  const $ = (id) => document.getElementById(id);
  const paintHeader = () => { $('site-header').innerHTML = U.header('admin', site); };
  paintHeader();
  $('site-footer').innerHTML = U.footer(site);
  const gate = $('mail-gate'), host = $('mail-host');
  if (S.state.handoffError) U.notify(S.state.handoffError, 'error');

  let gateMounted = false;
  function showGate() {
    gate.hidden = false; host.hidden = true;
    const u = S.sb.user;
    $('mail-gate-text').textContent = u ? `החשבון ${u.email || ''} מחובר, אבל אינו מוגדר כמנהל.` : 'הדף הזה למנהלי התוכנית. היכנסו עם חשבון Google.';
    $('mail-google').hidden = !!u;
    if (u || gateMounted || !S.sb.configured) return;
    gateMounted = true;
    S.sb.google($('mail-google'), { onDone: start, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') })
      .catch((err) => { gateMounted = false; $('mail-google').innerHTML = `<span class="cue-hint">${U.esc(err.message)}</span>`; });
  }

  async function start() {
    let ok = false;
    try { ok = await S.sb.isAdmin(); } catch { /* מציגים את השער */ }
    paintHeader();
    if (!ok) { showGate(); return; }
    gate.hidden = true; host.hidden = false;
    host.innerHTML = '<div class="state"><span class="notice-spinner" aria-hidden="true"></span><p>טוענים את התוכניות…</p></div>';
    let pub = null, draft = null;
    try { pub = await S.admin.pullOrigin(); } catch { pub = S.data; }
    try { const d = (await S.sb.draft.get()).draft?.data; if (d) draft = S.admin.normalize(d); } catch { /* אין טיוטה */ }
    const live = new Set(pub.episodes.filter((e) => e.visible && !S.scheduled(e)).map((e) => e.id));
    // התוכן העדכני ביותר (מהטיוטה, אם התוכנית נערכה בה); "באתר" — לפי מה שמפורסם
    const byId = new Map(pub.episodes.map((e) => [e.id, e]));
    for (const e of draft?.episodes || []) byId.set(e.id, e);
    const episodes = [...byId.values()];
    const want = U.qs('ep');
    const first = episodes.find((e) => e.id === want || e.slug === want);
    window.RoshMailComposer.mount(host, {
      episodes: () => episodes,
      episodeId: first?.id,
      kind: U.qs('kind') || '',   // mail.html?kind=digest (סיכום) או kind=note (הודעה חופשית)
      isLive: (e) => live.has(e.id),
      contacts: () => draft?.settings?.contacts || pub.settings?.contacts || S.settings?.contacts || {},
    });
  }
  start();
})();
