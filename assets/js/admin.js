/* אזור הניהול של ראש בראש — ארבעה חלקים: תוכניות, האתר, מאזינים, פרסום.
   כל שינוי נשמר מיד בטיוטה המשותפת בשרת (לפי חשבון Google, לא במכשיר), כך
   שאפשר להתחיל במחשב ולהמשיך בטלפון. שום טיוטה לא נשמרת בדפדפן.
   "פרסום לאתר" מעביר את הטיוטה לכולם. בלי קודים, בלי מזהים, בלי JSON. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const { esc, fmtDate, fmtDuration, slugify } = U;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  await S.ready;
  const site = S.site || {};
  const EMBED = !!S.state.embed;
  if (EMBED) document.body.classList.add('embed');

  /* דף ניהול אחד: הניהול של אתר התוכניות הוא חלק מדף הניהול של אתר הסקר.
     הכתובת הזו מעבירה לשם (עם אותו חשבון, בלי כניסה נוספת), ל"אתר התוכניות"
     בתפריט הצד. ?standalone=1 משאיר את הדף כאן — לבדיקות ולמקרה חירום. */
  if (S.state.source === 'cloudflare' && !EMBED && !new URLSearchParams(location.search).has('standalone')) {
    const part = `#prog-${['programs', 'site', 'listeners', 'publish'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'programs'}`;
    const shared = `${new URL(S.sb.cfg.apiBase).origin}/admin`;
    $('#admin-gate-text').textContent = 'עוברים לדף הניהול…';
    let target = `${shared}${part}`;
    if (S.sb.session?.token) { try { target = `${await S.sb.handoff.toSurvey()}${part}`; } catch { /* ייכנסו שם עם Google */ } }
    location.replace(target);
    return;
  }
  const paintHeader = () => { $('#site-header').innerHTML = EMBED ? '' : U.header('admin', site); };
  paintHeader();
  $('#site-footer').innerHTML = EMBED ? '' : U.footer(site);

  const TABS = ['programs', 'site', 'listeners', 'publish'];
  const CLOUD = S.state.source === 'cloudflare';
  const A = {
    data: clone(S.data),   // הטיוטה שעובדים עליה
    origin: null,          // מה שמפורסם באתר כרגע (להשוואה)
    originError: false,
    selected: null,        // התוכנית שנבחרה
    tab: 'programs',
    q: '',
    filter: 'all',
    bulk: false,           // מצב בחירה מרובה
    picked: new Set(),
    syncTimer: null, previewTimer: null,
    syncState: '',         // '', 'saving', 'saved'
    unsynced: false,       // יש שינויים בזיכרון שהשרת עוד לא קיבל (במצב בלי שרת: שעוד לא ירדו לקובץ)
    offline: false,        // השמירה האחרונה בשרת נכשלה — מזהירים ומנסים שוב
    syncing: null,         // שמירה שבדרך (Promise)
    syncGen: 0,            // עולה בפרסום, ביטול והתנתקות — תשובה של שמירה ישנה לא נוגעת במצב
    retryDelay: 0,
    draftAt: null,         // מתי נשמרה הטיוטה המשותפת שאנחנו מכירים (נשלח כ־ifUpdatedAt)
    draftBy: '',           // מי שמר אותה
    conflict: null,        // טיוטה חדשה יותר של מישהו אחר — לא דורסים עד שבוחרים
    overwrite: false,      // בחרו "להמשיך עם שלי ולדרוס"
    echoRetry: false,
    lastSent: '',          // הטיוטה האחרונה ששלחנו (לזהות 409 על שמירה שלנו שהתשובה שלה אבדה)
    publishing: false,
    checks: { audio: null, media: null },  // תוצאות הבדיקות
    versions: null,        // רשימת הגרסאות מהשרת
    versionCache: new Map(),
    stats: null, messages: null, admins: null, subs: null,
    surveys: null,         // הסקרים באתר הסקר, לקישור תוכנית
    base: null,            // הגרסה שבאתר כשהתחילו לערוך את הטיוטה — להגנה מדריסה בין מנהלים
    notify: true,          // לשלוח התראה למאזינים על תוכניות חדשות בפרסום
    mailAfter: S.prefs.get('mailAfterPublish', true),   // לפתוח טיוטת מייל לרשימת התפוצה אחרי פרסום של תוכנית חדשה
    pushCount: null, epStats: new Map(), statsEp: '',
    ai: new Map(),         // מצב התמלול והסיכום לכל תוכנית
  };
  /* שום טיוטה לא נשמרת במכשיר — רק בשרת, לפי החשבון. מה שנשאר בדפדפן מגרסאות קודמות נמחק. */
  const DEVICE_DRAFT_KEYS = ['rosh:override', 'rosh:override-at', 'rosh:override-base'];
  const dropDeviceDraft = () => { try { DEVICE_DRAFT_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* */ } };
  dropDeviceDraft();
  if (!A.data.settings) A.data.settings = S.admin.normSettings({});
  const sameData = (a, b) => JSON.stringify(S.admin.normalize(a)) === JSON.stringify(S.admin.normalize(b));
  const liveEp = (id) => A.data.episodes.find((x) => x.id === id) || null;
  const jobsBusy = () => Object.values(A.jobs || {}).some((j) => j.running);

  /* ---------- שמירה אוטומטית בטיוטה המשותפת בשרת ---------- */

  const canSync = () => CLOUD && !!S.sb.user?.isAdmin;
  function touch() {
    A.unsynced = true;
    refreshLive();
    scheduleSync();
    paintStatus();
  }
  function scheduleSync(ms = 1500) {
    clearTimeout(A.syncTimer); A.syncTimer = null;
    if (canSync()) A.syncTimer = setTimeout(sync, ms);
  }
  /** שומר עכשיו (אם יש מה). מחזיר true כשהשרת מחזיק את מה שיש כאן. */
  function sync() {
    if (!canSync()) return Promise.resolve(false);
    clearTimeout(A.syncTimer); A.syncTimer = null;
    if (A.publishing) { scheduleSync(); return Promise.resolve(false); }
    if (A.conflict) { showDraftConflict(); return Promise.resolve(false); }
    if (A.syncing) return A.syncing.then(() => (A.unsynced ? sync() : !A.offline && !A.conflict));
    if (!A.unsynced) return Promise.resolve(!A.offline);
    const p = A.syncing = saveDraft().finally(() => { if (A.syncing === p) A.syncing = null; });
    return p;
  }
  async function saveDraft() {
    const gen = A.syncGen;
    A.syncState = 'saving'; paintStatus();
    let sent = '';
    try {
      if (A.draftAt == null && !A.overwrite) {
        // לא ידוע על טיוטה בשרת: בודקים שאף אחד לא התחיל אחת בינתיים, כדי לא לדרוס אותה בשקט
        const { draft } = await S.sb.draft.get();
        if (gen !== A.syncGen) return false;
        if (draft?.data && !ownEcho(draft)) { onDraftConflict(draft); return false; }
        if (draft?.updatedAt) A.draftAt = draft.updatedAt;
      }
      const body = { ...A.data, baseVersion: A.base ?? null };
      sent = JSON.stringify(body);
      A.unsynced = false;   // עריכה בזמן השמירה תסמן שוב
      A.lastSent = sent;
      const r = await S.sb.draft.put(body, A.overwrite ? undefined : A.draftAt ?? undefined);
      if (gen !== A.syncGen) return false;
      A.draftAt = r.updatedAt ?? null; A.draftBy = r.by || S.sb.user?.email || '';
      A.overwrite = false; A.syncState = 'saved'; A.retryDelay = 0; A.echoRetry = false;
      if (A.offline) { A.offline = false; U.notify('החיבור חזר — השינויים נשמרו בשרת.', 'success'); }
      if (A.unsynced) scheduleSync();
      return true;
    } catch (err) {
      if (gen !== A.syncGen) return false;
      if (sent) A.unsynced = true;
      A.syncState = '';
      if (err.conflict) {
        let draft = err.draft;
        if (!draft?.data) { try { draft = (await S.sb.draft.get()).draft; } catch { draft = null; } if (gen !== A.syncGen) return false; }
        if (draft?.data && !ownEcho(draft)) { onDraftConflict(draft); return false; }
        // הטיוטה נמחקה בינתיים (פורסמה או בוטלה), או שזו השמירה שלנו עצמנו — שומרים שוב, פעם אחת
        A.draftAt = draft?.data ? draft.updatedAt ?? null : null;
        if (!A.echoRetry) { A.echoRetry = true; scheduleSync(0); return false; }
        A.echoRetry = false;
      }
      if (!A.offline) U.notify('השינויים לא נשמרים לשרת — אל תסגרו את הדף. ננסה שוב לבד כשהחיבור יחזור.', 'error', { ttl: 0 });
      A.offline = true;
      A.retryDelay = Math.min(60000, (A.retryDelay || 2500) * 2);
      scheduleSync(A.retryDelay);
      return false;
    } finally { paintStatus(); }
  }
  /** טיוטה בשרת שהיא בעצם השמירה האחרונה שלנו (התשובה אבדה בדרך, או נשלחה בסגירת הדף) */
  function ownEcho(draft) {
    if (!A.lastSent || (draft.by && draft.by !== S.sb.user?.email)) return false;
    try { return sameData(draft.data, JSON.parse(A.lastSent)); } catch { return false; }
  }
  function onDraftConflict(draft) {
    A.conflict = draft; A.unsynced = true; A.overwrite = false;
    clearTimeout(A.syncTimer); A.syncTimer = null;
    paintStatus(); showDraftConflict();
  }
  /** מנהל אחר (או אתם, ממכשיר אחר) שמר טיוטה חדשה יותר: לא דורסים — שואלים */
  function showDraftConflict() {
    const dr = A.conflict; if (!dr) return;
    let d = $('#dlg-draft');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-draft'; d.className = 'sheet'; d.setAttribute('aria-labelledby', 'dlg-draft-title');
      document.body.appendChild(d);
      d.addEventListener('click', async (ev) => {
        if (ev.target === d || ev.target.closest('[data-close]')) { d.close(); return; }
        const b = ev.target.closest('[data-draft]'); if (!b || !A.conflict) return;
        const pick = A.conflict; d.close();
        if (b.dataset.draft === 'mine') {
          A.conflict = null; A.draftAt = pick.updatedAt ?? null; A.overwrite = !pick.updatedAt; A.unsynced = true;
          sync();
          return;
        }
        A.conflict = null; A.syncGen++;
        A.data = S.admin.normalize(pick.data);
        if (!A.data.settings) A.data.settings = S.admin.normSettings({});
        A.base = pick.data.baseVersion !== undefined ? pick.data.baseVersion : A.base;
        A.draftAt = pick.updatedAt ?? null; A.draftBy = pick.by || '';
        A.unsynced = false; A.syncState = 'saved';
        if (!liveEp(A.selected)) A.selected = null;
        A.picked.clear();
        paintStatus(); render();
        U.notify('נטענה הטיוטה החדשה מהשרת.', 'info');
      });
    }
    const mine = !!dr.by && dr.by === S.sb.user?.email;
    const at = dr.updatedAt ? ` ב־${when(dr.updatedAt)}` : '';
    const head = mine ? `שמרתם טיוטה חדשה יותר ממכשיר אחר${at}` : `מנהל אחר (${dr.by || 'לא ידוע'}) שמר טיוטה חדשה יותר${at}`;
    d.innerHTML = `<div class="section-title"><div><p class="kicker">הטיוטה המשותפת</p><h2 id="dlg-draft-title">${esc(head)}</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><p class="help">כדי לא לדרוס אותה, השינויים שעשיתם כאן מאז לא נשמרו בשרת. אפשר לטעון את הטיוטה החדשה (השינויים שעשיתם כאן יאבדו), או להמשיך עם שלכם — ואז היא תוחלף בטיוטה שלכם.</p></div>
<div class="card-foot"><button type="button" class="btn" data-draft="theirs">${mine ? 'לטעון את הטיוטה ההיא' : 'לטעון את הטיוטה שלו'}</button><button type="button" class="btn danger" data-draft="mine">${mine ? 'להמשיך עם זו ולדרוס' : 'להמשיך עם שלי ולדרוס'}</button></div>`;
    if (!d.open) d.showModal();
  }
  /* סגירת הדף עם שינויים שעוד לא נשמרו: שולחים אותם בבקשה שממשיכה גם אחרי הסגירה
     (כשהטיוטה קטנה מספיק); אחרת הדפדפן שואל אם לעזוב. במכשיר עצמו לא נשמר כלום. */
  window.addEventListener('beforeunload', (ev) => {
    if (!A.unsynced && !A.syncing) return;
    if (canSync() && !A.conflict && !A.publishing && !A.offline) {
      const body = { ...A.data, baseVersion: A.base ?? null };
      if (S.sb.draft.putKeepalive(body, A.overwrite ? undefined : A.draftAt ?? undefined)) { A.lastSent = JSON.stringify(body); return; }
    }
    ev.preventDefault(); ev.returnValue = '';
  });
  // הדף עובר לרקע (בטלפון: מעבר לאפליקציה אחרת) — שומרים מיד; החיבור חזר — מנסים שוב
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && A.unsynced) sync(); });
  window.addEventListener('online', () => { if (A.unsynced) sync(); });

  /** מה השתנה לעומת מה שמפורסם */
  function changes() {
    if (!A.origin) return null;
    const key = (e) => JSON.stringify(e);
    const om = new Map(A.origin.episodes.map((e) => [e.id, key(e)]));
    let added = 0, changed = 0;
    for (const e of A.data.episodes) {
      if (!om.has(e.id)) added++;
      else if (om.get(e.id) !== key(S.admin.normEpisode(e, 0))) changed++;
    }
    const removed = A.origin.episodes.filter((e) => !A.data.episodes.some((x) => x.id === e.id));
    const seasons = key(S.admin.normalize({ seasons: A.origin.seasons }).seasons) !== key(S.admin.normalize({ seasons: A.data.seasons }).seasons);
    const settings = key(S.admin.normSettings(A.origin.settings)) !== key(S.admin.normSettings(A.data.settings));
    return { added, changed, removed, seasons, settings, any: !!(added || changed || removed.length || seasons || settings) };
  }
  /** תוכניות שהמאזינים יראו לראשונה אחרי הפרסום הזה (חדשות, או שהיו מוסתרות/מתוזמנות) */
  function newlyPublic() {
    if (!A.origin) return [];
    const isPublic = (e) => e.visible && !S.scheduled(e);
    const om = new Map(A.origin.episodes.map((e) => [e.id, e]));
    return A.data.episodes.filter((e) => isPublic(e) && !(om.has(e.id) && isPublic(om.get(e.id))));
  }

  /** מה בדיוק ישתנה באתר: לכל תוכנית — אילו שדות, ומה היה לעומת מה יהיה */
  const FIELD_NAMES = { title: 'השם', date: 'התאריך', number: 'המספר', season: 'העונה', description: 'התיאור', cover: 'התמונה', thumb: 'התמונה הקטנה', audio: 'ההקלטה', duration: 'האורך', visible: 'מוצגת באתר', featured: 'מומלצת בדף הבית', publishAt: 'מועד הפרסום', guests: 'האורחים', tags: 'מילות החיפוש', links: 'הקישורים', surveyId: 'המצעד המקושר' };
  const detailedChanges = () => (A.origin ? diffData(A.origin, A.data) : []);
  /** ההבדלים בין שתי גרסאות של האתר (מה שמפורסם מול הטיוטה, או שתי גרסאות קודמות) */
  function diffData(fromRaw, toRaw) {
    const from = S.admin.normalize(fromRaw), to = S.admin.normalize(toRaw);
    const out = [];
    const short = (v, f) => {
      if (f === 'visible' || f === 'featured') return v ? 'כן' : 'לא';
      if (f === 'date') return v ? fmtDate(v, true) : 'בלי';
      if (f === 'duration') return v ? fmtDuration(v) : 'בלי';
      if (f === 'cover' || f === 'thumb' || f === 'audio') return v ? 'יש' : 'אין';
      if (f === 'season') return (to.seasons.find((x) => x.id === v) || from.seasons.find((x) => x.id === v))?.title || v || 'בלי';
      if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? x.label || x.url : x)).join(', ') || 'בלי';
      const t = String(v ?? '').trim(); return t ? (t.length > 60 ? `${t.slice(0, 60)}…` : t) : 'ריק';
    };
    const om = new Map(from.episodes.map((e) => [e.id, e]));
    for (const e of to.episodes) {
      const o = om.get(e.id);
      if (!o) { out.push({ id: e.id, head: `תוכנית חדשה: "${label(e)}"`, rows: [] }); continue; }
      const rows = [];
      for (const f of Object.keys(FIELD_NAMES)) {
        const a = JSON.stringify(o[f] ?? ''), b = JSON.stringify(e[f] ?? '');
        if (a === b) continue;
        if ((f === 'cover' || f === 'thumb' || f === 'audio') && o[f] && e[f]) rows.push(`${FIELD_NAMES[f]} הוחלפה`);
        else if (f === 'description' && o[f] && e[f]) rows.push('התיאור עודכן');
        else rows.push(`${FIELD_NAMES[f]}: ${short(o[f], f)} ← ${short(e[f], f)}`);
      }
      if (rows.length) out.push({ id: e.id, head: `"${label(e)}"`, rows });
    }
    for (const o of from.episodes) if (!to.episodes.some((x) => x.id === o.id)) out.push({ id: '', head: `תימחק מהאתר: "${label(o)}"`, rows: [] });
    const declared = (raw) => JSON.stringify(S.admin.normalize({ seasons: raw?.seasons }).seasons);
    if (declared(fromRaw) !== declared(toRaw)) out.push({ id: '', head: 'העונות השתנו', rows: [] });
    const os = from.settings, ns = to.settings;
    if (JSON.stringify(os.banner) !== JSON.stringify(ns.banner)) out.push({ id: '', head: 'ההודעה בראש האתר השתנתה', rows: [ns.banner.enabled ? `"${short(ns.banner.text)}"` : 'ההודעה כבויה'] });
    if (JSON.stringify(os.updates) !== JSON.stringify(ns.updates)) out.push({ id: '', head: 'דף העדכונים השתנה', rows: [] });
    if (JSON.stringify(os.contacts) !== JSON.stringify(ns.contacts)) out.push({ id: '', head: 'פרטי הקשר השתנו', rows: Object.keys(ns.contacts).filter((k) => os.contacts[k] !== ns.contacts[k]).map((k) => `${short(os.contacts[k])} ← ${short(ns.contacts[k])}`) });
    return out;
  }

  /* ---------- בדיקת תקינות (בשפה פשוטה) ---------- */

  /** תיאור כללי שאינו מספר מה היה בתוכנית (כמו בתוכניות שיובאו מהארכיון) */
  const GENERIC_DESC = /^(מתוך ארכיון תוכנית ראש בראש\.?|הקלטה משוחזרת מתקופת קו המכלול[^]*)$/;
  /** קבוצות בבדיקת התקינות: שם, והכלי שמתקן את כולן בלחיצה אחת */
  const HEALTH_GROUPS = {
    noaudio: { title: 'בלי הקלטה' },
    noduration: { title: 'בלי אורך', fix: 'fill-durations', fixLabel: 'מילוי האורך לכולן' },
    nocover: { title: 'בלי תמונה', fix: 'covers-all', fixLabel: 'יצירת תמונה לכולן' },
    nothumb: { title: 'בלי תמונה קטנה לכרטיסים', fix: 'thumbs-all', fixLabel: 'יצירת תמונות קטנות' },
    nodesc: { title: 'בלי תיאור אמיתי', fix: 'ai-all', fixLabel: 'תיאור אוטומטי מהתמלול', cloud: true },
    nodate: { title: 'בלי תאריך', fix: 'dates-screen', fixLabel: 'השלמת תאריכים' },
    schedhidden: { title: 'מתוזמנות אבל מוסתרות' },
  };
  function health() {
    const must = [], should = [], dup = [];
    const byNumber = new Map(), byTitle = new Map(), byDrive = new Map();
    for (const e of A.data.episodes) {
      const name = label(e);
      if (!e.title.trim()) must.push({ id: e.id, text: `תוכנית בלי שם${e.number != null ? ` (תוכנית ${e.number})` : ''}${e.date ? ` מתאריך ${fmtDate(e.date, true)}` : ''}` });
      if (!U.streamUrl(e)) should.push({ kind: 'noaudio', id: e.id, text: `"${name}" בלי הקלטה` });
      else if (!e.duration) should.push({ kind: 'noduration', id: e.id, text: `"${name}" בלי אורך` });
      if (!e.cover) should.push({ kind: 'nocover', id: e.id, text: `"${name}" בלי תמונה` });
      else if (!e.thumb) should.push({ kind: 'nothumb', id: e.id, text: `"${name}" בלי תמונה קטנה` });
      if (!e.date) should.push({ kind: 'nodate', id: e.id, text: `"${name}" בלי תאריך` });
      if (!e.description.trim() || GENERIC_DESC.test(e.description.trim())) should.push({ kind: 'nodesc', id: e.id, text: `"${name}" בלי תיאור אמיתי` });
      if (e.publishAt && !S.scheduled(e) && !e.visible) should.push({ kind: 'schedhidden', id: e.id, text: `"${name}" תוזמנה לפרסום אבל מוסתרת` });
      if (e.number != null) { (byNumber.get(e.number) || byNumber.set(e.number, []).get(e.number)).push(e); }
      const t = e.title.trim().toLowerCase(); if (t) (byTitle.get(t) || byTitle.set(t, []).get(t)).push(e);
      const d = U.driveId(e); if (d) (byDrive.get(d) || byDrive.set(d, []).get(d)).push(e);
    }
    for (const [n, list] of byNumber) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות עם המספר ${n}` });
    for (const [, list] of byTitle) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות בשם "${label(list[0])}"` });
    for (const [, list] of byDrive) if (list.length > 1) dup.push({ ids: list.map((e) => e.id), text: `${list.length} תוכניות עם אותה הקלטה (${list.map(label).join(', ')})` });
    return { must, should, dup };
  }

  function paintStatus() {
    const dot = $('#status-dot'), txt = $('#status-text');
    const ch = changes();
    const syncNote = !CLOUD ? ' · הם רק בדף הזה עד שמורידים את הקובץ' : A.unsynced || A.syncState === 'saving' ? ' · שומרים בטיוטה המשותפת…' : ' · נשמרו';
    if (A.conflict) { dot.className = 'dot err'; txt.textContent = 'בשרת נשמרה טיוטה חדשה יותר · השינויים שלכם עוד לא נשמרו'; }
    else if (A.offline) { dot.className = 'dot err'; txt.textContent = 'השינויים לא נשמרים לשרת — אל תסגרו את הדף'; }
    else if (!A.origin && A.originError) { dot.className = 'dot err'; txt.textContent = `האתר לא זמין כרגע${CLOUD ? ' · השינויים נשמרים בטיוטה המשותפת' : ''}`; }
    else if (!A.origin) { dot.className = 'dot'; txt.textContent = 'בודקים מה מפורסם באתר…'; }
    else if (ch.any) { dot.className = 'dot draft'; txt.textContent = `יש שינויים שעדיין לא פורסמו${syncNote}`; }
    else { dot.className = 'dot on'; txt.textContent = 'הכול מפורסם'; }
    $('#btn-publish-top').classList.toggle('pulse', !!ch?.any);
  }

  /** טוענים מה מפורסם באתר ואת הטיוטה המשותפת מהשרת. שינויים שיש כאן בזיכרון ועוד
      לא נשמרו בשרת לא נמחקים בלי לשאול. */
  async function loadOrigin() {
    await A.syncing;
    let o = null;
    try { o = await S.admin.pullOrigin(); A.origin = o; A.originError = false; } catch { A.originError = true; }
    let draft = null, draftRead = false;
    if (canSync()) {
      try { draft = (await S.sb.draft.get()).draft; draftRead = true; } catch { /* השרת לא זמין — השמירה הבאה תבדוק שוב */ }
      if (!draft?.data) draft = null;
      if (draftRead) { A.draftAt = draft ? draft.updatedAt ?? null : null; A.draftBy = draft?.by || ''; }
    }
    // מה מציגים: הטיוטה המשותפת, ואם אין — מה שמפורסם. (חיבור חדש ל־D1 מחזיר קטלוג ריק:
    // נשארים עם הקטלוג המלא מהקובץ, כדי שאפשר יהיה לפרסם אותו.)
    const emptyRemote = CLOUD && !!o && o.episodes.length === 0 && A.data.episodes.length > 0;
    const next = draft ? S.admin.normalize(draft.data) : o && !emptyRemote ? clone(o) : null;
    if (next) {
      const same = sameData(next, A.data);
      const other = draft?.by && draft.by !== S.sb.user?.email ? draft.by : '';
      const what = draft ? `הטיוטה המשותפת מהשרת${other ? ` (שנשמרה על ידי ${other})` : ''}` : 'מה שמפורסם באתר';
      if (same || !A.unsynced || confirm(`יש כאן שינויים שעוד לא ${CLOUD ? 'נשמרו בשרת' : 'ירדו לקובץ'}. לטעון במקומם את ${what}?\n\nביטול = להמשיך עם השינויים שכאן${CLOUD ? ' (הם יישמרו בשרת)' : ''}.`)) {
        A.data = next; A.unsynced = false; A.conflict = null;
        A.syncState = draft ? 'saved' : '';
        A.base = draft ? (draft.data.baseVersion !== undefined ? draft.data.baseVersion : o?.versionId ?? A.base) : o.versionId;
        if (!liveEp(A.selected)) A.selected = null;
        A.picked.clear();
        if (!same && other) U.notify(`נטענה הטיוטה המשותפת (נשמרה על ידי ${other}).`, 'info');
      }
    }
    if (A.base == null && o) A.base = o.versionId ?? null;
    if (!A.data.settings) A.data.settings = S.admin.normSettings({});
    if (canSync() && !A.surveys) { try { A.surveys = (await S.sb.surveys()).surveys; } catch { A.surveys = []; } }
    if (A.unsynced) scheduleSync();
    paintStatus(); render();
    markSeen();
  }

  async function checkAccess() {
    let allowed = false;
    try { allowed = await S.sb.isAdmin(); } catch { /* מציגים את השער */ }
    document.body.classList.toggle('admin-locked', !allowed);
    $('#admin-gate').hidden = allowed;
    const u = S.sb.user;
    $('#admin-gate-text').textContent = u
      ? `החשבון ${u.email || ''} מחובר, אבל אינו מוגדר כמנהל. האזור האישי פתוח לכם.`
      : 'הניהול פתוח למנהלי התוכנית בלבד. היכנסו עם חשבון Google.';
    $('#gate-login').hidden = true;
    $('#gate-google').hidden = !!u;
    $('#gate-fallback').hidden = !!u || !CLOUD;
    if (!u && !allowed && CLOUD) mountGate();
    paintHeader();
    return allowed;
  }
  async function afterLogin() {
    const ok = await checkAccess();
    U.notify(ok ? 'ברוכים הבאים לניהול.' : 'התחברתם, אבל החשבון הזה אינו מוגדר כמנהל.', ok ? 'success' : 'info');
    if (ok) { await loadOrigin(); maybeGuide(); loadListeners(); }
  }
  /** התנתקות: שום דבר מהטיוטה לא נשאר — לא בזיכרון ולא במכשיר */
  async function logout() {
    if (A.unsynced && canSync()) await sync();
    if (A.unsynced && !confirm('יש שינויים שעוד לא נשמרו בשרת, והם יימחקו בהתנתקות. להתנתק בכל זאת?')) return;
    clearTimeout(A.syncTimer); A.syncTimer = null; A.syncGen++;
    Object.values(A.jobs).forEach((j) => { j.stop = true; });
    $('#dlg-draft')?.close();
    Object.assign(A, {
      data: clone(S.data), origin: null, originError: false, base: null, selected: null, bulk: false,
      unsynced: false, offline: false, syncState: '', retryDelay: 0, draftAt: null, draftBy: '', conflict: null, overwrite: false, echoRetry: false, lastSent: '',
      checks: { audio: null, media: null }, versions: null, stats: null, messages: null, admins: null, subs: null, surveys: null, comments: null, pushCount: null, statsEp: '', proof: null,
      seenPrev: undefined, since: null, live: false, inboxEp: '', inboxFilter: 'todo', share: null,
    });
    if (!A.data.settings) A.data.settings = S.admin.normSettings({});
    A.picked.clear(); A.versionCache.clear(); A.epStats.clear(); A.epStatsP.clear(); A.ai.clear(); A.inboxPicked.clear();
    dropDeviceDraft();
    S.signOut(); gateMounted = false;
    await checkAccess(); render(); paintStatus();
    U.notify('התנתקתם.', 'success');
  }
  let gateMounted = false;
  async function mountGate() {
    if (gateMounted) return; gateMounted = true;
    try { await S.sb.google($('#gate-google'), { onDone: afterLogin, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') }); }
    catch (err) { gateMounted = false; $('#gate-google').innerHTML = `<span class="cue-hint">${esc(err.message)}</span>`; $('#gate-login').hidden = false; }
  }
  const viaSite = async (e) => { e?.preventDefault(); try { await S.sb.signIn(); await afterLogin(); } catch (err) { U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error'); } };
  $('#gate-login').addEventListener('click', viaSite);
  $('#gate-login-site').addEventListener('click', viaSite);

  /* ---------- לשוניות ---------- */

  function setTab(tab, { push = true } = {}) {
    if (!TABS.includes(tab)) tab = 'programs';
    A.tab = tab;
    $$('#admin-tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
    if (push && location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
    // בדף המשותף: מעבר פנימי (למשל "פתיחה" מבדיקת התקינות) מסמן גם את תפריט הצד
    if (EMBED && push && CLOUD) { try { window.parent.postMessage({ type: 'rosh-admin-tab-changed', tab }, new URL(S.sb.cfg.apiBase).origin); } catch { /* */ } }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1) || 'programs', { push: false }));
  $('#admin-tabs').addEventListener('click', (e) => { const a = e.target.closest('[data-tab]'); if (!a) return; e.preventDefault(); setTab(a.dataset.tab); });

  function render() {
    ({ programs: renderPrograms, site: renderSite, listeners: renderListeners, publish: renderPublish })[A.tab]();
  }

  /* ---------- עזרים משותפים ---------- */

  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);
  const cur = () => A.data.episodes.find((e) => e.id === A.selected) || null;
  const label = (e) => (e.title || '').trim() || 'תוכנית בלי שם';
  const splitList = (v) => String(v).split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const when = (unix) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(typeof unix === 'number' ? unix * 1000 : unix));
  const n2 = (n) => Number(n || 0).toLocaleString('he-IL');

  function uniqueSlug(base, selfId) {
    const root = slugify(base) || 'episode';
    let s = root, n = 2;
    while (A.data.episodes.some((x) => x.slug === s && x.id !== selfId)) s = `${root}-${n++}`;
    return s;
  }
  function uniqueSeasonId(base) {
    const root = slugify(base) || 'season';
    let s = root, n = 2;
    while (A.data.seasons.some((x) => x.id === s)) s = `${root}-${n++}`;
    return s;
  }
  function seasonOptions(val, withNew = true) {
    return `<option value="">בלי עונה</option>${A.data.seasons.map((s) => `<option value="${esc(s.id)}" ${s.id === val ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}${withNew ? '<option value="__new">+ עונה חדשה…</option>' : ''}`;
  }
  function select(id, { tab } = {}) {
    A.selected = id;
    if (tab && tab !== A.tab) { setTab(tab); return; }
    if (A.tab === 'programs') { renderList(); renderEditor(); $('#editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else render();
  }
  function stateOf(e) {
    if (!e.visible) return { cls: 'hidden', text: 'מוסתרת' };
    if (S.scheduled(e)) return { cls: 'scheduled', text: `תעלה ב־${when(e.publishAt)}` };
    return { cls: 'live', text: 'מוצגת' };
  }
  /** זמן בשעון ישראל ("2026-10-01T20:00") → מילישניות */
  const ilMs = (local) => Date.parse(`${local}:00Z`) - Math.round((Date.parse(`${S.nowIL()}:00Z`) - Date.now()) / 900000) * 900000;
  const ago = (ms) => {
    const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
    const s = (ms - Date.now()) / 1000, abs = Math.abs(s);
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  };

  /* ---------- מד שלמות: כמה מהתוכנית מוכן, ומה חסר ---------- */
  const COMPLETE = [
    ['title', 'שם', (e) => !!e.title.trim()],
    ['date', 'תאריך', (e) => !!e.date],
    ['number', 'מספר', (e) => e.number != null],
    ['season', 'עונה', (e) => !!e.season],
    ['audio', 'הקלטה', (e) => !!U.streamUrl(e)],
    ['duration', 'אורך', (e) => !!e.duration],
    ['cover', 'תמונה', (e) => !!e.cover],
    ['description', 'תיאור', (e) => !!e.description.trim() && !GENERIC_DESC.test(e.description.trim())],
  ];
  function completeness(e) {
    const missing = COMPLETE.filter(([, , ok]) => !ok(e)).map(([f, name]) => ({ f, name }));
    return { pct: Math.round((COMPLETE.length - missing.length) / COMPLETE.length * 100), missing };
  }
  const cmpTitle = (c) => (c.missing.length ? `${c.pct}% מוכנה · חסר: ${c.missing.map((m) => m.name).join(', ')}` : 'התוכנית שלמה');
  const cmpRing = (e) => { const c = completeness(e); return `<span class="cmp${c.pct === 100 ? ' full' : ''}" style="--p:${c.pct}" title="${esc(cmpTitle(c))}" aria-label="${esc(cmpTitle(c))}"></span>`; };
  function cmpBar(e) {
    const c = completeness(e);
    return `<div class="cmp-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.pct}" aria-label="כמה מהתוכנית מוכן"><i style="width:${c.pct}%"></i></div>
<b>${c.pct === 100 ? '✓ התוכנית שלמה' : `${c.pct}% מוכנה`}</b>${c.missing.length ? `<span class="cue-hint">חסר:</span>${c.missing.map((m) => `<button type="button" class="chip" data-op="cmp-go" data-field="${m.f}">${esc(m.name)}</button>`).join('')}` : ''}`;
  }
  const paintCompleteness = () => { const e = cur(), el = $('#cmp-bar'); if (e && el) el.innerHTML = cmpBar(e); };
  /** לוחצים על מה שחסר — והטופס קופץ לשדה שממלא אותו */
  function goToField(f) {
    const target = { title: '[data-f="title"]', date: '[data-f="date"]', number: '[data-f="number"]', season: '[data-f="season"]', audio: '[data-upload="audio"]', duration: '#preview-audio, [data-upload="audio"]', cover: '[data-op="cover-auto"]', description: CLOUD && $('#ai-card') ? '#ai-card [data-op="ai-run"]' : '[data-f="description"]' }[f];
    const el = target && $(target, P);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.focus({ preventScroll: true }), 350);
  }

  /* ======================================================
     לוח בקרה — מה שמחכה לכם, כשאף תוכנית לא פתוחה
     ====================================================== */

  /* "מה השתנה מאז שהייתי כאן": בכל כניסה נשמר (במכשיר, לכל מנהל) איזו גרסה הייתה
     באתר. בכניסה הבאה — הפרסומים של מנהלים אחרים מאז, ומה בדיוק השתנה בכל אחד. */
  const seenKey = () => `rosh:admin:seen:${S.sb.user?.email || ''}`;
  A.seenPrev = undefined; A.since = null;
  function markSeen() {
    if (A.seenPrev !== undefined || !A.origin || !S.sb.user) return;
    try { A.seenPrev = JSON.parse(localStorage.getItem(seenKey()) || 'null'); localStorage.setItem(seenKey(), JSON.stringify({ versionId: A.origin.versionId ?? null, at: Date.now() })); } catch { A.seenPrev = null; }
    loadSince();
  }
  async function loadSince() {
    if (!CLOUD || !A.seenPrev?.at) { A.since = { list: [] }; return; }
    try {
      if (!A.versions) A.versions = (await S.sb.versions.list()).versions || [];
      const mine = S.sb.user?.email;
      const fresh = A.versions.filter((v) => Number(v.createdAt) * 1000 > A.seenPrev.at && v.by !== mine).slice(0, 3);
      const list = [];
      for (const v of fresh) {
        const prev = A.versions[A.versions.indexOf(v) + 1];
        let items = [];
        if (prev) { try { items = diffData((await versionData(prev.id)).data, (await versionData(v.id)).data); } catch { /* הגרסה לא נטענה */ } }
        list.push({ v, items });
      }
      A.since = { list, more: A.versions.filter((v) => Number(v.createdAt) * 1000 > A.seenPrev.at && v.by !== mine).length - fresh.length };
    } catch { A.since = { list: [], error: true }; }
    paintDash();
  }
  const paintDash = () => { if (A.tab === 'programs' && !cur()) renderEditor(); };

  /** האזנות בשבוע האחרון מול השבוע שלפניו (מתוך 30 הימים שבסטטיסטיקה) */
  function weekTrend() {
    const days = (A.stats?.days || []).slice().sort((a, b) => a.day.localeCompare(b.day));
    if (!days.length) return null;
    const today = S.todayIL(), dayMs = 86400000;
    const back = (n) => new Date(Date.parse(`${today}T12:00:00Z`) - n * dayMs).toISOString().slice(0, 10);
    const sum = (from, to) => days.filter((d) => d.day > from && d.day <= to).reduce((n, d) => n + (Number(d.plays) || 0), 0);
    const now = sum(back(7), today), before = sum(back(14), back(7));
    return { now, before, delta: before ? Math.round((now - before) / before * 100) : null };
  }
  function greeting() {
    const h = Number(S.nowIL().slice(11, 13));
    const first = String(S.sb.user?.name || '').trim().split(/\s+/)[0];
    return `${h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 22 ? 'ערב טוב' : 'לילה טוב'}${first ? `, ${first}` : ''}`;
  }
  /** "מה השתנה מאז הביקור הקודם": הפרסומים של מנהלים אחרים, ומה בדיוק השתנה בכל אחד */
  function sinceCard() {
    const since = A.since, seen = A.seenPrev;
    if (!seen?.at || !since) return '';
    const epBtn = (id, text) => (id && liveEp(id) ? `<button type="button" class="link-btn" data-op="open" data-id="${esc(id)}">${esc(text)}</button>` : `<b>${esc(text)}</b>`);
    const item = ({ v, items }) => `
    <div class="since-item"><p class="since-head">פרסום של <b class="ltr">${esc(v.by || 'מנהל אחר')}</b> · ${esc(when(v.createdAt))}${items.length ? ` · ${items.length === 1 ? 'שינוי אחד' : `${items.length} שינויים`}` : ''}</p>
    ${items.length ? `<ul class="diff-list">${items.slice(0, 6).map((d) => `<li>${epBtn(d.id, d.head)}${d.rows.length ? `<ul>${d.rows.slice(0, 4).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</li>`).join('')}${items.length > 6 ? `<li class="cue-hint">ועוד ${items.length - 6}…</li>` : ''}</ul>` : ''}</div>`;
    const body = since.list.length
      ? since.list.map(item).join('') + (since.more > 0 ? `<p class="cue-hint">ועוד ${since.more} פרסומים — הכול בחלק "פרסום", בגרסאות הקודמות.</p>` : '')
      : `<p class="help" style="margin:0">${since.error ? 'לא הצלחנו לבדוק מה השתנה.' : '✓ אף מנהל אחר לא פרסם מאז הביקור הקודם שלכם.'}</p>`;
    return `<div class="card dash-since">
  <div class="section-title"><div><p class="kicker">מאז הביקור הקודם · ${esc(ago(seen.at))}</p><h2>מה השתנה</h2></div></div>
  <div class="card-body">${body}</div>
</div>`;
  }
  function dashboard() {
    const ch = changes(), hc = health();
    const waiting = (A.messages?.unread || 0) + (A.comments?.pending || 0);
    const pending = ch ? ch.added + ch.changed + ch.removed.length + (ch.seasons ? 1 : 0) + (ch.settings ? 1 : 0) : 0;
    const trend = weekTrend();
    const partial = A.data.episodes.filter((e) => completeness(e).pct < 100).length;
    const tile = (n, text, sub, attrs, tone = '') => `<button type="button" class="dash-tile${tone ? ` ${tone}` : ''}" ${attrs}><b>${n}</b><span>${text}</span>${sub ? `<small>${sub}</small>` : ''}</button>`;
    const upcoming = A.data.episodes.filter((e) => e.visible && S.scheduled(e)).sort((a, b) => a.publishAt.localeCompare(b.publishAt));
    const latest = A.data.episodes.filter((e) => e.visible && !S.scheduled(e)).sort(byDate)[0];
    const recentRow = (id) => (A.stats?.recent || []).find((r) => r.id === id) || {};
    const plays = (id) => Number(recentRow(id).plays) || 0;
    const downloads = (id) => (A.stats?.config ? ` · ${n2(recentRow(id).downloads)} הורדות` : '');
    const groups = Object.entries(HEALTH_GROUPS).map(([kind, g]) => ({ kind, g, n: hc.should.filter((p) => p.kind === kind).length })).filter((x) => x.n);
    const other = A.draftBy && A.draftBy !== S.sb.user?.email ? A.draftBy : '';
    const epBtn = (id, text) => (id && liveEp(id) ? `<button type="button" class="link-btn" data-op="open" data-id="${esc(id)}">${esc(text)}</button>` : `<b>${esc(text)}</b>`);
    return `
<div class="card dash">
  <div class="section-title"><div><p class="kicker">לוח בקרה · ${esc(fmtDate(S.todayIL()))}</p><h2>${esc(greeting())}</h2></div>
</div>
  <div class="card-body">
    <div class="dash-tiles">
      ${CLOUD ? tile(A.messages || A.comments ? n2(waiting) : '…', 'מחכות לתשובה', 'הודעות ותגובות של מאזינים', 'data-op="goto" data-tab="listeners"', waiting ? 'hot' : '') : ''}
      ${tile(ch ? n2(pending) : '…', 'שינויים שלא פורסמו', pending ? 'לבדיקה ולפרסום' : 'הכול מפורסם', 'data-op="goto" data-tab="publish"', pending ? 'gold' : '')}
      ${CLOUD ? tile(trend ? n2(trend.now) : '…', 'האזנות השבוע', trend?.delta != null ? `<span class="delta ${trend.delta >= 0 ? 'up' : 'down'}">${trend.delta >= 0 ? '▲' : '▼'} ${Math.abs(trend.delta)}%</span> לעומת השבוע הקודם` : '', 'data-op="goto" data-tab="listeners"') : ''}
      ${tile(n2(partial), 'תוכניות לא שלמות', 'חסר בהן משהו', 'data-op="filter" data-filter="partial"')}
    </div>
  </div>
</div>
${other ? `<div class="card"><div class="card-body"><p class="help" style="margin:0">✎ אתם עובדים על הטיוטה המשותפת — שמר בה לאחרונה <b class="ltr">${esc(other)}</b>. השינויים של שניכם יתפרסמו יחד.</p></div></div>` : ''}
${sinceCard()}
<div class="two-col dash-cols">
  <div class="card"><div class="section-title"><div><p class="kicker">באתר</p><h2>התוכניות</h2></div></div><div class="card-body">
    ${upcoming.length ? `<p class="kicker">מתוזמנות</p><ul class="dash-list">${upcoming.slice(0, 4).map((e) => `<li>${epBtn(e.id, label(e))}<small>תעלה ${esc(ago(ilMs(e.publishAt)))} · ${esc(when(e.publishAt))}</small></li>`).join('')}</ul>` : ''}
    ${latest ? `<p class="kicker">האחרונה באתר</p><ul class="dash-list"><li>${epBtn(latest.id, label(latest))}<small>${esc(fmtDate(latest.date, true) || 'בלי תאריך')}${CLOUD && A.stats && !A.stats.error ? ` · ${n2(plays(latest.id))} האזנות${downloads(latest.id)} ב־30 יום` : ''}</small></li></ul>` : '<p class="help">עדיין אין תוכניות באתר.</p>'}
  </div></div>
  <div class="card"><div class="section-title"><div><p class="kicker">בדיקת תקינות</p><h2>מה כדאי להשלים</h2></div></div><div class="card-body">
    ${hc.must.length ? `<div class="problems"><b>לפני הפרסום הבא צריך לתקן:</b><ul>${hc.must.slice(0, 5).map((p) => `<li>${epBtn(p.id, p.text)}</li>`).join('')}</ul></div>` : ''}
    ${groups.length ? `<div class="dash-chips">${groups.map(({ g, n }) => `<button type="button" class="chip" data-op="goto" data-tab="publish">${n2(n)} ${esc(g.title)}</button>`).join('')}</div>` : !hc.must.length ? '<p class="help" style="margin:0">✓ לכל התוכניות יש כל מה שצריך.</p>' : ''}
  </div></div>
</div>`;
  }

  /* ======================================================
     1. תוכניות
     ====================================================== */

  function renderPrograms() {
    $('#panel').innerHTML = `
<div class="workspace">
  <aside class="side" aria-label="רשימת התוכניות">
    <div class="card">
      <div class="side-head">
        <button type="button" class="btn primary" data-op="new" style="width:100%">+ תוכנית חדשה</button>
        ${A.data.episodes.some((x) => !x.date) ? `<button type="button" class="btn small" data-op="dates-screen" style="width:100%;margin-top:8px">השלמת תאריכים (${A.data.episodes.filter((x) => !x.date).length})</button>` : ''}
        <div class="search-box" role="search">
          <span class="search-glyph" aria-hidden="true">♫</span>
          <label for="ep-q" class="visually-hidden">חיפוש תוכנית</label>
          <input id="ep-q" type="search" placeholder="חיפוש תוכנית…" autocomplete="off" value="${esc(A.q)}">
        </div>
        <div class="filters" style="margin:10px 0 0">
          <label class="visually-hidden" for="ep-filter">סינון</label>
          <select id="ep-filter" class="input small-select">
            <option value="all">כל התוכניות</option>
            <option value="visible">מוצגות באתר</option>
            <option value="hidden">מוסתרות</option>
            <option value="scheduled">מתוזמנות</option>
            <option value="noaudio">בלי הקלטה</option>
            <option value="nocover">בלי תמונה</option>
            <option value="partial">לא שלמות</option>
          </select>
          <span class="count" id="ep-count"></span>
          <button type="button" class="chip" data-op="bulk" aria-pressed="${A.bulk}">${A.bulk ? '✕ סיום בחירה' : 'בחירה מרובה'}</button>
        </div>
        <div class="bulk-bar" id="bulk-bar" ${A.bulk ? '' : 'hidden'}></div>
      </div>
      <div class="ep-list" id="ep-list" role="listbox" aria-label="תוכניות"></div>
    </div>
  </aside>
  <section class="editor" id="editor"></section>
  <aside class="live-pane" id="live-pane" aria-label="תצוגה חיה" hidden></aside>
</div>`;
    $('#ep-filter').value = A.filter;
    renderList(); renderEditor();
  }

  function listFiltered() {
    let l = A.data.episodes.slice().sort(byDate);
    if (A.filter === 'visible') l = l.filter((e) => e.visible && !S.scheduled(e));
    if (A.filter === 'hidden') l = l.filter((e) => !e.visible);
    if (A.filter === 'scheduled') l = l.filter((e) => S.scheduled(e));
    if (A.filter === 'noaudio') l = l.filter((e) => !U.streamUrl(e));
    if (A.filter === 'nocover') l = l.filter((e) => !e.cover);
    if (A.filter === 'partial') l = l.filter((e) => completeness(e).pct < 100);
    if (A.q) l = S.searchEpisodes(A.q, l);
    return l;
  }
  function renderList() {
    const box = $('#ep-list'); if (!box) return;
    const l = listFiltered();
    $('#ep-count').textContent = l.length === A.data.episodes.length ? `${l.length} תוכניות` : `${l.length} מתוך ${A.data.episodes.length}`;
    box.innerHTML = l.length ? l.map((e) => {
      const st = stateOf(e);
      return `
<button type="button" class="ep-item${e.visible ? '' : ' hidden-ep'}${A.picked.has(e.id) ? ' picked' : ''}" role="option" data-id="${esc(e.id)}" aria-current="${A.selected === e.id}" aria-selected="${A.bulk ? A.picked.has(e.id) : A.selected === e.id}">
  ${A.bulk ? `<span class="pick-box" aria-hidden="true">${A.picked.has(e.id) ? '✓' : ''}</span>` : `<span class="num">${e.number ?? '♫'}</span>`}
  <span class="txt"><b>${esc(label(e))}</b><small>${esc(fmtDate(e.date, true) || 'בלי תאריך')} · <i class="st ${st.cls}">${esc(st.text)}</i></small></span>
  <span class="flags">${cmpRing(e)}${e.featured ? '<span class="flag featured" title="מומלצת בדף הבית"></span>' : ''}${U.streamUrl(e) ? '<span class="flag audio" title="יש הקלטה"></span>' : '<span class="flag none" title="בלי הקלטה"></span>'}</span>
</button>`; }).join('') : '<div class="state" style="padding:24px"><p>אין תוכניות שמתאימות לחיפוש.</p></div>';
    renderBulkBar();
  }
  function renderBulkBar() {
    const bar = $('#bulk-bar'); if (!bar) return;
    bar.hidden = !A.bulk;
    if (!A.bulk) return;
    const n = A.picked.size;
    bar.innerHTML = `
<span class="cue-hint">${n ? (n === 1 ? 'נבחרה תוכנית אחת' : `נבחרו ${n} תוכניות`) : 'לחצו על תוכניות כדי לבחור'}</span>
<button type="button" class="btn small" data-op="pick-all">${n === listFiltered().length && n ? 'ניקוי הבחירה' : 'בחירת כל המוצגות'}</button>
<div class="bulk-actions" ${n ? '' : 'hidden'}>
  <button type="button" class="btn small" data-op="bulk-show">הצגה באתר</button>
  <button type="button" class="btn small" data-op="bulk-hide">הסתרה</button>
  <select class="input small-select" data-op="bulk-season" aria-label="שיוך לעונה"><option value="">שיוך לעונה…</option>${A.data.seasons.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}<option value="__none">בלי עונה</option></select>
  <button type="button" class="btn small danger" data-op="bulk-del">מחיקה</button>
</div>`;
  }

  function renderEditor() {
    const E = $('#editor'); if (!E) return;
    const e = cur();
    if (!e) {
      E.innerHTML = dashboard();
      paintLive();
      return;
    }
    const stream = U.streamUrl(e);
    const st = stateOf(e);
    E.innerHTML = `
<div class="card">
  <div class="section-title">
    <div><p class="kicker">${e.number != null ? `תוכנית ${e.number}` : 'תוכנית'} · <i class="st ${st.cls}">${esc(st.text)}</i></p><h2 id="ed-title-echo">${esc(label(e))}</h2><div class="cmp-bar" id="cmp-bar">${cmpBar(e)}</div></div>
    <div class="inline-toggles">
      <button type="button" class="btn small editor-back" data-op="back-to-list">← לרשימה</button>
      <button type="button" class="btn small" data-op="live" aria-pressed="${A.live}">${A.live ? '✓ תצוגה חיה' : 'תצוגה חיה'}</button>
      <button type="button" class="btn small" data-op="share">ערכת שיתוף</button>
      ${CLOUD ? '<button type="button" class="btn small" data-op="mail">✉ מייל למאזינים</button>' : ''}
      ${CLOUD ? '<button type="button" class="btn small gold" data-op="publish-one" title="מפרסם עכשיו רק את התוכנית הזו; שאר השינויים נשארים בטיוטה">פרסום של התוכנית הזו</button>' : ''}
      <button type="button" class="btn small" data-op="dup">שכפול</button>
      <button type="button" class="btn small" data-op="history" ${CLOUD ? '' : 'disabled'}>גרסאות קודמות</button>
      <button type="button" class="btn small danger" data-op="del">מחיקה</button>
    </div>
  </div>
  <div class="card-body">
    <div class="form-grid">
      <label class="field span2"><span>שם התוכנית</span><input data-f="title" value="${esc(e.title)}" placeholder="למשל: שירי הסתיו" autocomplete="off"><small>כך התוכנית תופיע באתר.</small></label>
      <label class="field"><span>תאריך השידור</span><input data-f="date" type="date" value="${esc(e.date)}"></label>
      <label class="field"><span>מספר התוכנית</span><input data-f="number" type="number" inputmode="numeric" value="${e.number ?? ''}" placeholder="90"></label>
      <label class="field"><span>עונה</span><select data-f="season">${seasonOptions(e.season)}</select></label>
      <label class="field"><span>אורחים</span><input data-f="guests" value="${esc(e.guests.join(', '))}" placeholder="שמות, מופרדים בפסיק"></label>
      ${CLOUD ? `<label class="field"><span>מקושרת למצעד (לא חובה)</span><select data-f="surveyId"><option value="">בלי מצעד</option>${(A.surveys || []).map((s) => `<option value="${esc(s.id)}" ${s.id === e.surveyId ? 'selected' : ''}>${esc(s.name)}${s.active ? ' · הפעיל' : ''}${s.open ? ' · ההצבעה פתוחה' : ''}</option>`).join('')}${e.surveyId && !(A.surveys || []).some((s) => s.id === e.surveyId) ? `<option value="${esc(e.surveyId)}" selected>מצעד שנמחק</option>` : ''}</select><small>דף התוכנית יציג קישור להצבעה כשהמצעד פתוח.</small></label>` : ''}
      <label class="field span2"><span>על התוכנית</span><textarea data-f="description" placeholder="כמה משפטים על מה שהיה בתוכנית. שורה ריקה פותחת פסקה חדשה.">${esc(e.description)}</textarea></label>
    </div>
    <div class="switches">
      <button type="button" class="toggle${e.visible ? ' on' : ''}" data-op="visible" aria-pressed="${e.visible}">${e.visible ? '✓ מוצגת באתר' : 'מוסתרת מהאתר'}</button>
      <button type="button" class="toggle${e.featured ? ' on' : ''}" data-op="featured" aria-pressed="${e.featured}">${e.featured ? '★ התוכנית המומלצת בדף הבית' : 'להציג כמומלצת בדף הבית'}</button>
    </div>
    <div class="schedule">
      <label class="field"><span>פרסום מתוזמן (לא חובה)</span><input data-f="publishAt" type="datetime-local" value="${esc(e.publishAt)}"><small>${e.publishAt ? (S.scheduled(e) ? `התוכנית תופיע באתר ב־${when(e.publishAt)}. עד אז המאזינים לא רואים אותה, גם אחרי פרסום.` : 'המועד עבר — התוכנית מוצגת כרגיל.') : 'ריק = מופיעה מיד אחרי הפרסום.'}</small></label>
      ${e.publishAt ? '<button type="button" class="btn small" data-op="unschedule">ביטול התזמון</button>' : ''}
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">ההקלטה</p><h2>מה שומעים</h2></div>${e.duration ? `<strong>${esc(fmtDuration(e.duration))}</strong>` : ''}</div>
  <div class="card-body">
    <div class="media-state${stream ? ' ok' : ''}">${stream ? '✓ יש הקלטה לתוכנית הזו. המאזינים שומעים אותה בנגן של האתר.' : 'עדיין אין הקלטה. העלו קובץ או הדביקו קישור.'}</div>
    ${stream ? `<audio class="audio-preview" id="preview-audio" controls preload="metadata" src="${esc(stream)}"></audio>` : ''}
    <div class="form-grid">
      <label class="field"><span>${stream ? 'החלפת ההקלטה — העלאת קובץ' : 'העלאת קובץ ההקלטה'}</span><input type="file" data-upload="audio" accept=".mp3,.m4a,.wav,.ogg,.flac,.aac"><small>קובץ שמע (MP3 וכו') עד 1GB — גם תוכנית של שעתיים. אפשר גם לגרור את הקובץ לכאן.</small><span class="upload-status" role="status" data-upload-status="audio"></span></label>
      <label class="field"><span>או קישור להקלטה</span><input data-f="audio" value="${esc(e.audio)}" placeholder="https://…" spellcheck="false" class="ltr"><small>קישור שיתוף לקובץ בדרייב מספיק.</small></label>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">התמונה</p><h2>מה רואים</h2></div></div>
  <div class="card-body">
    <div class="cover-grid">
      ${e.cover ? `<img class="cover-preview" src="${esc(e.cover)}" alt="">` : '<div class="cover-preview empty"><span>♫</span><small>בלי תמונה האתר מציג עטיפה צבעונית משלו</small></div>'}
      <div class="cover-fields">
        <div class="field"><span>יצירת תמונה אוטומטית</span><div class="actions" style="margin:0"><button type="button" class="btn gold" data-op="cover-auto">${e.cover ? 'יצירת תמונה חדשה' : 'ליצור תמונה עכשיו'}</button></div><small>עטיפה בסגנון האתר עם שם התוכנית, המספר ומשפט מהתיאור. אפשר ללחוץ שוב לגרסה אחרת.</small><span class="upload-status" role="status" data-upload-status="auto"></span></div>
        <label class="field"><span>העלאת תמונה משלכם</span><input type="file" data-upload="cover" accept=".jpg,.jpeg,.png,.webp"><small>או גררו תמונה לכאן.</small><span class="upload-status" role="status" data-upload-status="cover"></span></label>
        <label class="field"><span>או קישור לתמונה</span><input data-f="cover" value="${esc(e.cover)}" placeholder="https://…" spellcheck="false" class="ltr"></label>
        ${e.cover ? '<button type="button" class="btn small" data-op="cover-clear">הסרת התמונה</button>' : ''}
      </div>
    </div>
  </div>
</div>

<details class="card more-details">
  <summary>עוד פרטים (לא חובה)</summary>
  <div class="card-body">
    <label class="field"><span>מילות חיפוש</span><input data-f="tags" value="${esc(e.tags.join(', '))}" placeholder="למשל: מצעד, ראיון, חנוכה"><small>עוזרות למאזינים למצוא את התוכנית בחיפוש. מופרדות בפסיק.</small></label>
    <div class="field" style="margin-top:16px">
      <span>קישורים שיופיעו בדף התוכנית</span>
      <div class="link-rows" id="link-rows">${renderLinks(e)}</div>
      <div><button type="button" class="btn small" data-op="link-add">+ קישור</button></div>
    </div>
  </div>
</details>

${aiCard(e)}

${epStatsCard(e)}

<div class="card">
  <div class="section-title"><div><p class="kicker">כך זה ייראה</p><h2>באתר</h2></div>${A.live ? '' : '<button type="button" class="btn small" data-op="live">תצוגה חיה של הדף ←</button>'}</div>
  <div class="card-body"><div class="preview-wrap"><div id="preview-card"></div><p class="help">זה הכרטיס של התוכנית בדף הבית ובארכיון. "תצוגה חיה" פותחת לצד העריכה את דף התוכנית המלא, כמו שהמאזינים יראו אותו.</p></div></div>
</div>`;
    renderPreview(); paintAi(); paintEpStats(); paintLive();
  }

  function renderLinks(e) {
    return e.links.map((l, i) => `
<div class="link-row" data-i="${i}">
  <input data-lf="label" data-i="${i}" value="${esc(l.label)}" placeholder="מה זה? (למשל: הפלייליסט)" aria-label="שם הקישור">
  <input class="u" data-lf="url" data-i="${i}" value="${esc(l.url)}" placeholder="https://…" aria-label="כתובת" spellcheck="false">
  <button type="button" class="icon-btn del" data-op="link-del" data-i="${i}" aria-label="מחיקת הקישור">✕</button>
</div>`).join('') || '<p class="cue-hint" style="margin:0 0 8px">אין קישורים.</p>';
  }
  function renderPreview() {
    const e = cur(); const box = $('#preview-card'); if (!e || !box) return;
    box.innerHTML = U.epCard(S.admin.normEpisode(e, 0), { href: '#' });
    $('#ed-title-echo').textContent = label(e);
    paintCompleteness();
  }
  const schedulePreview = () => { clearTimeout(A.previewTimer); A.previewTimer = setTimeout(() => { renderPreview(); renderList(); }, 200); };

  function newEpisode() {
    const today = new Date().toISOString().slice(0, 10);
    const maxNum = A.data.episodes.reduce((m, e) => Math.max(m, e.number || 0), 0);
    const latestSeason = A.data.seasons.slice().sort((a, b) => (b.year || 0) - (a.year || 0))[0];
    const e = { id: `ep-${Date.now().toString(36)}`, slug: '', number: maxNum + 1, season: latestSeason?.id || '', title: '', date: today, description: '', cover: '', audio: '', duration: 0, tags: [], guests: [], links: [], featured: false, visible: true, tracks: [], publishAt: '' };
    e.slug = uniqueSlug(today, e.id);
    A.data.episodes.unshift(e);
    A.q = ''; A.filter = 'all'; A.bulk = false; A.picked.clear();
    touch();
    A.selected = e.id;
    if (A.tab !== 'programs') setTab('programs'); else renderPrograms();
    $('[data-f="title"]')?.focus();
  }
  function duplicate(e) {
    const c = clone(e);
    c.id = `ep-${Date.now().toString(36)}`; c.slug = uniqueSlug(`${e.slug}-2`, c.id); c.number = e.number != null ? e.number + 1 : null; c.featured = false; c.title = `${e.title} (עותק)`;
    A.data.episodes.unshift(c); touch(); select(c.id); U.notify('התוכנית שוכפלה. זה העותק — ערכו אותו.', 'success');
  }
  function removeMany(ids) {
    const gone = [];
    ids.forEach((id) => { const i = A.data.episodes.findIndex((x) => x.id === id); if (i >= 0) gone.push({ i, e: A.data.episodes.splice(i, 1)[0] }); });
    if (gone.some((g) => g.e.id === A.selected)) A.selected = null;
    A.picked.clear(); touch(); renderList(); renderEditor();
    U.notify(gone.length === 1 ? `"${label(gone[0].e)}" נמחקה.` : `${gone.length} תוכניות נמחקו.`, 'success', { action: 'ביטול', ttl: 9000, onAction: () => { gone.sort((a, b) => a.i - b.i).forEach((g) => A.data.episodes.splice(g.i, 0, g.e)); touch(); renderList(); renderEditor(); } });
  }
  function newSeasonInline(sel) {
    const title = prompt('איך לקרוא לעונה החדשה? (למשל: עונת 2027)');
    if (!title) { sel.value = cur()?.season || ''; return; }
    const year = (title.match(/\d{4}/) || [])[0];
    const s = { id: uniqueSeasonId(year || title), title: title.trim(), year: year ? Number(year) : null, note: '' };
    A.data.seasons.push(s);
    const e = cur(); if (e) e.season = s.id;
    touch(); renderEditor();
  }
  function shareText(e) {
    const url = new URL(`episode.html?ep=${encodeURIComponent(e.slug)}`, site.url || location.href).href;
    const first = (e.description || '').split(/\n+/)[0].trim().slice(0, 200);
    return [`🎙️ ${site.name || 'ראש בראש'}${e.number != null ? ` · תוכנית ${e.number}` : ''}`, `*${label(e)}*`, e.date ? fmtDate(e.date) : '', first, `להאזנה: ${url}`].filter(Boolean).join('\n');
  }

  /* ---------- מספרים של התוכנית, בתוך העורך ---------- */

  /** הסטטיסטיקה של תוכנית אחת (האזנות, עד איפה שמעו, רגעים אהובים) — נטענת פעם אחת */
  A.epStatsP = new Map();
  function fetchEpStats(id) {
    if (A.epStats.has(id)) return Promise.resolve(A.epStats.get(id));
    if (!A.epStatsP.has(id)) {
      A.epStatsP.set(id, Promise.allSettled([S.sb.call(`/api/program/stats/episode/${encodeURIComponent(id)}`), S.sb.call(`/api/program/moments/${encodeURIComponent(id)}`)]).then(([st, mo]) => {
        const v = { ...(st.status === 'fulfilled' ? st.value : { error: st.reason?.message || 'error' }), moments: mo.status === 'fulfilled' ? mo.value : null };
        A.epStats.set(id, v); A.epStatsP.delete(id);
        return v;
      }));
    }
    return A.epStatsP.get(id);
  }
  function epStatsCard(e) {
    if (!CLOUD || !A.origin?.episodes.some((x) => x.id === e.id)) return '';
    return `
<div class="card" id="ep-stats-card">
  <div class="section-title"><div><p class="kicker">מאזינים</p><h2>מי שמע את התוכנית</h2></div><button type="button" class="btn small" data-op="inbox-ep">מה כתבו עליה</button></div>
  <div class="card-body" id="ep-stats-box"><p class="help">טוענים…</p></div>
</div>`;
  }
  function paintEpStats() {
    const e = cur(), box = $('#ep-stats-box'); if (!e || !box) return;
    const id = e.id, s = A.epStats.get(id);
    if (!s) { fetchEpStats(id).then(() => { if (cur()?.id === id) paintEpStats(); }); return; }
    if (s.error) { box.innerHTML = `<p class="help">${/404|לא נמצא/.test(s.error) ? 'השרת עדיין לא אוסף מספרים לכל תוכנית.' : esc(s.error)}</p>`; return; }
    const ret = (s.retention || []).map((r) => ({ pct: Number(r.pct) || 0, n: Number(r.listeners) || 0 }));
    const start = ret[0]?.n || 0, end = ret.at(-1)?.n || 0;
    const likes = Number((A.stats?.likes || []).find((r) => r.id === id)?.likes) || 0;
    const wrote = (A.comments?.comments || []).filter((c) => c.episodeId === id).length + (A.messages?.messages || []).filter((m) => m.episodeId === id).length;
    const rmax = Math.max(1, ...ret.map((r) => r.n));
    const stat = (n, t) => `<div class="stat"><b>${n}</b><small>${t}</small></div>`;
    // שרת שסופר האזנות מלאות והורדות (s.config); בגרסה ישנה — כמה מהמתחילים הגיעו לסוף
    const counted = s.config ? `${stat(n2(s.full), 'האזנות מלאות')}${stat(n2(s.downloads), 'הורדות')}` : stat(start ? `${Math.round(end / start * 100)}%` : '—', 'שמעו עד הסוף');
    box.innerHTML = `
<div class="stats admin-stats mini">${stat(n2(s.plays), 'האזנות')}${stat(n2(s.listeners), 'מאזינים')}${counted}${stat(`♥ ${n2(likes)}`, 'אהבו')}${stat(n2(wrote), 'כתבו')}</div>
${s.config ? `<p class="cue-hint">מאז ${esc(fmtDate(s.config.since))} · ${esc(countRule(s.config))} · ${n2(s.starts)} התחילו לשמוע.</p>` : ''}
${ret.some((r) => r.n) ? `<div class="bars retention mini" role="img" aria-label="כמה מאזינים הגיעו לכל נקודה בתוכנית">${ret.map((r) => `<div class="bar" title="${r.pct}% מהתוכנית: ${n2(r.n)} מאזינים"><i style="height:${Math.round(r.n / rmax * 100)}%"></i><small>${r.pct % 25 ? '' : `${r.pct}%`}</small></div>`).join('')}</div><p class="cue-hint">כל עמודה: כמה מאזינים הגיעו לנקודה הזו. ירידה חדה = שם עוזבים.</p>` : '<p class="help">עוד אין מספיק האזנות לגרף של עד איפה שומעים.</p>'}
${s.moments?.top?.length ? `<p class="kicker" style="margin-top:14px">הרגעים הכי אהובים — לחיצה משמיעה</p><div class="hot-list">${s.moments.top.slice(0, 6).map((t) => `<button type="button" class="pill" data-op="hear-at" data-t="${Number(t.at) || 0}">♥ ${U.fmtTime(t.at)} · ${n2(t.count)}</button>`).join('')}</div>` : ''}`;
  }

  /* ---------- פרסום של תוכנית אחת בלבד ----------
     מפרסמים את מה שכבר באתר + התוכנית הזו. שאר השינויים נשארים בטיוטה. */
  const epChanged = (e) => { const o = A.origin?.episodes.find((x) => x.id === e.id); return !o || JSON.stringify(o) !== JSON.stringify(S.admin.normEpisode(e, 0)); };
  async function publishOne(e, btn) {
    if (!CLOUD) return;
    if (!A.origin) { U.notify('עוד לא ידוע מה מפורסם באתר. נסו שוב בעוד רגע.', 'info'); return; }
    if (jobsBusy()) { U.notify('ממתינים לסיום העבודה — אחר כך אפשר לפרסם.', 'info'); return; }
    if (A.publishing) return;
    if (!epChanged(e)) { U.notify('התוכנית הזו כבר מפורסמת בדיוק כמו שהיא כאן.', 'info'); return; }
    if (!e.title.trim()) { U.notify('לפני הפרסום צריך לתת לתוכנית שם.', 'error'); goToField('title'); return; }
    const isPublic = (x) => x.visible && !S.scheduled(x);
    const o = A.origin.episodes.find((x) => x.id === e.id);
    const fresh = isPublic(e) && !(o && isPublic(o));
    const others = detailedChanges().filter((d) => d.id !== e.id).length;
    if (!confirm(`לפרסם עכשיו רק את "${label(e)}"?${others ? `\n\n${others === 1 ? 'שינוי אחד אחר נשאר' : `${others} שינויים אחרים נשארים`} בטיוטה ולא יתפרסמו.` : ''}${fresh && A.notify ? '\n\nמי שביקש התראות יקבל התראה על התוכנית.' : ''}`)) return;
    const snap = clone(A.origin); delete snap.versionId;
    const ne = clone(S.admin.normEpisode(e, 0));
    const i = snap.episodes.findIndex((x) => x.id === e.id);
    if (i >= 0) snap.episodes[i] = ne; else snap.episodes.unshift(ne);
    if (ne.featured) snap.episodes.forEach((x) => { if (x.id !== ne.id) x.featured = false; });
    if (ne.season && !snap.seasons.some((s) => s.id === ne.season)) { const sd = A.data.seasons.find((s) => s.id === ne.season); if (sd) snap.seasons.push(clone(sd)); }
    if (btn) btn.disabled = true;
    const stop = U.notify('מפרסמים את התוכנית…', 'progress');
    const go = async (force) => {
      A.publishing = true;
      try {
        clearTimeout(A.syncTimer); A.syncTimer = null;
        await A.syncing;
        if (A.conflict) { showDraftConflict(); throw new Error('קודם בחרו מה לעשות עם הטיוטה החדשה שבשרת.'); }
        const r = await S.sb.push(snap, { removedIds: [], baseVersion: A.base ?? null, force, notify: fresh && A.notify });
        A.origin = S.admin.normalize(snap); A.origin.versionId = r.versionId ?? null; A.base = A.origin.versionId;
        A.originError = false; A.versions = null; A.versionCache.clear();
        // השרת מוחק את הטיוטה המשותפת בכל פרסום — מה שנשאר בה נשמר שוב מיד
        A.syncGen++; A.draftAt = null; A.draftBy = ''; A.syncState = '';
        if (sameData(A.data, A.origin)) { A.unsynced = false; try { await S.sb.draft.clear(); } catch { /* */ } }
        else { A.unsynced = true; A.overwrite = true; }
        stop(); U.notify(`"${label(e)}" פורסמה באתר.${others ? ' שאר השינויים עדיין בטיוטה.' : ''}`, 'success');
        paintStatus(); render();
        if (fresh && A.notify && r.notified) drainPush().then((n) => n && U.notify(n === 1 ? 'נשלחה התראה למכשיר אחד.' : `נשלחה התראה ל־${n} מכשירים.`, 'success'));
        if (fresh && A.mailAfter) openMail(e.id);   // התוכנית עלתה עכשיו לאתר: טיוטת מייל לרשימת התפוצה
      } finally { A.publishing = false; if (A.unsynced) scheduleSync(0); }
    };
    try { await go(false); }
    catch (err) {
      stop();
      if (err.conflict) {
        const who = err.latest?.by ? ` (${err.latest.by}${err.latest.createdAt ? `, ${when(err.latest.createdAt)}` : ''})` : '';
        showConflict(who, async () => { const s2 = U.notify('מפרסמים…', 'progress'); try { await go(true); } catch (e2) { s2(); U.notify(`הפרסום לא הצליח: ${e2.message}`, 'error'); } });
      } else U.notify(`הפרסום לא הצליח: ${err.message}`, 'error');
    } finally { if (btn) btn.disabled = false; }
  }

  /* ---------- תצוגה חיה: דף התוכנית כמו שייראה באתר, לצד העריכה ----------
     הדף נטען ב־iframe מאותו אתר (episode.html?live=1) ולוקח את הטיוטה מהזיכרון של
     הניהול — בלי שרת ובלי פרסום. כל שינוי מרענן אותו אחרי רגע. */
  A.live = false; A.liveSize = 'phone';
  window.RoshAdminLive = () => clone(A.data);
  function paintLive() {
    const pane = $('#live-pane'), ws = $('#panel .workspace'); if (!pane || !ws) return;
    const e = cur(), on = A.live && !!e;
    ws.classList.toggle('live', on); pane.hidden = !on;
    if (!on) { pane.innerHTML = ''; return; }
    const src = `episode.html?ep=${encodeURIComponent(e.slug)}&live=1`;
    let f = $('#live-frame');
    if (!f) {
      pane.innerHTML = `
<div class="card live-card">
  <div class="live-head"><b>כך זה ייראה באתר</b><div class="segmented" role="group" aria-label="גודל המסך"><button type="button" data-op="live-size" data-size="phone" aria-pressed="${A.liveSize === 'phone'}">טלפון</button><button type="button" data-op="live-size" data-size="desktop" aria-pressed="${A.liveSize === 'desktop'}">מחשב</button></div><button type="button" class="icon-btn" data-op="live" aria-label="סגירת התצוגה החיה">✕</button></div>
  <div class="live-stage"><iframe id="live-frame" title="תצוגה חיה של דף התוכנית" src="${esc(src)}"></iframe></div>
  <p class="cue-hint">מתעדכן מכל שינוי. רק אתם רואים את זה — המאזינים רואים רק מה שפורסם.</p>
</div>`;
      f = $('#live-frame');
      f.addEventListener('load', () => { try { const y = Number(f.dataset.y || 0); if (y) f.contentWindow.scrollTo(0, y); } catch { /* */ } });
    } else if (f.dataset.slug !== e.slug) { f.dataset.y = '0'; f.src = src; }
    f.dataset.slug = e.slug;
    fitLive();
  }
  function refreshLive() {
    clearTimeout(A.liveTimer);
    if (!A.live) return;
    A.liveTimer = setTimeout(() => {
      const f = $('#live-frame'); if (!f) return;
      try { f.dataset.y = String(f.contentWindow.scrollY || 0); f.contentWindow.location.reload(); } catch { f.src = f.src; }
    }, 900);
  }
  function fitLive() {
    const stage = $('.live-stage'), f = $('#live-frame'); if (!stage || !f) return;
    const W = A.liveSize === 'phone' ? 390 : 1280, H = A.liveSize === 'phone' ? 820 : 1500;
    const scale = Math.min(1, stage.clientWidth / W);
    Object.assign(f.style, { width: `${W}px`, height: `${H}px`, transform: `scale(${scale})`, marginLeft: `${Math.max(0, (stage.clientWidth - W * scale) / 2)}px` });
    stage.style.height = `${Math.round(H * scale)}px`;
  }
  window.addEventListener('resize', () => { if (A.live) fitLive(); });

  /* ---------- ערכת שיתוף: טקסטים, תמונת סטורי וקליפ וידאו קצר ---------- */

  /** התמונה של התוכנית כתמונה שאפשר לצייר על קנבס (ואם אי אפשר — העטיפה האוטומטית) */
  async function coverBitmap(e) {
    if (e.cover) { try { const r = await fetch(e.cover, { mode: 'cors' }); if (r.ok) return await createImageBitmap(await r.blob()); } catch { /* */ } }
    return createImageBitmap(await drawCover(e));
  }
  const roundRect = (x, px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
  /** תמונת סטורי (9:16): העטיפה במרכז, השם והתאריך, וכפתור "האזינו". בקליפ — בלי הכפתור (שם יש גל קול). */
  async function drawStory(e, { w = 1080, clip = false } = {}) {
    try { await document.fonts.load('700 120px Karantina'); await document.fonts.load('800 30px Heebo'); } catch { /* */ }
    const k = w / 1080, W = w, H = Math.round(1920 * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const img = await coverBitmap(e);
    const h1 = U.hue(e);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `hsl(${h1} 55% 12%)`); g.addColorStop(1, `hsl(${(h1 + 60) % 360} 50% 6%)`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // העטיפה עצמה, מטושטשת, כרקע
    x.save(); x.filter = `blur(${Math.round(70 * k)}px) brightness(.5) saturate(1.3)`;
    const cov = Math.max(W / img.width, H / img.height);
    x.drawImage(img, (W - img.width * cov) / 2, (H - img.height * cov) / 2, img.width * cov, img.height * cov);
    x.restore();
    const shade = x.createLinearGradient(0, 0, 0, H); shade.addColorStop(0, 'rgba(0,0,0,.35)'); shade.addColorStop(.55, 'rgba(0,0,0,.1)'); shade.addColorStop(1, 'rgba(0,0,0,.75)');
    x.fillStyle = shade; x.fillRect(0, 0, W, H);
    x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#f0c65a'; x.font = `800 ${Math.round(44 * k)}px Heebo, Arial`;
    x.fillText(`${site.name || 'ראש בראש'}${e.number != null ? `  ·  תוכנית ${e.number}` : ''}`, W / 2, 220 * k);
    // העטיפה בריבוע עם צל ופינות מעוגלות
    const S2 = 820 * k, sx = (W - S2) / 2, sy = 300 * k;
    x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 60 * k; x.shadowOffsetY = 24 * k; roundRect(x, sx, sy, S2, S2, 44 * k); x.fillStyle = '#000'; x.fill(); x.restore();
    x.save(); roundRect(x, sx, sy, S2, S2, 44 * k); x.clip();
    const sc = Math.max(S2 / img.width, S2 / img.height);
    x.drawImage(img, sx + (S2 - img.width * sc) / 2, sy + (S2 - img.height * sc) / 2, img.width * sc, img.height * sc);
    x.restore();
    // השם
    x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 20 * k;
    let size = 150 * k; x.font = `700 ${size}px Karantina, Impact, Arial`;
    while (size > 80 * k && wrap(x, label(e), 940 * k).length > 2) { size -= 10 * k; x.font = `700 ${size}px Karantina, Impact, Arial`; }
    const lines = wrap(x, label(e), 940 * k).slice(0, 3);
    const top = 1250 * k;
    lines.forEach((ln, i) => x.fillText(ln, W / 2, top + size * .8 + i * size * .95));
    x.shadowBlur = 0;
    const after = top + size * .8 + (lines.length - 1) * size * .95 + 70 * k;
    x.fillStyle = 'rgba(255,255,255,.82)'; x.font = `700 ${Math.round(40 * k)}px Heebo, Arial`;
    x.fillText([e.date ? fmtDate(e.date) : '', e.guests.length ? `עם ${e.guests.slice(0, 2).join(' ו')}` : ''].filter(Boolean).join('  ·  '), W / 2, after);
    if (!clip) {
      const bw = 520 * k, bh = 110 * k, bx = (W - bw) / 2, by = 1660 * k;
      roundRect(x, bx, by, bw, bh, bh / 2); x.fillStyle = '#f0c65a'; x.fill();
      x.fillStyle = '#15110a'; x.font = `900 ${Math.round(46 * k)}px Heebo, Arial`; x.fillText('▶ האזינו עכשיו', W / 2, by + bh * .66);
    }
    x.fillStyle = 'rgba(255,255,255,.6)'; x.font = `700 ${Math.round(30 * k)}px Heebo, Arial`;
    try { x.fillText(new URL(site.url || location.href).host, W / 2, H - 60 * k); } catch { /* */ }
    return c;
  }
  const toBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
  const once = (el, ev, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ההקלטה לא נטענה בזמן.')), ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); rej(new Error('ההקלטה לא נטענה ליצירת קליפ.')); }, { once: true });
  });
  const CLIP_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const clipType = () => (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? CLIP_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '' : '');
  /** קליפ וידאו (9:16) של רגע מהתוכנית: הסטורי + גל קול שזז עם הצליל. מוקלט בזמן אמת. */
  async function makeClip(e, start, secs, onTick) {
    const mime = clipType();
    if (!mime) throw new Error('הדפדפן הזה לא יודע ליצור וידאו. נסו בכרום או באדג׳ במחשב.');
    const url = U.streamUrl(e); if (!url) throw new Error('לתוכנית הזו אין הקלטה.');
    const base = await drawStory(e, { w: 720, clip: true });
    const W = base.width, H = base.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.preload = 'auto'; audio.src = url;
    await once(audio, 'loadedmetadata', 30000);
    const from = Math.max(0, Math.min(start, (audio.duration || start + secs) - secs));
    audio.currentTime = from;
    await once(audio, 'seeked', 30000);
    const ac = new AudioContext();
    const an = ac.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = .7;
    const dest = ac.createMediaStreamDestination();
    ac.createMediaElementSource(audio).connect(an); an.connect(dest);
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 });
    const chunks = []; rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    const bins = new Uint8Array(an.frequencyBinCount);
    let heard = 0, timer = 0;
    const frame = () => {
      x.drawImage(base, 0, 0);
      an.getByteFrequencyData(bins);
      const n = 40, span = W * .78, bw = span / n, left = (W - span) / 2, mid = H * .835, max = H * .05;
      x.fillStyle = '#f0c65a';
      for (let i = 0; i < n; i++) {
        const v = bins[Math.floor(i * bins.length * .7 / n)] / 255; if (v > .04) heard++;
        const hh = 3 + v * max; roundRect(x, left + i * bw + bw * .2, mid - hh, bw * .6, hh * 2, Math.min(bw * .3, hh));
        x.fill();
      }
      const t = Math.min(1, (audio.currentTime - from) / secs);
      x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(left, H * .9, span, 6);
      x.fillStyle = '#f0c65a'; x.fillRect(left + span * (1 - t), H * .9, span * t, 6);   // מימין לשמאל
      x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '800 22px Heebo, Arial'; x.textAlign = 'center';
      x.fillText(`${U.fmtTime(audio.currentTime)} מתוך התוכנית`, W / 2, H * .9 + 40);
      return t;
    };
    const finish = () => { clearInterval(timer); audio.pause(); if (rec.state !== 'inactive') rec.stop(); };
    frame();
    rec.start(250);
    try { await audio.play(); } catch (err) { finish(); await stopped; ac.close(); throw new Error('לא הצלחנו להשמיע את ההקלטה ליצירת הקליפ.'); }
    // setInterval ולא requestAnimationFrame: ממשיך גם כשהלשונית ברקע
    timer = setInterval(() => { const t = frame(); onTick?.(t); if (t >= 1 || audio.ended) finish(); }, 1000 / 30);
    await stopped;
    ac.close(); audio.removeAttribute('src'); audio.load();
    if (!heard) throw new Error('הצליל של ההקלטה לא נקלט (השרת לא אפשר לקרוא אותו). נסו שוב מאוחר יותר.');
    return new Blob(chunks, { type: mime.split(';')[0] });
  }
  function socialText(e, kind) {
    const url = U.shareUrl(e);
    const first = (e.description || '').split(/(?<=[.!?])\s+|\n+/)[0].trim().slice(0, 220);
    const tags = uniq(['ראש_בראש', ...e.tags.slice(0, 4).map((t) => t.replace(/[^\p{L}\p{N}]+/gu, '_'))]).map((t) => `#${t}`).join(' ');
    if (kind === 'short') return `${label(e)} — ${site.name || 'ראש בראש'}${e.number != null ? `, תוכנית ${e.number}` : ''}. להאזנה: ${url}`;
    return [`🎙️ ${label(e)}`, first, e.guests.length ? `עם ${e.guests.join(', ')}` : '', `להאזנה מלאה ←  ${url}`, '', tags].filter((l, i, a) => l || (i && a[i - 1])).join('\n');
  }
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const canShareFile = (f) => { try { return !!navigator.canShare?.({ files: [f] }); } catch { return false; } };
  async function openShare(e) {
    let d = $('#dlg-share');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-share'; d.className = 'sheet wide'; d.setAttribute('aria-labelledby', 'dlg-share-title');
      document.body.appendChild(d);
      d.addEventListener('click', (ev) => { if (ev.target === d || ev.target.closest('[data-close]')) d.close(); });
      d.addEventListener('click', shareClick);
      d.addEventListener('change', (ev) => { if (ev.target.matches('[data-sh="clip-from"]')) d.querySelector('[data-custom]').hidden = ev.target.value !== 'custom'; });
    }
    A.share = { id: e.id, story: null, clip: null };
    const hot = A.epStats.get(e.id)?.moments?.top?.[0]?.at;
    const texts = [['whatsapp', 'לוואטסאפ', shareText(e)], ['social', 'לפייסבוק ולאינסטגרם', socialText(e, 'social')], ['short', 'קצר, לסטטוס', socialText(e, 'short')]];
    const canClip = !!clipType() && !!U.streamUrl(e);
    d.innerHTML = `<div class="section-title"><div><p class="kicker">ערכת שיתוף</p><h2 id="dlg-share-title">${esc(label(e))}</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body share-kit">
  <div class="share-visual">
    <div class="story-frame"><img id="story-img" alt="תמונת סטורי של התוכנית"><span class="notice-spinner" aria-hidden="true"></span></div>
    <div class="actions" style="margin:0"><button type="button" class="btn small gold" data-sh="story-dl" disabled>הורדת התמונה</button><button type="button" class="btn small" data-sh="story-share" hidden>שיתוף…</button></div>
    <p class="cue-hint">גודל של סטורי (1080×1920) — לאינסטגרם, לסטטוס בוואטסאפ ולפייסבוק.</p>
  </div>
  <div class="share-side">
    ${texts.map(([k, t, text]) => `<div class="share-text"><div class="share-text-head"><b>${t}</b><button type="button" class="btn small" data-sh="copy" data-text="${esc(text)}">העתקה</button></div><div class="whatsapp-text">${esc(text)}</div></div>`).join('')}
    <div class="share-clip">
      <p class="kicker">קליפ וידאו קצר</p>
      ${canClip ? `<p class="help">הסטורי עם גל קול שזז לפי ההקלטה. הקליפ מוקלט בזמן אמת — השאירו את החלון פתוח עד הסוף.</p>
      <div class="clip-opts">
        <label class="field"><span>מאיזה רגע</span><select data-sh="clip-from">${hot != null ? `<option value="${Math.max(0, hot - 5)}">הרגע הכי אהוב (${U.fmtTime(hot)})</option>` : ''}<option value="0">מההתחלה</option><option value="custom">זמן אחר…</option></select></label>
        <label class="field" data-custom hidden><span>זמן (דקות:שניות)</span><input data-sh="clip-at" value="0:00" class="ltr" inputmode="numeric"></label>
        <label class="field"><span>אורך</span><select data-sh="clip-len"><option value="15">15 שניות</option><option value="30" selected>30 שניות</option><option value="60">דקה</option></select></label>
      </div>
      <div class="actions" style="margin:0"><button type="button" class="btn gold" data-sh="clip-make">יצירת קליפ</button><span class="upload-status" data-sh="clip-status" role="status"></span></div>
      <div data-sh="clip-out"></div>` : `<p class="help">${U.streamUrl(e) ? 'הדפדפן הזה לא יודע ליצור וידאו. נסו בכרום או באדג׳ במחשב.' : 'לתוכנית הזו עוד אין הקלטה.'}</p>`}
    </div>
  </div>
</div>`;
    if (!d.open) d.showModal();
    // הרגע הכי אהוב (אם עוד לא נטען) — נוסף לבחירה כשהוא מגיע
    if (hot == null && CLOUD) fetchEpStats(e.id).then((st) => {
      const at = st?.moments?.top?.[0]?.at, sel = $('[data-sh="clip-from"]', d);
      if (at == null || !sel || A.share?.id !== e.id || sel.querySelector('[data-hot]')) return;
      sel.insertAdjacentHTML('afterbegin', `<option value="${Math.max(0, at - 5)}" data-hot>הרגע הכי אהוב (${U.fmtTime(at)})</option>`);
      sel.value = String(Math.max(0, at - 5));
    }).catch(() => {});
    try {
      const blob = await toBlob(await drawStory(e), 'image/jpeg', .9);
      if (A.share?.id !== e.id) return;
      A.share.story = new File([blob], `story-${e.slug || e.id}.jpg`, { type: 'image/jpeg' });
      const img = $('#story-img', d); img.src = URL.createObjectURL(blob); img.closest('.story-frame').classList.add('ready');
      $('[data-sh="story-dl"]', d).disabled = false;
      $('[data-sh="story-share"]', d).hidden = !canShareFile(A.share.story);
    } catch (err) { $('.story-frame', d).innerHTML = `<p class="problems">התמונה לא נוצרה: ${esc(err.message)}</p>`; }
  }
  async function shareClick(ev) {
    const b = ev.target.closest('[data-sh]'); const d = $('#dlg-share'); const sh = A.share; if (!b || !sh || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const e = liveEp(sh.id); if (!e) return;
    const k = b.dataset.sh;
    if (k === 'copy') { (await U.copy(b.dataset.text)) ? U.notify('הועתק.', 'success') : U.notify('ההעתקה לא הצליחה.', 'error'); return; }
    if (k === 'story-dl' && sh.story) download(sh.story, sh.story.name);
    if (k === 'story-share' && sh.story) { try { await navigator.share({ files: [sh.story], text: socialText(e, 'short') }); } catch { /* בוטל */ } }
    if (k === 'clip-dl' && sh.clip) download(sh.clip, sh.clip.name);
    if (k === 'clip-share' && sh.clip) { try { await navigator.share({ files: [sh.clip], text: socialText(e, 'short') }); } catch { /* */ } }
    if (k === 'clip-make') {
      const sel = $('[data-sh="clip-from"]', d).value;
      const start = sel === 'custom' ? (U.parseTime($('[data-sh="clip-at"]', d).value) || 0) : Number(sel) || 0;
      const secs = Number($('[data-sh="clip-len"]', d).value) || 30;
      const status = $('[data-sh="clip-status"]', d), out = $('[data-sh="clip-out"]', d);
      b.disabled = true; out.innerHTML = ''; status.textContent = 'מכינים…';
      try {
        const blob = await makeClip(e, start, secs, (t) => { status.textContent = `מקליטים… ${Math.round(t * 100)}%`; });
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        sh.clip = new File([blob], `clip-${e.slug || e.id}.${ext}`, { type: blob.type });
        status.textContent = '✓ הקליפ מוכן';
        out.innerHTML = `<video class="clip-video" controls playsinline src="${URL.createObjectURL(blob)}"></video><div class="actions" style="margin:0"><button type="button" class="btn small gold" data-sh="clip-dl">הורדת הקליפ</button>${canShareFile(sh.clip) ? '<button type="button" class="btn small" data-sh="clip-share">שיתוף…</button>' : ''}</div>${ext === 'webm' ? '<p class="cue-hint">הקובץ בפורמט WebM. וואטסאפ ואינסטגרם בטלפון מעדיפים MP4 — אם לא עולה, העבירו אותו דרך ממיר.</p>' : ''}`;
      } catch (err) { status.textContent = err.message; }
      b.disabled = false;
    }
  }

  /* ---------- תמונה אוטומטית: עטיפה בסגנון האתר על קנבס ---------- */

  /* העטיפה ריבועית (1400×1400) — כך היא מופיעה במלואה בדף התוכנית, במסך הנעילה
     ובתצוגה המקדימה בוואטסאפ. בכרטיסים (יחס 1.45) נחתכים רק הקצוות העליון
     והתחתון, ולכן כל הטקסט יושב ברצועה האמצעית שנשארת גלויה תמיד. */
  const COVER = 1400, SAFE_TOP = 250, SAFE_BOTTOM = 1150;
  async function drawCover(e) {
    try { await document.fonts.load('700 120px Karantina'); await document.fonts.load('800 30px Heebo'); } catch { /* גופן ברירת מחדל */ }
    const W = COVER, H = COVER, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const words = (e.description || '').split(/\s+/).filter((w) => w.length > 3);
    const seed = (e.id + e.title + words.slice(0, 6).join('')).split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7 + (A.coverTry || 0));
    const h1 = U.hue(e), h2 = (h1 + 40 + (seed % 80)) % 360, h3 = (h1 + 200 + (seed % 60)) % 360;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${h1} 60% 14%)`); g.addColorStop(.55, `hsl(${h2} 55% 22%)`); g.addColorStop(1, `hsl(${h3} 60% 12%)`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) { const px = W * ((seed >> (i * 3)) % 100) / 100, py = H * ((seed >> (i * 5)) % 100) / 100; const r = x.createRadialGradient(px, py, 0, px, py, 620); r.addColorStop(0, `hsl(${[h1, h2, h3][i]} 90% 65% / .35)`); r.addColorStop(1, 'transparent'); x.fillStyle = r; x.fillRect(0, 0, W, H); }
    // תקליט בצד שמאל, במרכז הרצועה
    const cx = 330 + (seed % 50), cy = (SAFE_TOP + SAFE_BOTTOM) / 2 + 30;
    for (let r = 290; r > 40; r -= 6) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.strokeStyle = r % 12 ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.08)'; x.lineWidth = 3; x.stroke(); }
    x.beginPath(); x.arc(cx, cy, 78, 0, Math.PI * 2); x.fillStyle = `hsl(${h1} 85% 62%)`; x.fill();
    x.beginPath(); x.arc(cx, cy, 8, 0, Math.PI * 2); x.fillStyle = '#0b0d14'; x.fill();
    // אקולייזר בתחתית
    for (let i = 0; i < 52; i++) { const bh = 30 + ((seed * (i + 3)) % 160); x.fillStyle = `hsl(${(h1 + i * 4) % 360} 90% 65% / .5)`; x.fillRect(W - 70 - i * 25, H - 40 - bh, 13, bh); }
    x.fillStyle = 'rgba(255,255,255,.035)'; for (let i = 0; i < 3500; i++) x.fillRect((seed * (i + 1) * 7919) % W, (seed * (i + 7) * 104729) % H, 2, 2);
    // טקסט (מימין לשמאל), כולו בתוך הרצועה הבטוחה
    const right = W - 80, textW = W - 80 - 700;
    x.direction = 'rtl'; x.textAlign = 'right'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#f0c65a'; x.font = '800 36px Heebo, Arial'; x.fillText(`${site.name || 'ראש בראש'}${e.number != null ? `  ·  תוכנית ${e.number}` : ''}`, right, SAFE_TOP + 60);
    x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 24;
    const title = label(e);
    let size = 150; x.font = `700 ${size}px Karantina, Impact, Arial`;
    while (size > 80 && wrap(x, title, textW).length > 3) { size -= 10; x.font = `700 ${size}px Karantina, Impact, Arial`; }
    const lines = wrap(x, title, textW).slice(0, 3);
    lines.forEach((ln, i) => x.fillText(ln, right, SAFE_TOP + 110 + size * .85 + i * (size * .92)));
    x.shadowBlur = 0;
    const sub = (e.description || '').split(/[.\n!?]/)[0].trim().slice(0, 90);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.font = '700 34px Heebo, Arial';
    wrap(x, sub, textW).slice(0, 2).forEach((ln, i) => x.fillText(ln, right, SAFE_BOTTOM - 120 + i * 46));
    x.fillStyle = '#f0c65a'; x.font = '800 30px Heebo, Arial'; x.fillText(e.date ? fmtDate(e.date) : (site.tagline || ''), right, SAFE_BOTTOM - 20);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', .88));
  }
  /* ---------- תמונה קטנה לכרטיסים ----------
     לכל תמונה נשמרת גם גרסה של 640 פיקסלים, שהארכיון ודף הבית טוענים במקום
     התמונה המלאה — פי 5–10 פחות לטעון בטלפון. */
  async function makeThumb(source, max = 640) {
    const blob = source instanceof Blob ? source : await (await fetch(source, { mode: 'cors', cache: 'no-store' })).blob();
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', .82));
  }
  /** סוג התמונה נשמר כמו שהוא (PNG נשאר PNG); תמונה שנוצרה כאן היא JPEG */
  const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  function imageFile(blob, base) {
    const fromName = String(blob.name || '').split('.').pop().toLowerCase();
    const ext = Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k] === blob.type) || (IMAGE_TYPES[fromName] ? fromName : 'jpg');
    return new File([blob], `${base}.${ext}`, { type: IMAGE_TYPES[ext] });
  }
  /** מעלה תמונה (ואת הגרסה הקטנה שלה) ושומר את שתיהן בתוכנית — בטיוטה שבזיכרון עכשיו,
      גם אם היא הוחלפה בזמן ההעלאה */
  async function setCover(e, blob, progress = () => {}) {
    const name = `cover-${e.slug || e.id}`;
    const cover = await window.RoshUpload(imageFile(blob, name), e.id, 'cover', progress);
    let thumb = '';   // בלי גרסה קטנה — הכרטיס יציג את התמונה המלאה
    try { thumb = await window.RoshUpload(new File([await makeThumb(blob)], `${name}-small.jpg`, { type: 'image/jpeg' }), e.id, 'cover', () => {}); } catch { /* */ }
    const live = liveEp(e.id);
    if (!live) throw new Error('התוכנית נמחקה בזמן ההעלאה.');
    live.cover = cover; live.thumb = thumb;
  }
  /** שורת המצב של העלאה בטופס — רק כשהתוכנית הזו פתוחה, ונמצאת מחדש בכל כתיבה (הטופס מצטייר מחדש) */
  function uploadStatus(e, kind, text) {
    if (A.selected !== e.id) return;
    const el = P.querySelector(`[data-upload-status="${kind}"]`);
    if (el) el.textContent = text;
  }
  async function autoCover(e) {
    uploadStatus(e, 'auto', 'מציירים…');
    const blob = await drawCover(e);
    const file = new File([blob], `cover-${e.slug || e.id}.jpg`, { type: 'image/jpeg' });
    if (CLOUD) {
      uploadStatus(e, 'auto', 'מעלים…');
      await setCover(e, file, (pct) => uploadStatus(e, 'auto', `מעלים — ${pct}%`));
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      U.notify('התמונה ירדה למחשב. העלו אותה לאתר והדביקו את הקישור.', 'info');
    }
    A.coverTry = (A.coverTry || 0) + 1;
    touch(); renderEditor(); renderList();
  }
  function wrap(x, text, max) {
    const out = []; let line = '';
    for (const w of String(text).split(/\s+/).filter(Boolean)) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out;
  }

  /* ---------- עבודות על הרבה תוכניות בבת אחת: אורך, תמונות, תיאורים ----------
     רצות ברקע (אפשר להמשיך לעבוד), מתקדמות אחת־אחת, ואפשר לעצור באמצע.
     כל תוצאה נכנסת לטיוטה — ולאתר רק בלחיצה על "פרסום". */
  A.jobs = {};
  async function runJob(name, items, work, { concurrency = 1, label: what = 'תוכניות', one = 'תוכנית אחת עודכנה' } = {}) {
    if (A.jobs[name]?.running) return;
    const job = A.jobs[name] = { running: true, stop: false, done: 0, failed: 0, total: items.length, text: `0/${items.length}` };
    // בזמן העבודה מתעדכנת רק שורת ההתקדמות; החלק כולו מצטייר מחדש בהתחלה ובסוף
    const paint = (full) => {
      job.text = `${job.done}/${job.total}${job.failed ? ` · ${job.failed} נכשלו` : ''}`;
      if (A.tab !== 'publish') return;
      if (full) { renderPublish(); return; }
      const el = P.querySelector(`.job-progress[data-job="${name}"] .job-text`);
      if (el) el.textContent = job.text;
    };
    paint(true);
    let i = 0;
    const worker = async () => {
      while (i < items.length && !job.stop) {
        const it = items[i++];
        // הטיוטה עלולה להתחלף בזמן העבודה (טעינה מהשרת, שחזור) — עובדים על התוכנית שבה עכשיו
        const live = liveEp(it.id);
        if (!live) { job.failed++; job.done++; paint(); continue; }
        try { await work(live); } catch { job.failed++; }
        job.done++; paint(); touch();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, worker));
    job.running = false; paint(true);
    renderList(); if (A.tab === 'programs') renderEditor();
    const ok = job.done - job.failed;
    const updated = ok === 1 ? one : `${ok} ${what} עודכנו`;
    U.notify(job.stop ? `נעצר: ${updated}.` : `הסתיים: ${updated}${job.failed ? `, ${job.failed} נכשלו` : ''}. לחצו "פרסום" כדי שזה יופיע באתר.`, job.failed ? 'info' : 'success');
  }
  /** האורך של הקלטה, מתוך הקובץ עצמו (נקרא רק ראש הקובץ) */
  function measureDuration(url) {
    return new Promise((resolve, reject) => {
      const a = new Audio(); a.preload = 'metadata';
      const t = setTimeout(() => { a.src = ''; reject(new Error('timeout')); }, 30000);
      a.onloadedmetadata = () => { clearTimeout(t); const d = a.duration; a.src = ''; isFinite(d) && d > 0 ? resolve(Math.round(d)) : reject(new Error('no duration')); };
      a.onerror = () => { clearTimeout(t); reject(new Error('load error')); };
      a.src = url;
    });
  }
  /** התוכנית כפי שהיא בטיוטה עכשיו, אחרי המתנה; נכשל אם נמחקה או שהשדה השתנה בינתיים */
  const liveAfter = (e, field, was) => {
    const live = liveEp(e.id);
    if (!live || (field && live[field] !== was)) throw new Error('התוכנית השתנתה בינתיים.');
    return live;
  };
  const fillDurations = () => runJob('fill-durations', A.data.episodes.filter((e) => U.streamUrl(e) && !e.duration), async (e) => {
    const url = U.streamUrl(e), d = await measureDuration(url);
    const live = liveAfter(e); if (U.streamUrl(live) !== url) throw new Error('ההקלטה הוחלפה בינתיים.');
    live.duration = d;
  }, { concurrency: 3, label: 'אורכים', one: 'אורך אחד עודכן' });
  const coversAll = () => runJob('covers-all', A.data.episodes.filter((e) => !e.cover), async (e) => {
    await setCover(e, await drawCover(e));
  }, { concurrency: 2, label: 'תמונות', one: 'תמונה אחת עודכנה' });
  const thumbsAll = () => runJob('thumbs-all', A.data.episodes.filter((e) => e.cover && !e.thumb), async (e) => {
    const cover = e.cover;
    const thumb = await window.RoshUpload(new File([await makeThumb(cover)], `cover-${e.slug || e.id}-small.jpg`, { type: 'image/jpeg' }), e.id, 'cover', () => {});
    liveAfter(e, 'cover', cover).thumb = thumb;
  }, { concurrency: 2, label: 'תמונות קטנות', one: 'תמונה קטנה אחת עודכנה' });

  /* ---------- בדיקת איות ב־AI ----------
     עובר על השמות והתיאורים (של מה שהשתנה, או של הכול) ומציע תיקוני כתיב
     בלבד — בלי לשכתב. כל הצעה מאושרת בנפרד, או "תיקון הכול". */
  A.proof = null;
  async function runProofread(scope) {
    if (A.proof?.running) return;
    const origin = new Map((A.origin?.episodes || []).map((e) => [e.id, e]));
    const eps = A.data.episodes.filter((e) => scope === 'all' || !origin.has(e.id) || ['title', 'description'].some((f) => origin.get(e.id)[f] !== e[f]));
    const items = [];
    for (const e of eps) for (const f of ['title', 'description']) if (String(e[f] || '').trim().length > 1) items.push({ key: `${e.id}|${f}`, text: e[f] });
    const b = A.data.settings.banner; if (b?.text) items.push({ key: 'banner|text', text: b.text });
    (A.data.settings.updates || []).forEach((u, i) => { if (u.title) items.push({ key: `update:${i}|title`, text: u.title }); if (u.text) items.push({ key: `update:${i}|text`, text: u.text }); });
    if (!items.length) { U.notify(scope === 'all' ? 'אין טקסטים לבדוק.' : 'לא השתנה שום שם או תיאור מאז הפרסום.', 'info'); return; }
    const batches = []; let cur = [], size = 0;
    for (const it of items) { if (cur.length && (cur.length >= 40 || size + it.text.length > 38000)) { batches.push(cur); cur = []; size = 0; } cur.push(it); size += it.text.length; }
    if (cur.length) batches.push(cur);
    const byKey = new Map(items.map((it) => [it.key, it.text]));
    const P2 = A.proof = { running: true, done: 0, total: batches.length, results: [], error: '' };
    renderPublish();
    for (const batch of batches) {
      try {
        const r = await S.sb.call('/api/program/ai/proofread', { method: 'POST', body: { items: batch } });
        for (const x of r.results || []) if (x.fixed && x.fixed !== byKey.get(x.key)) P2.results.push({ ...x, original: byKey.get(x.key) });
      } catch (err) { P2.error = err.message; }
      P2.done++; if (A.tab === 'publish') renderPublish();
    }
    P2.running = false; if (A.tab === 'publish') renderPublish();
    U.notify(P2.results.length ? `נמצאו הצעות תיקון ב־${P2.results.length} טקסטים.` : 'לא נמצאו שגיאות כתיב.', P2.results.length ? 'info' : 'success');
  }
  /** איפה הטקסט יושב בטיוטה: [אובייקט, שדה] */
  function proofTarget(key) {
    const [where, field] = key.split('|');
    if (where === 'banner') return [A.data.settings.banner, field];
    if (where.startsWith('update:')) return [A.data.settings.updates?.[Number(where.slice(7))], field];
    return [A.data.episodes.find((e) => e.id === where), field];
  }
  function proofLabel(key) {
    const [where, field] = key.split('|');
    if (where === 'banner') return 'ההודעה בראש האתר';
    if (where.startsWith('update:')) return `עדכון · ${field === 'title' ? 'כותרת' : 'תוכן'}`;
    const e = A.data.episodes.find((x) => x.id === where);
    return `${e ? label(e) : 'תוכנית'} · ${field === 'title' ? 'השם' : 'התיאור'}`;
  }
  function applyProof(r) {
    const [obj, field] = proofTarget(r.key);
    if (!obj || obj[field] !== r.original) { r.stale = true; return false; }   // נערך בינתיים — לא דורסים
    obj[field] = r.fixed; r.applied = true; return true;
  }
  function proofCard() {
    if (!CLOUD) return '';
    const P2 = A.proof;
    const open = P2 ? P2.results.filter((r) => !r.applied && !r.ignored) : [];
    return `
<div class="card" id="proof-card">
  <div class="section-title"><div><p class="kicker">AI</p><h2>בדיקת איות</h2></div>${open.length ? `<strong>${open.length}</strong>` : ''}</div>
  <div class="card-body">
    <p class="help">ה־AI עובר על השמות, התיאורים, ההודעה והעדכונים, ומסמן שגיאות כתיב ורווחים חסרים — בלי לשנות ניסוח או שמות. כל תיקון נכנס לטיוטה רק אחרי שאישרתם.</p>
    <div class="actions" style="margin:0">
      <button type="button" class="btn gold" data-op="proof-changed" ${P2?.running ? 'disabled' : ''}>בדיקת מה שהשתנה</button>
      <button type="button" class="btn small" data-op="proof-all" ${P2?.running ? 'disabled' : ''}>בדיקת כל האתר</button>
      ${open.length > 1 ? '<button type="button" class="btn small primary" data-op="proof-apply-all">תיקון הכול</button>' : ''}
    </div>
    ${P2?.running ? `<p class="upload-status"><span class="notice-spinner" aria-hidden="true"></span> בודקים… ${P2.done}/${P2.total}</p>` : ''}
    ${P2?.error ? `<p class="problems">${esc(P2.error)}</p>` : ''}
    ${P2 && !P2.running && !P2.error && !P2.results.length ? '<p class="help">✓ לא נמצאו שגיאות כתיב.</p>' : ''}
    ${open.length ? `<ul class="proof-list">${P2.results.map((r, i) => (r.applied || r.ignored) ? '' : `<li>
      <button type="button" class="link-btn" data-op="proof-open" data-i="${i}">${esc(proofLabel(r.key))}</button>
      <div class="proof-changes">${(r.changes || []).slice(0, 12).map((c) => `<span><del>${esc(c.from || '·')}</del> ← <ins>${esc(c.to || '·')}</ins></span>`).join('')}</div>
      ${r.stale ? '<small class="problems">הטקסט נערך אחרי הבדיקה — בדקו שוב.</small>' : ''}
      <div class="proof-ops"><button type="button" class="btn small primary" data-op="proof-apply" data-i="${i}">תיקון</button><button type="button" class="btn small" data-op="proof-ignore" data-i="${i}">התעלמות</button></div>
    </li>`).join('')}</ul>` : ''}
  </div>
</div>`;
  }

  /* ---------- השלמת תאריכים: כל התוכניות בלי תאריך במסך אחד ----------
     ליד כל תוכנית — התאריכים של התוכניות הסמוכות לה במספור, כרמז. בחירת
     תאריך נשמרת מיד ועוברת לשדה הבא. */
  function datesScreen() {
    let d = $('#dlg-dates');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-dates'; d.className = 'sheet wide'; d.setAttribute('aria-labelledby', 'dlg-dates-title');
      document.body.appendChild(d);
      d.addEventListener('click', (ev) => { if (ev.target === d || ev.target.closest('[data-close]')) d.close(); });
      d.addEventListener('close', render);   // גם בסגירה עם Escape
      d.addEventListener('change', (ev) => {
        const inp = ev.target.closest('input[data-date-for]'); if (!inp) return;
        const e = A.data.episodes.find((x) => x.id === inp.dataset.dateFor); if (!e) return;
        e.date = inp.value; touch();
        inp.closest('li')?.classList.toggle('done', !!inp.value);
        const all = [...d.querySelectorAll('input[data-date-for]')];
        const next = all.slice(all.indexOf(inp) + 1).find((x) => !x.value);
        if (inp.value && next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
        d.querySelector('[data-left]').textContent = all.filter((x) => !x.value).length;
      });
    }
    const dated = A.data.episodes.filter((e) => e.date && e.number != null && !Number.isNaN(e.number)).sort((a, b) => a.number - b.number);
    const around = (e) => {
      if (e.number == null) return '';
      const before = [...dated].reverse().find((x) => x.number < e.number && x.season === e.season) || [...dated].reverse().find((x) => x.number < e.number);
      const after = dated.find((x) => x.number > e.number && x.season === e.season) || dated.find((x) => x.number > e.number);
      return [before && `תוכנית ${before.number}: ${fmtDate(before.date, true)}`, after && `תוכנית ${after.number}: ${fmtDate(after.date, true)}`].filter(Boolean).join(' · ');
    };
    const list = A.data.episodes.filter((e) => !e.date).sort((a, b) => (a.season || '').localeCompare(b.season || '') || (a.number ?? 1e9) - (b.number ?? 1e9));
    const seasonName = (id) => A.data.seasons.find((x) => x.id === id)?.title || 'בלי עונה';
    d.innerHTML = `<div class="section-title"><div><p class="kicker">השלמת תאריכים</p><h2 id="dlg-dates-title"><span data-left>${list.length}</span> תוכניות בלי תאריך</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body dates-screen">
  <p class="help">בוחרים תאריך שידור, והשדה הבא נפתח לבד. הכול נשמר בטיוטה — וכשמסיימים, "פרסום". ליד כל תוכנית: התאריכים של התוכניות הסמוכות, כרמז.</p>
  ${list.length ? `<ol class="dates-list">${list.map((e, i) => `${i === 0 || list[i - 1].season !== e.season ? `<li class="dates-season">${esc(seasonName(e.season))}</li>` : ''}<li><span class="num">${e.number ?? '♫'}</span><span class="txt"><b>${esc(label(e))}</b><small>${esc(around(e))}</small></span><input type="date" data-date-for="${esc(e.id)}" aria-label="תאריך השידור של ${esc(label(e))}"></li>`).join('')}</ol>` : '<p class="help">✓ לכל התוכניות יש תאריך.</p>'}
</div>
<div class="card-foot"><button type="button" class="btn primary" data-close>סיום</button></div>`;
    d.showModal();
    d.querySelector('input[data-date-for]')?.focus();
  }

  /* ---------- AI: תמלול (רק למנהלים) ותיאור + סיכום שנוצרים ממנו ---------- */
  /** מתמלל חלק אחרי חלק; ממשיך מהחלק שבו תמלול קודם נעצר */
  async function transcribe(e, onStep, have = null) {
    let part = 0, total = 1;
    if (have?.partsTotal && (have.partsDone || 0) < have.partsTotal) { part = have.partsDone || 0; total = Number(have.partsTotal) || 1; }
    while (part < total) {
      const r = await S.sb.call('/api/program/ai/transcribe', { method: 'POST', body: { episodeId: e.id, part } });
      total = Number(r.partsTotal) || 1; part++;
      onStep?.(part, total);
    }
  }
  async function summarize(e) {
    const r = await S.sb.call('/api/program/ai/summarize', { method: 'POST', body: { episodeId: e.id } });
    return r && typeof r.summary === 'object' && r.summary ? r.summary : r;
  }
  const uniq = (list) => [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  function applySummary(e, sum) {
    e.description = [sum.description, sum.summary].map((x) => String(x || '').trim()).filter(Boolean).join('\n\n');
    e.tags = uniq([...e.tags, ...(sum.tags || [])]).slice(0, 12);
    e.guests = uniq([...e.guests, ...(sum.guests || [])]).slice(0, 12);
  }
  async function aiRun(e, { apply = false } = {}) {
    const st = A.ai.get(e.id) || {}; A.ai.set(e.id, st);
    if (st.running) return;
    const paint = () => { if (A.selected === e.id) paintAi(); };
    st.running = true; st.error = ''; st.text = 'מתמללים את ההקלטה…'; paint();
    try {
      let have = null;
      try { have = await S.sb.call(`/api/program/ai/transcript/${encodeURIComponent(e.id)}`); } catch { /* עוד אין */ }
      if (!have || !have.partsTotal || have.partsDone < have.partsTotal) await transcribe(e, (p, t) => { st.text = `מתמללים… ${Math.round(p / t * 100)}%`; paint(); }, have);
      st.text = 'כותבים תיאור וסיכום…'; paint();
      st.summary = await summarize(e);
      st.text = '';
      if (apply) applySummary(liveAfter(e), st.summary);
    } catch (err) { st.error = err.message; st.text = ''; throw err; }
    finally { st.running = false; paint(); }
  }
  const aiAll = () => runJob('ai-all', A.data.episodes.filter((e) => U.streamUrl(e) && (!e.description.trim() || GENERIC_DESC.test(e.description.trim()))), (e) => aiRun(e, { apply: true }), { label: 'תיאורים' });

  function aiCard(e) {
    if (!CLOUD || !U.streamUrl(e)) return '';
    return `
<div class="card" id="ai-card">
  <div class="section-title"><div><p class="kicker">AI</p><h2>תיאור וסיכום מההקלטה</h2></div></div>
  <div class="card-body">
    <p class="help">המערכת מתמללת את ההקלטה, ומהתמלול כותבת תיאור, סיכום של מה שהיה בתוכנית, מילות חיפוש ושמות האורחים. התמלול עצמו גלוי רק למנהלים ולא מופיע באתר. תוכנית של שעה לוקחת כמה דקות.</p>
    <div id="ai-box"></div>
  </div>
</div>`;
  }
  function paintAi() {
    const box = $('#ai-box'); const e = cur(); if (!box || !e) return;
    const st = A.ai.get(e.id) || {};
    const sum = st.summary;
    box.innerHTML = `
<div class="actions" style="margin:0">
  <button type="button" class="btn gold" data-op="ai-run" ${st.running ? 'disabled' : ''}>${sum ? 'יצירה מחדש' : 'תמלול ויצירת תיאור'}</button>
  <button type="button" class="btn small" data-op="ai-transcript" aria-expanded="${st.transcript != null}">${st.transcript != null ? 'הסתרת התמלול' : 'הצגת התמלול'}</button>
  <button type="button" class="btn small" data-op="ai-titles" ${st.titlesBusy ? 'disabled' : ''}>${st.titlesBusy ? 'חושבים על שמות…' : 'הצעות לשם התוכנית'}</button>
</div>
${st.titles ? `<div class="ai-result"><p class="kicker">הצעות לשם — לחיצה מחליפה את השם</p><div class="title-ideas">${st.titles.map((t, i) => `<button type="button" class="chip" data-op="ai-title-use" data-i="${i}">${esc(t)}</button>`).join('')}</div>${st.whatsapp ? `<p class="kicker" style="margin-top:12px">טקסט לוואטסאפ</p><div class="whatsapp-text">${esc(st.whatsapp)}</div><div class="actions"><button type="button" class="btn small" data-op="copy" data-text="${esc(st.whatsapp)}">העתקה</button></div>` : ''}</div>` : ''}
${st.text ? `<p class="upload-status" role="status"><span class="notice-spinner" aria-hidden="true"></span> ${esc(st.text)}</p>` : ''}
${st.error ? `<p class="problems">${esc(st.error)}</p>` : ''}
${sum ? `<div class="ai-result">
  <p class="kicker">ההצעה</p>
  ${sum.description ? `<p><b>תיאור:</b> ${esc(sum.description)}</p>` : ''}
  ${sum.summary ? `<p style="white-space:pre-line"><b>סיכום:</b>\n${esc(sum.summary)}</p>` : ''}
  ${(sum.tags || []).length ? `<p><b>מילות חיפוש:</b> ${esc(sum.tags.join(', '))}</p>` : ''}
  ${(sum.guests || []).length ? `<p><b>אורחים:</b> ${esc(sum.guests.join(', '))}</p>` : ''}
  <div class="actions"><button type="button" class="btn primary" data-op="ai-apply">הכנסה לתוכנית <span>←</span></button><span class="cue-hint">התיאור והסיכום נכנסים לשדה "על התוכנית"; אפשר לערוך אחר כך.</span></div>
</div>` : ''}
${st.transcript != null ? `<details class="ai-transcript" open><summary>התמלול (למנהלים בלבד)</summary><div class="transcript-text">${esc(st.transcript) || 'עדיין אין תמלול.'}</div></details>` : ''}`;
  }

  /* ---------- גרסאות קודמות של תוכנית ---------- */

  async function versionData(id) {
    if (!A.versionCache.has(id)) A.versionCache.set(id, (await S.sb.versions.get(id)));
    return A.versionCache.get(id);
  }
  async function openHistory(e) {
    const dlg = $('#dlg-history'); $('#history-title').textContent = label(e); $('#history-body').innerHTML = '<p class="help">טוענים את הגרסאות…</p>'; dlg.showModal();
    try {
      if (!A.versions) A.versions = (await S.sb.versions.list()).versions;
      const rows = [];
      let prevKey = null;
      for (const v of A.versions) {
        const data = (await versionData(v.id)).data;
        const found = (data.episodes || []).find((x) => x.id === e.id);
        const k = found ? JSON.stringify(S.admin.normEpisode(found, 0)) : null;
        if (k !== prevKey) rows.push({ v, found });
        prevKey = k;
      }
      $('#history-body').innerHTML = rows.length ? `<p class="help">כל פרסום שבו התוכנית הזו השתנתה. "שחזור" מחזיר את התוכנית לטיוטה כפי שהייתה אז — ואז לוחצים פרסום.</p><div class="version-list">${rows.map(({ v, found }) => `
<div class="version"><div><b>${esc(when(v.createdAt))}</b><small>${found ? `${esc(found.title || 'בלי שם')}${found.date ? ` · ${esc(fmtDate(found.date, true))}` : ''}${found.cover ? ' · עם תמונה' : ''}` : 'התוכנית לא הייתה קיימת בגרסה הזו'}${v.by ? ` · פורסם על ידי ${esc(v.by)}` : ''}</small></div>${found ? `<button type="button" class="btn small" data-restore-ep="${esc(v.id)}">שחזור</button>` : ''}</div>`).join('')}</div>` : '<p class="help">עדיין אין גרסאות קודמות — הן נשמרות מעכשיו בכל פרסום.</p>';
    } catch (err) { $('#history-body').innerHTML = `<p class="problems">${esc(err.message)}</p>`; }
  }
  $('#history-body').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-restore-ep]'); if (!b) return;
    const e = cur(); if (!e) return;
    const found = ((await versionData(b.dataset.restoreEp)).data.episodes || []).find((x) => x.id === e.id);
    if (!found) return;
    Object.assign(e, S.admin.normEpisode(found, 0));
    touch(); renderEditor(); renderList(); $('#dlg-history').close(); U.notify('התוכנית שוחזרה לטיוטה. לחצו פרסום כדי להעלות לאתר.', 'success');
  });

  /* ======================================================
     2. האתר — הודעה, עדכונים, עונות
     ====================================================== */

  function renderSite() {
    const b = A.data.settings.banner || {};
    const ct = A.data.settings.contacts || (A.data.settings.contacts = S.admin.normSettings({}).contacts);
    const ups = A.data.settings.updates || [];
    $('#panel').innerHTML = `
<div class="card">
  <div class="section-title"><div><p class="kicker">הודעה</p><h2>הודעה בראש האתר</h2></div><span class="toggle${b.enabled ? ' on' : ''}" aria-hidden="true">${!b.enabled ? 'כבויה' : b.from && b.from > S.todayIL() ? 'מתוזמנת' : 'מוצגת'}</span></div>
  <div class="card-body">
    <p class="help">פס הודעה שמופיע בראש כל הדפים — למשל "התוכנית הבאה ביום חמישי" או ברכה לחג. נעלם לבד בתאריך שתבחרו.</p>
    <div class="form-grid">
      <label class="field span2"><span>ההודעה</span><input data-sf="text" value="${esc(b.text || '')}" maxlength="300" placeholder="למשל: התוכנית הבאה — יום חמישי ב־20:00"></label>
      <label class="field"><span>קישור (לא חובה)</span><input data-sf="link" value="${esc(b.link || '')}" placeholder="https://… או episode.html?ep=…" class="ltr"></label>
      <label class="field"><span>טקסט הכפתור</span><input data-sf="linkLabel" value="${esc(b.linkLabel || '')}" placeholder="לפרטים"></label>
      <label class="field"><span>להתחיל להציג ב־ (לא חובה)</span><input data-sf="from" type="date" value="${esc(b.from || '')}"><small>ריק = מיד אחרי הפרסום. כך אפשר להכין ברכה לחג מראש.</small></label>
      <label class="field"><span>להציג עד (לא חובה)</span><input data-sf="until" type="date" value="${esc(b.until || '')}"></label>
    </div>
    ${b.enabled && b.text && b.from && b.from > S.todayIL() ? `<p class="cue-hint banner-when">🕒 ההודעה תופיע באתר ב־${esc(fmtDate(b.from))}${b.until ? ` ותרד אחרי ${esc(fmtDate(b.until))}` : ''}.</p>` : ''}
    <div class="switches"><button type="button" class="toggle${b.enabled ? ' on' : ''}" data-op="banner-toggle" aria-pressed="${!!b.enabled}">${b.enabled ? '✓ ההודעה מוצגת' : 'להציג את ההודעה'}</button></div>
    <div class="banner-sites"><span class="cue-hint">איפה להציג:</span><label class="check"><input type="checkbox" data-bs="program" ${b.sites?.program !== false ? 'checked' : ''}> באתר התוכניות</label><label class="check"><input type="checkbox" data-bs="survey" ${b.sites?.survey ? 'checked' : ''}> באתר הסקר</label></div>
    ${b.enabled && b.text ? `<div class="banner-preview"><span class="kicker">כך זה נראה</span><div class="site-banner"><span class="site-banner-mark">✦</span><p>${esc(b.text)}</p>${b.link ? `<span class="btn small">${esc(b.linkLabel || 'לפרטים')} <span>←</span></span>` : ''}</div></div>` : ''}
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">דף העדכונים</p><h2>מה חדש</h2></div><strong>${ups.length}</strong></div>
  <div class="card-body">
    <p class="help">הודעות קצרות למאזינים בדף "עדכונים" באתר (הקישור מופיע בתפריט כשיש עדכונים). החדש ביותר למעלה; אפשר לנעוץ עדכון חשוב.</p>
    <div class="update-rows" id="update-rows">${renderUpdates(ups)}</div>
    <div class="track-tools"><button type="button" class="btn gold" data-op="update-add">+ עדכון חדש</button></div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">פרטי קשר</p><h2>קו התוכן והקשר איתנו</h2></div></div>
  <div class="card-body">
    <p class="help">מה שמופיע בדף הבית בכרטיסים "גם בטלפון" ו"הקול שלכם". שדה ריק לא מוצג.</p>
    <div class="form-grid">
      <label class="field"><span>טלפון ראשי</span><input data-cf="phone" value="${esc(ct.phone)}" class="ltr" inputmode="tel" maxlength="30"></label>
      <label class="field"><span>טלפון נוסף</span><input data-cf="phone2" value="${esc(ct.phone2)}" class="ltr" inputmode="tel" maxlength="30"></label>
      <label class="field span2"><span>מה יש בקו (השלוחות)</span><textarea data-cf="phoneNote" maxlength="500">${esc(ct.phoneNote)}</textarea></label>
      <label class="field span2"><span>איך מדברים עם המגישים</span><textarea data-cf="hostsNote" maxlength="500">${esc(ct.hostsNote)}</textarea></label>
      <label class="field"><span>מייל (לתפוצה ולצ׳אט)</span><input data-cf="email" type="email" value="${esc(ct.email)}" class="ltr" maxlength="120"></label>
      <label class="field"><span>הערה להצטרפות לצ׳אט</span><input data-cf="chatNote" value="${esc(ct.chatNote)}" maxlength="500"></label>
    </div>
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">עונות</p><h2>סידור הארכיון</h2></div><strong>${A.data.seasons.length}</strong></div>
  <div class="card-body">
    <p class="help">עונה היא קבוצה של תוכניות — לפי שנה, לפי תקופה או לפי המגישים. בארכיון אפשר לסנן לפי עונה, ולכל תוכנית בוחרים עונה בטופס שלה.</p>
    <div class="season-rows" id="season-rows">${renderSeasonRows()}</div>
    <div class="track-tools">
      <button type="button" class="btn gold" data-op="season-add">+ עונה חדשה</button>
      <span class="cue-hint">מחיקת עונה לא מוחקת תוכניות — הן פשוט יישארו בלי עונה.</span>
    </div>
  </div>
</div>`;
  }
  function renderUpdates(ups) {
    if (!ups.length) return '<div class="state" style="padding:20px"><p>עדיין אין עדכונים.</p></div>';
    return ups.map((u, i) => `
<div class="update-row${u.pinned ? ' pinned' : ''}" data-i="${i}">
  <div class="update-head"><input data-uf="date" data-i="${i}" type="date" value="${esc(u.date)}" aria-label="תאריך" class="ltr"><input data-uf="title" data-i="${i}" value="${esc(u.title)}" placeholder="כותרת" aria-label="כותרת"><button type="button" class="chip" data-op="update-pin" data-i="${i}" aria-pressed="${!!u.pinned}">${u.pinned ? '📌 נעוץ' : 'נעיצה'}</button><button type="button" class="icon-btn del" data-op="update-del" data-i="${i}" aria-label="מחיקת העדכון">✕</button></div>
  <textarea data-uf="text" data-i="${i}" placeholder="תוכן העדכון" aria-label="תוכן">${esc(u.text)}</textarea>
  <input data-uf="link" data-i="${i}" value="${esc(u.link || '')}" placeholder="קישור (לא חובה)" aria-label="קישור" class="ltr">
</div>`).join('');
  }
  function renderSeasonRows() {
    const counts = {}; A.data.episodes.forEach((e) => { counts[e.season] = (counts[e.season] || 0) + 1; });
    if (!A.data.seasons.length) return '<div class="state" style="padding:24px"><p>עדיין אין עונות. הוסיפו אחת.</p></div>';
    return `<div class="season-head"><span>שם העונה</span><span>שנה</span><span>הערה</span><span>תוכניות</span><span></span></div>` + A.data.seasons.map((s, i) => `
<div class="season-row" data-i="${i}">
  <input data-zf="title" data-i="${i}" value="${esc(s.title)}" aria-label="שם העונה" placeholder="למשל: עונת 2026">
  <input data-zf="year" data-i="${i}" type="number" value="${s.year ?? ''}" aria-label="שנה" placeholder="2026" class="ltr center">
  <input data-zf="note" data-i="${i}" value="${esc(s.note)}" aria-label="הערה" placeholder="הערה (לא חובה)">
  <span class="pill">${counts[s.id] || 0}</span>
  <button type="button" class="icon-btn del" data-op="season-del" data-i="${i}" aria-label="מחיקת העונה">✕</button>
</div>`).join('');
  }

  /* ======================================================
     3. מאזינים — מספרים והודעות
     ====================================================== */

  async function loadListeners() {
    if (!CLOUD || !S.sb.user?.isAdmin) return;
    const [stats, messages, subs, push, comments] = await Promise.allSettled([S.sb.stats(), S.sb.messages.list(), S.sb.subscribe.count(), S.sb.call('/api/program/push/count'), S.sb.call('/api/program/comments/all?status=all')]);
    A.comments = comments.status === 'fulfilled' ? comments.value : { error: comments.reason?.status === 404 ? 'השרת עדיין לא עודכן לגרסה עם תגובות.' : comments.reason?.message, comments: [] };
    A.pushCount = push.status === 'fulfilled' ? Number(push.value.total) || 0 : null;
    A.stats = stats.status === 'fulfilled' ? stats.value : { error: stats.reason?.message };
    A.messages = messages.status === 'fulfilled' ? messages.value : { error: messages.reason?.message };
    A.subs = subs.status === 'fulfilled' ? subs.value : null;
    const badge = $('#tab-unread'); const unread = (A.messages?.unread || 0) + (A.comments?.pending || 0);
    badge.hidden = !unread; badge.textContent = unread;
    if (A.tab === 'listeners') renderListeners();
    paintDash(); paintEpStats();
  }
  /* ---------- סטטיסטיקה מעמיקה: מאיפה מגיעים, מתי מאזינים, מה אוהבים, ועד איפה שומעים ---------- */
  const SOURCE_NAMES = { email: 'מייל (רשימת התפוצה)', whatsapp: 'וואטסאפ', google: 'גוגל', facebook: 'פייסבוק', direct: 'ישיר (קישור או כתובת)', internal: 'מתוך האתר', other: 'אחר' };
  function hbars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return `<div class="hbars">${rows.map((r) => `<div class="hbar"><span>${esc(r.label)}</span><i style="--w:${Math.round(r.n / max * 100)}%"></i><b>${n2(r.n)}</b></div>`).join('')}</div>`;
  }
  function deepStats(st) {
    const sources = (st.sources || []).filter((r) => Number(r.plays)).sort((a, b) => b.plays - a.plays);
    const dlSources = (st.downloads?.sources || []).filter((r) => Number(r.downloads)).sort((a, b) => b.downloads - a.downloads);
    const hours = st.hours || [];
    const hmax = Math.max(1, ...hours.map((h) => Number(h.plays) || 0));
    const likes = (st.likes || []).filter((r) => Number(r.likes));
    const epName = (id) => { const e = A.data.episodes.find((x) => x.id === id); return e ? label(e) : 'תוכנית שנמחקה'; };
    const withAudio = A.data.episodes.filter((e) => U.streamUrl(e)).slice().sort(byDate);
    const ret = A.statsEp ? A.epStats.get(A.statsEp) : null;
    const rmax = Math.max(1, ...(ret?.retention || []).map((r) => Number(r.listeners) || 0));
    return `
<div class="two-col" style="margin-top:22px">
  <div><p class="kicker">מאיפה הגיעו המאזינים (30 יום)</p>${sources.length ? hbars(sources.map((r) => ({ label: SOURCE_NAMES[r.ref] || r.ref || 'אחר', n: Number(r.plays) || 0 }))) : '<p class="help">עוד אין נתונים — הם מתחילים להיאסף מעכשיו.</p>'}</div>
  <div><p class="kicker">באיזו שעה מאזינים (30 יום)</p>${hours.some((h) => Number(h.plays)) ? `<div class="bars hours" role="img" aria-label="האזנות לפי שעה ביום">${hours.map((h) => `<div class="bar" title="${String(h.hour).padStart(2, '0')}:00 — ${n2(h.plays)} האזנות"><i style="height:${Math.round((Number(h.plays) || 0) / hmax * 100)}%"></i><small>${Number(h.hour) % 3 ? '' : String(h.hour).padStart(2, '0')}</small></div>`).join('')}</div>` : '<p class="help">עוד אין נתונים.</p>'}</div>
</div>
${dlSources.length ? `<div style="margin-top:22px"><p class="kicker">מאיפה הורידו${st.config ? ` (מאז ${esc(fmtDate(st.config.since))})` : ''}</p>${hbars(dlSources.map((r) => ({ label: SOURCE_NAMES[r.ref] || r.ref || 'אחר', n: Number(r.downloads) || 0 })))}</div>` : ''}
<div class="two-col" style="margin-top:22px">
  <div><p class="kicker">הכי אהובות (♥)</p>${likes.length ? `<ol class="top-list">${likes.slice(0, 10).map((r) => `<li><span>${esc(epName(r.id))}</span><b>♥ ${n2(r.likes)}</b></li>`).join('')}</ol>` : '<p class="help">עוד אף אחד לא סימן "אהבתי".</p>'}${(st.moments || []).length ? `<p class="kicker" style="margin-top:14px">הכי הרבה רגעים מסומנים</p><ol class="top-list">${st.moments.slice(0, 5).map((r) => `<li><span>${esc(epName(r.id))}</span><b>♥ ${n2(r.count)}</b></li>`).join('')}</ol>` : ''}</div>
  <div><p class="kicker">עד איפה מאזינים</p>
    <label class="visually-hidden" for="stats-ep">תוכנית</label>
    <select id="stats-ep" class="input small-select" style="width:100%"><option value="">בחרו תוכנית…</option>${withAudio.map((e) => `<option value="${esc(e.id)}" ${A.statsEp === e.id ? 'selected' : ''}>${esc(label(e))}</option>`).join('')}</select>
    ${A.statsEp ? (!ret ? '<p class="help">טוענים…</p>' : ret.error ? `<p class="problems">${esc(ret.error)}</p>` : (ret.retention || []).some((r) => Number(r.listeners)) ? `<div class="bars retention" role="img" aria-label="כמה מאזינים הגיעו לכל נקודה בתוכנית">${ret.retention.map((r) => `<div class="bar" title="${r.pct}% מהתוכנית: ${n2(r.listeners)} מאזינים"><i style="height:${Math.round((Number(r.listeners) || 0) / rmax * 100)}%"></i><small>${r.pct % 25 ? '' : `${r.pct}%`}</small></div>`).join('')}</div><p class="cue-hint">${n2(ret.listeners)} מאזינים · ${n2(ret.plays)} האזנות${ret.config ? ` · ${n2(ret.full)} האזנות מלאות · ${n2(ret.downloads)} הורדות` : ''}. כל עמודה: כמה מאזינים הגיעו לנקודה הזו בתוכנית (כל מי שהתחיל לשמוע). ירידה חדה = שם עוזבים.</p>` : '<p class="help">עוד אין מספיק נתונים לתוכנית הזו.</p>') : '<p class="help">בחרו תוכנית כדי לראות באיזה רגע מאזינים מפסיקים לשמוע.</p>'}
    ${ret?.moments ? hotMoments(ret.moments) : ''}
  </div>
</div>`;
  }
  /** הרגעים הכי חמים בתוכנית: איפה המאזינים סימנו ♥ (גלוי רק כאן, בניהול) */
  function hotMoments(m) {
    if (!m.buckets?.length) return '<p class="kicker" style="margin-top:16px">הרגעים הכי חמים</p><p class="help">עוד אף מאזין לא סימן ♥ על רגע בתוכנית הזו.</p>';
    const e = A.data.episodes.find((x) => x.id === m.id);
    const D = e?.duration || Math.max(...m.buckets.map((b) => b.at + 30));
    const bins = 40, per = Math.max(30, Math.ceil(D / bins / 30) * 30);
    const counts = Array.from({ length: Math.ceil(D / per) }, (_, i) => m.buckets.filter((b) => b.at >= i * per && b.at < (i + 1) * per).reduce((n, b) => n + b.count, 0));
    const max = Math.max(1, ...counts);
    return `<p class="kicker" style="margin-top:16px">הרגעים הכי חמים · ${n2(m.total)} מאזינים סימנו ♥</p>
<div class="bars hours" role="img" aria-label="כמה מאזינים סימנו כל חלק בתוכנית">${counts.map((c, i) => `<div class="bar" title="${U.fmtTime(i * per)}–${U.fmtTime((i + 1) * per)}: ${n2(c)}"><i style="height:${Math.round(c / max * 100)}%;background:linear-gradient(180deg,var(--pink),color-mix(in srgb,var(--pink) 30%,transparent))"></i><small>${i % 8 ? '' : U.fmtTime(i * per)}</small></div>`).join('')}</div>
<ul class="hot-list">${(m.top || []).map((t) => `<li><span class="pill">♥ ${U.fmtTime(t.at)} · ${n2(t.count)}</span></li>`).join('')}</ul>`;
  }
  async function loadEpStats(id) {
    A.statsEp = id; if (!id) { renderListeners(); return; }
    if (!A.epStats.has(id)) {
      renderListeners();
      await fetchEpStats(id);
    }
    if (A.tab === 'listeners') renderListeners();
  }
  /* ---------- תיבת הדואר: הודעות ("כתבו לנו") ותגובות מדפי התוכניות, במקום אחד ----------
     סינון (צריך טיפול / הודעות / תגובות / הכול, ולפי תוכנית), תשובות מוכנות, ופעולה
     על כמה פריטים יחד. פעולה על פריט מעדכנת רק אותו (ואת המונים) — תשובות שמוקלדות
     בפריטים אחרים לא נמחקות. */
  A.inboxFilter = 'todo'; A.inboxEp = ''; A.inboxPicked = new Set();
  const INBOX_TABS = [['todo', 'צריך טיפול'], ['messages', 'הודעות'], ['comments', 'תגובות'], ['all', 'הכול']];
  const REPLIES_KEY = 'rosh:admin:replies';
  const DEFAULT_REPLIES = ['תודה רבה! שמחים שנהניתם 🙏', 'תודה על ההערה — נבדוק ונתקן.', 'תודה! הבקשה נרשמה, ונשתדל להשמיע אותה בתוכנית הבאה.'];
  function replies() { try { const v = JSON.parse(localStorage.getItem(REPLIES_KEY) || 'null'); return Array.isArray(v) && v.length ? v : DEFAULT_REPLIES; } catch { return DEFAULT_REPLIES; } }
  const secs = (v) => (typeof v === 'number' ? v : (Date.parse(v) / 1000) || 0);
  const epName = (id) => { const e = A.data.episodes.find((x) => x.id === id); return e ? label(e) : 'תוכנית שנמחקה'; };
  function inboxItems() {
    const ms = (A.messages?.messages || []).map((m) => ({ kind: 'msg', id: m.id, at: secs(m.createdAt), ep: m.episodeId || '', todo: !m.readAt, m }));
    const cs = (A.comments?.comments || []).map((c) => ({ kind: 'com', id: c.id, at: secs(c.createdAt), ep: c.episodeId || '', todo: c.status === 'pending', c }));
    return [...ms, ...cs].sort((a, b) => b.at - a.at);
  }
  const inboxMatch = (it, f = A.inboxFilter) => (!A.inboxEp || it.ep === A.inboxEp) && (f === 'all' || (f === 'todo' ? it.todo : f === 'messages' ? it.kind === 'msg' : it.kind === 'com'));
  const inboxTabText = (k, t) => { const n = inboxItems().filter((it) => inboxMatch(it, k)).length; return `${t}${k === 'all' ? '' : ` (${n})`}`; };
  const pickKey = (it) => `${it.kind}:${it.id}`;
  const COMMENT_STATES = { pending: 'ממתינה לאישור', approved: 'מוצגת באתר', hidden: 'מוסתרת' };
  function commentItem(c) {
    const it = { kind: 'com', id: c.id };
    return `
      <li class="inbox-item mod ${c.status}" data-kind="com" data-id="${esc(c.id)}">
        <label class="pick"><input type="checkbox" data-inbox-pick="${esc(pickKey(it))}" ${A.inboxPicked.has(pickKey(it)) ? 'checked' : ''} aria-label="בחירה"></label>
        <div class="inbox-body">
        <div class="mod-head"><span class="kind">תגובה</span><b>${esc(c.name || 'מאזין')}</b>${c.email ? `<small class="ltr">${esc(c.email)}</small>` : ''}<small>על "${esc(epName(c.episodeId))}"${c.at != null ? ` · ברגע ${U.fmtTime(c.at)}` : ''} · ${esc(when(c.createdAt))}</small><span class="pill st-${c.status}">${COMMENT_STATES[c.status] || c.status}</span>${c.pinned ? '<span class="pill gold">★ נבחרת</span>' : ''}</div>
        <p>${esc(c.text)}</p>
        <label class="field"><span>תשובת המגישים (לא חובה)</span><textarea data-reply-for="${esc(c.id)}" maxlength="1000" placeholder="תשובה שתופיע מתחת לתגובה">${esc(c.reply || '')}</textarea></label>
        <div class="tpl-chips"><span class="cue-hint">תשובה מוכנה:</span>${replies().map((r, i) => `<button type="button" class="chip" data-op="reply-tpl" data-id="${esc(c.id)}" data-i="${i}" title="${esc(r)}">${esc(r.length > 26 ? `${r.slice(0, 24)}…` : r)}</button>`).join('')}</div>
        <div class="mod-ops">
          ${c.status !== 'approved' ? `<button type="button" class="btn small primary" data-op="comment-status" data-id="${esc(c.id)}" data-st="approved">✓ אישור והצגה</button>` : ''}
          ${c.status !== 'hidden' ? `<button type="button" class="btn small" data-op="comment-status" data-id="${esc(c.id)}" data-st="hidden">הסתרה</button>` : ''}
          <button type="button" class="btn small" data-op="comment-pin" data-id="${esc(c.id)}">${c.pinned ? 'ביטול "נבחרת"' : '★ תגובה נבחרת'}</button>
          <button type="button" class="btn small" data-op="comment-reply" data-id="${esc(c.id)}">שמירת התשובה</button>
          <button type="button" class="btn small danger" data-op="comment-del" data-id="${esc(c.id)}">מחיקה</button>
        </div></div>
      </li>`;
  }
  function messageItem(m) {
    const it = { kind: 'msg', id: m.id };
    const mail = (body) => `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`תשובה מ${site.name || 'ראש בראש'}`)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
    return `
      <li class="inbox-item msg${m.readAt ? '' : ' unread'}" data-kind="msg" data-id="${esc(m.id)}">
        <label class="pick"><input type="checkbox" data-inbox-pick="${esc(pickKey(it))}" ${A.inboxPicked.has(pickKey(it)) ? 'checked' : ''} aria-label="בחירה"></label>
        <div class="inbox-body">
        <div class="msg-head"><span class="kind">הודעה</span><b>${esc(m.name || 'מאזין/ה')}</b>${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}<small>${esc(when(m.createdAt))}${m.episodeId ? ` · על "${esc(epName(m.episodeId))}"` : ''}</small></div>
        <p>${esc(m.text)}</p>
        <div class="msg-ops"><button type="button" class="btn small" data-op="msg-read" data-id="${esc(m.id)}" data-read="${m.readAt ? '0' : '1'}">${m.readAt ? 'סימון כלא נקרא' : '✓ נקרא'}</button>${m.email ? `<details class="reply-menu"><summary class="btn small">תשובה במייל ▾</summary><div class="reply-menu-list"><a href="${esc(mail(''))}">מייל ריק</a>${replies().map((r) => `<a href="${esc(mail(r))}">${esc(r)}</a>`).join('')}</div></details>` : ''}<button type="button" class="btn small danger" data-op="msg-del" data-id="${esc(m.id)}">מחיקה</button></div>
        </div>
      </li>`;
  }
  const itemHtml = (it) => (it.kind === 'msg' ? messageItem(it.m) : commentItem(it.c));
  function inboxBulk() {
    const n = A.inboxPicked.size;
    if (!n) return '';
    const kinds = [...A.inboxPicked].map((k) => k.split(':')[0]);
    return `<span class="cue-hint">${n === 1 ? 'נבחר פריט אחד' : `נבחרו ${n} פריטים`}</span>
<div class="bulk-actions">${kinds.includes('msg') ? '<button type="button" class="btn small" data-op="inbox-bulk" data-do="read">✓ סימון כנקרא</button>' : ''}${kinds.includes('com') ? '<button type="button" class="btn small primary" data-op="inbox-bulk" data-do="approved">✓ אישור והצגה</button><button type="button" class="btn small" data-op="inbox-bulk" data-do="hidden">הסתרה</button>' : ''}<button type="button" class="btn small danger" data-op="inbox-bulk" data-do="delete">מחיקה</button><button type="button" class="btn small" data-op="inbox-unpick">ניקוי הבחירה</button></div>`;
  }
  function inboxCard() {
    const ms = A.messages, cs = A.comments;
    if (!ms && !cs) return '<div class="card" id="inbox-card"><div class="card-body"><p class="help">טוענים את ההודעות והתגובות…</p></div></div>';
    const notReady = (o) => o?.error && /404|לא נמצא|לא עודכן/.test(o.error);
    const errs = [ms?.error && (notReady(ms) ? 'השרת עדיין לא עודכן לגרסה שמקבלת הודעות מהמאזינים.' : ms.error), cs?.error].filter(Boolean);
    const all = inboxItems(), list = all.filter((it) => inboxMatch(it));
    const todo = all.filter((it) => it.todo).length;
    const eps = [...new Set(all.map((it) => it.ep).filter(Boolean))];
    return `
<div class="card" id="inbox-card">
  <div class="section-title"><div><p class="kicker">תיבת הדואר</p><h2>מה המאזינים כותבים</h2></div><strong data-inbox-todo ${todo ? '' : 'hidden'}>${todo || ''}</strong></div>
  <div class="card-body">
    <p class="help">הודעות מ"כתבו לנו" ותגובות מדפי התוכניות, במקום אחד. תגובה מופיעה באתר רק אחרי שאישרתם אותה; אפשר לענות בשם המגישים ולסמן "תגובה נבחרת" שתופיע ראשונה.</p>
    ${errs.map((x) => `<p class="problems">${esc(x)}</p>`).join('')}
    <div class="inbox-bar">
      <div class="segmented" role="group" aria-label="סינון">${INBOX_TABS.map(([k, t]) => `<button type="button" data-op="inbox-filter" data-inbox="${k}" aria-pressed="${A.inboxFilter === k}">${inboxTabText(k, t)}</button>`).join('')}</div>
      ${eps.length ? `<label class="visually-hidden" for="inbox-ep">לפי תוכנית</label><select id="inbox-ep" class="input small-select"><option value="">כל התוכניות</option>${eps.map((id) => `<option value="${esc(id)}" ${A.inboxEp === id ? 'selected' : ''}>${esc(epName(id))}</option>`).join('')}</select>` : ''}
    </div>
    <div class="bulk-bar inbox-bulk" data-inbox-bulk ${A.inboxPicked.size ? '' : 'hidden'}>${inboxBulk()}</div>
    ${list.length ? `<ul class="inbox-list">${list.map(itemHtml).join('')}</ul>` : `<div class="state" style="padding:20px"><p>${A.inboxFilter === 'todo' ? '✓ אין שום דבר שמחכה לטיפול.' : all.length ? 'אין כאן כלום בסינון הזה.' : 'עדיין לא הגיעו הודעות. המאזינים כותבים דרך "כתבו לנו" ובדפי התוכניות.'}</p></div>`}
    <details class="tpl-edit"><summary>התשובות המוכנות</summary><p class="help">כל שורה היא תשובה מוכנה. נשמרות במכשיר הזה.</p><textarea data-replies rows="4">${esc(replies().join('\n'))}</textarea><div class="actions" style="margin:8px 0 0"><button type="button" class="btn small" data-op="replies-save">שמירה</button></div></details>
  </div>
</div>`;
  }
  /** מעדכנים את תיבת הדואר במקום (בלי לצייר את כל החלק), ואת התג בלשונית */
  function paintInbox() { const card = $('#inbox-card'); if (card) card.outerHTML = inboxCard(); loadListenersBadge(); }
  function paintInboxCounts() {
    const card = $('#inbox-card'); if (!card) return;
    INBOX_TABS.forEach(([k, t]) => { const b = card.querySelector(`[data-op="inbox-filter"][data-inbox="${k}"]`); if (b) b.textContent = inboxTabText(k, t); });
    const todo = inboxItems().filter((it) => it.todo).length, el = card.querySelector('[data-inbox-todo]');
    if (el) { el.hidden = !todo; el.textContent = todo || ''; }
    const bulk = card.querySelector('[data-inbox-bulk]'); if (bulk) { bulk.hidden = !A.inboxPicked.size; bulk.innerHTML = inboxBulk(); }
    loadListenersBadge();
  }
  function repaintItem(kind, id) {
    const li = P.querySelector(`.inbox-item[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
    const it = inboxItems().find((x) => x.kind === kind && x.id === id);
    if (li && it) {
      const typed = li.querySelector('textarea[data-reply-for]')?.value;
      li.outerHTML = itemHtml(it);
      if (typed != null) { const ta = P.querySelector(`[data-reply-for="${CSS.escape(id)}"]`); if (ta && ta.value !== typed && it.kind === 'com' && (it.c.reply || '') !== typed) ta.value = typed; }
    } else if (li) li.remove();
    paintInboxCounts();
  }
  /** פעולה על תגובה. מחזיר true כשהשרת קיבל. */
  async function moderate(id, body, { quiet = false } = {}) {
    try {
      const r = await S.sb.call('/api/program/comments/moderate', { method: 'POST', body: { id, ...body } });
      const list = A.comments?.comments || []; const i = list.findIndex((c) => c.id === id);
      if (i >= 0 && r.comment) list[i] = r.comment;
      A.comments.pending = list.filter((c) => c.status === 'pending').length;
      if (!quiet) repaintItem('com', id);
      return true;
    } catch (err) { if (!quiet) U.notify(err.message, 'error'); return false; }
  }
  async function readMessage(id, read, { quiet = false } = {}) {
    await S.sb.messages.read(id, read);
    const m = (A.messages?.messages || []).find((x) => x.id === id);
    if (m) m.readAt = read ? Math.floor(Date.now() / 1000) : null;
    A.messages.unread = (A.messages.messages || []).filter((x) => !x.readAt).length;
    if (!quiet) repaintItem('msg', id);
  }
  async function deleteItem(kind, id) {
    if (kind === 'msg') { await S.sb.messages.remove(id); A.messages.messages = A.messages.messages.filter((m) => m.id !== id); A.messages.unread = A.messages.messages.filter((x) => !x.readAt).length; }
    else { await S.sb.call('/api/program/comments', { method: 'DELETE', body: { id } }); A.comments.comments = A.comments.comments.filter((c) => c.id !== id); A.comments.pending = A.comments.comments.filter((c) => c.status === 'pending').length; }
    A.inboxPicked.delete(`${kind}:${id}`);
  }
  async function inboxBulkDo(what) {
    const picked = [...A.inboxPicked].map((k) => { const [kind, ...rest] = k.split(':'); return { kind, id: rest.join(':') }; });
    if (what === 'delete' && !confirm(picked.length === 1 ? 'למחוק את הפריט לתמיד?' : `למחוק ${picked.length} פריטים לתמיד?`)) return;
    let ok = 0, failed = 0;
    for (const { kind, id } of picked) {
      try {
        if (what === 'delete') await deleteItem(kind, id);
        else if (what === 'read' && kind === 'msg') await readMessage(id, true, { quiet: true });
        else if ((what === 'approved' || what === 'hidden') && kind === 'com') { if (!await moderate(id, { status: what }, { quiet: true })) throw new Error(); }
        else continue;
        ok++;
      } catch { failed++; }
    }
    A.inboxPicked.clear(); paintInbox();
    U.notify(`${ok === 1 ? 'פריט אחד עודכן' : `${ok} פריטים עודכנו`}${failed ? ` · ${failed} נכשלו` : ''}.`, failed ? 'info' : 'success');
  }
  function loadListenersBadge() { const badge = $('#tab-unread'); const n = (A.messages?.unread || 0) + (A.comments?.pending || 0); badge.hidden = !n; badge.textContent = n; }
  function pushCard() {
    return `
<div class="card">
  <div class="section-title"><div><p class="kicker">התראות לטלפון</p><h2>הודעה לכל המאזינים</h2></div>${A.pushCount != null ? `<strong>${n2(A.pushCount)}</strong>` : ''}</div>
  <div class="card-body">
    <p class="help">${A.pushCount != null ? `${n2(A.pushCount)} מכשירים ביקשו לקבל התראות.` : 'מאזינים מפעילים התראות באזור האישי.'} בפרסום של תוכנית חדשה נשלחת התראה אוטומטית (אפשר לכבות את זה בכפתור הפרסום). כאן אפשר לשלוח הודעה משלכם.</p>
    <form class="push-form" data-push-send>
      <div class="form-grid">
        <label class="field span2"><span>כותרת</span><input name="title" maxlength="80" required placeholder="למשל: התוכנית החדשה עלתה!"></label>
        <label class="field span2"><span>הטקסט</span><input name="body" maxlength="180" placeholder="משפט קצר"></label>
        <label class="field span2"><span>לאן ההתראה פותחת</span><select name="url"><option value="">דף הבית</option>${A.data.episodes.filter((e) => e.visible && !S.scheduled(e)).slice().sort(byDate).slice(0, 40).map((e) => `<option value="episode.html?ep=${esc(encodeURIComponent(e.slug))}">${esc(label(e))}</option>`).join('')}</select></label>
      </div>
      <div class="actions"><button type="submit" class="btn primary">שליחה לכולם <span>←</span></button></div>
    </form>
  </div>
</div>`;
  }
  /* ---------- מה נספר: אחרי כמה דקות האזנה היא נספרת, ומאיזה יום (איפוס) ----------
     ההגדרה בשרת (/api/program/stats/config) ומשותפת לכל המנהלים. */
  const minutesOf = (cfg) => Math.round((Number(cfg?.minSeconds) || 600) / 60);
  const countRule = (cfg) => `האזנה נספרת אחרי ${minutesOf(cfg) === 1 ? 'דקה' : `${minutesOf(cfg)} דקות`} האזנה`;
  const MINUTE_CHOICES = [1, 2, 3, 5, 10, 15, 20, 30];
  A.statsAll = false;
  /** טבלה: לכל תוכנית — האזנות, האזנות מלאות, הורדות ומאזינים */
  function episodeTable(rows, epName) {
    if (!rows.length) return '<p class="help">אין עדיין נתונים.</p>';
    const sorted = rows.slice().sort((a, b) => (Number(b.plays) || 0) - (Number(a.plays) || 0) || (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
    const shown = A.statsAll ? sorted : sorted.slice(0, 15);
    return `<div class="stats-table-wrap"><table class="stats-table">
<thead><tr><th scope="col">תוכנית</th><th scope="col">האזנות</th><th scope="col">האזנות מלאות</th><th scope="col">הורדות</th><th scope="col">מאזינים</th></tr></thead>
<tbody>${shown.map((r) => `<tr><td>${esc(epName(r.id))}</td><td>${n2(r.plays)}</td><td>${n2(r.full)}</td><td>${n2(r.downloads)}</td><td>${n2(r.listeners)}</td></tr>`).join('')}</tbody>
</table></div>${sorted.length > 15 ? `<button type="button" class="btn small" data-op="stats-all">${A.statsAll ? 'פחות' : `כל ${n2(sorted.length)} התוכניות`}</button>` : ''}`;
  }
  function countSettings(cfg) {
    const minutes = minutesOf(cfg);
    const choices = [...new Set([...MINUTE_CHOICES, minutes])].sort((a, b) => a - b);
    return `
<div class="count-box">
  <p class="kicker">מה נספר</p>
  <p class="help"><b>האזנה</b> — מי ששמע לפחות ${minutes === 1 ? 'דקה' : `${minutes} דקות`} מהתוכנית באותו יום (או את כולה). <b>האזנה מלאה</b> — שמע לפחות 90% מהתוכנית. <b>הורדה</b> — לחיצה על קישור ההורדה, באתר או במייל; פעם אחת לכל מכשיר ביום, ובוטים וסורקי קישורים לא נספרים.</p>
  <div class="count-row">
    <label>האזנה נספרת אחרי <select id="stats-min" class="input small-select">${choices.map((m) => `<option value="${m}" ${m === minutes ? 'selected' : ''}>${m === 1 ? 'דקה' : `${m} דקות`}</option>`).join('')}</select></label>
    <label>סופרים מ־<input type="date" id="stats-since" class="input" value="${esc(cfg.since)}" max="${esc(S.todayIL())}"></label>
    <button type="button" class="btn small" data-op="stats-since">שמירת התאריך</button>
    <button type="button" class="btn small" data-op="stats-reset">איפוס — לספור מהיום</button>
  </div>
  ${cfg.by ? `<p class="cue-hint">עודכן לאחרונה על ידי <span class="ltr">${esc(cfg.by)}</span>${cfg.updatedAt ? ` · ${esc(when(cfg.updatedAt))}` : ''}.</p>` : ''}
</div>`;
  }
  async function saveStatsConfig(body, done) {
    try {
      await S.sb.call('/api/program/stats/config', { method: 'POST', body });
      U.notify(done, 'success');
      A.epStats.clear(); A.stats = null;
      renderListeners(); loadListeners();
    } catch (err) { U.notify(err.message, 'error'); }
  }

  function renderListeners() {
    if (!CLOUD) { $('#panel').innerHTML = '<div class="card"><div class="state"><span class="mark">☺</span><h3>המאזינים</h3><p>הסטטיסטיקות וההודעות עובדות רק כשהאתר מחובר לשרת.</p></div></div>'; return; }
    const st = A.stats;
    const notReady = (o) => o?.error && /404|לא נמצא/.test(o.error);
    const epName = (id) => { const e = A.data.episodes.find((x) => x.id === id); return e ? label(e) : 'תוכנית שנמחקה'; };
    const days = st?.days || [];
    const max = Math.max(1, ...days.map((d) => Number(d.plays) || 0));
    const dayName = (iso) => new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`));
    // השרת סופר מיום מסוים ולפי סף (st.config); בלי config — גרסה ישנה של השרת, והמספרים כמו קודם
    const cfg = st?.config, from = cfg ? fmtDate(cfg.since) : '';
    const top = (rows) => (rows || []).filter((r) => Number(r.plays)).slice(0, 10);
    const topList = (rows) => (top(rows).length ? `<ol class="top-list">${top(rows).map((r) => `<li><span>${esc(epName(r.id))}</span><b>${n2(r.plays)}</b></li>`).join('')}</ol>` : '<p class="help">אין עדיין נתונים.</p>');
    const statsHtml = !st ? '<p class="help">טוענים…</p>' : notReady(st) ? '<p class="problems">השרת עדיין לא עודכן לגרסה שאוספת סטטיסטיקות. אחרי העדכון המספרים יתחילו להצטבר כאן.</p>' : st.error ? `<p class="problems">${esc(st.error)}</p>` : `
${cfg ? `<p class="cue-hint" style="margin-top:0">סופרים מ־${esc(from)}. ${esc(countRule(cfg))}; האזנה מלאה — שמעו 90% מהתוכנית.</p>` : ''}
<div class="stats admin-stats${cfg ? ' six' : ''}">
  <div class="stat"><b>${n2(st.week?.plays)}</b><small>האזנות בשבוע האחרון</small></div>
  <div class="stat"><b>${n2(st.week?.listeners)}</b><small>מאזינים בשבוע האחרון</small></div>
  <div class="stat"><b>${n2(st.totals?.plays)}</b><small>${cfg ? `האזנות מאז ${esc(from)}` : 'האזנות מאז ההתחלה'}</small></div>
  ${cfg ? `<div class="stat"><b>${n2(st.totals?.full)}</b><small>האזנות מלאות</small></div>
  <div class="stat"><b>${n2(st.totals?.downloads)}</b><small>הורדות</small></div>` : ''}
  <div class="stat"><b>${n2(Math.round((Number(st.totals?.seconds) || 0) / 3600))}</b><small>שעות האזנה בסך הכול</small></div>
</div>
<p class="kicker" style="margin-top:20px">30 הימים האחרונים</p>
${days.length ? `<div class="bars" role="img" aria-label="האזנות לפי יום">${days.map((d) => `<div class="bar" title="${esc(dayName(d.day))}: ${n2(d.plays)} האזנות, ${n2(d.listeners)} מאזינים${cfg ? `, ${n2(d.full)} מלאות, ${n2(d.downloads)} הורדות` : ''}"><i style="height:${Math.round((Number(d.plays) || 0) / max * 100)}%"></i><small>${esc(dayName(d.day).slice(0, 5))}</small></div>`).join('')}</div>` : '<p class="help">עדיין אין האזנות שנרשמו. המספרים מתחילים להצטבר מהאזנה הראשונה באתר.</p>'}
<div class="two-col">
  <div><p class="kicker">הכי נשמעות ב־30 הימים האחרונים</p>${topList(st.recent)}</div>
  <div><p class="kicker">${cfg ? `הכי נשמעות מאז ${esc(from)}` : 'הכי נשמעות מאז ומעולם'}</p>${topList(st.episodes)}</div>
</div>
${cfg ? `<p class="kicker" style="margin-top:22px">לכל תוכנית (מאז ${esc(from)})</p>${episodeTable(st.episodes || [], epName)}` : ''}
<p class="cue-hint" style="margin-top:12px">מכשירים ב־30 הימים האחרונים: טלפון ${n2(st.devices?.phone)} · מחשב ${n2(st.devices?.desktop)}. הספירה אנונימית — בלי שמות ובלי כתובות.</p>
${deepStats(st)}
${cfg ? countSettings(cfg) : ''}`;
    $('#panel').innerHTML = `
${inboxCard()}
<div class="card">
  <div class="section-title"><div><p class="kicker">מספרים</p><h2>מי מאזין</h2></div><button type="button" class="btn small" data-op="reload-listeners">רענון</button></div>
  <div class="card-body">${statsHtml}</div>
</div>
${pushCard()}
<div class="card">
  <div class="section-title"><div><p class="kicker">רשימת התפוצה</p><h2>נשארים בראש</h2></div>${A.subs ? `<strong>${n2(A.subs.active)}</strong>` : ''}</div>
  <div class="card-body"><p class="help">${A.subs ? `${n2(A.subs.active)} נרשמים פעילים, מהם ${n2(A.subs.fromProgram)} שנרשמו דרך אתר התוכניות. זו אותה רשימה של אתר הסקר — הוספת כתובות (הדבקה או קובץ אקסל), ניהול הרשימה והורדה לאקסל נעשים שם, בלשונית "רשימת תפוצה". אפשר להוסיף כתובות גם מעורך טיוטת המייל ("✉ מייל למאזינים").` : 'המאזינים מצטרפים בלחיצה אחת עם חשבון Google בדף הבית ובאזור האישי. הרשימה משותפת עם אתר הסקר.'}</p>${site.storage?.cloudflare?.apiBase ? `<a class="btn small" href="${esc(new URL(site.storage.cloudflare.apiBase).origin)}/admin" target="_blank" rel="noopener">לניהול הרשימה באתר הסקר</a>` : ''}</div>
</div>`;
  }

  /* ======================================================
     4. פרסום — בדיקה, העברה לאתר, גרסאות, כלים מתקדמים
     ====================================================== */

  function renderPublish() {
    const ch = changes(), hc = health();
    const u = S.sb.user;
    const list = [];
    if (ch) {
      if (ch.added) list.push(ch.added === 1 ? 'תוכנית אחת חדשה' : `${ch.added} תוכניות חדשות`);
      if (ch.changed) list.push(ch.changed === 1 ? 'תוכנית אחת עודכנה' : `${ch.changed} תוכניות עודכנו`);
      if (ch.removed.length) list.push(ch.removed.length === 1 ? `תוכנית אחת תימחק מהאתר (${esc(label(ch.removed[0]))})` : `${ch.removed.length} תוכניות יימחקו מהאתר`);
      if (ch.seasons) list.push('העונות השתנו');
      if (ch.settings) list.push('ההודעה, העדכונים או פרטי הקשר השתנו');
    }
    let title, text;
    if (!A.origin && A.originError) { title = 'האתר לא זמין כרגע'; text = 'לא הצלחנו לקרוא מה מפורסם באתר. השינויים שלכם שמורים — נסו שוב בעוד רגע.'; }
    else if (!A.origin) { title = 'רגע…'; text = 'בודקים מה מפורסם באתר.'; }
    else if (!ch.any) { title = 'הכול מפורסם'; text = 'האתר מציג בדיוק את מה שיש כאן. אין מה לפרסם.'; }
    else { title = 'יש שינויים שמחכים לפרסום'; text = 'עד הפרסום, השינויים נראים רק לכם (ולמי שקיבל קישור תצוגה מקדימה).'; }
    const busy = jobsBusy();
    const canPublish = !!ch?.any && !hc.must.length && (CLOUD ? !!u : true) && !busy;
    const fresh = newlyPublic();
    const checkRow = (kind, titleText, hint) => {
      const r = A.checks[kind];
      return `<div class="tool" data-check="${kind}"><div><b>${titleText}</b><small>${r ? (r.running ? `בודקים… ${r.done}/${r.total}` : r.problems.length ? `${r.problems.length} בעיות נמצאו:` : `✓ הכול תקין (${r.total} נבדקו)`) : hint}</small>${r && !r.running && r.problems.length ? `<ul class="check-list">${r.problems.map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(p.text)}</button></li>`).join('')}</ul>` : ''}</div><button type="button" class="btn small" data-op="check-${kind}" ${r?.running ? 'disabled' : ''}>${r ? 'בדיקה חוזרת' : 'בדיקה'}</button></div>`;
    };
    $('#panel').innerHTML = `
<div class="card pub-card${ch?.any ? ' pending' : ''}">
  <div class="card-body">
    <p class="kicker">פרסום</p>
    <h2 class="display">${title}</h2>
    <p class="help">${text}</p>
    ${list.length ? `<ul class="change-list">${list.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${(() => { const dc = detailedChanges(); return dc.length ? `<details class="diff" ${dc.length <= 8 ? 'open' : ''}><summary>מה בדיוק ישתנה (${dc.length})</summary><ul class="diff-list">${dc.map((d) => `<li>${d.id ? `<button type="button" class="link-btn" data-op="open" data-id="${esc(d.id)}">${esc(d.head)}</button>` : `<b>${esc(d.head)}</b>`}${d.rows.length ? `<ul>${d.rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></details>` : ''; })()}
    ${hc.must.length ? `<div class="problems"><b>לפני שמפרסמים, צריך לתקן:</b><ul>${hc.must.map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(p.text)}</button></li>`).join('')}</ul></div>` : ''}
    ${CLOUD && !u ? '<p class="problems">כדי לפרסם צריך להיות מחוברים. רעננו את הדף והיכנסו שוב.</p>' : ''}
    <div class="actions">
      <button type="button" class="btn xl primary" data-op="publish" ${canPublish ? '' : 'disabled'}>${CLOUD ? 'פרסום לאתר' : 'הורדת הקובץ לפרסום'} <span>←</span></button>
      ${busy && ch?.any ? '<span class="cue-hint"><span class="notice-spinner" aria-hidden="true"></span> ממתינים לסיום העבודה</span>' : ''}
      ${CLOUD && fresh.length ? `<label class="check notify-check"><input type="checkbox" id="pub-notify" ${A.notify ? 'checked' : ''}> לשלוח התראה לטלפון של המאזינים על ${fresh.length === 1 ? 'התוכנית שעולה עכשיו לאתר' : `${fresh.length} התוכניות שעולות עכשיו לאתר`}</label>` : ''}
      ${CLOUD && fresh.length ? `<label class="check mail-check"><input type="checkbox" id="pub-mail" ${A.mailAfter ? 'checked' : ''}> ואחרי הפרסום — להכין טיוטת מייל לרשימת התפוצה בג'ימייל</label>` : ''}
      ${ch?.any ? '<button type="button" class="btn" data-op="discard">ביטול כל השינויים</button>' : ''}
      ${!A.origin ? '<button type="button" class="btn" data-op="reload">בדיקה חוזרת</button>' : ''}
    </div>
    ${CLOUD ? '' : '<p class="cue-hint" style="margin-top:14px">האתר הזה לא מחובר לשרת. הפרסום מוריד קובץ אחד — מוסרים אותו למי שמתחזק את האתר.</p>'}
  </div>
</div>

<div class="card">
  <div class="section-title"><div><p class="kicker">בדיקת תקינות</p><h2>מה כדאי להשלים</h2></div><strong>${hc.should.length + hc.dup.length}</strong></div>
  <div class="card-body">
    ${hc.should.length || hc.dup.length ? `
    ${hc.dup.length ? `<div class="problems soft"><b>כפילויות:</b><ul>${hc.dup.map((d) => `<li>${esc(d.text)} — ${d.ids.map((id, i) => `<button type="button" class="link-btn" data-op="open" data-id="${esc(id)}">פתיחה ${i + 1}</button>`).join(' · ')}</li>`).join('')}</ul></div>` : ''}
    <div class="health-groups">${Object.entries(HEALTH_GROUPS).map(([kind, g]) => {
      const items = hc.should.filter((p) => p.kind === kind);
      if (!items.length) return '';
      const job = A.jobs?.[g.fix];
      return `<div class="health-group"><div class="hg-head"><b>${items.length}</b><span>${g.title}</span>${g.fix && (!g.cloud || CLOUD) ? (job?.running ? `<span class="cue-hint job-progress" data-job="${g.fix}"><span class="notice-spinner" aria-hidden="true"></span> <span class="job-text">${esc(job.text)}</span></span><button type="button" class="btn small" data-op="job-stop" data-job="${g.fix}">עצירה</button>` : `<button type="button" class="btn small gold" data-op="${g.fix}">${g.fixLabel}</button>`) : ''}</div>
        <details><summary>הצגת הרשימה</summary><ul class="check-list">${items.slice(0, 120).map((p) => `<li><button type="button" class="link-btn" data-op="open" data-id="${esc(p.id)}">${esc(label(A.data.episodes.find((x) => x.id === p.id) || { title: p.text }))}</button></li>`).join('')}${items.length > 120 ? `<li>ועוד ${items.length - 120}…</li>` : ''}</ul></details></div>`;
    }).join('')}</div>
    <p class="cue-hint">אלה לא חוסמים פרסום — רק הצעות. תוכניות בלי הקלטה ובלי תמונה עדיין מופיעות באתר.</p>` : '<p class="help">✓ לכל התוכניות יש שם, תאריך, תיאור, הקלטה, אורך ותמונה, ואין כפילויות.</p>'}
    <div class="tool-list" style="margin-top:14px">
      ${checkRow('audio', 'בדיקת ההקלטות', 'עובר על כל ההקלטות ומוודא שהן נטענות בנגן.')}
      ${checkRow('media', 'בדיקת תמונות וקישורים', 'מוודא שכל התמונות נטענות ושהקישורים בדפי התוכניות עונים.')}
    </div>
  </div>
</div>

${proofCard()}

<div class="card">
  <div class="section-title"><div><p class="kicker">גיבוי אוטומטי</p><h2>גרסאות קודמות</h2></div><button type="button" class="btn small" data-op="versions" ${CLOUD ? '' : 'disabled'}>${A.versions ? 'רענון' : 'הצגת הגרסאות'}</button></div>
  <div class="card-body">
    <p class="help">כל פרסום נשמר אוטומטית כגרסה. אם משהו השתבש, בוחרים גרסה, לוחצים "שחזור" — והכול חוזר לטיוטה כפי שהיה. אחר כך לוחצים פרסום.${CLOUD ? ' הגיבוי המלא של שני האתרים יחד (הסקר והתוכניות) נמצא בניהול הסקר, בלשונית "ארכיון וגיבויים".' : ''}</p>
    ${!CLOUD ? '<p class="cue-hint">עובד רק כשהאתר מחובר לשרת.</p>' : A.versions === null ? '' : A.versions.length ? `${compareRow()}<div class="version-list">${A.versions.map((v, i) => `<div class="version"><div><b>${esc(when(v.createdAt))}${i === 0 ? ' <span class="pill gold">הגרסה שבאתר</span>' : ''}</b><small>${n2(v.episodes)} תוכניות${v.by ? ` · פורסם על ידי ${esc(v.by)}` : ''}</small></div>${A.versions[i + 1] ? `<button type="button" class="btn small" data-op="version-diff" data-from="${esc(A.versions[i + 1].id)}" data-to="${esc(v.id)}">מה השתנה בו</button>` : ''}<button type="button" class="btn small" data-op="restore-version" data-id="${esc(v.id)}">שחזור</button></div>`).join('')}</div>` : '<p class="help">עדיין אין גרסאות שמורות — הראשונה תישמר בפרסום הבא.</p>'}
  </div>
</div>

<details class="card more-details">
  <summary>כלים מתקדמים</summary>
  <div class="card-body tool-list">
    ${CLOUD ? `<div class="tool"><div><b>קישור לתצוגה מקדימה</b><small>שולחים למישהו קישור, והוא רואה את האתר עם הטיוטה — לפני שמפרסמים. הקישור עובד עד הפרסום הבא.</small><div id="preview-link"></div></div><button type="button" class="btn small" data-op="preview-link">יצירת קישור</button></div>` : ''}
    <div class="tool"><div><b>קובץ גיבוי</b><small>קובץ אחד עם כל התוכניות, העונות וההגדרות. כדאי לשמור עותק במחשב מדי פעם.</small></div><button type="button" class="btn small" data-op="backup">הורדת גיבוי</button></div>
    <div class="tool"><div><b>שחזור מקובץ גיבוי</b><small>מחליף את כל מה שכאן בתוכן של קובץ גיבוי ששמרתם בעבר. אחר כך לוחצים פרסום.</small></div><button type="button" class="btn small" data-op="restore">בחירת קובץ…</button></div>
    ${CLOUD ? '<div class="tool"><div><b>העברת ההקלטות לאתר</b><small>מעתיק את ההקלטות מהדרייב לאחסון של האתר, כדי שינוגנו מהר יותר ולא יהיו תלויות בדרייב. אפשר לעצור ולהמשיך אחר כך.</small></div><button type="button" class="btn small" data-op="migrate">פתיחה</button></div>' : ''}
    ${CLOUD ? `<div class="tool"><div><b>מי מנהל</b><small>מי שמופיע כאן יכול להיכנס לניהול — גם באתר הסקר. זו אותה רשימה.</small><div id="admins-box">${renderAdmins()}</div></div><button type="button" class="btn small" data-op="admins">${A.admins ? 'רענון' : 'הצגה'}</button></div>` : ''}
    <div class="tool"><div><b>החשבון</b><small>${u ? `מחוברים כ־${esc(u.email || u.name || '')}` : 'לא מחוברים'}</small></div>${u ? '<button type="button" class="btn small" data-op="logout">התנתקות</button>' : ''}</div>
  </div>
</details>`;
  }
  /* ---------- השוואת גרסאות: מה ההבדל בין שתי גרסאות (או בין גרסה לטיוטה) ---------- */
  function compareRow() {
    const vs = A.versions || [];
    const opt = (id, text, sel) => `<option value="${esc(id)}" ${sel ? 'selected' : ''}>${esc(text)}</option>`;
    const list = (sel) => vs.map((v, i) => opt(v.id, `${when(v.createdAt)}${i === 0 ? ' (באתר עכשיו)' : ''}`, v.id === sel)).join('') + opt('draft', 'הטיוטה שלכם עכשיו', sel === 'draft');
    const a = vs[1]?.id || vs[0]?.id, b = vs[1] ? vs[0].id : 'draft';
    return `<div class="compare-row"><span class="cue-hint">השוואה בין</span><label class="visually-hidden" for="cmp-from">הגרסה הישנה</label><select id="cmp-from" class="input small-select">${list(a)}</select><span class="cue-hint">לבין</span><label class="visually-hidden" for="cmp-to">הגרסה החדשה</label><select id="cmp-to" class="input small-select">${list(b)}</select><button type="button" class="btn small gold" data-op="compare">השוואה</button></div>`;
  }
  const versionTitle = (id) => (id === 'draft' ? 'הטיוטה שלכם' : (() => { const v = A.versions?.find((x) => x.id === id); return v ? when(v.createdAt) : 'גרסה'; })());
  async function compareVersions(fromId, toId) {
    if (fromId === toId) { U.notify('בחרו שתי גרסאות שונות.', 'info'); return; }
    const stop = U.notify('משווים…', 'progress');
    try {
      const dataOf = async (id) => (id === 'draft' ? A.data : (await versionData(id)).data);
      const items = diffData(await dataOf(fromId), await dataOf(toId));
      stop();
      let d = $('#dlg-compare');
      if (!d) {
        d = document.createElement('dialog'); d.id = 'dlg-compare'; d.className = 'sheet wide'; d.setAttribute('aria-labelledby', 'dlg-compare-title');
        document.body.appendChild(d);
        d.addEventListener('click', (ev) => {
          if (ev.target === d || ev.target.closest('[data-close]')) { d.close(); return; }
          const o = ev.target.closest('[data-open]'); if (o) { d.close(); A.bulk = false; select(o.dataset.open, { tab: 'programs' }); }
        });
      }
      d.innerHTML = `<div class="section-title"><div><p class="kicker">השוואת גרסאות</p><h2 id="dlg-compare-title">מה השתנה</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><p class="help"><b>${esc(versionTitle(fromId))}</b> ← <b>${esc(versionTitle(toId))}</b>${items.length ? ` · ${items.length === 1 ? 'שינוי אחד' : `${items.length} שינויים`}` : ''}</p>${items.length ? `<ul class="diff-list">${items.map((x) => `<li>${x.id && liveEp(x.id) ? `<button type="button" class="link-btn" data-open="${esc(x.id)}">${esc(x.head)}</button>` : `<b>${esc(x.head)}</b>`}${x.rows.length ? `<ul>${x.rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : '<p class="help">✓ אין הבדלים — שתי הגרסאות זהות.</p>'}</div>`;
      d.showModal();
    } catch (err) { stop(); U.notify(`ההשוואה לא הצליחה: ${err.message}`, 'error'); }
  }
  function renderAdmins() {
    if (!A.admins) return '';
    if (A.admins.error) return `<p class="problems" style="margin-top:8px">${esc(A.admins.error)}</p>`;
    return `<p class="cue-hint" style="margin:8px 0 0">אותה רשימה כמו בלשונית "הרשאות" באתר הסקר. התנתקות במקום אחד מנתקת משניהם.</p><ul class="admin-list">${A.admins.map((a) => `<li><span>${esc(a.email)}${a.you ? ' <span class="pill gold">אתם</span>' : ''}${a.fixed ? ' <span class="pill">קבוע</span>' : ''}${a.lastSeen ? `<small class="seen">נכנס לאחרונה: ${esc(when(a.lastSeen))}</small>` : ''}</span>${a.you || a.fixed ? '' : `<button type="button" class="icon-btn del" data-op="admin-del" data-email="${esc(a.email)}" aria-label="הסרה">✕</button>`}</li>`).join('')}</ul><form class="admin-add" data-admin-add><input type="email" required placeholder="כתובת Gmail של מנהל חדש" class="ltr"><button type="submit" class="btn small">הוספה</button></form>`;
  }

  /* ---------- בדיקות: הקלטות, תמונות וקישורים ---------- */

  async function runCheck(kind) {
    const items = kind === 'audio'
      ? A.data.episodes.filter((e) => U.streamUrl(e)).map((e) => ({ e, url: U.streamUrl(e), what: 'ההקלטה' }))
      : A.data.episodes.flatMap((e) => [...(e.cover ? [{ e, url: e.cover, what: 'התמונה', img: true }] : []), ...U.publicLinks(e).map((l) => ({ e, url: l.url, what: `הקישור "${l.label}"`, masc: true }))]);
    const r = A.checks[kind] = { running: true, total: items.length, done: 0, problems: [] };
    renderPublish();
    const probe = async (it) => {
      if (it.img) return new Promise((res) => { const im = new Image(); const t = setTimeout(() => res(false), 15000); im.onload = () => { clearTimeout(t); res(true); }; im.onerror = () => { clearTimeout(t); res(false); }; im.src = it.url; });
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(it.url, { method: kind === 'audio' ? 'GET' : 'HEAD', headers: kind === 'audio' ? { Range: 'bytes=0-1' } : {}, mode: kind === 'audio' ? 'cors' : 'no-cors', signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (res.type === 'opaque') return true;   // אתר אחר שלא מאפשר לבדוק — ענה, וזה מספיק
        return res.ok || res.status === 206;
      } catch { return false; }
    };
    let i = 0;
    // בזמן הבדיקה מתעדכן רק המונה בשורה שלה; התוצאות מוצגות בסוף
    const tick = () => { const el = A.tab === 'publish' && P.querySelector(`[data-check="${kind}"] small`); if (el) el.textContent = `בודקים… ${r.done}/${r.total}`; };
    const worker = async () => { while (i < items.length) { const it = items[i++]; const ok = await probe(it); if (!ok) r.problems.push({ id: it.e.id, text: `${it.what} של "${label(it.e)}" לא ${it.masc ? 'נטען' : 'נטענת'}` }); r.done++; tick(); } };
    await Promise.all([worker(), worker(), worker()]);
    r.running = false; if (A.tab === 'publish') renderPublish();
    U.notify(r.problems.length ? `הבדיקה הסתיימה: ${r.problems.length} בעיות.` : 'הבדיקה הסתיימה: הכול תקין.', r.problems.length ? 'info' : 'success');
  }

  /* ---------- גיבוי, שחזור, פרסום ---------- */

  function backupFile() {
    const text = S.admin.export(A.data);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = CLOUD ? `rosh-berosh-backup-${new Date().toISOString().slice(0, 10)}.json` : 'episodes.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (!CLOUD) { A.unsynced = false; paintStatus(); }   // בלי שרת, הקובץ שירד הוא השמירה
  }
  $('#file-restore').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    let raw; try { raw = JSON.parse(await f.text()); } catch { U.notify('זה לא קובץ גיבוי של האתר.', 'error'); return; }
    const errs = S.admin.validate(raw);
    if (errs.length) { U.notify(`הקובץ לא תקין: ${errs[0]}`, 'error'); return; }
    if (!confirm(`לשחזר ${raw.episodes.length} תוכניות מהקובץ? כל מה שיש כאן עכשיו יוחלף (עד הפרסום זה נראה רק לכם).`)) return;
    applyData(raw); U.notify('הגיבוי שוחזר. בדקו את האתר ואז לחצו פרסום.', 'success');
  });
  function applyData(raw) {
    A.data = S.admin.normalize(raw);
    if (!raw.settings && A.origin) A.data.settings = clone(A.origin.settings || S.admin.normSettings({}));
    A.selected = A.data.episodes.some((e) => e.id === A.selected) ? A.selected : null;
    A.picked.clear(); touch(); render();
  }

  async function publish(btn) {
    if (jobsBusy()) { U.notify('ממתינים לסיום העבודה — אחר כך אפשר לפרסם.', 'info'); return; }
    if (A.publishing) return;
    const hc = health();
    if (hc.must.length) { U.notify(hc.must[0].text, 'error'); setTab('publish'); return; }
    const errs = S.admin.validate(A.data);
    if (errs.length) { U.notify(errs[0], 'error'); return; }
    if (!CLOUD) { backupFile(); U.notify('הקובץ ירד. מסרו אותו למי שמתחזק את האתר.', 'success'); return; }
    if (btn) btn.disabled = true;
    const stop = U.notify('מפרסמים…', 'progress');
    const go = async (force) => {
      if (jobsBusy()) throw new Error('ממתינים לסיום העבודה.');
      A.publishing = true;
      try {
        // שמירה אוטומטית שמחכה או שכבר בדרך לא תתחרה בפרסום
        clearTimeout(A.syncTimer); A.syncTimer = null;
        await A.syncing;
        if (A.conflict) { showDraftConflict(); throw new Error('קודם בחרו מה לעשות עם הטיוטה החדשה שבשרת.'); }
        // מפרסמים תמונת מצב: מה שמשתנה בזמן הפרסום נשאר בטיוטה לפרסום הבא
        const snap = clone(A.data);
        const freshIds = newlyPublic().map((e) => e.id);   // לטיוטת המייל אחרי הפרסום
        const removedIds = A.origin ? A.origin.episodes.filter((o) => !snap.episodes.some((e) => e.id === o.id)).map((o) => o.id) : [];
        const r = await S.sb.push(snap, { removedIds, baseVersion: A.base ?? null, force, notify: A.notify });
        A.syncGen++; clearTimeout(A.syncTimer); A.syncTimer = null; A.syncState = '';
        A.origin = S.admin.normalize(snap); A.origin.versionId = r.versionId ?? null; A.base = A.origin.versionId;
        A.originError = false; A.versions = null; A.versionCache.clear();
        // הטיוטה המשותפת פורסמה — מוחקים אותה בשרת
        try { await S.sb.draft.clear(); A.draftAt = null; A.draftBy = ''; } catch { /* תוחלף בשמירה הבאה */ }
        A.unsynced = !sameData(A.data, snap);
        stop(); U.notify('פורסם! האתר מציג עכשיו את הגרסה החדשה.', 'success');
        paintStatus(); if (A.tab === 'publish') render();
        if (A.notify && r.notified) drainPush().then((n) => n && U.notify(n === 1 ? 'נשלחה התראה למכשיר אחד.' : `נשלחה התראה ל־${n} מכשירים.`, 'success'));
        // תוכנית חדשה עלתה: טיוטת מייל לרשימת התפוצה (החדשה ביותר מביניהן; אפשר להחליף בחלון)
        const fresh = A.data.episodes.filter((e) => freshIds.includes(e.id)).sort(byDate);
        if (A.mailAfter && fresh.length) openMail(fresh[0].id);
      } finally { A.publishing = false; if (A.unsynced) scheduleSync(); }
    };
    try { await go(false); }
    catch (err) {
      stop();
      if (err.conflict) {
        // מנהל אחר פרסם אחרי שהתחלתם לערוך — לא דורסים בלי לשאול
        const who = err.latest?.by ? ` (${err.latest.by}${err.latest.createdAt ? `, ${when(err.latest.createdAt)}` : ''})` : '';
        showConflict(who, async () => { const s2 = U.notify('מפרסמים…', 'progress'); try { await go(true); } catch (e2) { s2(); U.notify(`הפרסום לא הצליח: ${e2.message}`, 'error'); } });
      } else U.notify(`הפרסום לא הצליח: ${err.message}`, 'error');
    }
    finally { if (btn) btn.disabled = false; }
  }
  /** טיוטת מייל לרשימת התפוצה על תוכנית (החלון של mail-composer.js). "באתר" = כמו שמפורסם עכשיו. */
  function openMail(id) {
    window.RoshMailComposer.open({
      episodes: () => A.data.episodes,
      episodeId: id,
      isLive: (e) => { const o = A.origin?.episodes.find((x) => x.id === e.id); return !!o && o.visible && !S.scheduled(o); },
      contacts: () => A.data.settings?.contacts || {},
    });
  }
  /** ההתראות נשלחות במנות קטנות (מגבלת השרת); הדף ממשיך לשלוח עד שכולן יצאו */
  async function drainPush(sent = 0) {
    for (let i = 0; i < 500; i++) {
      let r; try { r = await S.sb.call('/api/program/push/drain', { method: 'POST' }); } catch { break; }
      sent += Number(r.sent) || 0;
      if (!Number(r.remaining)) break;
    }
    return sent;
  }
  /** מנהל אחר פרסם בינתיים: מציגים מה קרה ושתי דרכים — לראות את הגרסה החדשה, או לפרסם בכל זאת */
  function showConflict(who, force) {
    let d = $('#dlg-conflict');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'dlg-conflict'; d.className = 'sheet'; d.setAttribute('aria-labelledby', 'dlg-conflict-title');
      document.body.appendChild(d);
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    }
    d.innerHTML = `<div class="section-title"><div><p class="kicker">רגע לפני הפרסום</p><h2 id="dlg-conflict-title">מנהל אחר פרסם בינתיים</h2></div><button type="button" class="icon-btn" data-close aria-label="סגירה">✕</button></div>
<div class="card-body"><p class="help">מאז שהתחלתם לערוך, מישהו אחר פרסם גרסה חדשה לאתר${esc(who)}. אם תפרסמו עכשיו, השינויים שלו יימחקו ויוחלפו בטיוטה שלכם.</p>
<p class="help">מומלץ: לפתוח את "גרסאות קודמות" בחלק "פרסום", לראות מה השתנה, ולהעתיק לטיוטה רק את מה שצריך.</p></div>
<div class="card-foot"><button type="button" class="btn" data-close>ביטול — לא לפרסם</button><button type="button" class="btn danger" data-force>לפרסם בכל זאת ולדרוס</button></div>`;
    d.querySelector('[data-force]').addEventListener('click', () => { d.close(); force(); });
    d.showModal();
  }
  async function discard() {
    const other = A.draftBy && A.draftBy !== S.sb.user?.email ? A.draftBy : '';
    const msg = CLOUD
      ? `לבטל את כל השינויים שלא פורסמו ולחזור למה שמפורסם באתר?\n\nגם הטיוטה המשותפת בשרת תימחק — לכל המנהלים${other ? `, כולל השינויים ש־${other} שמר בה` : ''}.`
      : 'לבטל את כל השינויים שלא פורסמו ולחזור למה שמפורסם באתר?';
    if (!confirm(msg)) return;
    clearTimeout(A.syncTimer); A.syncTimer = null; A.syncGen++;
    await A.syncing;
    if (CLOUD) {
      try { await S.sb.draft.clear(); }
      catch (err) { U.notify(`הטיוטה בשרת לא נמחקה: ${err.message}`, 'error'); A.unsynced = true; scheduleSync(); return; }
    }
    A.unsynced = false; A.draftAt = null; A.draftBy = '';
    location.reload();
  }
  async function restoreVersion(id) {
    const v = A.versions?.find((x) => x.id === id);
    if (!confirm(`לשחזר את הגרסה מ־${v ? when(v.createdAt) : 'התאריך הזה'}? כל מה שבטיוטה יוחלף. אחר כך לוחצים פרסום.`)) return;
    const stop = U.notify('משחזרים…', 'progress');
    try { const { data } = await versionData(id); applyData(data); stop(); U.notify('הגרסה שוחזרה לטיוטה. בדקו ולחצו פרסום.', 'success'); }
    catch (err) { stop(); U.notify(err.message, 'error'); }
  }
  async function previewLink() {
    const box = $('#preview-link'); box.innerHTML = '<span class="cue-hint">מכינים…</span>';
    try {
      if (!await sync()) throw new Error('הטיוטה עוד לא נשמרה בשרת, ולכן הקישור היה מציג גרסה ישנה. נסו שוב בעוד רגע.');
      const { preview } = await S.sb.preview.create();
      const url = new URL(`index.html?preview=${preview.token}`, site.url || location.href).href;
      box.innerHTML = `<div class="preview-url"><input readonly value="${esc(url)}" class="ltr" aria-label="קישור"><button type="button" class="btn small gold" data-op="copy" data-text="${esc(url)}">העתקה</button><button type="button" class="btn small" data-op="preview-revoke">ביטול הקישור</button></div>`;
    } catch (err) { box.innerHTML = `<span class="problems">${esc(err.message)}</span>`; }
  }
  $('#btn-publish-top').addEventListener('click', () => { const ch = changes(); if (ch && !ch.any) { U.notify('הכול כבר מפורסם.', 'info'); return; } setTab('publish'); });
  /* בתוך דף הניהול המשותף, תפריט הצד של אתר הסקר בוחר את החלק */
  if (EMBED && CLOUD) {
    const parentOrigin = new URL(S.sb.cfg.apiBase).origin;
    window.addEventListener('message', (e) => { if (e.origin === parentOrigin && e.data?.type === 'rosh-admin-tab') setTab(e.data.tab, { push: false }); });
  }

  /* ---------- העברת ההקלטות ---------- */

  const dlgMigrate = $('#dlg-migrate');
  let stopMigration = false;
  function openMigrate() {
    const eps = A.data.episodes.filter((e) => U.driveId(e));
    const bytes = eps.reduce((n, e) => n + (e.sourceFileBytes || 0), 0);
    $('#migrate-summary').textContent = `${eps.length} הקלטות בדרייב${bytes ? `, בערך ${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB` : ''}`;
    $('#migrate-progress').max = Math.max(1, eps.length); $('#migrate-progress').value = 0; $('#migrate-errors').textContent = '';
    dlgMigrate.showModal();
  }
  $('#migrate-stop').addEventListener('click', () => { stopMigration = true; $('#migrate-stop').disabled = true; });
  $('#migrate-start').addEventListener('click', async () => {
    const start = $('#migrate-start'), stop = $('#migrate-stop'), status = $('#migrate-status'), progress = $('#migrate-progress'), errors = $('#migrate-errors');
    if (!await checkAccess()) { U.notify('צריך להיות מחוברים כמנהל.', 'error'); return; }
    const episodes = A.data.episodes.filter((e) => U.driveId(e));
    progress.max = Math.max(1, episodes.length); progress.value = 0; errors.textContent = '';
    start.disabled = true; stop.disabled = false; stopMigration = false;
    let uploaded = 0, existing = 0, failed = 0;
    for (let i = 0; i < episodes.length && !stopMigration; i++) {
      const e = episodes[i];
      status.innerHTML = `<b>${i + 1} מתוך ${episodes.length}: ${esc(label(e))}</b><span>מעתיקים לאתר…</span>`;
      try { const r = await S.sb.importDrive(e); r.status === 'existing' ? existing++ : uploaded++; }
      catch (err) { failed++; errors.insertAdjacentHTML('beforeend', `<div>✕ ${esc(label(e))}: ${esc(err.message)}</div>`); }
      progress.value = i + 1;
    }
    status.innerHTML = `<b>${stopMigration ? 'ההעברה נעצרה' : 'ההעברה הסתיימה'}</b><span>${uploaded} הועברו · ${existing} כבר היו באתר · ${failed} לא הצליחו</span>`;
    start.disabled = false; start.textContent = failed || stopMigration ? 'המשך / ניסיון חוזר' : 'בדיקה חוזרת'; stop.disabled = true;
    if (!failed && !stopMigration) U.notify('כל ההקלטות הועברו לאתר.', 'success');
  });

  /* ---------- המדריך ---------- */

  const dlgGuide = $('#dlg-guide');
  $('#btn-guide').addEventListener('click', () => dlgGuide.showModal());
  function maybeGuide() { try { if (!localStorage.getItem('rosh:admin:guided')) { dlgGuide.showModal(); localStorage.setItem('rosh:admin:guided', '1'); } } catch { /* */ } }

  /* ======================================================
     אירועים — האצלה אחת על כל הפאנל
     ====================================================== */

  const P = $('#panel');

  P.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'ep-q') { A.q = t.value; renderList(); return; }
    const e = cur();
    const { f, lf, sf, uf, zf } = t.dataset;
    if (f && e) {
      const v = t.value;
      switch (f) {
        case 'number': e.number = v === '' ? null : Number(v); break;
        case 'tags': e.tags = splitList(v); break;
        case 'guests': e.guests = splitList(v); break;
        case 'season': if (v === '__new') { newSeasonInline(t); return; } e.season = v; break;
        case 'audio': e.audio = v; e.duration = 0; break;
        case 'cover': e.cover = v; e.thumb = ''; break;   // קישור חדש — הגרסה הקטנה הישנה כבר לא מתאימה
        default: e[f] = v;
      }
      touch(); schedulePreview();
    } else if (lf && e) {
      const l = e.links[Number(t.dataset.i)]; if (!l) return;
      l[lf] = t.value; touch(); schedulePreview();
    } else if (sf) {
      const b = A.data.settings.banner || (A.data.settings.banner = {}); b[sf] = t.value; touch();
    } else if (t.dataset.bs) {
      const b = A.data.settings.banner || (A.data.settings.banner = {}); b.sites = { program: true, survey: false, ...(b.sites || {}) }; b.sites[t.dataset.bs] = t.checked; touch();
    } else if (uf) {
      const u = A.data.settings.updates[Number(t.dataset.i)]; if (!u) return; u[uf] = t.value; touch();
    } else if (t.dataset.cf) {
      const c = A.data.settings.contacts || (A.data.settings.contacts = S.admin.normSettings({}).contacts);
      c[t.dataset.cf] = t.value; touch();
    } else if (zf) {
      const s = A.data.seasons[Number(t.dataset.i)]; if (!s) return;
      s[zf] = zf === 'year' ? (t.value ? Number(t.value) : null) : t.value; touch();
    }
  });

  P.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'ep-filter') { A.filter = t.value; renderList(); return; }
    if (t.id === 'pub-notify') { A.notify = t.checked; return; }
    if (t.id === 'pub-mail') { A.mailAfter = t.checked; S.prefs.set('mailAfterPublish', t.checked); return; }
    if (t.id === 'stats-ep') { loadEpStats(t.value); return; }
    if (t.id === 'stats-min') { saveStatsConfig({ minMinutes: Number(t.value) }, `מעכשיו האזנה נספרת אחרי ${Number(t.value) === 1 ? 'דקה' : `${t.value} דקות`}.`); return; }
    if (t.dataset.sf === 'from' || t.dataset.sf === 'until') { renderSite(); return; }
    if (t.id === 'inbox-ep') { A.inboxEp = t.value; A.inboxPicked.clear(); paintInbox(); return; }
    if (t.dataset.inboxPick) { t.checked ? A.inboxPicked.add(t.dataset.inboxPick) : A.inboxPicked.delete(t.dataset.inboxPick); paintInboxCounts(); return; }
    if (t.dataset.op === 'bulk-season') {
      const v = t.value; if (!v) return;
      A.picked.forEach((id) => { const e = A.data.episodes.find((x) => x.id === id); if (e) e.season = v === '__none' ? '' : v; });
      touch(); renderList(); renderEditor(); U.notify(`${A.picked.size === 1 ? 'תוכנית אחת שויכה' : `${A.picked.size} תוכניות שויכו`}${v === '__none' ? ' ל"בלי עונה"' : ` לעונה "${A.data.seasons.find((s) => s.id === v)?.title || ''}"`}.`, 'success');
      return;
    }
    const e = cur(); if (!e) return;
    if (t.dataset.upload) {
      const file = t.files[0]; if (!file) return;
      t.disabled = true;
      if (!await uploadFile(e, t.dataset.upload, file)) { t.disabled = false; t.value = ''; }
      return;
    }
    if (t.dataset.f === 'audio' || t.dataset.f === 'cover' || t.dataset.f === 'publishAt') renderEditor();
  });

  /** העלאת קובץ לתוכנית — מכפתור הבחירה או מגרירה */
  async function uploadFile(e, kind, file) {
    try {
      uploadStatus(e, kind, 'מתחילים להעלות…');
      const progress = (pct) => uploadStatus(e, kind, `מעלים את ${file.name} — ${pct}%`);
      if (kind === 'cover') await setCover(e, file, progress);
      else {
        const url = await window.RoshUpload(file, e.id, kind, progress);
        const live = liveEp(e.id); if (!live) throw new Error('התוכנית נמחקה בזמן ההעלאה.');
        live[kind] = url; live.duration = 0;
      }
      touch();
      if (A.selected === e.id) renderEditor();
      U.notify('הקובץ הועלה. כשתלחצו פרסום, הוא יופיע באתר.', 'success');
      return true;
    } catch (err) { uploadStatus(e, kind, err.message); U.notify(err.message, 'error'); return false; }
  }
  /* גרירת קובץ לטופס התוכנית: הקלטה או תמונה — לפי סוג הקובץ. (כפתורי הבחירה נשארים.)
     קובץ שנגרר לדף אף פעם לא נפתח בדפדפן במקום הניהול (זה היה מוחק את מה שבזיכרון). */
  const fileKind = (f) => (/^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name) ? 'audio' : /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name) ? 'cover' : '');
  const hasFiles = (ev) => !!ev.dataTransfer?.types?.includes('Files');
  const canDrop = () => A.tab === 'programs' && !!cur();
  let dragDepth = 0;
  ['dragover', 'drop'].forEach((type) => window.addEventListener(type, (ev) => { if (hasFiles(ev)) ev.preventDefault(); }));
  P.addEventListener('dragenter', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); if (!canDrop()) return; dragDepth++; $('#editor')?.classList.add('drop-ready'); });
  P.addEventListener('dragleave', (ev) => { if (!hasFiles(ev)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#editor')?.classList.remove('drop-ready'); } });
  P.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });   // גם בלי תוכנית פתוחה — כדי להסביר מה לעשות
  P.addEventListener('drop', async (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault(); dragDepth = 0; $('#editor')?.classList.remove('drop-ready');
    const e = canDrop() ? cur() : null;
    if (!e) { U.notify('בחרו תוכנית לפני גרירת קובץ', 'info'); return; }
    for (const file of ev.dataTransfer.files) {
      const kind = fileKind(file);
      if (!kind) { U.notify(`"${file.name}" אינו קובץ שמע או תמונה.`, 'error'); continue; }
      await uploadFile(e, kind, file);
    }
  });

  P.addEventListener('submit', async (ev) => {
    const pf = ev.target.closest('[data-push-send]');
    if (pf) {
      ev.preventDefault();
      const title = pf.elements.title.value.trim(); if (!title) return;
      if (!confirm(`לשלוח את ההתראה "${title}" ל־${A.pushCount ?? 'כל'} המכשירים?`)) return;
      const btn = pf.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        const url = new URL(pf.elements.url.value || '', site.url || location.href).href;
        const stopN = U.notify('שולחים…', 'progress');
        const r = await S.sb.call('/api/program/push/send', { method: 'POST', body: { title, body: pf.elements.body.value.trim(), url } });
        const sent = Number(r.remaining) ? await drainPush(Number(r.sent) || 0) : Number(r.sent) || 0;
        stopN(); U.notify(sent === 1 ? 'נשלח למכשיר אחד.' : `נשלח ל־${sent} מכשירים.`, 'success'); pf.reset();
        if (r.removed) A.pushCount = Math.max(0, (A.pushCount || 0) - r.removed);
      } catch (err) { U.notify(`השליחה לא הצליחה: ${err.message}`, 'error'); }
      btn.disabled = false;
      return;
    }
    const f = ev.target.closest('[data-admin-add]'); if (!f) return;
    ev.preventDefault();
    const email = f.querySelector('input').value.trim(); if (!email) return;
    try { A.admins = (await S.sb.admins.add(email)).admins; $('#admins-box').innerHTML = renderAdmins(); U.notify(`${email} נוסף לרשימת המנהלים.`, 'success'); }
    catch (err) { U.notify(err.message, 'error'); }
  });

  P.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.ep-item[data-id]');
    if (item) {
      if (A.bulk) { A.picked.has(item.dataset.id) ? A.picked.delete(item.dataset.id) : A.picked.add(item.dataset.id); renderList(); }
      else select(item.dataset.id);
      return;
    }
    const b = ev.target.closest('[data-op]'); if (!b || b.tagName === 'SELECT') return;
    const op = b.dataset.op, i = Number(b.dataset.i), e = cur();
    switch (op) {
      // כללי
      case 'new': newEpisode(); break;
      case 'open': A.bulk = false; select(b.dataset.id, { tab: 'programs' }); break;
      case 'goto': setTab(b.dataset.tab); break;
      case 'filter': A.filter = b.dataset.filter; A.q = ''; A.bulk = false; renderPrograms(); $('#ep-list')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      case 'cmp-go': goToField(b.dataset.field); break;
      case 'copy': (await U.copy(b.dataset.text)) ? U.notify('הועתק.', 'success') : U.notify('ההעתקה לא הצליחה.', 'error'); break;
      // רשימה ובחירה מרובה
      case 'bulk': A.bulk = !A.bulk; A.picked.clear(); renderPrograms(); break;
      case 'pick-all': { const l = listFiltered(); if (A.picked.size === l.length && l.length) A.picked.clear(); else l.forEach((x) => A.picked.add(x.id)); renderList(); break; }
      case 'bulk-show': case 'bulk-hide': { const on = op === 'bulk-show'; A.picked.forEach((id) => { const x = A.data.episodes.find((y) => y.id === id); if (x) x.visible = on; }); touch(); renderList(); renderEditor(); const n = A.picked.size; U.notify(n === 1 ? `תוכנית אחת ${on ? 'תוצג באתר' : 'הוסתרה'}.` : `${n} תוכניות ${on ? 'יוצגו באתר' : 'הוסתרו'}.`, 'success'); break; }
      case 'bulk-del': if (confirm(A.picked.size === 1 ? 'למחוק תוכנית אחת?' : `למחוק ${A.picked.size} תוכניות?`)) removeMany([...A.picked]); break;
      // תוכנית
      case 'visible': if (e) { e.visible = !e.visible; touch(); renderEditor(); renderList(); } break;
      case 'featured': if (e) { const on = !e.featured; A.data.episodes.forEach((x) => { x.featured = on && x.id === e.id; }); touch(); renderEditor(); renderList(); U.notify(on ? 'התוכנית הזו תופיע בראש דף הבית.' : 'דף הבית יציג את התוכנית האחרונה.', 'info'); } break;
      case 'unschedule': if (e) { e.publishAt = ''; touch(); renderEditor(); renderList(); } break;
      case 'dup': if (e) duplicate(e); break;
      case 'del': if (e && confirm(`למחוק את "${label(e)}"?`)) removeMany([e.id]); break;
      case 'mail': if (e) openMail(e.id); break;
      case 'share': if (e) openShare(e); break;
      case 'publish-one': if (e) publishOne(e, b); break;
      case 'live': A.live = !A.live; renderEditor(); if (A.live) $('#live-pane')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      case 'live-size': A.liveSize = b.dataset.size; $$('[data-op="live-size"]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); fitLive(); break;
      case 'hear-at': { const au = $('#preview-audio'); if (au) { au.currentTime = Number(b.dataset.t) || 0; au.play().catch(() => {}); au.scrollIntoView({ block: 'center', behavior: 'smooth' }); } break; }
      case 'inbox-ep': if (e) { A.inboxEp = e.id; A.inboxFilter = 'all'; setTab('listeners'); } break;
      case 'history': if (e) openHistory(e); break;
      case 'cover-clear': if (e) { e.cover = ''; e.thumb = ''; touch(); renderEditor(); } break;
      case 'thumbs-all': thumbsAll(); break;
      case 'dates-screen': datesScreen(); break;
      case 'back-to-list': $('#ep-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); break;
      case 'proof-changed': runProofread('changed'); break;
      case 'inbox-filter': A.inboxFilter = b.dataset.inbox; A.inboxPicked.clear(); paintInbox(); break;
      case 'inbox-unpick': A.inboxPicked.clear(); paintInbox(); break;
      case 'inbox-bulk': inboxBulkDo(b.dataset.do); break;
      case 'reply-tpl': { const ta = P.querySelector(`[data-reply-for="${CSS.escape(b.dataset.id)}"]`); const r = replies()[i]; if (ta && r) { ta.value = ta.value.trim() ? `${ta.value.trim()} ${r}` : r; ta.focus(); } break; }
      case 'replies-save': { const lines = (P.querySelector('[data-replies]')?.value || '').split('\n').map((x) => x.trim()).filter(Boolean); try { if (lines.length) localStorage.setItem(REPLIES_KEY, JSON.stringify(lines.slice(0, 20))); else localStorage.removeItem(REPLIES_KEY); } catch { /* */ } paintInbox(); U.notify('התשובות המוכנות נשמרו.', 'success'); break; }
      case 'comment-status': {
        // אישור או הסתרה שומרים גם תשובה שהוקלדה ועוד לא נשמרה
        const c = A.comments?.comments?.find((x) => x.id === b.dataset.id);
        const ta = P.querySelector(`[data-reply-for="${CSS.escape(b.dataset.id)}"]`);
        const reply = ta ? ta.value.trim() : null;
        moderate(b.dataset.id, { status: b.dataset.st, ...(reply != null && reply !== (c?.reply || '') ? { reply } : {}) });
        break;
      }
      case 'comment-pin': { const c = A.comments?.comments?.find((x) => x.id === b.dataset.id); if (c) moderate(c.id, { pinned: !c.pinned, ...(c.pinned || c.status === 'approved' ? {} : { status: 'approved' }) }); break; }
      case 'comment-reply': { const ta = P.querySelector(`[data-reply-for="${CSS.escape(b.dataset.id)}"]`); if (await moderate(b.dataset.id, { reply: ta?.value.trim() || '' })) U.notify('התשובה נשמרה.', 'success'); break; }
      case 'comment-del': if (confirm('למחוק את התגובה לתמיד?')) { try { await deleteItem('com', b.dataset.id); repaintItem('com', b.dataset.id); } catch (err) { U.notify(err.message, 'error'); } } break;
      case 'proof-all': if (confirm('לבדוק את האיות של כל השמות והתיאורים באתר? זה לוקח כדקה.')) runProofread('all'); break;
      case 'proof-apply': { const r = A.proof?.results[i]; if (r && applyProof(r)) { touch(); U.notify('תוקן בטיוטה.', 'success'); } renderPublish(); break; }
      case 'proof-ignore': { const r = A.proof?.results[i]; if (r) r.ignored = true; renderPublish(); break; }
      case 'proof-apply-all': { let n = 0; for (const r of A.proof?.results || []) if (!r.applied && !r.ignored && applyProof(r)) n++; touch(); renderPublish(); U.notify(`${n} טקסטים תוקנו בטיוטה. בדקו ולחצו "פרסום".`, 'success'); break; }
      case 'proof-open': { const r = A.proof?.results[i]; const id = r?.key.split('|')[0]; if (id && A.data.episodes.some((x) => x.id === id)) { A.bulk = false; select(id, { tab: 'programs' }); } else setTab('site'); break; }
      case 'cover-auto': if (e) { b.disabled = true; try { await autoCover(e); U.notify('התמונה נוצרה. לא אהבתם? לחצו שוב לגרסה אחרת.', 'success'); } catch (err) { uploadStatus(e, 'auto', err.message); b.disabled = false; } } break;
      case 'link-add': if (e) { e.links.push({ label: '', url: '' }); touch(); $('#link-rows').innerHTML = renderLinks(e); $$('#link-rows input[data-lf="label"]').pop()?.focus(); } break;
      case 'link-del': if (e) { e.links.splice(i, 1); touch(); $('#link-rows').innerHTML = renderLinks(e); renderPreview(); } break;
      // עבודות על כל התוכניות
      case 'fill-durations': fillDurations(); break;
      case 'covers-all': if (confirm(`ליצור תמונה אוטומטית ל־${A.data.episodes.filter((x) => !x.cover).length} תוכניות בלי תמונה?`)) coversAll(); break;
      case 'ai-all': if (confirm('לתמלל ולכתוב תיאור וסיכום לכל התוכניות בלי תיאור אמיתי? זה לוקח כמה דקות לכל תוכנית, ואפשר לעצור באמצע.')) aiAll(); break;
      case 'job-stop': if (A.jobs[b.dataset.job]) A.jobs[b.dataset.job].stop = true; break;
      // AI לתוכנית אחת
      case 'ai-run': if (e) aiRun(e).catch(() => {}); break;
      case 'ai-titles': if (e) {
        const st = A.ai.get(e.id) || {}; A.ai.set(e.id, st); st.titlesBusy = true; st.error = ''; paintAi();
        try { const r = await S.sb.call('/api/program/ai/titles', { method: 'POST', body: { episodeId: e.id } }); st.titles = r.titles || []; st.whatsapp = r.whatsapp || ''; }
        catch (err) { st.error = err.status === 409 ? 'קודם צריך לתמלל את ההקלטה (הכפתור "תמלול ויצירת תיאור").' : err.message; }
        st.titlesBusy = false; paintAi();
      } break;
      case 'ai-title-use': if (e) { const t = A.ai.get(e.id)?.titles?.[i]; if (t) { e.title = t; touch(); renderEditor(); renderList(); U.notify('השם הוחלף. אפשר לערוך אותו בשדה "שם התוכנית".', 'success'); } } break;
      case 'ai-apply': if (e && A.ai.get(e.id)?.summary) { applySummary(e, A.ai.get(e.id).summary); touch(); renderEditor(); renderList(); U.notify('התיאור והסיכום נכנסו לתוכנית. בדקו, ואז "פרסום לאתר".', 'success'); } break;
      case 'ai-transcript': if (e) { const st = A.ai.get(e.id) || {}; A.ai.set(e.id, st); if (st.transcript != null) { st.transcript = null; paintAi(); break; } try { const r = await S.sb.call(`/api/program/ai/transcript/${encodeURIComponent(e.id)}`); st.transcript = r.text || ''; if (!st.summary && r.summary) st.summary = r.summary; } catch (err) { st.transcript = ''; st.error = err.status === 404 ? 'עדיין אין תמלול לתוכנית הזו.' : err.message; } paintAi(); } break;
      // האתר
      case 'banner-toggle': { const bn = A.data.settings.banner || (A.data.settings.banner = {}); bn.enabled = !bn.enabled; if (bn.enabled && !bn.text) { U.notify('כתבו קודם את ההודעה.', 'info'); bn.enabled = false; } touch(); renderSite(); break; }
      case 'update-add': A.data.settings.updates.unshift({ id: `u-${Date.now().toString(36)}`, date: new Date().toISOString().slice(0, 10), title: '', text: '', link: '', pinned: false }); touch(); $('#update-rows').innerHTML = renderUpdates(A.data.settings.updates); $('#update-rows input[data-uf="title"]')?.focus(); break;
      case 'update-pin': { const u = A.data.settings.updates[i]; if (u) { u.pinned = !u.pinned; touch(); $('#update-rows').innerHTML = renderUpdates(A.data.settings.updates); } break; }
      case 'update-del': if (confirm('למחוק את העדכון?')) { A.data.settings.updates.splice(i, 1); touch(); renderSite(); } break;
      case 'season-add': { const y = new Date().getFullYear(); A.data.seasons.push({ id: uniqueSeasonId(String(y)), title: `עונת ${y}`, year: y, note: '' }); touch(); $('#season-rows').innerHTML = renderSeasonRows(); $$('#season-rows input[data-zf="title"]').pop()?.select(); break; }
      case 'season-del': { const s = A.data.seasons[i]; if (!s) break; const n = A.data.episodes.filter((x) => x.season === s.id).length; if (!confirm(`למחוק את העונה "${s.title}"?${n ? ` ${n} תוכניות יישארו בלי עונה.` : ''}`)) break; A.data.episodes.forEach((x) => { if (x.season === s.id) x.season = ''; }); A.data.seasons.splice(i, 1); touch(); renderSite(); break; }
      // מאזינים
      case 'reload-listeners': A.stats = A.messages = null; renderListeners(); loadListeners(); break;
      case 'stats-all': A.statsAll = !A.statsAll; renderListeners(); break;
      case 'stats-since': {
        const v = $('#stats-since')?.value || '';
        if (!v) { U.notify('בחרו תאריך.', 'info'); break; }
        if (v === A.stats?.config?.since) { U.notify('זה כבר התאריך שממנו סופרים.', 'info'); break; }
        saveStatsConfig({ since: v }, `הספירה מתחילה עכשיו מ־${fmtDate(v)}.`);
        break;
      }
      case 'stats-reset':
        if (!confirm('לאפס את הספירה? כל המספרים (האזנות, האזנות מלאות והורדות) יתחילו מאפס מהיום.\nההאזנות הקודמות לא נמחקות — בחירת תאריך מוקדם יותר מחזירה אותן.')) break;
        saveStatsConfig({ reset: true }, 'הספירה אופסה — מהיום סופרים מחדש.');
        break;
      case 'msg-read': try { await readMessage(b.dataset.id, b.dataset.read === '1'); } catch (err) { U.notify(err.message, 'error'); } break;
      case 'msg-del': if (confirm('למחוק את ההודעה?')) { try { await deleteItem('msg', b.dataset.id); repaintItem('msg', b.dataset.id); } catch (err) { U.notify(err.message, 'error'); } } break;
      // פרסום
      case 'publish': publish(b); break;
      case 'discard': discard(); break;
      case 'reload': loadOrigin(); break;
      case 'check-audio': runCheck('audio'); break;
      case 'check-media': runCheck('media'); break;
      case 'versions': b.disabled = true; try { A.versions = (await S.sb.versions.list()).versions; } catch (err) { U.notify(err.message, 'error'); A.versions = []; } renderPublish(); break;
      case 'restore-version': restoreVersion(b.dataset.id); break;
      case 'version-diff': compareVersions(b.dataset.from, b.dataset.to); break;
      case 'compare': compareVersions($('#cmp-from').value, $('#cmp-to').value); break;
      case 'preview-link': previewLink(); break;
      case 'preview-revoke': try { await S.sb.preview.revoke(); $('#preview-link').innerHTML = '<span class="cue-hint">הקישור בוטל.</span>'; } catch (err) { U.notify(err.message, 'error'); } break;
      case 'backup': backupFile(); U.notify('קובץ הגיבוי ירד למחשב.', 'success'); break;
      case 'restore': $('#file-restore').click(); break;
      case 'migrate': openMigrate(); break;
      case 'admins': b.disabled = true; try { A.admins = (await S.sb.admins.list()).admins; } catch (err) { A.admins = { error: err.status === 404 ? 'השרת עדיין לא עודכן לגרסה שמנהלת מנהלים מכאן. בינתיים — בלשונית "הרשאות" באתר הסקר.' : err.message }; } renderPublish(); $('details.more-details').open = true; break;
      case 'admin-del': if (confirm(`להסיר את ${b.dataset.email} מרשימת המנהלים?`)) { try { A.admins = (await S.sb.admins.remove(b.dataset.email)).admins; $('#admins-box').innerHTML = renderAdmins(); } catch (err) { U.notify(err.message, 'error'); } } break;
      case 'logout': logout(); break;
    }
  });

  // האורך נקרא מהקובץ אוטומטית (אירועי מדיה לא מבעבעים — לכן capture)
  P.addEventListener('loadedmetadata', (ev) => {
    if (ev.target.id !== 'preview-audio') return;
    const e = cur(); if (e && !e.duration && isFinite(ev.target.duration)) { e.duration = Math.round(ev.target.duration); touch(); renderPreview(); }
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); sync(); U.notify(CLOUD ? 'הכול נשמר אוטומטית בטיוטה המשותפת. כשמסיימים — "פרסום לאתר".' : 'השינויים נשמרים רק בדף הזה. כשמסיימים — "הורדת הקובץ לפרסום".', 'info'); }
  });
  $$('dialog.sheet').forEach((d) => { d.querySelectorAll('[data-close]').forEach((x) => x.addEventListener('click', () => d.close())); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); });

  /* ---------- התחלה ---------- */

  const first = U.qs('ep');
  if (first) { const e = A.data.episodes.find((x) => x.id === first || x.slug === first); if (e) A.selected = e.id; }
  setTab(location.hash.slice(1) || 'programs', { push: false });
  paintStatus();
  if (S.state.authRedirect) U.notify(`התחברתם כ־${S.state.authRedirect.email}.`, 'success');
  if (S.state.handoffError) U.notify(S.state.handoffError, 'error');
  const allowed = await checkAccess();
  if (allowed || !CLOUD) { await loadOrigin(); if (allowed) { maybeGuide(); loadListeners(); } }
})();
