/* העלאה ישירה ל־R2 של אתר הסקר; הרשאת מנהל נבדקת ב־Worker.
   קובץ קטן (עד 8MB) עולה בבקשה אחת. כל קובץ גדול יותר — גם הקלטה של שעה וחצי
   (70–150MB) — עולה בחלקים (R2 multipart), ארבעה חלקים במקביל, כך שהקו מנוצל
   כל הזמן והמתנה של השרת לשמירת חלק אחד לא עוצרת את השאר. חלק שנכשל או נתקע
   (בלי התקדמות 45 שניות) מנוסה שוב לבד, עם המתנה גדלה, ואחרי ניתוק — ברגע
   שהחיבור חוזר. ההעלאה נזכרת במכשיר: אם בכל זאת נעצרה (או שהדף רוענן),
   בחירה חוזרת של אותו הקובץ ממשיכה מהחלק שנעצר ולא מההתחלה. */
(function () {
  'use strict';
  const SMALL = 8 * 1024 * 1024;          // עד כאן — בקשה אחת
  const PARALLEL = 4;                     // חלקים שעולים בבת אחת
  const ATTEMPTS = 6;                     // ניסיונות לכל בקשה (המתנה: 1, 2, 4, 8, 16 שניות)
  const STALL_MS = 45 * 1000;             // בלי התקדמות כל כך הרבה זמן — הבקשה מנותקת ומנוסה שוב
  const MAX = { audio: 1024 * 1024 * 1024, cover: 15 * 1024 * 1024, file: 200 * 1024 * 1024 };
  const RESUME_KEY = 'rosh:upload:resume'; // העלאות בחלקים שלא הושלמו, לפי קובץ
  const RESUME_MAX_AGE = 6 * 24 * 60 * 60 * 1000; // ותיקה יותר נשכחת ומבוטלת בשרת (כלל החיים של ה־bucket מוחק אחרי שבוע)
  const RETRY_NOTE = 'החיבור נקטע, מנסים שוב…';

  function types(kind) {
    if (kind === 'file') {
      // קבצים מצורפים לעדכונים (אותה רשימה כמו ATTACHMENT_EXT ב־worker/program-api.ts במאגר rosh-berosh)
      return {
        pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
        mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4',
      };
    }
    return kind === 'audio'
      ? { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' }
      : { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  /** כשל שכדאי לנסות שוב: ניתוק, בקשה שנתקעה, או שגיאת שרת חולפת (5xx, 408, 429) */
  const transient = (status) => !status || status >= 500 || status === 408 || status === 429;

  /** ממתין שהחיבור יחזור — רק כשהדפדפן יודע שאין חיבור */
  function online() {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    if (!nav || nav.onLine !== false || typeof window.addEventListener !== 'function') return Promise.resolve();
    return new Promise((res) => {
      const done = () => { window.removeEventListener('online', done); clearInterval(poll); res(); };
      const poll = setInterval(() => { if (nav.onLine) done(); }, 2000);   // גם אם האירוע לא הגיע
      window.addEventListener('online', done);
    });
  }

  /** מריץ בקשה שוב ושוב עד שמצליחה: המתנה גדלה בין הניסיונות, ואחרי ניתוק — עד שהחיבור חוזר */
  async function retrying(task, onRetry) {
    for (let attempt = 1; ; attempt++) {
      try { return await task(); }
      catch (err) {
        if (!transient(err.status) || attempt >= ATTEMPTS) throw err;
        if (onRetry) onRetry(attempt);
        await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
        await online();
      }
    }
  }

  /** בקשת XHR אחת עם דיווח התקדמות. בקשה שאינה מתקדמת STALL_MS מנותקת ונחשבת כשל חולף. */
  function send(method, url, token, body, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let timer = 0, stalled = false;
      const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; xhr.abort(); }, STALL_MS); };
      const fail = (message, status) => { clearTimeout(timer); reject(Object.assign(new Error(message), { status })); };
      xhr.open(method, url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (event) => { watch(); if (onProgress && event.lengthComputable) onProgress(event.loaded); };
      xhr.onerror = () => fail('החיבור נקטע.');
      xhr.ontimeout = () => fail('ההעלאה נתקעה.');
      // ניתוק על ידי הדפדפן (יציאה מהדף) נחשב כמו תקיעה: ההעלאה נזכרת ותמשיך בבחירה הבאה של הקובץ
      xhr.onabort = () => fail(stalled ? 'ההעלאה נתקעה.' : 'ההעלאה הופסקה.');
      xhr.onload = () => {
        clearTimeout(timer);
        let json = {}; try { json = JSON.parse(xhr.responseText); } catch { /* server error */ }
        if (xhr.status < 200 || xhr.status >= 300) return fail(json.error || `ההעלאה נכשלה (${xhr.status}).`, xhr.status);
        resolve(json);
      };
      watch();
      xhr.send(body);
    });
  }

  /* ---------- זיכרון ההעלאות שלא הושלמו (localStorage) ---------- */
  const resumeStore = {
    read() { try { return JSON.parse(localStorage.getItem(RESUME_KEY)) || {}; } catch { return {}; } },
    write(map) { try { Object.keys(map).length ? localStorage.setItem(RESUME_KEY, JSON.stringify(map)) : localStorage.removeItem(RESUME_KEY); } catch { /* מצב פרטי */ } },
  };
  const fileId = (file, episodeId, kind) => `${episodeId}|${kind}|${file.name}|${file.size}|${file.lastModified || 0}`;
  function remember(id, record) { const map = resumeStore.read(); map[id] = record; resumeStore.write(map); }
  function forget(id) { const map = resumeStore.read(); delete map[id]; resumeStore.write(map); }
  /** ההעלאה שנקטעה של הקובץ הזה, אם יש; העלאות ישנות נמחקות גם בשרת */
  function resumable(cf, id) {
    const map = resumeStore.read();
    let changed = false;
    for (const [key, record] of Object.entries(map)) {
      if (Date.now() - (record.at || 0) <= RESUME_MAX_AGE) continue;
      cf.call('/api/program/upload/abort', { method: 'POST', body: { key: record.key, uploadId: record.uploadId } }).catch(() => {});
      delete map[key]; changed = true;
    }
    if (changed) resumeStore.write(map);
    return map[id] && map[id].key && map[id].uploadId && map[id].partSize ? map[id] : null;
  }

  /* ---------- העלאה בחלקים ---------- */
  async function uploadInParts(cf, token, file, meta, progress, fresh) {
    const id = fileId(file, meta.episodeId, meta.kind);
    const saved = fresh ? null : resumable(cf, id);
    const start = saved || await retrying(() => cf.call(`/api/program/upload/start?${meta.query}`, { method: 'POST', body: { contentType: meta.contentType, size: file.size, name: file.name } }));
    const size = start.partSize || 10 * 1024 * 1024;
    const count = Math.ceil(file.size / size);
    const etags = { ...(saved ? saved.etags : null) };
    const record = () => remember(id, { key: start.key, uploadId: start.uploadId, partSize: size, etags, at: Date.now() });
    record();
    const partSize = (part) => Math.min(size, file.size - (part - 1) * size);
    let done = 0;
    for (let part = 1; part <= count; part++) if (etags[part]) done += partSize(part);
    const inFlight = new Map();   // בייטים שכבר נשלחו מכל חלק שבדרך
    const report = (note) => { let sent = done; inFlight.forEach((n) => { sent += n; }); progress(Math.min(99, Math.round(sent / file.size * 100)), note); };
    report();

    let next = 1, failure = null;
    const worker = async () => {
      while (next <= count && !failure) {
        const part = next++;
        if (etags[part]) continue;   // עלה כבר בניסיון קודם
        const chunk = file.slice((part - 1) * size, (part - 1) * size + partSize(part));
        const url = cf.base(`/api/program/upload/part?key=${encodeURIComponent(start.key)}&uploadId=${encodeURIComponent(start.uploadId)}&part=${part}`);
        try {
          const r = await retrying(
            () => send('PUT', url, token, chunk, 'application/octet-stream', (n) => { inFlight.set(part, n); report(); }),
            () => { inFlight.set(part, 0); report(RETRY_NOTE); });
          etags[part] = r.etag; done += chunk.size; inFlight.delete(part); record(); report();
        } catch (err) { inFlight.delete(part); failure = failure || err; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));

    if (!failure) {
      try {
        const r = await retrying(() => cf.call('/api/program/upload/complete', { method: 'POST', body: { key: start.key, uploadId: start.uploadId, parts: Object.keys(etags).map(Number).sort((a, b) => a - b).map((part) => ({ part, etag: etags[part] })) } }));
        forget(id); progress(100);
        return r.url;
      } catch (err) { failure = err; }
    }
    // ההעלאה כבר לא קיימת בשרת (פגה או נמחקה) — מתחילים מחדש, פעם אחת
    if (saved && (failure.status === 404 || failure.status === 410)) { forget(id); return uploadInParts(cf, token, file, meta, progress, true); }
    if (transient(failure.status)) {
      // ניתוק ממושך: החלקים שעלו נשארים בשרת ובזיכרון, ובחירה חוזרת של הקובץ ממשיכה מכאן
      const pct = Math.round(done / file.size * 100);
      throw new Error(`ההעלאה נעצרה ב־${pct}% (${failure.message}) בחרו שוב את אותו הקובץ וההעלאה תמשיך מאותה נקודה.`);
    }
    forget(id);
    cf.call('/api/program/upload/abort', { method: 'POST', body: { key: start.key, uploadId: start.uploadId } }).catch(() => {});
    throw new Error(`${failure.message} בחרו שוב את הקובץ כדי לנסות מחדש.`);
  }

  /** progress(אחוזים, הערה) — ההערה מופיעה כשמנסים שוב אחרי ניתוק */
  window.RoshUpload = async function (file, episodeId, kind, progress = () => {}) {
    const cf = window.RoshStore.sb;
    let admin = false;
    try { admin = await cf.isAdmin(); } catch { throw new Error('אין חיבור לשרת. בדקו את החיבור ונסו שוב.'); }
    if (!admin) throw new Error('יש להתחבר עם חשבון מנהל כדי להעלות קבצים.');
    kind = kind === 'cover' || kind === 'file' ? kind : 'audio';
    const ext = file.name.split('.').pop().toLowerCase();
    // הסוג שהקובץ מצהיר עליו קודם (PNG נשאר PNG גם אם השם לא מתאים), ואם אינו מוכר — לפי הסיומת
    const allowed = types(kind);
    const contentType = (file.type && Object.values(allowed).includes(file.type) ? file.type : '') || allowed[ext] || '';
    if (!contentType) throw new Error('סוג הקובץ אינו נתמך.');
    if (!file.size) throw new Error('הקובץ ריק.');
    if (file.size > MAX[kind]) throw new Error({ audio: 'אפשר להעלות הקלטה של עד 1GB.', cover: 'אפשר להעלות תמונה של עד 15MB.', file: 'אפשר לצרף קובץ של עד 200MB.' }[kind]);
    const token = cf.session.token;
    // השם המקורי נשמר עם הקובץ המצורף — כך הוא נפתח או יורד בשמו
    const query = `episode=${encodeURIComponent(episodeId)}&kind=${kind}${kind === 'file' ? `&name=${encodeURIComponent(file.name)}` : ''}`;
    progress(0);

    if (file.size <= SMALL) {
      const r = await retrying(
        () => send('POST', cf.base(`/api/program/upload?${query}`), token, file, contentType, (n) => progress(Math.round(n / file.size * 100))),
        () => progress(0, RETRY_NOTE));
      progress(100);
      return r.url;
    }
    return uploadInParts(cf, token, file, { episodeId, kind, contentType, query }, progress, false);
  };
})();
