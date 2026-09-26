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
const page = await ctx.newPage();
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
// קישור "#" שהדף מטפל בו (כמו "כניסה דרך אתר הסקר" באזור האישי) אינו ניווט: הדף לא נטען מחדש
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
check((await page.locator('[data-login]').count()) === 1, 'האזור האישי מציע התחברות');
check((await page.locator('#me-profile a[href="admin.html"]').count()) === 0, 'בלי כפתור ניהול למי שלא מחובר');
check((await page.locator('#me-history .row').count()) >= 1, 'בביקור הנוכחי: ההיסטוריה מציגה את מה שנוגן');
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /^rosh:(later|pos:|history|prefs|last)/.test(k)))), 'בלי התחברות שום נתון אישי לא נשמר במכשיר');
await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
await page.reload();
await page.waitForSelector('#me-profile .profile-hero');
check((await page.locator('.site-nav .admin-link').count()) === 1, 'מנהל מחובר רואה את כפתור הניהול בכותרת');
check((await page.locator('#me-profile a[href="admin.html"]').count()) === 1, 'מנהל מחובר רואה "מעבר לניהול" באזור האישי');
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

/* ---------- סיכום ---------- */
// ה־Worker מאשר CORS רק ל־origin של האתר הפרוס, ולכן מול שרת מקומי הקטלוג נופל
// לעותק שבמאגר (זה מה שהבדיקה בודקת) — שגיאת ה־CORS הזו אינה תקלה באתר.
const realErrors = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_(FAILED|TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|CONNECTION_REFUSED)|net::ERR_TOO_MANY_RETRIES|blocked by CORS policy|accounts\.google\.com|GSI_LOGGER|status of 403 \(\)/i.test(e));
check(realErrors.length === 0, `אין שגיאות JavaScript${realErrors.length ? `: ${realErrors.join(' | ')}` : ''}`);
await browser.close();
if (failures.length) { console.error(`\n${failures.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
