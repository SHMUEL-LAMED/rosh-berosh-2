/* Service Worker של ראש בראש: שומר את מעטפת האתר להפעלה מהירה ובלי רשת.
   נתוני התוכניות נטענים תמיד מהרשת קודם (ונופלים למטמון אם אין), וההקלטות
   עצמן לא נשמרות. ניווט שנכשל ואין לו עותק שמור מקבל את offline.html.
   הגופנים של Google נשמרים במטמון נפרד (שורד החלפת גרסה) כדי שהאתר ייראה נכון גם בלי רשת. */
const VERSION = 'rosh-v18-polls';
const FONTS = 'rosh-fonts-v1';
const OFFLINE = './offline.html';
const SHELL = [
  './', './index.html', './archive.html', './episode.html', './me.html', './updates.html', './negishut.html', OFFLINE,
  './assets/css/rosh.css', './assets/css/features.css', './assets/css/polls.css', './assets/js/theme.js', './assets/js/app-update.js', './assets/js/offline.js', './assets/js/ui.js', './assets/js/store.js', './assets/js/player.js', './assets/js/extras.js', './assets/js/polls.js', './assets/js/router.js',
  './assets/js/home.js', './assets/js/archive.js', './assets/js/episode.js', './assets/js/me.js', './assets/js/updates.js', './assets/js/negishut.js',
  './assets/img/medallion.svg', './assets/img/icon-192.png', './assets/img/icon-512.png', './assets/img/icon-maskable-512.png',
  './assets/img/apple-touch-icon.png', './manifest.webmanifest',
];
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&family=Karantina:wght@400;700&display=swap';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // קובץ אחד שחסר לא מפיל את כל ההתקנה; offline.html חייב להיכנס
    await c.add(new Request(OFFLINE, { cache: 'reload' }));
    await Promise.all(SHELL.map((url) => c.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    // גיליון הגופנים (לא חובה — ייכנס גם בשימוש הראשון)
    try { const r = await fetch(FONT_CSS); if (r.ok) await (await caches.open(FONTS)).put(FONT_CSS, r); } catch { /* בלי רשת */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/* גיליון הגופנים: מהמטמון מיד, ומתרענן ברקע */
function staleWhileRevalidate(e, req) {
  return caches.open(FONTS).then(async (c) => {
    const cached = await c.match(req);
    const fresh = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => cached);
    if (cached) { e.waitUntil(fresh.then(() => {}, () => {})); return cached; }
    return fresh.then((r) => r || Response.error());
  });
}
/* קובצי הגופנים עצמם: לא משתנים לעולם (הכתובת כוללת גרסה) — מטמון קודם */
function cacheFirst(e, req) {
  return caches.open(FONTS).then(async (c) => {
    const cached = await c.match(req);
    if (cached) return cached;
    const r = await fetch(req);
    if (r.ok || r.type === 'opaque') e.waitUntil(c.put(req, r.clone()));
    return r;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com') { e.respondWith(staleWhileRevalidate(e, req)); return; }
  if (url.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(e, req)); return; }
  if (url.origin !== location.origin) return;
  // הקלטות: ישר מהרשת, בלי מטמון
  if (/\.(mp3|m4a|wav|ogg|aac|flac|opus|webm)$/i.test(url.pathname) || req.headers.has('range')) return;
  // נתונים: רשת קודם, מטמון כגיבוי (רק תשובה תקינה נשמרת — שגיאה לא דורסת את העותק הטוב)
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => caches.match(req).then((hit) => hit || Response.error())));
    return;
  }
  // קובצי האפליקציה: תמיד מאומתים מול הרשת כדי שפריסה חדשה לא תתערבב עם ישנה
  const navigate = req.mode === 'navigate';
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => {
    if (r.ok) {
      const copy = r.clone();
      e.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)));
    }
    return r;
  }).catch(async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (navigate) {
      // דף בתיקייה אחרת (episodes/…): הכתובות היחסיות של offline.html לא יעבדו שם — מפנים אליו
      const off = new URL(OFFLINE, self.registration.scope).href;
      if (url.pathname.replace(/[^/]*$/, '') !== new URL(self.registration.scope).pathname) return Response.redirect(off, 302);
      return (await caches.match(OFFLINE)) || Response.error();
    }
    return Response.error();
  }));
});

/* התראה על תוכנית חדשה (Web Push): מציגים אותה, ולחיצה פותחת את התוכנית —
   בחלון האתר שכבר פתוח אם יש כזה: החלון מקבל הודעה ('rosh-navigate') ועובר לדף
   בלי טעינה מחדש (router.js), כך שהנגן ממשיך לנגן. חלון חדש רק כשאין חלון פתוח. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || '' }; }
  const title = d.title || 'ראש בראש';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: d.icon || './assets/img/icon-192.png', badge: './assets/img/icon-192.png',
    dir: 'rtl', lang: 'he', tag: d.url || 'rosh', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // חלון עליון של האתר (לא iframe, ולא אזור הניהול — שם אין ניווט בלי טעינה)
    const mine = wins.filter((w) => w.url.startsWith(self.registration.scope) && w.frameType !== 'nested' && !/\/admin\.html/.test(new URL(w.url).pathname));
    const here = mine.find((w) => w.focused) || mine.find((w) => w.visibilityState === 'visible') || mine[0];
    if (here) {
      try { await here.focus(); } catch { /* הדפדפן לא תמיד מרשה — ההודעה עדיין עוברת */ }
      here.postMessage({ type: 'rosh-navigate', url: target });
      return;
    }
    return self.clients.openWindow(target);
  })());
});
