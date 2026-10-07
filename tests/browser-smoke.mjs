/* בדיקת דפדפן אמיתי לאתר ראש בראש.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/browser-smoke.mjs (בחלון שני)
   דורש Playwright (npm i -g playwright) — אינו תלות של האתר.
   הבדיקה רצה על הקטלוג האמיתי (86 הקלטות). ניגון ההקלטה דורש רשת;
   בלי רשת (OFFLINE=1) הבדיקה מדלגת על חלק ההזרמה.
   מאחורי פרוקסי: אם HTTPS_PROXY מוגדר, הדפדפן עובר דרכו לכל כתובת חיצונית
   והשרת המקומי נגיש ישירות. */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) failures.push(msg); };

const launch = {};
if (process.env.PW_EXECUTABLE) launch.executablePath = process.env.PW_EXECUTABLE;
if (process.env.HTTPS_PROXY) {
  const pac = `function FindProxyForURL(url, host) { if (host === '127.0.0.1' || host === 'localhost' || isPlainHostName(host)) return 'DIRECT'; return 'PROXY ${new URL(process.env.HTTPS_PROXY).host}'; }`;
  launch.args = [`--proxy-pac-url=data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac).toString('base64')}`];
}
const browser = await chromium.launch(launch);
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
if (!process.env.STREAM) {
  // בלי STREAM=1 ההקלטה מגיעה מהבדיקה ולא מה־Worker האמיתי, כדי שתקלה ברשת או בשרת לא
  // תכשיל את בדיקות הנגן: 25 דקות של שקט (WAV, 8kHz, 8 ביט), כדי שקפיצה לדקה 20 תעבוד
  const rate = 8000, len = rate * 1500;
  const wav = Buffer.alloc(44 + len, 0x80);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + len, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(len, 40);
  await ctx.route('**/api/program/stream/**', (route) => {
    if (globalThis.streamDown) return route.abort();   // השרת לא זמין
    const m =/bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = m ? Number(m[1]) : 0, end = m && m[2] ? Math.min(Number(m[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: m ? 206 : 200, headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': 'audio/wav', ...(m ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) });
  });
}
// שירות Google חיצוני מדומה, כמו שרת האימות המדומה בבדיקות האלה.
await ctx.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
  contentType: 'application/javascript',
  body: 'window.google = { accounts: { id: { initialize() {}, prompt() {}, renderButton(el) { const b = document.createElement("button"); b.textContent = "התחברות עם Google"; el.appendChild(b); } } } };',
}));
const page = await ctx.newPage();
// כמו מבקר שבוחר להמשיך בלי להתחבר, סוגרים את ההצעה לפני פעולות בדף.
await page.addLocatorHandler(page.locator('#login-welcome[open]'), async () => {
  await page.locator('#login-welcome .welcome-later[data-dismiss]').click();
});
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

/* ---------- דף הבית ---------- */
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
check((await page.getAttribute('html', 'dir')) === 'rtl', 'הדף בעברית מימין לשמאל');
check(await page.locator('.site-header .brand strong').innerText() === 'ראש בראש', 'הכותרת מציגה את שם התוכנית');
check((await page.locator('.site-nav .admin-link').count()) === 0, 'כפתור הניהול מוסתר למי שלא מחובר כמנהל');
check((await page.locator('.site-nav .me-link').count()) === 1, 'קישור לאזור האישי בכותרת');
check((await page.locator('#recent .ep-card').count()) >= 3, 'רשת התוכניות האחרונות מלאה');
check((await page.locator('#stats .stat').count()) === 2, 'לוח המספרים מוצג');
check((await page.locator('.ticker a').count()) > 10, 'סרט התוכניות הנע מלא');
check((await page.locator('#hero-eq i').count()) > 20, 'האקולייזר בגיבור נבנה');
const total = await page.evaluate(() => window.RoshStore.episodes().length);
check(total === 86, `הקטלוג נטען (${total} תוכניות)`);
check(!(await page.locator('#main').innerText()).includes('Drive'), 'שום אזכור של ספק האחסון בדף הבית');

// ניגון התוכנית המומלצת מדף הבית פותח את הנגן הקבוע; ההזרמה עוברת דרך ה־Worker
await page.click('#featured [data-play]');
await page.waitForSelector('.dock.open');
check(await page.locator('.dock.open').count() === 1, 'הנגן הקבוע נפתח');
check((await page.locator('.dock [data-moment]').count()) === 1, 'כפתור "♡ הרגע הזה" בנגן');
await page.locator('.dock [data-vol]').fill('40');
check(Math.abs((await page.evaluate(() => window.RoshPlayer.volume)) - 0.4) < 0.01, 'פס עוצמת הקול בנגן משנה את העוצמה');
await page.click('.dock [data-mute]');
await page.waitForFunction(() => document.querySelector('.dock [data-mute]').dataset.level === 'mute');
check(await page.evaluate(() => window.RoshPlayer.muted), 'כפתור ההשתקה בנגן');
await page.click('.dock [data-mute]');
check(!(await page.evaluate(() => window.RoshPlayer.muted)), 'לחיצה נוספת מבטלת את ההשתקה');
// שם תוכנית עם רווח מיותר ("…מוזיקה "): הכותרת בלשונית בזמן ניגון לא נכנסת ללולאה שתוקעת את הדף
{
  const title = page.evaluate(() => {
    const ep = window.RoshPlayer.episode, was = ep.title;
    ep.title = `${was.trim()}  בדיקה `;
    window.RoshPlayer.play();
    document.title = 'דף אחר';   // כמו מעבר בין דפים
    return new Promise((r) => setTimeout(() => { const t = document.title; ep.title = was; r(t); }, 300));
  });
  const shown = await Promise.race([title, new Promise((r) => setTimeout(() => r(null), 5000))]);
  check(!!shown && shown.startsWith('▶ ') && shown.includes('בדיקה'), `שם תוכנית עם רווח מיותר לא תוקע את הדף בזמן ניגון${shown ? '' : ' (הדף נתקע)'}`);
  if (!shown) { console.error('הדף נתקע — עוצרים כאן'); process.exit(1); }
}
const apiBase = await page.evaluate(() => window.RoshStore.site?.storage?.cloudflare?.apiBase || '');
const src = await page.evaluate(() => window.RoshPlayer.src);
check(apiBase ? src.startsWith(`${apiBase}/api/program/stream/`) : /^https:\/\/drive\.usercontent\.google\.com\//.test(src), 'הנגן מזרים דרך ה־Worker (בלי נגן חיצוני)');
check((await page.locator('.dock [data-download]').getAttribute('href')).startsWith(`${apiBase}/api/program/download/`), 'ההורדה מהאחסון של האתר, בשם התוכנית (לא מהדרייב)');
if (process.env.STREAM) {
  // דורש Worker פרוס עם /api/program/stream ורשת
  const streaming = await page.waitForFunction(() => window.RoshPlayer.duration > 60 && window.RoshPlayer.time > 0.5, null, { timeout: 45000 }).then(() => true).catch(() => false);
  check(streaming, 'ההקלטה מתנגנת בנגן של האתר');
  await page.evaluate(() => window.RoshPlayer.seek(1200));
  await page.waitForFunction(() => window.RoshPlayer.time >= 1199, null, { timeout: 20000 }).catch(() => {});
  check((await page.evaluate(() => window.RoshPlayer.time)) >= 1199, 'קפיצה באמצע ההקלטה (Range) עובדת');
  check(await page.evaluate(() => document.body.classList.contains('is-playing')), 'התקליט מסתובב בזמן ניגון');
  await page.evaluate(() => window.RoshPlayer.pause());
} else {
  console.log('· (STREAM=1 מפעיל גם את בדיקת ההזרמה עצמה מול ה־Worker)');
  await page.evaluate(() => { window.RoshPlayer.pause(); window.RoshPlayer.seek(1200); });
}
await page.evaluate(() => { window.__sameDocument = true; });
await page.click('.site-nav a[href="archive.html"]');
await page.waitForSelector('#results .ep-card');
check(await page.locator('.dock.open').count() === 1, 'הנגן נשאר פתוח במעבר לארכיון');
check(await page.evaluate(() => window.__sameDocument === true), 'המעבר בין דפים בלי טעינה מחדש (הנגן לא נעצר)');
check((await page.evaluate(() => window.RoshPlayer.time)) >= 1000, 'המיקום בהקלטה נשמר בין דפים');
check(page.url().endsWith('/archive.html'), 'הכתובת מתעדכנת במעבר');
await page.goBack();
await page.waitForSelector('#featured .card');
check(await page.evaluate(() => window.__sameDocument === true) && (await page.locator('#recent .ep-card').count()) >= 3, 'כפתור "אחורה" מחזיר לדף הקודם בלי טעינה');
await page.goForward();
await page.waitForSelector('#results .ep-card');

/* ---------- ארכיון ---------- */
check((await page.locator('#results .ep-card').count()) === 86, 'הארכיון מציג את כל התוכניות');
await page.click('[data-season="slater"]');
await page.waitForFunction(() => document.querySelectorAll('#results .ep-card').length === 10);
check(true, 'סינון לפי עונה עובד');
await page.click('[data-season=""]');
await page.fill('#q', 'מצעד');
await page.waitForFunction(() => document.querySelectorAll('#results .ep-card').length > 0 && document.querySelectorAll('#results .ep-card').length < 86);
check(true, 'חיפוש טקסט חופשי מסנן');
await page.fill('#q', 'אין-כזה-דבר-בכלל');
await page.waitForSelector('#results .state');
check(true, 'מצב ריק בחיפוש בלי תוצאות');
await page.fill('#q', '');
await page.click('[data-view="seasons"]');
await page.waitForSelector('.season-block');
check((await page.locator('.season-block').count()) === 5, 'תצוגה לפי עונות');
await page.click('[data-view="list"]');
await page.waitForSelector('#results .row');
check((await page.locator('#results .row [data-play]').count()) === 86, 'לכל תוכנית כפתור ניגון ברשימה');

/* ---------- קיצורי מקלדת, קישורי "#" ועיצוב אורך ---------- */
// רווח על כפתור ממוקד מפעיל את הכפתור — לא גם את הנגן (שיש בו תוכנית, מושהית)
await page.evaluate(() => { window.RoshPlayer.pause(); const b = document.createElement('button'); b.type = 'button'; b.id = 't-btn'; b.textContent = 'בדיקה'; document.getElementById('main').appendChild(b); b.focus(); });
await page.keyboard.press('Space');
check(await page.evaluate(() => window.RoshPlayer.paused), 'רווח על כפתור ממוקד לא מפעיל גם את הנגן');
await page.evaluate(() => { document.getElementById('t-btn').remove(); document.activeElement?.blur?.(); });
await page.keyboard.press('Space');
check(!(await page.evaluate(() => window.RoshPlayer.paused)), 'רווח מחוץ לכפתורים מפעיל את הנגן');
await page.evaluate(() => window.RoshPlayer.pause());
await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ל', code: 'KeyK', bubbles: true })));
check(!(await page.evaluate(() => window.RoshPlayer.paused)), 'הקיצור K עובד גם במקלדת בעברית (לפי המקש הפיזי)');
await page.evaluate(() => window.RoshPlayer.pause());
// המהירות שנבחרה נשארת גם אחרי מעבר לתוכנית אחרת (load() מחזיר את playbackRate לברירת המחדל)
{
  const rate = await page.evaluate(async () => {
    const Pl = window.RoshPlayer, ld = HTMLMediaElement.prototype.load;
    let el = null; HTMLMediaElement.prototype.load = function () { el = this; return ld.call(this); };
    Pl.setRate(1.5);
    Pl.load(window.RoshStore.episodes().find((e) => e.stream && !Pl.isCurrent(e.id)), { at: 0, autoplay: false });
    HTMLMediaElement.prototype.load = ld;
    const r = el?.playbackRate; Pl.setRate(1); return r;
  });
  check(rate === 1.5, `המהירות שנבחרה נשמרת במעבר לתוכנית אחרת (${rate})`);
}
// אחרי סגירת הנגן (✕), ניגון מחדש (רווח) פותח שוב את הנגן — לא מנגן בלי נגן גלוי
await page.click('.dock [data-close]');
await page.evaluate(() => document.activeElement?.blur?.());
await page.keyboard.press('Space');
check(await page.evaluate(() => !window.RoshPlayer.paused && !!document.querySelector('.dock.open')), 'ניגון אחרי סגירת הנגן פותח אותו שוב');
await page.evaluate(() => window.RoshPlayer.pause());
// ההקלטה לא נטענה: הנגן נעצר עם הודעה אחת, ו־▶ טוען אותה מחדש כשהשרת חוזר
if (!process.env.STREAM) {
  await page.evaluate(() => { window.__errNotices = 0; new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('notice-error')) window.__errNotices++; }).observe(document.body, { childList: true, subtree: true }); });
  globalThis.streamDown = true;
  await page.evaluate(() => { const Pl = window.RoshPlayer; Pl.load(window.RoshStore.episodes().find((e) => e.stream && !Pl.isCurrent(e.id)), { at: 0 }); });
  const stopped = await page.waitForFunction(() => window.__errNotices > 0 && window.RoshPlayer.paused && document.querySelector('.dock [data-toggle]').dataset.state === 'paused', null, { timeout: 15000 }).then(() => true, () => false);
  await page.waitForTimeout(1000);
  check(stopped && await page.evaluate(() => window.__errNotices === 1), 'הקלטה שלא נטענה: הנגן מוצג כעצור, עם הודעת שגיאה אחת');
  globalThis.streamDown = false;
  await page.click('.dock [data-toggle]');
  check(await page.waitForFunction(() => !window.RoshPlayer.paused && window.RoshPlayer.time > 0.3, null, { timeout: 10000 }).then(() => true, () => false), 'אחרי שגיאת טעינה, ▶ מנגן שוב כשהשרת חזר');
  await page.evaluate(() => window.RoshPlayer.pause());
}
// קישור "#" שהדף מטפל בו (כמו "כניסה בחלון נפרד" באזור האישי) אינו ניווט: הדף לא נטען מחדש
const urlBeforeHash = page.url();
await page.evaluate(() => {
  document.querySelector('.shell').dataset.probe = '1';
  const a = document.createElement('a'); a.href = '#'; a.id = 't-hash'; a.textContent = 'בדיקה';
  document.getElementById('main').appendChild(a);
  document.addEventListener('click', (e) => { if (e.target.closest('#t-hash')) e.preventDefault(); });   // נרשם אחרי router.js, כמו בדפים
});
await page.click('#t-hash');
await page.waitForTimeout(400);
check(await page.evaluate(() => document.querySelector('.shell')?.dataset.probe === '1') && page.url() === urlBeforeHash, 'קישור "#" לא טוען את הדף מחדש');
await page.evaluate(() => document.getElementById('t-hash')?.remove());
check(await page.evaluate(() => { const f = window.RoshUI.fmtDuration; return f(3599) === 'שעה' && f(7195) === 'שעתיים' && f(3725) === 'שעה ו־2 דקות' && f(2700) === '45 דקות' && f(60) === 'דקה אחת'; }), 'אורך בשעות ודקות מעוגל נכון (3599 שניות = שעה, לא "60 דקות")');

/* ---------- דף תוכנית ---------- */
const featured = await page.evaluate(() => ({ slug: window.RoshStore.featured().slug, title: window.RoshStore.featured().title }));
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(featured.slug)}`);
await page.waitForSelector('#episode .ep-hero');
check((await page.locator('#episode h1').innerText()).includes(featured.title.slice(0, 12)), 'דף התוכנית נטען לפי הכתובת');
check((await page.locator('iframe').count()) === 0, 'אין נגן חיצוני בדף התוכנית');
check(!(await page.locator('#main').innerText()).includes('Drive'), 'שום אזכור של ספק האחסון בדף התוכנית');
check((await page.locator('#episode a[download]').count()) === 1, 'כפתור הורדת ההקלטה');
check((await page.locator('#episode [data-later]').count()) === 1 && (await page.locator('#episode [data-queue]').count()) === 1 && (await page.locator('#episode [data-like]').count()) === 1, 'כפתורי לאחר כך, תור ואהבתי');
check((await page.locator('.theme-toggle').count()) === 1, 'כפתור מצב בהיר/כהה בכותרת');
await page.click('#episode [data-queue]');
check(await page.evaluate(() => window.RoshStore.queue.list().length === 1), 'התוכנית נוספה לתור');
await page.click('#episode [data-play]');
await page.waitForSelector('.dock.open');
check((await page.locator('#prevnext a').count()) >= 1, 'קישורי קודמת/הבאה');
check((await page.locator('#more .ep-card').count()) >= 1, 'עוד מאותה תקופה');
await page.goto(`${BASE}/archive.html`);
await page.waitForSelector('#results .ep-card');
await page.fill('#q', 'מצעךד');
await page.waitForFunction(() => document.querySelectorAll('#results .ep-card').length < 86);
check((await page.locator('#results .ep-card').count()) > 0, 'חיפוש סולח על טעות הקלדה');
check(await page.evaluate(() => window.RoshStore.suggest('מצאד') === 'מצעד'), '"אולי התכוונתם ל…" מציע את המילה הנכונה');
await page.fill('#q', 'קוי מתאר');
await page.waitForFunction(() => document.querySelector('#results .ep-card b')?.textContent === 'קווי מתאר', null, { timeout: 5000 }).catch(() => {});
check((await page.locator('#results .ep-card b').first().innerText()) === 'קווי מתאר', 'חיפוש סולח על כתיב חסר ("קוי" מוצא את "קווי")');
check(await page.evaluate(() => window.RoshStore.searchEpisodes('בפטריוטים').some((e) => e.title === 'עולמות של פטריוטים')), 'חיפוש מתעלם מאותיות שימוש בתחילת מילה (ב־, ה־, ל־…)');
check(await page.evaluate(() => window.RoshStore.searchEpisodes('xyzxyz').length === 0), 'חיפוש סלחני לא ממציא תוצאות');
check(await page.evaluate(() => { const r = window.RoshStore.searchEpisodes('תוכנית 89'); return r.length === 1 && r[0].number === 89; }), 'חיפוש "תוכנית 89" (התווית שעל הכרטיס) מוצא את תוכנית 89');
{
  // תוכניות בלי תאריך נשארות בין השכנות שלהן במספר — בארכיון, בקודמת/הבאה ובנגן
  const seq = await page.evaluate(() => { const n = window.RoshStore.episodes().map((e) => e.number).filter((x) => x != null); const i = n.indexOf(66); return n.slice(i, i + 10).join(' '); });
  check(seq === '66 65 64 63 62 61 60 59 58 57', `סדר התוכניות לפי המספר גם כשחסר תאריך (${seq})`);
}
// הכריכה של משדר התוצאות מוצגת באתר בלבד: הניהול (טיוטה ופרסום) מקבל את הכריכה שבקטלוג
check(await page.evaluate(() => window.RoshStore.admin.normalize({ episodes: [{ id: 'x', number: 90, title: 'מצעד האלבומים 25 שנות מוזיקה ', cover: 'https://example.com/c.jpg' }] }).episodes[0].cover === 'https://example.com/c.jpg'), 'הכריכה המיוחדת לא נכנסת לנתונים שהניהול מפרסם');
check(await page.evaluate(() => { const b = (from) => window.RoshStore.bannerActive({ enabled: true, text: 'x', from, until: '', sites: { program: true } }); return !b('2999-01-01') && b('2000-01-01') && b(''); }), 'הודעה מתוזמנת מופיעה רק מיום ההתחלה');
check(await page.evaluate(() => { const H = window.RoshHoliday; const on = (d) => H.on(new Date(`${d}T12:00:00Z`)); return on('2026-12-07')?.candles === 3 && on('2027-03-23')?.key === 'purim' && on('2026-09-26')?.key === 'sukkot' && on('2026-09-21')?.quiet && on('2026-11-01') === null; }), 'מצב חג לפי הלוח העברי (חנוכה — נר שלישי, פורים באדר ב׳, סוכות, יום כיפור שקט)');
await page.goto(`${BASE}/index.html?holiday=purim`);
await page.waitForSelector('.site-header .brand');
check((await page.locator('.brand .holiday-line').innerText()).includes('פורים שמח') && await page.evaluate(() => document.body.classList.contains('holiday-purim')), 'בחג: ברכה בכותרת במקום הסיסמה, וגוון חגיגי');
await page.goto(`${BASE}/archive.html?holiday=off`);
await page.waitForSelector('#results .ep-card');
check(!(await page.locator('.brand .holiday-line').count()), '?holiday=off — בלי קישוטי חג');
await page.goto(`${BASE}/episode.html?ep=לא-קיים`);
await page.waitForSelector('#episode .state.error');
check(true, 'תוכנית שלא קיימת מציגה הודעה ברורה');

/* ---------- האזור האישי ---------- */
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(featured.slug)}`);
await page.waitForSelector('#episode .ep-hero');
await page.click('#episode [data-play]');
await page.waitForSelector('.dock.open');
await page.click('.site-nav .me-link');
await page.waitForSelector('#me-profile .profile-hero');
check((await page.locator('[data-google]').count()) === 1, 'האזור האישי מציע התחברות');
check((await page.locator('#me-profile a[data-admin-go]').count()) === 0, 'בלי כפתור ניהול למי שלא מחובר');
check((await page.locator('#me-history .row').count()) >= 1, 'בביקור הנוכחי: ההיסטוריה מציגה את מה שנוגן');
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /^rosh:(later|pos:|history|prefs|last)/.test(k)))), 'בלי התחברות שום נתון אישי לא נשמר במכשיר');
await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
await page.reload();
await page.waitForSelector('#me-profile .profile-hero');
check((await page.locator('.site-nav .admin-link').count()) === 1, 'מנהל מחובר רואה את כפתור הניהול בכותרת');
check((await page.locator('#me-profile a[data-admin-go]').count()) === 1, 'מנהל מחובר רואה "מעבר לניהול" באזור האישי');
check(/^https:\/\/[^/]+\/admin#prog-programs$/.test(await page.locator('.site-nav .admin-link').getAttribute('href')), 'הקישור לניהול מוביל ישר לדף הניהול של אתר הסקר, בלי דף ביניים');
await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'user@example.com', name: 'מאזין', isAdmin: false } })));
await page.reload();
await page.waitForSelector('#me-profile .profile-hero');
check((await page.locator('.site-nav .admin-link').count()) === 0, 'מאזין רגיל מחובר לא רואה ניהול');
check((await page.locator('#me-profile h1').innerText()).includes('מאזין'), 'האזור האישי מברך בשם');
await page.evaluate(() => localStorage.removeItem('rosh:cf:session'));

/* ---------- ניהול: השער ---------- */
await page.goto(`${BASE}/admin.html?standalone=1`);   // בלי standalone הדף עובר לניהול המשותף באתר הסקר
await page.waitForSelector('#admin-gate');
await page.waitForTimeout(500);
check(await page.evaluate(() => document.body.classList.contains('admin-locked')), 'אזור הניהול נעול למי שלא מחובר');

/* ---------- שרת איטי: הדף לא נשאר ריק ----------
   מיד אחרי פריסה של ה־Worker, או כשמופע חדש שלו מתעורר, הקטלוג יכול להתעכב. הדף מחכה
   לו עד 8 שניות ואז מציג את העותק השמור באתר, במקום לחכות בלי סוף — ובלי הודעת כשל,
   כי שום דבר לא נכשל. שרת שעונה בשגיאה כן מקבל את ההודעה "החיבור נכשל". */
for (const mode of ['slow', 'down']) {
  const label = mode === 'slow' ? 'שרת איטי' : 'שרת בתקלה';
  const sctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
  // כל הודעה שהופיעה נרשמת — גם כזו שכבר נסגרה לבד עד שהבדיקה מסתכלת
  await sctx.addInitScript(() => {
    window.__notices = [];
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.classList?.contains('notice')) window.__notices.push(n.textContent); })
      .observe(document, { childList: true, subtree: true });
  });
  const p = await sctx.newPage();
  // כמו מבקר שבוחר להמשיך בלי להתחבר, סוגרים את ההצעה לפני פעולות בדף.
  await p.addLocatorHandler(p.locator('#login-welcome[open]'), async () => {
    await p.locator('#login-welcome .welcome-later[data-dismiss]').click();
  });
  await p.route('**/api/program/catalog*', (route) => {
    if (mode === 'down') route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    /* slow: לא עונים — שרת תקוע */
  });
  const t0 = Date.now();
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  const shown = await p.waitForSelector('#featured .card', { timeout: 15000 }).then(() => true, () => false);
  check(shown, `${label}: דף הבית מוצג מהעותק השמור (${Math.round((Date.now() - t0) / 1000)} שניות)`);
  await p.waitForTimeout(300);
  const notices = (await p.evaluate(() => window.__notices)).join(' | ');
  if (mode === 'slow') check(!/נכשל/.test(notices), `${label}: בלי הודעת כשל${notices ? ` (${notices})` : ''}`);
  else check(/החיבור למקור הנתונים נכשל/.test(notices), `${label}: הודעה שמוצג העותק השמור${notices ? ` (${notices})` : ''}`);
  await sctx.close();
}

/* ---------- תקלה בשרת אינה התנתקות ----------
   כשמסד הסשנים לא עונה השרת עונה 503. הסשן במכשיר נשאר והכותרת עדיין מציגה את המאזין
   כמחובר. רק 401 (הטוקן נדחה) מוחק את הסשן — וגם אז מקומית בלבד, בלי /logout שמנתק
   את החשבון מכל המכשירים. */
{
  const seed = { token: 'test-token', user: { email: 'user@example.com', name: 'מאזין', isAdmin: false } };
  const api = (status, body) => ({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' }, body: JSON.stringify(body) });
  const mock = (answers, calls) => (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/program\//, '');
    if (req.method() === 'OPTIONS') return route.fulfill(api(204, {}));
    calls.push(`${req.method()} ${path}`);
    const answer = answers[path];
    return answer ? route.fulfill(api(answer.status, answer.body)) : route.abort();
  };
  const open = async (answers, url) => {
    const ctx2 = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
    const p = await ctx2.newPage();
    // כמו מבקר שבוחר להמשיך בלי להתחבר, סוגרים את ההצעה לפני פעולות בדף.
    await p.addLocatorHandler(p.locator('#login-welcome[open]'), async () => {
      await p.locator('#login-welcome .welcome-later[data-dismiss]').click();
    });
    const calls = [];
    await p.route('**/api/program/**', mock(answers, calls));
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate((s) => localStorage.setItem('rosh:cf:session', JSON.stringify(s)), seed);
    await p.goto(`${BASE}/${url}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.site-nav .me-link');
    await p.waitForTimeout(1500);
    const session = await p.evaluate(() => localStorage.getItem('rosh:cf:session'));
    const signed = (await p.locator('.site-nav .me-link.signed').count()) === 1;
    await ctx2.close();
    return { calls, session, signed };
  };
  const down = { status: 503, body: { error: 'השרת לא זמין כרגע.', unavailable: true } };
  const outage = await open({ me: down, userdata: down, subscribe: down, likes: down }, 'me.html');
  check(!!outage.session && outage.signed, `שרת בתקלה (503): הסשן במכשיר נשמר והכותרת עדיין "מחובר"${outage.signed ? '' : ` (calls: ${outage.calls.join(', ')})`}`);
  const rejected = await open({ me: { status: 200, body: { user: seed.user } }, userdata: { status: 200, body: { data: null, updatedAt: null } }, subscribe: { status: 401, body: { error: 'צריך להתחבר.' } }, likes: { status: 200, body: { counts: {}, mine: [] } } }, 'index.html');
  check(!rejected.session, 'טוקן שנדחה (401): הסשן במכשיר נמחק');
  check(!rejected.calls.some((c) => /logout/.test(c)), `טוקן שנדחה: בלי /logout שמנתק את החשבון מכל המכשירים (calls: ${rejected.calls.join(', ')})`);
}

/* ---------- הנתונים האישיים בזמן ניגון ----------
   המיקום מתעדכן כל כמה שניות בזמן ניגון: הוא נשמר בחשבון יחד עם זמן ההאזנה (פעם בחצי דקה,
   ובעצירה) — לא שמירה מלאה כל 5 שניות — והאזור האישי לא מצויר מחדש (הפוקוס נשאר בבורר).
   לפני שמירה קוראים מהשרת וממזגים: מה שנשמר בינתיים ממכשיר אחר לא נדרס. */
{
  const user = { email: 'user@example.com', name: 'מאזין', isAdmin: false };
  let server = { later: [] };
  let auth = true;   // false: הטוקן נדחה (401), כמו אחרי "התנתקות מכל המקומות" במכשיר אחר
  const calls = [];
  const c3 = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
  const rate = 8000, len = rate * 600, wav = Buffer.alloc(44 + len, 0x80);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + len, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(len, 40);
  await c3.route('**/api/program/**', (route) => {
    const req = route.request(), m = req.method(), path = new URL(req.url()).pathname.replace(/^.*\/api\/program\//, '');
    const json = (body, status = 200) => route.fulfill({ status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' }, body: JSON.stringify(body) });
    if (m === 'OPTIONS') return json({});
    if (path.startsWith('stream/')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'audio/wav' }, body: wav });
    calls.push(`${m} ${path}`);
    if (path === 'userdata') { if (m === 'PUT') server = req.postDataJSON().data; return json(m === 'GET' ? { data: server, updatedAt: null } : { ok: true }); }
    if (path === 'me') return auth ? json({ user }) : json({ user: null }, 401);
    if (path === 'likes') return json({ counts: {}, mine: [] });
    return route.abort();
  });
  const p = await c3.newPage();
  await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.evaluate((u) => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: u })), user);
  await p.goto(`${BASE}/me.html`);
  await p.waitForSelector('#me-prefs [data-pref-theme]');
  const id = await p.evaluate(() => { const ep = window.RoshStore.episodes().find((e) => e.stream); window.RoshPlayer.load(ep, { at: 30 }); return ep.id; });
  await p.waitForFunction(() => window.RoshPlayer.time > 1, null, { timeout: 15000 });
  await p.waitForTimeout(3000);   // השמירה של "נוגן" (היסטוריה)
  await p.focus('#me-prefs [data-pref-theme]');
  calls.length = 0;
  await p.waitForTimeout(12000);
  const puts = calls.filter((c) => c === 'PUT userdata').length;
  const focused = await p.evaluate(() => !window.RoshPlayer.paused && document.activeElement?.matches('[data-pref-theme]'));
  check(puts === 0 && focused, `בזמן ניגון: בלי שמירה מלאה כל 5 שניות (${puts} שמירות ב־12 שניות), והפוקוס באזור האישי נשאר במקום`);
  server = { ...server, later: ['from-other-device', ...(server.later || [])] };   // מכשיר אחר שמר בינתיים
  await p.evaluate(() => window.RoshPlayer.pause());
  await p.waitForFunction(() => !window.RoshStore.me.dirty && !window.RoshStore.me.saving, null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
  check(server.later?.includes('from-other-device') && server.positions?.[id]?.dur > 0 && server.listenSeconds > 0, `בעצירה המיקום וזמן ההאזנה נשמרים, בלי לדרוס את מה שנשמר ממכשיר אחר (later: ${JSON.stringify(server.later)})`);

  /* זמן ההאזנה לא מוכפל. נתונים שכבר נקראו מהחשבון אינם "ביקור לפני התחברות": גם אחרי שהסשן נדחה
     (401 בבדיקת המנהל — כמו אחרי "התנתקות מכל המקומות" במכשיר אחר), קריאה בלי סשן, וכניסה מחדש —
     הסכום בחשבון נשאר כפי שהיה (הגרסה הקודמת הכפילה אותו בכל מחזור כזה). */
  const before = server.listenSeconds;
  auth = false;
  await p.evaluate(() => window.RoshStore.sb.isAdmin());
  const left = await p.evaluate(() => ({ account: window.RoshStore.me.account, seconds: window.RoshStore.me.data.listenSeconds, session: localStorage.getItem('rosh:cf:session') }));
  check(!left.account && left.seconds === 0 && !left.session, `הטוקן נדחה: הסשן והנתונים של החשבון יוצאים מהדף (${JSON.stringify(left)})`);
  auth = true;
  await p.evaluate(async (u) => {
    await window.RoshStore.me.load();   // קריאה בלי סשן (כמו בחזרה ללשונית)
    window.RoshStore.sb.session = { token: 'test', user: u };
    await window.RoshStore.me.load(); await window.RoshStore.me.save(true);   // כמו בכניסה עם Google
  }, user);
  const after = await p.evaluate(() => window.RoshStore.me.data.listenSeconds);
  check(server.listenSeconds === before && after === before, `כניסה מחדש אחרי דחיית הטוקן: זמן ההאזנה נשאר ${before} (בחשבון ${server.listenSeconds}, בדף ${after})`);
  // הסשן לא נקרא לרגע (קריאה בלי משתמש) ואז נקרא שוב: הנתונים שבדף עדיין של החשבון — מיזוג לפי ההפרש
  await p.evaluate(async () => {
    const s = localStorage.getItem('rosh:cf:session'); localStorage.removeItem('rosh:cf:session'); window.RoshStore.sb._mem = null;
    await window.RoshStore.me.load();
    localStorage.setItem('rosh:cf:session', s);
    await window.RoshStore.me.load(); await window.RoshStore.me.save(true);
  });
  const again = await p.evaluate(() => ({ account: window.RoshStore.me.account, seconds: window.RoshStore.me.data.listenSeconds }));
  check(server.listenSeconds === before && again.seconds === before && again.account === user.email, `סשן שלא נקרא לרגע: זמן ההאזנה נשאר ${before} (בחשבון ${server.listenSeconds}, בדף ${again.seconds})`);
  // ערך שבור מגרסה קודמת (יותר ממה שאפשר לצבור מאז תחילת הספירה) מתאפס בקריאה
  server = { ...server, listenSeconds: 892850216248800 };
  await p.evaluate(() => window.RoshStore.me.load());
  const sane = await p.evaluate(() => window.RoshStore.me.data.listenSeconds);
  check(sane === 0, `זמן האזנה בלתי אפשרי בחשבון מתאפס בדף (${sane})`);
  await c3.close();
}

/* ---------- עדכון בכוח (app-update.js) לא קוטע האזנה ----------
   פריסה חדשה: version.json שונה מה־?v= של הדף. הנגן (new Audio()) לא נמצא ב־DOM ו־body.is-playing
   יורד בזמן טעינת ההקלטה — ובכל זאת אסור לטעון את הדף כשלוחצים ▶ וההקלטה עוד נטענת, וגם לא כשיש
   טקסט שנכתב ועוד לא נשלח. כשהניגון נעצר — העדכון נטען. */
{
  const uctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
  await uctx.addInitScript(() => { HTMLDialogElement.prototype.showModal = function () {}; });   // בלי הצעת ההתחברות (חלון פתוח מחזיק את העדכון)
  await uctx.route('**/api/program/stream/**', () => { /* לא עונים: ההקלטה נשארת בטעינה */ });
  await uctx.route('**/media/**', () => {});
  let deployed = 'old';   // הגרסה "עולה" רק אחרי שהדף נטען
  await uctx.route(/\/version\.json(\?|$)/, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: deployed }) }));
  await uctx.route(/\/index\.html(\?|$)/, async (route) => {
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()).replace('assets/js/app-update.js"', 'assets/js/app-update.js?v=old"') });
  });
  const p = await uctx.newPage();
  let loads = 0;
  p.on('domcontentloaded', () => loads++);
  await p.goto(`${BASE}/index.html`);
  await p.waitForSelector('#featured [data-play]');
  await p.waitForTimeout(500);
  await p.evaluate(() => { const ta = document.createElement('textarea'); ta.id = 't-unsent'; document.getElementById('main').appendChild(ta); });
  await p.fill('#t-unsent', 'הודעה שעוד לא נשלחה');
  deployed = 'new';
  await p.evaluate(() => { document.activeElement?.blur?.(); window.RoshAppUpdate.check(); });
  await p.waitForTimeout(4000);
  check(loads === 1, 'עדכון בכוח לא טוען את הדף כשיש טקסט שלא נשלח (גם כשהפוקוס כבר לא בתיבה)');
  await p.evaluate(() => document.getElementById('t-unsent').remove());
  await p.click('#featured [data-play]');
  await p.waitForSelector('.dock.open');
  await p.waitForTimeout(4000);
  check(loads === 1 && (await p.locator('.dock.open').count()) === 1, 'עדכון בכוח לא טוען את הדף בזמן שההקלטה נטענת (הנגן מחוץ ל־DOM)');
  await p.evaluate(() => window.RoshPlayer.pause());
  for (let i = 0; i < 40 && loads < 2; i++) await p.waitForTimeout(250);
  check(loads === 2, 'כשהניגון נעצר — העדכון נטען');
  await uctx.close();
}


/* ---------- טלפון עם מגע: רוחב, ניווט ופקדי נגן ---------- */
{
  const mobile = await browser.newContext({ locale: 'he-IL', isMobile: true, hasTouch: true, viewport: { width: 320, height: 740 } });
  const mp = await mobile.newPage();
  await mp.addLocatorHandler(mp.locator('#login-welcome[open]'), async () => {
    await mp.locator('#login-welcome .welcome-later[data-dismiss]').click();
  });
  for (const width of [320, 360, 390, 430]) {
    await mp.setViewportSize({ width, height: 740 });
    for (const path of ['index.html', 'archive.html', 'updates.html', 'me.html']) {
      await mp.goto(BASE + '/' + path);
      await mp.waitForSelector('.site-header');
      check(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'אין גלילה אופקית בטלפון: ' + path + ' / ' + width);
    }
    await mp.goto(BASE + '/index.html');
    await mp.waitForSelector('#featured [data-play]');
    await mp.locator('#featured [data-play]').click();
    await mp.waitForSelector('.dock.open');
    const targets = await mp.locator('.dock-controls button, .dock-controls select').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, right: r.right };
    }));
    check(targets.every(r => r.w >= 44 && r.h >= 44 && r.x >= -1 && r.right <= width + 1), 'כפתורי הנגן נגישים למגע ונכנסים למסך / ' + width);
    await mp.locator('.dock [data-close]').click();
  }
  await mobile.close();
}

/* ---------- ממשיכים בדיוק מאיפה שעצרתם ---------- */
// כמו באייפון: קפיצה שנעשית לפני שההקלטה נטענה נבלעת. הנגן צריך להחיל אותה כשההקלטה מוכנה,
// ובינתיים לא לדרוס את המיקום השמור ב־0.
{
  const rctx = await browser.newContext({ locale: 'he-IL', ignoreHTTPSErrors: !!process.env.HTTPS_PROXY });
  await rctx.addInitScript(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return d.get.call(this); }, set(v) { if (this.readyState >= 1) d.set.call(this, v); } });
  });
  // הקלטה שקטה של 50 דקות (WAV, 8000 דגימות בשנייה) עם תמיכה ב־Range, כמו ה־Worker
  const secs = 3000, data = 8000 * secs, wav = Buffer.alloc(44 + data, 128);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + data, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(data, 40);
  await rctx.route(/\/api\/program\/stream\/|drive\.usercontent\.google\.com/, (route) => {
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    if (!m) return route.fulfill({ status: 200, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' }, body: wav });
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : wav.length - 1;
    return route.fulfill({ status: 206, headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${wav.length}` }, body: wav.subarray(a, b + 1) });
  });
  const rp = await rctx.newPage();
  await rp.goto(BASE + '/index.html');
  await rp.waitForFunction(() => window.RoshStore && window.RoshPlayer);
  const r = await rp.evaluate(async () => {
    await window.RoshStore.ready;
    const S = window.RoshStore, ep = S.state.data.episodes.find((e) => e.stream && e.visible);
    S.positions.set(ep.id, 1234, 3000);
    window.RoshPlayer.load(ep, { autoplay: false, quiet: true });
    const before = window.RoshPlayer.time;
    window.RoshPlayer.play();
    await new Promise((ok) => setTimeout(ok, 2500));
    const after = window.RoshPlayer.time;
    window.RoshPlayer.pause();
    await new Promise((ok) => setTimeout(ok, 200));
    return { before, after, saved: S.positions.get(ep.id)?.t };
  });
  check(r.before === 1234, `המיקום השמור נשמר גם לפני שההקלטה נטענה (${r.before})`);
  check(r.after >= 1234 && r.after < 1245, `הניגון ממשיך מהמקום המדויק (${Math.round(r.after)})`);
  check(r.saved >= 1234 && r.saved < 1245, `בעצירה נשמר המקום המדויק, לא 0 (${r.saved})`);

  // מנהל שמאזין ועובר לניהול: הקישור נושא את התוכנית והשנייה הנוכחית, כדי שהנגן של דף הניהול ימשיך משם
  await rctx.route((u) => u.pathname === '/admin' || /\/api\/program\/handoff/.test(u.pathname), (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'x' }) })
    : route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ניהול</title>' }));
  await rp.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
  await rp.reload();
  await rp.waitForSelector('.site-nav .admin-link');
  const epId = await rp.evaluate(async () => {
    await window.RoshStore.ready;
    const ep = window.RoshStore.state.data.episodes.find((e) => e.stream && e.visible);
    window.RoshPlayer.load(ep, { at: 0, autoplay: false, quiet: true });
    return ep.id;
  });
  await rp.locator('.dock [data-toggle]').click();
  await rp.waitForFunction(() => !window.RoshPlayer.paused && window.RoshPlayer.time > 0.3, null, { timeout: 15000 }).catch(() => {});
  await rp.evaluate(() => window.RoshPlayer.seek(1500));
  await rp.locator('.site-nav .admin-link').click();
  await rp.waitForURL(/handoff\/x#/, { timeout: 10000 }).catch(() => {});
  const m = /#prog-programs&resume=([^&]+)&t=(\d+)$/.exec(rp.url());
  check(!!m && decodeURIComponent(m[1]) === epId && Number(m[2]) >= 1500 && Number(m[2]) < 1510, `בזמן האזנה הקישור לניהול נושא את התוכנית והשנייה הנוכחית (${rp.url().split('#')[1] || ''})`);
  await rctx.close();
}

/* ---------- סיכום ---------- */
// ה־Worker מאשר CORS רק ל־origin של האתר הפרוס, ולכן מול שרת מקומי הקטלוג נופל
// לעותק שבמאגר (זה מה שהבדיקה בודקת) — שגיאת ה־CORS הזו אינה תקלה באתר.
const realErrors = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_(FAILED|TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED)|net::ERR_TOO_MANY_RETRIES|blocked by CORS policy|accounts\.google\.com|GSI_LOGGER|status of 403 \(\)/i.test(e));
check(realErrors.length === 0, `אין שגיאות JavaScript${realErrors.length ? `: ${realErrors.join(' | ')}` : ''}`);
await browser.close();
if (failures.length) { console.error(`\n${failures.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
