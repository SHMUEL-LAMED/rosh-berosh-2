/* שכבת הנתונים של ראש בראש.
   מקורות אפשריים (site.json → storage.provider):
     "json"     — קובץ data/episodes.json במאגר (ברירת מחדל, בלי שרת).
     "cloudflare" — אותו D1 של אתר הסקר; קריאה ציבורית וכתיבת מנהל.
   טיוטת הניהול נשמרת רק בשרת (/api/program/draft, לפי חשבון המנהל) — אף פעם
   לא בדפדפן. הדפים הציבוריים תמיד מציגים את מה שפורסם. */
(function () {
  'use strict';

  const LS = {
    sb: 'rosh:cf:session',          // סשן ההתחברות
    preview: 'rosh:preview',        // קישור תצוגה מקדימה (sessionStorage)
    sso: 'rosh:sso-checked',        // מתי נבדק לאחרונה אם מחוברים באתר הסקר
  };
  const SSO_TTL = 6 * 60 * 60 * 1000;

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* מצב פרטי */ } };

  const state = {
    site: null,
    data: { version: 1, seasons: [], episodes: [], settings: { banner: null, updates: [] } },
    source: 'json',
    error: null,
    loadedFrom: null,
    preview: null,   // טוקן תצוגה מקדימה כשצופים בטיוטה דרך קישור
    embed: false,    // הניהול מוטמע בתוך ניהול אתר הסקר
    handoffError: '',
  };

  /* ---------- נרמול ---------- */

  function normEpisode(e, i) {
    const tracks = Array.isArray(e.tracks) ? e.tracks : [];
    const ep = {
      id: String(e.id || e.slug || `ep-${i}`),
      slug: String(e.slug || e.id || `ep-${i}`),
      number: e.number == null || e.number === '' ? null : Number(e.number),
      season: e.season ? String(e.season) : '',
      title: String(e.title || ''),
      date: e.date ? String(e.date).slice(0, 10) : '',
      description: String(e.description || ''),
      cover: String(e.cover || ''),
      thumb: String(e.thumb || ''),   // גרסה קטנה של התמונה לכרטיסים
      audio: String(e.audio || ''),
      duration: Number(e.duration) || 0,
      sourceFileBytes: Number(e.sourceFileBytes) || 0,
      r2Key: String(e.r2Key || ''),
      audioSource: String(e.audioSource || ''),
      audioSize: Number(e.audioSize) || 0,
      audioMigratedAt: String(e.audioMigratedAt || ''),
      tags: Array.isArray(e.tags) ? e.tags.map(String).filter(Boolean) : [],
      guests: Array.isArray(e.guests) ? e.guests.map(String).filter(Boolean) : [],
      links: Array.isArray(e.links) ? e.links.filter((l) => l && l.url).map((l) => ({ label: String(l.label || l.url), url: String(l.url) })) : [],
      featured: !!e.featured,
      visible: e.visible !== false,
      // פרסום מתוזמן: התוכנית מוצגת לציבור רק מהמועד הזה (זמן מקומי, "2026-10-01T20:00")
      publishAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(e.publishAt || '')) ? String(e.publishAt).slice(0, 16) : '',
      // תוכנית מקושרת לסקר (מזהה הסקר באתר הסקר)
      surveyId: String(e.surveyId || ''),
      tracks: tracks
        .filter((t) => t && (t.title || t.artist))
        .map((t) => ({ at: Math.max(0, Number(t.at) || 0), title: String(t.title || ''), artist: String(t.artist || ''), note: String(t.note || '') }))
        .sort((a, b) => a.at - b.at),
    };
    // הכתובת שהנגן מנגן בפועל (קובץ ישיר או הזרמה ישירה מהדרייב). שדה מחושב —
    // לא נכנס ל־JSON שמתפרסם, ולכן מוגדר כלא־ניתן־למנייה.
    Object.defineProperty(ep, 'stream', { get() { return window.RoshUI?.streamUrl(this) || ''; }, enumerable: false, configurable: true });
    return ep;
  }

  function normalize(raw) {
    const seasons = (Array.isArray(raw?.seasons) ? raw.seasons : []).map((s, i) => ({
      id: String(s.id || `s${i + 1}`), title: String(s.title || `עונה ${i + 1}`), year: s.year ? Number(s.year) : null, note: String(s.note || ''),
    }));
    const episodes = (Array.isArray(raw?.episodes) ? raw.episodes : []).map(normEpisode);
    // עונות שמופיעות בתוכניות אך לא הוגדרו
    for (const e of episodes) {
      if (e.season && !seasons.find((s) => s.id === e.season)) seasons.push({ id: e.season, title: e.season, year: null, note: '' });
    }
    return { version: Number(raw?.version) || 1, updated: raw?.updated || '', seasons, episodes, settings: normSettings(raw?.settings) };
  }

  /** ההגדרות שמתפרסמות עם הקטלוג: ההודעה בדף הבית ודף העדכונים */
  function normSettings(raw) {
    const b = raw?.banner && typeof raw.banner === 'object' ? raw.banner : {};
    const sites = b.sites && typeof b.sites === 'object' ? b.sites : {};
    const banner = { enabled: !!b.enabled, text: String(b.text || ''), link: String(b.link || ''), linkLabel: String(b.linkLabel || ''), from: String(b.from || '').slice(0, 10), until: String(b.until || '').slice(0, 10), sites: { program: sites.program !== false, survey: sites.survey === true } };
    const sv = raw?.survey && typeof raw.survey === 'object' ? raw.survey : null;
    const survey = sv ? { id: String(sv.id || ''), name: String(sv.name || ''), open: !!sv.open, url: String(sv.url || '') } : null;
    const updates = (Array.isArray(raw?.updates) ? raw.updates : []).map((u, i) => ({
      id: String(u?.id || `u${i}`), date: String(u?.date || '').slice(0, 10), title: String(u?.title || ''), text: String(u?.text || ''), link: String(u?.link || ''), pinned: !!u?.pinned,
    })).filter((u) => u.title || u.text);
    // פרטי הקשר בדף הבית — נערכים בניהול; כשלא נשמרו, הערכים שהיו באתר מאז ומעולם
    const c = raw?.contacts && typeof raw.contacts === 'object' ? raw.contacts : {};
    const contacts = { ...CONTACT_DEFAULTS };
    for (const k of Object.keys(CONTACT_DEFAULTS)) if (typeof c[k] === 'string') contacts[k] = c[k].trim();
    return { banner, updates, survey, contacts, polls: normPolls(raw?.polls) };
  }

  /* ---------- סקרים: אותם כללים כמו בשרת (worker/program-polls.ts), כדי שהטיוטה והתצוגה המקדימה
     ייראו בדיוק כמו אחרי הפרסום. כאן לא מסננים — הניהול צריך גם טיוטות; הסינון בתצוגה (polls.js). */
  const POLL_ENUM = { layout: ['list', 'grid', 'cards'], optionShape: ['circle', 'square', 'rounded'], optionSize: ['s', 'm', 'l'], imageShape: ['wide', 'square', 'circle'], results: ['after', 'always', 'closed', 'admin'] };
  const POLL_DEFAULT = { layout: 'list', optionShape: 'circle', optionSize: 'm', imageShape: 'wide', results: 'after' };
  const pollKey = (v) => String(v ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  const httpsUrl = (v) => { const u = String(v ?? '').trim().slice(0, 600); return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; };
  const wall = (v) => { const t = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) ? t.slice(0, 16) : /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00` : ''; };
  const newKey = (n = 10) => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, n);
  function normPoll(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const seen = new Set();
    const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, 40).map((o) => {
      let id = pollKey(o?.id) || newKey(8);
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return { id, label: String(o?.label ?? '').slice(0, 120), sub: String(o?.sub ?? '').slice(0, 120), image: httpsUrl(o?.image) };
    });
    const show = raw.show && typeof raw.show === 'object' ? raw.show : {};
    const multi = raw.multi === true;
    const pickE = (k) => (POLL_ENUM[k].includes(raw[k]) ? raw[k] : POLL_DEFAULT[k]);
    const hue = Math.round(Number(raw.hue));
    const filled = options.filter((o) => o.label.trim());
    return {
      id: pollKey(raw.id) || newKey(12),
      enabled: raw.enabled === true,
      title: String(raw.title ?? '').slice(0, 120), question: String(raw.question ?? '').slice(0, 300), description: String(raw.description ?? '').slice(0, 1000),
      image: httpsUrl(raw.image), imageShape: pickE('imageShape'), hue: Number.isFinite(hue) ? ((hue % 360) + 360) % 360 : 42,
      layout: pickE('layout'), optionShape: pickE('optionShape'), optionSize: pickE('optionSize'),
      multi, maxChoices: multi ? Math.max(1, Math.min(filled.length || 1, Math.round(Number(raw.maxChoices)) || filled.length || 1)) : 1,
      allowChange: raw.allowChange !== false, results: pickE('results'),
      from: wall(raw.from), until: wall(raw.until),
      thanks: String(raw.thanks ?? '').slice(0, 200), buttonLabel: String(raw.buttonLabel ?? '').slice(0, 40),
      show: { home: show.home === true, archive: show.archive === true, me: show.me === true, allEpisodes: show.allEpisodes === true, episodes: [...new Set((Array.isArray(show.episodes) ? show.episodes : []).map(String).filter(Boolean))].slice(0, 300) },
      options,
      createdAt: String(raw.createdAt || new Date().toISOString()).slice(0, 25),
    };
  }
  function normPolls(raw) {
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).slice(0, 50).map(normPoll).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  }
  const CONTACT_DEFAULTS = {
    phone: '077-226-2271', phone2: '073-707-9536', email: 'rbr17011701@gmail.com',
    phoneNote: 'האזנה לתוכניות בשלוחה 1, שירים מומלצים בשלוחה 3 והרשמה לצינתוק בשלוחה 4.',
    hostsNote: 'לשאלות ולתגובות למגישים: שלוחה 9 בקו התוכן. פורום המאזינים נמצא בשלוחה 5.',
    chatNote: 'בבקשה ציינו לאיזו קבוצה להצטרף — גברים או נשים.',
  };
  /* ---------- שעון ישראל ----------
     התאריכים באתר (תאריך שידור, "הודעה עד", פרסום מתוזמן) הם לפי שעון ישראל,
     גם כשהגולש בחו"ל וגם בין חצות לשלוש, כשהשעון העולמי עוד ב"אתמול". */
  const ilParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  /** "2026-09-22T23:45" — הזמן עכשיו בישראל */
  function nowIL(at = new Date()) {
    const p = Object.fromEntries(ilParts.formatToParts(at).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  /** "2026-09-22" — התאריך היום בישראל */
  const todayIL = (at) => nowIL(at).slice(0, 10);

  /** ההודעה בדף הבית פעילה? (מסומנת, יש טקסט, הגיע יום ההתחלה, התאריך לא עבר, ומיועדת לאתר הזה) */
  function bannerActive(banner = state.data.settings?.banner) {
    if (!banner?.enabled || !banner.text || banner.sites?.program === false) return false;
    const today = todayIL();
    return (!banner.from || banner.from <= today) && (!banner.until || banner.until >= today);
  }
  /** תוכנית מתוזמנת שעדיין לא הגיע זמנה (המועד נקבע בשעון ישראל) */
  function scheduled(e, now = new Date()) {
    return !!e.publishAt && e.publishAt > nowIL(now);
  }

  /* ---------- Cloudflare: אותו D1 ואותו אימות Google של אתר הסקר ---------- */

  /** מאיפה הגיע הביקור הזה (לסטטיסטיקה, בלי שום פרט מזהה): מייל, וואטסאפ, גוגל, פייסבוק, ישיר או אחר */
  function visitSource() {
    try {
      const saved = sessionStorage.getItem('rosh:ref'); if (saved) return saved;
      const utm = new URLSearchParams(location.search).get('utm_source') || '';
      const ref = document.referrer ? new URL(document.referrer) : null;
      const host = ref?.hostname || '';
      const src = /^(e-?mail|newsletter)$/i.test(utm) ? 'email'
        : /whatsapp/i.test(utm) || /whatsapp|wa\.me/.test(host) ? 'whatsapp'
        : /google\./.test(host) || /google/i.test(utm) ? 'google'
        : /facebook|fb\.|instagram/.test(host) || /facebook/i.test(utm) ? 'facebook'
        : !ref ? 'direct'
        : ref.origin === location.origin || /workers\.dev$/.test(host) ? 'internal' : 'other';
      sessionStorage.setItem('rosh:ref', src);
      return src;
    } catch { return 'other'; }
  }

  const sb = {
    get cfg() { return state.site?.storage?.cloudflare || null; },
    get configured() { return !!this.cfg?.apiBase; },
    // כשהניהול מוטמע בתוך אתר הסקר, אחסון הדפדפן עלול להיות חסום — הסשן נשמר גם בזיכרון
    _mem: null,
    get session() { return read(LS.sb, null) ?? this._mem; },
    set session(v) { this._mem = v; write(LS.sb, v); },
    get user() { return this.session?.user || null; },
    base(path) { return `${this.cfg.apiBase.replace(/\/$/, '')}${path}`; },
    headers(auth = true) {
      const h = { 'Content-Type': 'application/json' };
      if (auth && this.session?.token) h.Authorization = `Bearer ${this.session.token}`;
      return h;
    },
    /* כניסה: חלון קטן בכתובת אתר הסקר. כל אחד יכול להתחבר עם Google ולקבל
       אזור אישי; מי שמופיע ברשימת המנהלים של אתר הסקר מקבל גם גישה לניהול
       (user.isAdmin). מי שכבר מחובר שם נכנס מיד, בלי כניסה נוספת. */
    async signIn() {
      const origin = new URL(this.cfg.apiBase).origin;
      const popup = window.open(this.base('/api/program/login'), 'rosh-program-login', 'popup,width=460,height=620');
      if (!popup) throw new Error('הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים ונסו שוב.');
      return new Promise((resolve, reject) => {
        const finish = (settle) => { clearTimeout(timer); clearInterval(watch); window.removeEventListener('message', receive); settle(); };
        const timer = setTimeout(() => finish(() => reject(new Error('ההתחברות ארכה יותר מדי. נסו שוב.'))), 120000);
        const watch = setInterval(() => { if (popup.closed) finish(() => reject(new Error('חלון ההתחברות נסגר לפני שההתחברות הושלמה.'))); }, 500);
        const receive = (event) => {
          if (event.origin !== origin || event.data?.type !== 'rosh-program-auth') return;
          if (!event.data.token || !event.data.user) return finish(() => reject(new Error('ההתחברות לא הושלמה. נסו שוב.')));
          this.session = { token:event.data.token, user:{ ...event.data.user, isAdmin: !!event.data.user.isAdmin } };
          signedIn().catch(() => {}).then(() => finish(() => resolve(this.user)));
        };
        window.addEventListener('message', receive);
      });
    },
    async refresh() { return this.session; },
    /** אחרי כניסה כאן: מעבר רגעי דרך אתר הסקר כדי שגם שם יהיו מחוברים. מחזיר true כשהדף עובר. */
    async shareLogin() {
      if (!this.configured || state.embed || !this.session?.token) return false;
      try {
        const { code } = await this.call('/api/program/handoff', { method: 'POST', body: {} });
        write(LS.sso, Date.now());
        location.href = `${this.base(`/api/program/handoff/${code}`)}?return=${encodeURIComponent(location.href)}`;
        return true;
      } catch { return false; }
    },
    /** התנתקות מכל המקומות: גם הסשן של אתר הסקר לאותו חשבון נמחק בשרת.
        after: הבטחה שההתנתקות בשרת מחכה לה (השמירה האחרונה של הנתונים האישיים). */
    signOut(after) {
      const token = this.session?.token;
      this.session = null;
      write(LS.sso, Date.now());
      if (token && this.configured) Promise.resolve(after).catch(() => {}).then(() => fetch(this.base('/api/program/logout'), { method:'POST', headers:{ Authorization:`Bearer ${token}` } })).catch(() => {});
    },
    /* כניסה אחת לשני האתרים: קוד חד־פעמי שעובר בין אתר התוכניות לאתר הסקר */
    handoff: {
      create: () => sb.call('/api/program/handoff', { method:'POST', body:{} }),
      redeem: (code) => sb.call('/api/program/auth/handoff', { method:'POST', body:{ code }, auth:false }),
      /** כתובת המעבר לניהול אתר הסקר, כבר מחוברים */
      async toSurvey() { const { code } = await sb.handoff.create(); return `${new URL(sb.cfg.apiBase).origin}/api/program/handoff/${code}`; },
    },
    surveys: () => sb.call('/api/program/surveys'),
    /** טוען את הספרייה של Google (כפתור הכניסה, והרשאות כמו יצירת טיוטות בג'ימייל) */
    async loadGoogle() {
      if (window.google?.accounts?.id) return window.google;
      await new Promise((resolve, reject) => {
        const failed = () => reject(new Error('כפתור Google לא נטען. בדקו את החיבור ונסו שוב.'));
        const existing = document.querySelector('script[data-gsi]');
        if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', failed); if (window.google?.accounts?.id) resolve(); return; }
        const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true; sc.dataset.gsi = '1';
        // סקריפט שנכשל יוצא מהדף: הניסיון הבא (למשל אחרי מעבר לדף אחר) טוען אותו מחדש,
        // במקום לחכות לאירוע טעינה שכבר עבר ולהשאיר את הכפתור ריק
        sc.onload = resolve; sc.onerror = () => { sc.remove(); failed(); };
        document.head.appendChild(sc);
      });
      if (!window.google?.accounts?.id) throw new Error('כפתור Google לא נטען.');
      return window.google;
    },
    /* כניסה ישירה עם Google מתוך האתר (בלי דף ביניים): כפתור Google נטען
       לתוך אלמנט, והאישור נשלח ל־Worker שמחזיר סשן. */
    async google(el, { onDone, onError } = {}) {
      const clientId = this.cfg?.googleClientId;
      if (!clientId || !el) throw new Error('כניסה עם Google אינה מוגדרת באתר הזה.');
      await this.loadGoogle();
      window.google.accounts.id.initialize({
        client_id: clientId, ux_mode: 'popup', auto_select: false, itp_support: true,
        callback: async ({ credential }) => {
          try {
            let r;
            try { r = await fetch(this.base('/api/program/auth/google'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) }); }
            catch { throw new Error('אין חיבור לשרת כרגע. נסו שוב.'); }
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j.token) throw new Error(j.error || 'ההתחברות לא הצליחה.');
            this.session = { token: j.token, user: { ...j.user, isAdmin: !!j.user?.isAdmin } };
            // כניסה אחת: מחברים מיד גם את אתר הסקר, והדף חוזר לכאן
            await me.load(); await me.save(true);
            // הטוקן נדחה בינתיים והסשן נמחק: לא מודיעים "התחברתם" על כניסה שלא נשמרה
            if (!this.session?.token) throw new Error('ההתחברות לא נשמרה. נסו שוב בעוד רגע.');
            if (await this.shareLogin()) return;
            await signedIn();
            onDone?.(this.user);
          } catch (err) { onError?.(err); }
        },
      });
      el.innerHTML = '';
      window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: 'he', width: 280 });
    },
    /* קריאות לכלי הניהול ולשירותים של האתר */
    async call(path, { method = 'GET', body, auth = true } = {}) {
      const r = await fetch(this.base(path), { method, headers: this.headers(auth), body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const err = new Error(j.error || `השרת החזיר שגיאה (${r.status}).`); err.status = r.status; throw err; }
      return j;
    },
    /** אירוע האזנה לסטטיסטיקה (ציבורי; בלי preflight, בלי המתנה) */
    event(kind, episodeId, seconds = 0, extra = {}, { beacon = false } = {}) {
      if (!this.configured || state.preview || state.live) return;
      const device = matchMedia('(pointer: coarse)').matches ? 'phone' : 'desktop';
      const body = JSON.stringify({ kind, episodeId, seconds, device, ref: visitSource(), ...extra });
      // בסגירת הדף sendBeacon אמין יותר (הדפדפן שולח גם אחרי שהדף נסגר)
      if (beacon && navigator.sendBeacon) { try { if (navigator.sendBeacon(this.base('/api/program/events'), new Blob([body], { type: 'text/plain' }))) return; } catch { /* */ } }
      try { fetch(this.base('/api/program/events'), { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body }).catch(() => {}); } catch { /* */ }
    },
    /* הטיוטה המשותפת של המנהלים — רק בשרת. ifUpdatedAt = מתי נשמרה הטיוטה שהדף מכיר;
       אם מישהו שמר אחריה, השרת מחזיר 409 ולא דורס (err.conflict, err.draft = הטיוטה החדשה). */
    draft: {
      get: () => sb.call('/api/program/draft'),
      async put(data, ifUpdatedAt) {
        const body = ifUpdatedAt == null ? { data } : { data, ifUpdatedAt };
        const r = await fetch(sb.base('/api/program/draft'), { method: 'PUT', headers: sb.headers(), body: JSON.stringify(body), cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const conflict = r.status === 409 || j.error === 'draft-conflict';
          const err = new Error(conflict ? 'מנהל אחר שמר טיוטה חדשה יותר.' : j.error || `שמירת הטיוטה נכשלה (${r.status}).`);
          err.status = r.status; err.conflict = conflict; err.draft = j.draft || null;
          throw err;
        }
        return j;
      },
      /** בסגירת הדף: בקשה שממשיכה גם אחרי שהדף נסגר. keepalive מוגבל ל־64KB, ולכן
          מחזיר false כשהטיוטה גדולה מדי (או כשהדפדפן לא מאפשר) — ואז הדף מבקש לא לסגור. */
      putKeepalive(data, ifUpdatedAt) {
        try {
          const body = JSON.stringify(ifUpdatedAt == null ? { data } : { data, ifUpdatedAt });
          if (new Blob([body]).size > 60000) return false;
          fetch(sb.base('/api/program/draft'), { method: 'PUT', headers: sb.headers(), body, keepalive: true }).catch(() => {});
          return true;
        } catch { return false; }
      },
      clear: () => sb.call('/api/program/draft', { method: 'DELETE' }),
    },
    preview: {
      get: () => sb.call('/api/program/preview'),
      create: () => sb.call('/api/program/preview', { method: 'POST' }),
      revoke: () => sb.call('/api/program/preview', { method: 'DELETE' }),
      open: (token) => sb.call(`/api/program/preview/${encodeURIComponent(token)}`, { auth: false }),
    },
    versions: {
      list: () => sb.call('/api/program/versions'),
      get: (id) => sb.call(`/api/program/versions/${encodeURIComponent(id)}`),
    },
    stats: () => sb.call('/api/program/stats'),
    polls: {
      /** מצב הסקרים: פתוח/סגור, מה בחרתי, ותוצאות (כשמותר לראות) */
      status: (ids) => sb.call(`/api/program/polls?ids=${encodeURIComponent(ids.join(','))}`),
      vote: (pollId, choices) => sb.call('/api/program/polls/vote', { method: 'POST', body: { pollId, choices } }),
      reset: (pollId) => sb.call('/api/program/polls/reset', { method: 'POST', body: { pollId } }),
    },
    messages: {
      list: () => sb.call('/api/program/messages'),
      send: (body) => sb.call('/api/program/messages', { method: 'POST', body }),
      read: (id, read = true) => sb.call('/api/program/messages/read', { method: 'POST', body: { id, read } }),
      remove: (id) => sb.call('/api/program/messages', { method: 'DELETE', body: { id } }),
    },
    admins: {
      list: () => sb.call('/api/program/admins'),
      add: (email) => sb.call('/api/program/admins', { method: 'POST', body: { email } }),
      remove: (email) => sb.call('/api/program/admins', { method: 'DELETE', body: { email } }),
    },
    subscribe: {
      status: () => sb.call('/api/program/subscribe'),
      join: () => sb.call('/api/program/subscribe', { method: 'POST' }),
      leave: () => sb.call('/api/program/subscribe', { method: 'DELETE' }),
      count: () => sb.call('/api/program/subscribers/count'),
      /** כל הכתובות הפעילות ברשימה (למנהלים; לטיוטת המייל על תוכנית חדשה) */
      list: () => sb.call('/api/program/subscribers'),
      /** הוספת כתובות לרשימה (טקסט: שורה לכל כתובת, אפשר עם שם). מי שהסיר את עצמו בעבר לא חוזר. */
      add: (content) => sb.call('/api/program/subscribers', { method: 'POST', body: { content } }),
    },
    /** מרענן את פרטי המשתמש מהשרת; מחזיר true רק למנהל. סשן שפג נמחק. */
    async isAdmin() {
      if (!this.session?.token) return false;
      const r = await fetch(this.base('/api/program/me'), { headers:this.headers() });
      if (!r.ok) { if (r.status === 401) this.session = null; return false; }
      const j = await r.json();
      if (j.user) this.session = { ...this.session, user:{ ...this.session.user, ...j.user, isAdmin: !!j.user.isAdmin } };
      return !!j.user?.isAdmin;
    },
    /** הקטלוג מהשרת. timeout (במילישניות): שרת איטי (למשל מיד אחרי פריסה) לא משאיר
        את הדף ריק — הבקשה נכשלת, והטעינה נופלת לעותק השמור באתר. */
    async pull(auth = false, { timeout = 0 } = {}) {
      const c = timeout ? new AbortController() : null;
      const t = c ? setTimeout(() => c.abort(), timeout) : 0;
      try {
        const r = await fetch(this.base('/api/program/catalog'), { headers:this.headers(auth), cache:'no-store', signal:c?.signal });
        if (!r.ok) throw new Error(`Cloudflare: ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    },
    /** פרסום. baseVersion = הגרסה שהייתה באתר כשהתחלנו לערוך; אם מנהל אחר פרסם
        בינתיים, השרת מחזיר 409 (err.conflict) ולא דורס — אלא אם force. */
    async push(data, { removedIds = [], baseVersion, force = false, notify = false } = {}) {
      if (!await this.isAdmin()) throw new Error('צריך להתחבר עם חשבון מנהל כדי לפרסם.');
      const payload = { seasons:data.seasons, episodes:data.episodes, removedIds, settings:data.settings || {}, notify, force };
      if (baseVersion !== undefined) payload.baseVersion = baseVersion;
      const r = await fetch(this.base('/api/program/catalog'), { method:'POST', headers:this.headers(), body:JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const err = new Error(j.error || `שמירת התוכניות נכשלה (${r.status}).`); err.status = r.status; err.conflict = !!j.conflict; err.latest = j.latest || null; throw err; }
      return j;
    },
    async importDrive(episode) {
      if (!await this.isAdmin()) throw new Error('צריך להתחבר עם חשבון מנהל כדי להעביר הקלטות.');
      const driveId = window.RoshUI?.driveId(episode);
      if (!driveId) throw new Error('לא נמצא מזהה קובץ בדרייב.');
      const r = await fetch(this.base('/api/program/import-drive'), {
        method:'POST', headers:this.headers(), body:JSON.stringify({
          episodeId:episode.id, driveId, expectedSize:Number(episode.sourceFileBytes) || 0,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `העברת ההקלטה נכשלה (${r.status}).`);
      return j;
    },
  };

  /* ---------- טעינה ---------- */

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }

  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });

  /** צריך לבדוק באתר הסקר אם כבר מחוברים שם? רק באזור האישי ובניהול, בלי
      סשן כאן, ולא יותר מפעם בכמה שעות (ופעם בכל ביקור). בשאר הדפים לא בודקים
      בכלל — כדי שהטעינה הראשונה תהיה מיידית, בלי מעבר לאתר הסקר וחזרה. */
  async function needsSso(params) {
    if (!sb.configured || sb.session?.token || state.embed || params.has('preview')) return false;
    if (!/(?:me|admin|mail)\.html$/.test(location.pathname)) return false;
    let here = false; try { here = location.origin === new URL(state.site.url).origin || !!localStorage.getItem('rosh:sso-test'); } catch { /* */ }
    if (!here || /bot|crawl|spider|preview/i.test(navigator.userAgent || '')) return false;
    const last = Number(read(LS.sso, 0)) || 0;
    let fresh = Date.now() - last < SSO_TTL;
    try { fresh = fresh && !!sessionStorage.getItem('rosh:sso-visit'); sessionStorage.setItem('rosh:sso-visit', '1'); } catch { /* */ }
    if (fresh) return false;
    // השרת זמין? (אחרת לא שולחים את הדפדפן לדף שגיאה)
    try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2000); const r = await fetch(sb.base('/api/program/banner'), { signal: c.signal, cache: 'no-store' }); clearTimeout(t); return r.ok; } catch { return false; }
  }

  // כמה זמן הדף מחכה לקטלוג מהשרת לפני שהוא מציג את העותק השמור באתר
  const CATALOG_TIMEOUT = 8000;

  async function load() {
    state.error = null;
    try { state.site = await fetchJSON('data/site.json'); }
    catch (e) { state.site = { name: 'ראש בראש', tagline: 'מוזיקה ואקטואליה', storage: { provider: 'json' } }; }
    state.source = state.site.storage?.provider === 'cloudflare' && sb.configured ? 'cloudflare' : 'json';

    // תצוגה חיה מתוך הניהול: הדף נטען ב־iframe של דף הניהול (אותו אתר) ומציג את הטיוטה
    // שבזיכרון של הניהול — בלי שרת, בלי סטטיסטיקה ובלי נתונים אישיים
    try {
      if (new URLSearchParams(location.search).has('live') && window.parent !== window && typeof window.parent.RoshAdminLive === 'function') {
        state.data = normalize(window.parent.RoshAdminLive());
        state.live = true; state.loadedFrom = 'live';
        me.loaded = true;
        readyResolve(state);
        return state;
      }
    } catch { /* לא בתוך הניהול */ }

    // הגעה מניהול אתר הסקר: קוד מעבר חד־פעמי הופך לסשן כאן, בלי כניסה נוספת
    try {
      const params = new URLSearchParams(location.search);
      state.embed = params.get('embed') === '1';
      const code = params.get('handoff');
      if (code) {
        if (sb.configured) {
          try { const j = await sb.handoff.redeem(code); sb.session = { token:j.token, user:{ ...j.user, isAdmin: !!j.user?.isAdmin } }; state.authRedirect = j.user; }
          catch (e) { state.handoffError = e.message; }
        }
        params.delete('handoff');
        window.history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
      }
      // חזרה מבדיקת הכניסה באתר הסקר: קוד → מחוברים גם כאן; none → לא מחוברים שם
      const sso = params.get('sso');
      if (sso != null) {
        write(LS.sso, Date.now());
        if (sso !== 'none' && sb.configured && !sb.session?.token) {
          try { const j = await sb.handoff.redeem(sso); sb.session = { token:j.token, user:{ ...j.user, isAdmin: !!j.user?.isAdmin } }; } catch { /* הקוד פג */ }
        }
        params.delete('sso');
        window.history.replaceState(null, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
      } else if (await needsSso(params)) {
        write(LS.sso, Date.now());
        location.replace(`${sb.base('/api/program/sso')}?return=${encodeURIComponent(location.href)}`);
        return new Promise(() => {});   // הדף עובר; לא ממשיכים לטעון
      }
    } catch { /* */ }
    // מחוברים כאן? מוודאים מול השרת ברקע (התנתקות באתר הסקר מנתקת גם כאן),
    // בלי לעכב את הדף: הכותרת מתעדכנת כשהתשובה מגיעה.
    const verify = sb.configured && sb.session?.token
      ? sb.isAdmin().catch(() => {}).then(() => { if (!sb.session?.token) me.reset(); sessionChanged(); })
      : Promise.resolve();
    state.verified = verify;
    // הנתונים האישיים נטענים מהחשבון במקביל לקטלוג (לכל היותר 2.5 שניות המתנה)
    const personal = Promise.race([me.load(), new Promise((r) => setTimeout(r, 2500))]);
    // תצוגה מקדימה של הטיוטה דרך קישור (?preview=טוקן) — נשמר לכל הביקור
    try {
      const fromUrl = new URLSearchParams(location.search).get('preview');
      if (fromUrl != null) { if (fromUrl) sessionStorage.setItem(LS.preview, fromUrl); else sessionStorage.removeItem(LS.preview); }
      state.preview = sessionStorage.getItem(LS.preview) || null;
    } catch { state.preview = null; }

    // תמיד מה שפורסם (או תצוגה מקדימה בקישור). טיוטת הניהול נטענת מהשרת בדף הניהול עצמו.
    if (state.preview && state.source === 'cloudflare') {
      try { state.data = normalize((await sb.preview.open(state.preview)).data); state.loadedFrom = 'preview'; }
      catch (e) { state.error = e; state.preview = null; try { sessionStorage.removeItem(LS.preview); } catch { /* */ } state.data = normalize(await sb.pull(false, { timeout: CATALOG_TIMEOUT }).catch(() => ({}))); state.loadedFrom = state.source; }
    } else {
      try {
        const raw = state.source === 'cloudflare' ? await sb.pull(false, { timeout: CATALOG_TIMEOUT }) : await fetchJSON('data/episodes.json');
        const remote = normalize(raw);
        // חיבור חדש ל־D1 מחזיר קטלוג תקין אך ריק. במקרה כזה מציגים מיד את
        // הקטלוג המלא שנבנה מתיקיית הדרייב של התוכנית, במקום אתר ריק. מנהל
        // יכול לפרסם את אותה רשימה ל־D1 בלחיצה אחת מאזור הניהול.
        if (state.source === 'cloudflare' && remote.episodes.length === 0) {
          state.data = normalize(await fetchJSON('data/episodes.json'));
          state.loadedFrom = 'json-empty-cloudflare';
        } else {
          state.data = remote;
          state.loadedFrom = state.source;
        }
      } catch (e) {
        state.error = e;
        // נפילה חזרה לקובץ המקומי אם Cloudflare לא זמין. שרת שרק לא ענה בזמן (AbortError —
        // למשל מופע חדש של ה־Worker שמתעורר) אינו תקלה: 'json-slow', והעותק מוצג בלי הודעה
        if (state.source === 'cloudflare') {
          try { state.data = normalize(await fetchJSON('data/episodes.json')); state.loadedFrom = e?.name === 'AbortError' ? 'json-slow' : 'json-fallback'; }
          catch { state.data = normalize({}); }
        } else state.data = normalize({});
      }
    }
    await personal;
    readyResolve(state);
    return state;
  }

  /* ---------- שינוי בחיבור: כניסה, יציאה, או אימות מול השרת ---------- */
  const sessionListeners = new Set();
  function onSession(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); }
  function sessionChanged() { sessionListeners.forEach((fn) => { try { fn(sb.user); } catch { /* */ } }); }
  /** אחרי כניסה: טוענים את הנתונים של החשבון ומודיעים לכל הדף */
  async function signedIn() { await me.load(); likes.load(true); sessionChanged(); }
  /** התנתקות מכל המקומות. השמירה האחרונה יוצאת עכשיו (עם הטוקן), וההתנתקות בשרת נשלחת רק
      אחרי שהיא הסתיימה — אחרת השרת עלול למחוק את הסשן לפני שהנתונים נשמרו. הדף מתעדכן מיד
      (הניהול וטופס התפוצה בודקים את המצב מיד אחרי הקריאה), וההבטחה מסתיימת אחרי השמירה. */
  async function signOut() {
    let saved;
    try { saved = me.save(true); } catch { /* */ }
    sb.signOut(saved);
    me.reset(); likes.mine = new Set(); sessionChanged();
    try { await saved; } catch { /* */ }
  }
  /** השרת דחה את הטוקן של המכשיר הזה (401): הסשן נמחק כאן בלבד. זו לא בקשה של המשתמש
      להתנתק, ולכן לא שולחים /logout — שמנתק את החשבון מכל המכשירים ומאתר הסקר. */
  function forgetSession() {
    sb.session = null;
    me.reset(); likes.mine = new Set(); sessionChanged();
  }

  /* ---------- שאילתות ---------- */

  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0);

  function episodes({ includeHidden = false, includeScheduled = false } = {}) {
    const now = new Date();
    return state.data.episodes.filter((e) => includeHidden || (e.visible && (includeScheduled || !scheduled(e, now)))).sort(byDate);
  }
  function seasons() {
    const list = state.data.seasons.slice();
    const counts = {};
    for (const e of episodes()) counts[e.season] = (counts[e.season] || 0) + 1;
    return list.map((s) => ({ ...s, count: counts[s.id] || 0 })).sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  function bySlug(slug) { return state.data.episodes.find((e) => e.slug === slug || e.id === slug) || null; }
  function byId(id) { return state.data.episodes.find((e) => e.id === id) || null; }
  function latest() { return episodes()[0] || null; }
  function featured() { return episodes().find((e) => e.featured) || latest(); }
  function neighbors(id) {
    const list = episodes();
    const i = list.findIndex((e) => e.id === id);
    return { newer: i > 0 ? list[i - 1] : null, older: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
  }

  /* ---------- חיפוש ----------
     מתעלם מניקוד, מגרשיים ומאותיות סופיות, מחפש גם בשם העונה ובאורחים,
     וסולח על טעות הקלדה אחת במילים של ארבע אותיות ומעלה. */
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const fold = (s) => String(s || '').toLowerCase().replace(/[\u0591-\u05C7]/g, '').replace(/[״"'׳`]/g, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function near(a, b) {   // מרחק עריכה ≤ 1
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  const haystack = (e) => {
    const season = state.data.seasons.find((x) => x.id === e.season);
    return fold([e.title, e.description, e.number, e.date, season?.title, ...e.tags, ...e.guests].join(' '));
  };
  const termHit = (t, hay, words) => hay.includes(t) || (t.length >= 4 && words.some((w) => near(t, w) || (w.length > t.length && near(t, w.slice(0, t.length)))));

  /* חיפוש סלחני (כשגם טעות הקלדה אחת לא מצאה כלום):
     • כתיב חסר/מלא: ו ו־י באמצע המילה לא משנים ("סתו" = "סתיו", "שרים" = "שירים")
     • אותיות השימוש בתחילת מילה: "הסתיו", "בסתיו", "לסתיו", "וכשהגיע" = "סתיו", "הגיע"
     • עד שתי טעויות במילה ארוכה (7 אותיות ומעלה), כולל שתי אותיות שהתחלפו */
  const PREFIXES = /^(?:[ו]?[ש]?[הבלמכ]|[וש])(?=..)/;
  const variants = (w) => { const out = new Set([w]); let x = w; for (let i = 0; i < 3 && x.length > 3; i++) { const m = x.match(PREFIXES); if (!m) break; x = x.slice(m[0].length); out.add(x); } return [...out]; };
  const skel = (w) => (w.length > 2 ? w[0] + w.slice(1, -1).replace(/[וי]/g, '') + w.slice(-1) : w);
  /** מרחק עריכה (כולל החלפת שתי אותיות סמוכות), עם עצירה מוקדמת מעל max */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        row.push(v); if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = row;
    }
    return prev[b.length];
  }
  function looseHit(t, words) {
    const tv = variants(t);
    return words.some((w) => variants(w).some((b) => tv.some((a) => {
      if (a.length < 2) return false;
      if (b.startsWith(a) && a.length >= 3) return true;
      const sa = skel(a);
      if (a.length >= 3 && sa === skel(b)) return true;
      const k = a.length >= 7 ? 2 : a.length >= 5 ? 1 : 0;
      return k > 0 && (editDistance(a, b, k) <= k || (b.length > a.length && editDistance(a, b.slice(0, a.length), k) <= k));
    })));
  }

  function searchEpisodes(q, list = episodes()) {
    q = fold(q);
    if (!q) return list;
    const terms = q.split(' ');
    const exact = list.filter((e) => { const hay = haystack(e); return terms.every((t) => hay.includes(t)); });
    if (exact.length) return exact;
    // אין התאמה מדויקת — סובלנות לטעות הקלדה
    const typo = list.filter((e) => { const hay = haystack(e), words = hay.split(' '); return terms.every((t) => termHit(t, hay, words)); });
    if (typo.length) return typo;
    // ועדיין כלום — כתיב חסר, אותיות שימוש ושתי טעויות במילים ארוכות
    return list.filter((e) => { const hay = haystack(e), words = hay.split(' '); return terms.every((t) => hay.includes(t) || looseHit(t, words)); });
  }
  /** "אולי התכוונתם ל…": המילה הקרובה ביותר מתוך שמות התוכניות, האורחים והתגיות */
  function suggest(q, list = episodes()) {
    const raw = String(q || '').trim().split(/\s+/).filter(Boolean);
    if (!raw.length) return '';
    const vocab = new Map();   // מילה מקופלת → המילה כפי שהיא כתובה
    list.forEach((e) => [e.title, state.data.seasons.find((x) => x.id === e.season)?.title, ...e.tags, ...e.guests].join(' ').replace(/[\u0591-\u05C7]/g, '').split(/[^\p{L}\p{N}"'״׳]+/u).forEach((w) => { const f = fold(w); if (f.length >= 3 && !vocab.has(f)) vocab.set(f, w); }));
    let changed = false;
    const out = raw.map((r) => {
      const t = fold(r);
      if (vocab.has(t) || t.length < 3) return r;
      const hit = [...vocab.keys()].find((w) => near(t, w));
      if (hit) { changed = true; return vocab.get(hit); }
      return r;
    });
    return changed ? out.join(' ') : '';
  }

  /* ---------- הנתונים האישיים: נשמרים רק בחשבון Google ----------
     שום דבר אישי לא נשמר במכשיר. מי שמחובר — הנתונים שלו (איפה עצר, "לאחר
     כך", היסטוריה, תור, העדפות, זמן האזנה) נטענים מהחשבון ונשמרים בו, כך
     שהם זהים בכל מכשיר. מי שלא מחובר — הנתונים חיים רק בזיכרון של הביקור
     הנוכחי, ומצטרפים לחשבון כשהוא מתחבר. */

  const ME_KEYS = ['positions', 'later', 'history', 'prefs', 'queue', 'finished', 'last', 'listenSeconds'];
  const blank = () => ({ positions: {}, later: [], history: [], prefs: {}, queue: [], finished: [], last: null, listenSeconds: 0, moments: {} });
  function cleanMe(raw) {
    const d = blank();
    if (!raw || typeof raw !== 'object') return d;
    if (raw.positions && typeof raw.positions === 'object') {
      for (const [id, p] of Object.entries(raw.positions)) if (p && Number.isFinite(Number(p.t))) d.positions[id] = { t: Math.floor(Number(p.t)), dur: Math.floor(Number(p.dur) || 0), at: Number(p.at) || 0 };
    }
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : []);
    d.later = ids(raw.later); d.queue = ids(raw.queue); d.finished = ids(raw.finished);
    d.history = (Array.isArray(raw.history) ? raw.history : []).filter((h) => h && h.id).map((h) => ({ id: String(h.id), at: Number(h.at) || 0 }));
    d.prefs = raw.prefs && typeof raw.prefs === 'object' ? { ...raw.prefs } : {};
    d.last = raw.last && raw.last.id ? { id: String(raw.last.id), t: Math.floor(Number(raw.last.t) || 0) } : null;
    d.listenSeconds = Math.max(0, Math.floor(Number(raw.listenSeconds) || 0));
    if (raw.moments && typeof raw.moments === 'object') {
      for (const [id, list] of Object.entries(raw.moments)) if (Array.isArray(list)) d.moments[id] = [...new Set(list.map(Number).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b).slice(0, 200);
    }
    return d;
  }
  const hasContent = (d) => !!(Object.keys(d.moments || {}).length || Object.keys(d.positions).length || d.later.length || d.history.length || d.queue.length || d.listenSeconds || d.last);
  /** מיזוג: מה שנעשה בביקור הזה (לפני שהתחברו, או במכשיר הזה) נוסף לחשבון */
  function mergeMe(base, extra) {
    const out = cleanMe(base), x = cleanMe(extra);
    for (const [id, p] of Object.entries(x.positions)) if (!out.positions[id] || p.at > out.positions[id].at) out.positions[id] = p;
    out.later = [...new Set([...x.later, ...out.later])];
    out.queue = [...new Set([...out.queue, ...x.queue])];
    out.finished = [...new Set([...out.finished, ...x.finished])];
    const hist = new Map(); for (const h of [...out.history, ...x.history]) if (!hist.has(h.id) || hist.get(h.id).at < h.at) hist.set(h.id, h);
    out.history = [...hist.values()].sort((a, b) => b.at - a.at);
    out.prefs = { ...out.prefs, ...x.prefs };
    if (x.last) out.last = x.last;
    out.listenSeconds += x.listenSeconds;
    for (const [id, list] of Object.entries(x.moments)) out.moments[id] = [...new Set([...(out.moments[id] || []), ...list])].sort((a, b) => a - b);
    return out;
  }

  const me = {
    data: blank(),
    account: null,       // המייל שהנתונים שייכים לו
    loaded: false,
    dirty: false,
    timer: null,
    listeners: new Set(),
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    emit() { this.listeners.forEach((fn) => { try { fn(this.data); } catch { /* */ } }); },
    /** טוען את הנתונים מהחשבון (ומצרף אליהם את מה שנעשה בביקור הזה) */
    async load() {
      const email = sb.user?.email || null;
      if (!email || !sb.configured) { this.account = null; this.loaded = true; return this.data; }
      try {
        const r = await sb.call('/api/program/userdata');
        const visit = this.account === email || !hasContent(this.data) ? null : this.data;   // מה שנעשה לפני ההתחברות
        const server = cleanMe(r.data);
        this.data = visit ? mergeMe(server, visit) : (this.dirty ? mergeMe(server, this.data) : server);
        // העברה חד־פעמית: נתונים ישנים שנשמרו פעם במכשיר עוברים לחשבון ונמחקים מהמכשיר
        const legacy = takeLegacy();
        if (legacy) this.data = mergeMe(this.data, legacy);
        this.account = email; this.loaded = true;
        if (visit || legacy || this.dirty) this.save(true);
      } catch (e) {
        if (e.status === 401) sb.session = null;
        this.account = null; this.loaded = true;
      }
      this.emit();
      return this.data;
    },
    /** נקרא אחרי כל שינוי. שמירה בחשבון באיחור קצר (מאגדת שינויים רצופים). */
    change() {
      this.dirty = true;
      this.emit();
      if (!this.account) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(), 2500);
    },
    async save(now = false, { keepalive = false } = {}) {
      clearTimeout(this.timer); this.timer = null;
      if (!this.account || !sb.session?.token || !this.dirty && !now) return;
      this.dirty = false;
      try {
        const body = JSON.stringify({ data: this.data });
        // keepalive מוגבל ל־64KB בבתים (עברית = 2 בתים לאות), לא בתווים
        const r = await fetch(sb.base('/api/program/userdata'), { method: 'PUT', headers: sb.headers(), body, keepalive: keepalive && new Blob([body]).size < 60000, cache: 'no-store' });
        if (!r.ok) { if (r.status === 401) { sb.session = null; this.account = null; } else this.dirty = true; }
      } catch { this.dirty = true; }
    },
    /** אחרי מחיקת הנתונים מהחשבון */
    clear() { clearTimeout(this.timer); this.data = blank(); this.dirty = false; this.emit(); },
    /** התנתקות: הנתונים של החשבון יוצאים מהדף */
    reset() { clearTimeout(this.timer); this.data = blank(); this.account = null; this.dirty = false; this.emit(); },
  };
  /** נתונים ישנים מהתקופה שבה האתר שמר במכשיר — נאספים פעם אחת ונמחקים */
  function takeLegacy() {
    try {
      const d = blank(); let found = false;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i); if (!k) continue;
        if (k.startsWith('rosh:pos:')) { const p = read(k, null); if (p) { d.positions[k.slice(9)] = p; found = true; } localStorage.removeItem(k); }
      }
      const later = read('rosh:later', null), hist = read('rosh:history', null), prefs = read('rosh:prefs', null), lastEp = read('rosh:last', null);
      if (later) { d.later = later; found = true; } if (hist) { d.history = hist; found = true; }
      if (prefs) { d.prefs = { rate: prefs.rate, archiveView: prefs.archiveView }; found = true; }
      if (lastEp) { d.last = lastEp; found = true; }
      ['rosh:later', 'rosh:history', 'rosh:prefs', 'rosh:last'].forEach((k) => localStorage.removeItem(k));
      return found ? d : null;
    } catch { return null; }
  }
  window.addEventListener('pagehide', () => { if (me.dirty) me.save(true, { keepalive: true }); });
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) { if (me.dirty) me.save(true, { keepalive: true }); }
    else if (me.account && !me.dirty && Date.now() - (me.pulledAt || 0) > 60000) { me.pulledAt = Date.now(); me.load(); }   // עדכונים ממכשיר אחר
  });

  const prefs = {
    get all() { return me.data.prefs; },
    get(k, fb) { const v = me.data.prefs[k]; return v == null ? fb : v; },
    set(k, v) { if (me.data.prefs[k] === v) return; me.data.prefs[k] = v; me.change(); },
  };

  const positions = {
    get(id) { return me.data.positions[id] || null; },
    set(id, t, dur) {
      // אורך 0 = עוד לא ידוע (לפני שההקלטה נטענה) — נשאר האורך שנמדד קודם
      me.data.positions[id] = { t: Math.floor(t), dur: Math.floor(dur || 0) || me.data.positions[id]?.dur || 0, at: Date.now() };
      const ids = Object.keys(me.data.positions);
      if (ids.length > 400) ids.sort((a, b) => me.data.positions[a].at - me.data.positions[b].at).slice(0, ids.length - 400).forEach((x) => delete me.data.positions[x]);
      me.change();
    },
    clear(id) { if (me.data.positions[id]) { delete me.data.positions[id]; me.change(); } },
    clearAll() { me.data.positions = {}; me.data.last = null; me.change(); },
    /** תוכניות שהתחלתם ולא סיימתם, מהאחרונה */
    resumable() {
      const out = [];
      for (const [id, p] of Object.entries(me.data.positions)) {
        const e = byId(id);
        if (e && e.visible && !scheduled(e) && p.t > 20 && (!p.dur || p.t < p.dur - 30)) out.push({ episode: e, ...p });
      }
      return out.sort((a, b) => b.at - a.at);
    },
  };

  const last = {
    get() { return me.data.last; },
    set(id, t) { me.data.last = { id, t: Math.floor(t || 0) }; me.change(); },
  };

  /** היסטוריית האזנה: התוכניות שנוגנו, מהאחרונה. */
  const history = {
    list() { return me.data.history; },
    add(id) { me.data.history = [{ id, at: Date.now() }, ...me.data.history.filter((x) => x.id !== id)].slice(0, 300); me.change(); },
    clear() { me.data.history = []; me.change(); },
  };

  const later = {
    list() { return me.data.later; },
    has(id) { return me.data.later.includes(id); },
    toggle(id) { const on = !this.has(id); me.data.later = on ? [id, ...me.data.later] : me.data.later.filter((x) => x !== id); me.change(); return on; },
  };

  /** תור האזנה: מה מתנגן אחרי התוכנית הנוכחית */
  const queue = {
    list() { return me.data.queue; },
    has(id) { return me.data.queue.includes(id); },
    add(id) { if (!this.has(id)) { me.data.queue = [...me.data.queue, id]; me.change(); } },
    remove(id) { if (this.has(id)) { me.data.queue = me.data.queue.filter((x) => x !== id); me.change(); } },
    toggle(id) { this.has(id) ? this.remove(id) : this.add(id); return this.has(id); },
    clear() { me.data.queue = []; me.change(); },
    /** התוכנית הבאה בתור (ומוציא אותה מהתור) */
    shift(currentId) {
      const ids = me.data.queue.filter((x) => x !== currentId);
      const nextId = ids.find((x) => { const e = byId(x); return e && e.visible && !scheduled(e) && e.stream; });
      me.data.queue = nextId ? ids.slice(ids.indexOf(nextId) + 1) : ids;
      me.change();
      return nextId ? byId(nextId) : null;
    },
  };

  /** סיכום האזנה לאזור האישי: זמן האזנה אמיתי ותוכניות שנשמעו עד הסוף */
  const listening = {
    tick(seconds = 1) { me.data.listenSeconds += seconds; me.dirty = true; if (me.account && !me.timer) me.timer = setTimeout(() => me.save(), 30000); },
    finish(id) { if (!me.data.finished.includes(id)) { me.data.finished = [id, ...me.data.finished]; me.change(); } },
    get seconds() { return me.data.listenSeconds; },
    get finished() { return me.data.finished; },
  };

  /* ---------- הרגעים שאהבתי: ♥ על רגע בתוכנית ----------
     נשמר באזור האישי (בחשבון), ונשלח לשרת לספירה — שרק המנהלים רואים. */
  const moments = {
    step: 5,
    of(id) { return me.data.moments[id] || []; },
    all() { return Object.entries(me.data.moments).filter(([, l]) => l.length); },
    near(id, t) { return this.of(id).find((m) => Math.abs(m - t) < 10) ?? null; },
    async toggle(id, t) {
      if (!sb.user) throw Object.assign(new Error('כדי לסמן רגעים צריך להתחבר.'), { login: true });
      const hit = this.near(id, t);
      const at = hit ?? Math.floor(t / this.step) * this.step;
      const on = hit == null;
      const list = this.of(id).filter((m) => m !== at);
      me.data.moments[id] = on ? [...list, at].sort((a, b) => a - b) : list;
      if (!me.data.moments[id].length) delete me.data.moments[id];
      me.change();
      sb.call('/api/program/moments', { method: 'POST', body: { episodeId: id, at, on } }).catch(() => {});
      return { at, on };
    },
  };

  /* ---------- "אהבתי" ---------- */
  const likes = {
    counts: {}, mine: new Set(), loaded: false, _p: null,
    load(force = false) {
      if (!sb.configured) return Promise.resolve(this);
      if (this._p && !force) return this._p;
      // כישלון לא נשמר: הקריאה הבאה מנסה שוב
      const p = this._p = sb.call('/api/program/likes').then((r) => { this.counts = r.counts || {}; this.mine = new Set(r.mine || []); this.loaded = true; return this; }).catch(() => { if (this._p === p) this._p = null; return this; });
      return p;
    },
    count(id) { return Number(this.counts[id] || 0); },
    has(id) { return this.mine.has(id); },
    async toggle(id) {
      const on = !this.mine.has(id);
      const r = await sb.call('/api/program/likes', { method: 'POST', body: { episodeId: id, like: on } });
      if (r.liked) this.mine.add(id); else this.mine.delete(id);
      this.counts[id] = Number(r.count) || 0;
      return r.liked;
    },
  };

  /* ---------- ניהול ---------- */

  const admin = {
    /** מה שמפורסם באתר עכשיו (בלי הטיוטה) */
    async pullOrigin() {
      const raw = state.source === 'cloudflare' ? await sb.pull(true) : await fetchJSON('data/episodes.json');
      const data = normalize(raw);
      data.versionId = raw?.versionId ?? null;   // הגרסה שבאתר עכשיו (להגנה מדריסה)
      return data;
    },
    export(data) {
      return JSON.stringify({ version: 1, updated: new Date().toISOString().slice(0, 10), seasons: data.seasons, episodes: data.episodes, settings: data.settings || {} }, null, 2);
    },
    validate(raw) {
      const errors = [];
      if (!raw || typeof raw !== 'object') return ['הקובץ אינו אובייקט JSON'];
      if (!Array.isArray(raw.episodes)) errors.push('חסר מערך "episodes"');
      const ids = new Set(), slugs = new Set();
      (raw.episodes || []).forEach((e, i) => {
        const where = `תוכנית #${i + 1}${e?.title ? ` (${e.title})` : ''}`;
        if (!e || typeof e !== 'object') { errors.push(`${where}: לא אובייקט`); return; }
        if (!e.title) errors.push(`${where}: חסרה כותרת`);
        if (e.id && ids.has(e.id)) errors.push(`${where}: מזהה כפול "${e.id}"`);
        if (e.slug && slugs.has(e.slug)) errors.push(`${where}: כתובת כפולה "${e.slug}"`);
        ids.add(e.id); slugs.add(e.slug);
        if (e.date && !/^\d{4}-\d{2}-\d{2}/.test(String(e.date))) errors.push(`${where}: תאריך לא בפורמט YYYY-MM-DD`);
        if (e.tracks && !Array.isArray(e.tracks)) errors.push(`${where}: "tracks" חייב להיות מערך`);
      });
      return errors;
    },
    normalize,
    normEpisode,
    normSettings, normPoll,
  };

  window.RoshStore = {
    state, ready, load, sb, prefs, positions, last, later, history, queue, listening, likes, moments, me, admin,
    episodes, seasons, bySlug, byId, latest, featured, neighbors, searchEpisodes, suggest,
    bannerActive, scheduled, nowIL, todayIL, onSession, signedIn, signOut, forgetSession,
    get site() { return state.site; },
    get data() { return state.data; },
    get settings() { return state.data.settings || { banner: null, updates: [] }; },
  };

  load();
})();
