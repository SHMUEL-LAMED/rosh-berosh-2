/* בדיקת דפדפן לטיוטת המייל למאזינים (mail.html והחלון באזור הניהול) — מול Worker מדומה,
   ספריית Google מדומה ו־Gmail API מדומה. בלי רשת ובלי חשבון אמיתי.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/mail-smoke.mjs   (בחלון שני; דורש Playwright כמו שאר הבדיקות) */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const API = 'https://rosh-berosh.smwlyqswkwt232.workers.dev';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) fails.push(msg); };
const catalog = JSON.parse(readFileSync(new URL('../data/episodes.json', import.meta.url), 'utf8'));
const EP = catalog.episodes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[3];
const SUBS = ['one@example.com', 'Two@Example.com', 'two@example.com', 'three@example.com', 'not-an-email'];

let admin = true, subsMode = 'ok', gmailMode = 'ok', userdata = null, published = null, dropDraft = 0;   // dropDraft=n: יצירת הטיוטה ה־n מעכשיו נכשלת (ניתוק רשת)
const listAdds = [];   // מה שנשלח להוספה לרשימת התפוצה
const drafts = []; let tokenRequests = 0;
const alive = new Set(), deleted = [], sent = [];   // ג'ימייל מדומה: טיוטות שעוד קיימות, מה שנמחק, ומה שנשלח

// שם קובץ בעברית (הורדת ‎.eml) דורש שהדפדפן ירוץ עם UTF-8
const browser = await chromium.launch({ ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}), env: { ...process.env, LANG: /utf-?8/i.test(process.env.LANG || '') ? process.env.LANG : 'C.UTF-8' } });
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1360, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,range', 'access-control-allow-methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS' };
await ctx.route(`${API}/**`, async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname; const m = req.method(); const auth = req.headers().authorization;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return json({});
  if (p === '/api/program/me') return auth ? json({ user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: admin } }) : json({ user: null }, 401);
  if (p === '/api/program/catalog' && m === 'GET') return json({ ...(published || catalog), ...(auth ? { versionId: 'v1' } : {}) });
  if (p === '/api/program/catalog' && m === 'POST') { const b = req.postDataJSON(); published = { seasons: b.seasons, episodes: b.episodes, settings: b.settings }; return json({ ok: true, versionId: 'v2', notified: 0 }); }
  if (p === '/api/program/draft' && m === 'GET') return json({ draft: null });
  if (p === '/api/program/draft') return json({ ok: true, updatedAt: new Date().toISOString(), by: 'admin@example.com' });
  if (p === '/api/program/userdata' && m === 'GET') return auth ? json({ data: userdata }) : json({ error: 'x' }, 401);
  if (p === '/api/program/userdata' && m === 'PUT') { userdata = req.postDataJSON().data; return json({ ok: true }); }
  if (p === '/api/program/subscribers' && m === 'POST') {
    if (!admin) return json({ error: 'אין הרשאת ניהול.' }, 403);
    const content = req.postDataJSON().content; listAdds.push(content);
    const emails = [...new Set((content.match(/[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
    const fresh = emails.filter((e) => !SUBS.some((x) => x.toLowerCase() === e));
    SUBS.push(...fresh);
    return json({ ok: true, found: emails.length, added: fresh.length, duplicates: emails.length - fresh.length, optedOut: 0, skipped: 0 });
  }
  if (p === '/api/program/subscribers') {
    if (!admin) return json({ error: 'אין הרשאת ניהול.' }, 403);
    if (subsMode === 'missing') return json({ error: 'הנתיב לא נמצא.' }, 404);
    return json({ subscribers: SUBS.map((email) => ({ email, name: '' })), active: SUBS.length });
  }
  if (p === '/api/program/likes') return json({ counts: {}, mine: [] });
  return json({ error: 'לא נמצא' }, 404);
});
// Gmail API מדומה
await ctx.route('https://gmail.googleapis.com/**', async (route) => {
  const req = route.request(); const p = new URL(req.url()).pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return json({});
  if (req.headers().authorization !== 'Bearer tok-1') return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
  if (gmailMode === 'disabled') return json({ error: { code: 403, message: 'Gmail API has not been used in project 601586229891 before or it is disabled.', status: 'PERMISSION_DENIED' } }, 403);
  if (p.endsWith('/profile')) return json({ emailAddress: 'admin@example.com' });
  if (p.endsWith('/drafts') && req.method() === 'POST' && dropDraft && --dropDraft === 0) return route.abort('failed');
  if (p.endsWith('/drafts') && req.method() === 'POST') { const raw = req.postDataJSON().message.raw; drafts.push(Buffer.from(raw, 'base64url').toString('utf8')); alive.add(`r-${drafts.length}`); return json({ id: `r-${drafts.length}`, message: { id: `18ab${drafts.length}`, threadId: 't' } }); }
  const dm = p.match(/\/drafts\/([^/]+)$/);
  if (dm && req.method() === 'GET') return alive.has(dm[1]) ? json({ id: dm[1], message: { id: 'm' } }) : json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
  if (dm && req.method() === 'DELETE') { if (!alive.delete(dm[1])) return json({ error: { code: 404 } }, 404); deleted.push(dm[1]); return route.fulfill({ status: 204, headers: cors, body: '' }); }
  if (p.endsWith('/messages/send') && req.method() === 'POST') { sent.push(Buffer.from(req.postDataJSON().raw, 'base64url').toString('utf8')); return json({ id: `s-${sent.length}` }); }
  return json({ error: { code: 404 } }, 404);
});
await ctx.route('https://accounts.google.com/**', (route) => route.abort());
await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route('https://media.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
// ספריית Google מדומה: כפתור כניסה, והרשאה לג'ימייל (מחזירה טוקן)
await ctx.exposeFunction('__tokenRequested', () => { tokenRequests++; });
await ctx.addInitScript(() => {
  window.google = { accounts: {
    id: { initialize() {}, renderButton(el) { el.innerHTML = '<button type="button">Google</button>'; }, prompt() {} },
    oauth2: {
      initTokenClient(cfg) { window.__tokenCfg = cfg; return { requestAccessToken(o) { window.__tokenRequested(); window.__lastHint = o?.login_hint; setTimeout(() => cfg.callback(window.__deny ? { error: 'access_denied' } : { access_token: 'tok-1', expires_in: 3600, scope: cfg.scope }), 30); } }; },
      hasGrantedAllScopes: (r, s) => String(r.scope || '').split(' ').includes(s),
    },
  } };
});

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
await page.addLocatorHandler(page.locator('#account-chooser[open]'), async () => {
  await page.locator('#account-chooser [data-cancel]').click();
});
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('dialog', (d) => d.accept());
const frameText = () => page.frameLocator('[data-m-frame]').locator('body').innerText();
const frameHtml = () => page.evaluate(() => document.querySelector('[data-m-frame]').srcdoc);
const header = (mime, name) => (mime.split('\r\n\r\n')[0].replace(/\r\n /g, ' ').match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] || '';
const partOf = (mime, type) => { const m = mime.match(new RegExp(`Content-Type: ${type}; charset="UTF-8"\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n--`)); return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8') : ''; };
const subjectOf = (mime) => header(mime, 'Subject').split(' ').map((w) => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
const settle = (ms = 400) => page.waitForTimeout(ms);
const tab = (name, scope = '') => page.click(`${scope}[data-mtab="${name}"]`);
// SHOTS=<תיקייה> שומר צילומי מסך של העורך (לבדיקה בעין; לא חלק מהבדיקה)
const shot = (name, fullPage = true) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage }) : null);

/* ---------- השער ---------- */
await page.goto(`${BASE}/mail.html?standalone=1`);
await page.waitForSelector('#mail-gate:not([hidden])');
check((await page.locator('#mail-google button').count()) === 1, 'בלי חיבור: כפתור כניסה עם Google');

/* ---------- העורך עבר לדף הניהול: קישור ישן מעביר לשם, על אותה תוכנית ---------- */
{
  await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
  let target = '';
  await page.route(`${API}/api/program/handoff`, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'c0de' }) }));
  await page.route(`${API}/api/program/handoff/**`, (route) => { target = route.request().url(); return route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }); });
  await page.goto(`${BASE}/mail.html?ep=${encodeURIComponent(EP.slug)}`);
  await page.waitForURL((u) => u.href.startsWith(`${API}/api/program/handoff/`), { timeout: 15000 });
  const u = new URL(target);
  check(u.searchParams.get('mail') === EP.slug && new URL(page.url()).hash === '#prog-mail', 'קישור ישן ל־mail.html מעביר לחלק „מייל למאזינים” בדף הניהול, עם קוד מעבר ועל אותה תוכנית');
  await page.unroute(`${API}/api/program/handoff/**`); await page.unroute(`${API}/api/program/handoff`);
  await page.evaluate(() => localStorage.removeItem('rosh:cf:session')).catch(() => {});
}
await page.goto(`${BASE}/mail.html?standalone=1`);

/* ---------- מנהל מחובר: העורך ---------- */
await page.evaluate(() => localStorage.setItem('rosh:cf:session', JSON.stringify({ token: 'test', user: { email: 'admin@example.com', name: 'בדיקה', isAdmin: true } })));
await page.goto(`${BASE}/mail.html?standalone=1&ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer', { timeout: 15000 });
check((await page.locator('[data-m="ep"]').inputValue()) === EP.id, 'התוכנית מהכתובת נבחרה');
check((await page.locator('[data-m="subject"]').inputValue()).includes(EP.title), 'הנושא כולל את שם התוכנית');
await page.waitForFunction(() => document.querySelector('[data-m-frame]')?.contentDocument?.body?.innerText.includes('להאזנה באתר'));
check((await frameText()).includes(EP.title), 'התצוגה המקדימה מציגה את התוכנית');
check(await page.locator('[data-m-frame]').evaluate((f) => f.offsetHeight > 500), 'התצוגה המקדימה בגובה המייל (ה־CSP מאפשר אותה)');
{
  const html = await frameHtml();
  check(html.includes(`episode.html?ep=${encodeURIComponent(EP.slug)}&amp;utm_source=email`), 'כפתור האזנה לדף התוכנית באתר');
  check(html.includes(`${API}/api/program/download/${encodeURIComponent(EP.id)}`), 'קישור הורדה ישיר');
}
await page.waitForFunction(() => /3 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check(/3 כתובות מרשימת התפוצה/.test(await page.locator('[data-m-count]').innerText()), 'רשימת התפוצה נטענה — בלי כפילויות ובלי כתובת לא תקינה');
check((await page.locator('[data-m="to"]').inputValue()) === 'admin@example.com', 'הנמען הגלוי: החשבון המחובר');

// עריכה: סגנון, צבע ומה נכנס (לשונית "עיצוב"), והטקסט (לשונית "תוכן")
check((await page.locator('[data-mtab="content"]').getAttribute('aria-selected')) === 'true' && await page.locator('[data-panel="design"]').isHidden(), 'העורך נפתח בלשונית "תוכן"');
await tab('design');
await page.click('[data-mstyle="gold"]');
await page.fill('[data-m="accent"]', '#1d4ed8');
await page.uncheck('[data-mshow="phone"]');
await page.click('[data-mcover="none"]');
await tab('content');
await page.fill('[data-m="intro"]', 'שלום לכולם!\n\nהתוכנית החדשה כאן.');
await settle();
{
  const html = await frameHtml();
  check(html.includes('#f5f0e6') && html.includes('#1d4ed8'), 'סגנון "זהב בהיר" וצבע ההדגשה נכנסו לתצוגה');
  check(html.includes('התוכנית החדשה כאן.') && !html.includes('077-226-2271'), 'הפתיחה נערכה והטלפון הוסר');
  check(!/<img[^>]+(cover|media)/.test(html), '"בלי תמונה"');
}
// תיאור התוכנית: מתחיל מהאתר, נערך למייל בלבד
check((await page.locator('[data-m="description"]').inputValue()) === (EP.description || ''), 'שדה התיאור מתחיל מהתיאור של התוכנית באתר');
await page.fill('[data-m="description"]', 'תיאור מיוחד למייל: ראיון בלעדי ושלושה שירים חדשים.');
await page.fill('[data-m="descTitle"]', 'מה היה בתוכנית');
await settle();
{
  const html = await frameHtml();
  check(html.includes('ראיון בלעדי ושלושה שירים חדשים') && html.includes('מה היה בתוכנית'), 'התיאור שנערך והכותרת שלו בתצוגה המקדימה');
  check(await page.locator('[data-mop="desc-reset"]').isVisible(), 'אחרי עריכה: "חזרה לתיאור מהאתר"');
}
await shot('composer-desktop');
if (process.env.SHOTS) await page.locator('[data-block="intro"]').screenshot({ path: `${process.env.SHOTS}/block-intro.png` });
await page.click('[data-mview="phone"]');
await settle(200);
check(await page.locator('[data-m-frame]').evaluate((f) => f.getBoundingClientRect().width <= 392), 'תצוגת טלפון');

/* ---------- הסבר חד־פעמי לפני החיבור הראשון ל־Gmail ---------- */
check((await page.locator('[data-mop="auth-help"]').innerText()) === 'איך מחברים את Gmail?', 'קישור "איך מחברים את Gmail?" ליד הכפתור');
await page.click('[data-mop="create"]');
await page.waitForSelector('#dlg-gmail-intro[open]');
check((await page.locator('#gmail-intro-title').innerText()) === 'חיבור חד־פעמי ל־Gmail' && (await page.locator('#dlg-gmail-intro .gi-steps li').count()) === 4, 'בפעם הראשונה: חלון הסבר לפני החלון של Google, עם ארבעה צעדים');
check(tokenRequests === 0, 'חלון Google לא נפתח לפני ההסבר');
await page.click('#dlg-gmail-intro .card-foot [data-gi="cancel"]');
await settle(200);
check(tokenRequests === 0 && drafts.length === 0 && !(await page.locator('#dlg-gmail-intro').count()), '"ביטול" — בלי חיבור ובלי טיוטה');

/* ---------- יצירת הטיוטה בג'ימייל ---------- */
await page.click('[data-mop="create"]');
await page.waitForSelector('#dlg-gmail-intro[open]');
await page.click('#dlg-gmail-intro [data-gi="go"]');
check(tokenRequests === 1, '"הבנתי, המשך לאישור" פותח את חלון Google מיד, מתוך הלחיצה');
await page.waitForSelector('.mc-done', { timeout: 10000 });
check(await page.evaluate(() => window.RoshStore.prefs.get('mailAuthIntroSeen', false) === true && localStorage.getItem('rosh:mailAuthIntroSeen') === '1'), 'ההסבר נשמר כ"נראה" בחשבון ובמכשיר');
check(await page.evaluate(() => window.__tokenCfg.scope === 'https://www.googleapis.com/auth/gmail.compose' && window.__lastHint === 'admin@example.com'), 'רק הרשאת gmail.compose, לחשבון המחובר');
check(drafts.length === 1, 'נוצרה טיוטה אחת');
{
  const mime = drafts[0];
  check(header(mime, 'To') === 'admin@example.com', 'אל: החשבון המחובר');
  check(header(mime, 'Bcc').split(/,\s*/).sort().join(' ') === 'one@example.com three@example.com two@example.com', 'כל רשימת התפוצה בעותק מוסתר');
  check(subjectOf(mime) === await page.locator('[data-m="subject"]').inputValue(), 'הנושא בעברית עבר נכון');
  const html = partOf(mime, 'text/html'), text = partOf(mime, 'text/plain');
  check(html.includes('#f5f0e6') && html.includes('התוכנית החדשה כאן.'), 'הטיוטה בדיוק כמו התצוגה המקדימה');
  check(text.includes(`${API}/api/program/download/`) && text.includes('utm_source=email'), 'גרסת טקסט עם שני הקישורים');
  check(html.includes('ראיון בלעדי ושלושה שירים חדשים') && text.includes('מה היה בתוכנית:'), 'התיאור שנערך נכנס לטיוטה');
}
await shot('composer-done');
check((await page.locator('.mc-done a').first().getAttribute('href')) === 'https://mail.google.com/mail/u/?authuser=admin%40example.com#drafts?compose=18ab1', 'קישור שפותח את הטיוטה בג\'ימייל');
check((await page.locator('[data-mop="create"]').innerText()).includes('טיוטה נוספת'), 'אחרי היצירה: הכפתור מציע טיוטה נוספת');

// רשימה ארוכה: כמה טיוטות
await tab('people');
await page.fill('[data-m="chunk"]', '2');
await page.click('[data-mop="create"]');
await page.waitForFunction(() => document.querySelectorAll('.mc-done-links a.gold').length === 2, null, { timeout: 10000 });
check(drafts.length === 3 && header(drafts[1], 'Bcc').split(',').length === 2 && header(drafts[2], 'Bcc').split(',').length === 1, 'עד 2 נמענים בכל טיוטה: שתי טיוטות');
check(tokenRequests === 1, 'הטוקן נשמר בזיכרון לכמה טיוטות');

// טיוטת בדיקה אליי בלבד
await page.click('[data-mmode="me"]');
await page.click('[data-mop="create"]');
await page.waitForFunction((n) => document.querySelector('.mc-done span')?.textContent.includes('טיוטת בדיקה'), null, { timeout: 10000 });
check(drafts.length === 4 && header(drafts[3], 'To') === 'admin@example.com' && !drafts[3].includes('Bcc:'), '"רק אליי": בלי הרשימה');

// כל רשימת התפוצה רק בעותק מוסתר: גם כשמדביקים כתובות מהרשימה בשדה "אל" — הן לא נכנסות אליו
await page.click('[data-mmode="all"]');
await page.fill('[data-m="chunk"]', '400');
await page.fill('[data-m="to"]', 'One@Example.com, guest@other.org; three@example.com, second@other.org');
await page.click('[data-mop="create"]');
await page.waitForFunction(() => document.querySelector('.mc-done span')?.textContent.includes('Bcc'), null, { timeout: 10000 });
{
  const mime = drafts.at(-1), to = header(mime, 'To'), bcc = header(mime, 'Bcc').split(/,\s*/).sort();
  check(to === 'guest@other.org', `"אל": כתובת אחת בלבד, אף פעם לא כתובת מהרשימה (${to})`);
  check(JSON.stringify(bcc) === JSON.stringify(['one@example.com', 'second@other.org', 'three@example.com', 'two@example.com']), 'כל הרשימה (וכתובות נוספות שהוקלדו) בעותק מוסתר בלבד');
  check(!/^Cc:/m.test(mime.split('\r\n\r\n')[0]), 'בלי עותק גלוי (Cc)');
  check((await page.locator('.mc-done span').first().innerText()).includes('כולם בעותק מוסתר (Bcc). ב"אל" רק guest@other.org'), 'ההודעה אומרת במפורש: כולם בעותק מוסתר, ומי ב"אל"');
}
// "אל" ריק: הכתובת של חשבון הג'ימייל
await page.fill('[data-m="to"]', '');
{ const before = drafts.length; await page.click('[data-mop="create"]'); for (let t = 0; t < 100 && drafts.length === before; t++) await page.waitForTimeout(100); }
check(header(drafts.at(-1), 'To') === 'admin@example.com' && header(drafts.at(-1), 'Bcc').split(',').length === 3, '"אל" ריק: הכתובת של חשבון הג\'ימייל, והרשימה בעותק מוסתר');
await page.fill('[data-m="to"]', 'admin@example.com');

// הבחירות נשמרות בחשבון לפעם הבאה, עם שם התוכנית כמקום ריק
await settle(3500);
check(userdata?.prefs?.mailDraft?.style === 'gold' && userdata.prefs.mailDraft.accent === '#1d4ed8' && userdata.prefs.mailDraft.show?.phone === false, 'הסגנון והבחירות נשמרו בחשבון');
check(String(userdata?.prefs?.mailDraft?.subject || '').includes('{{title}}') && !String(userdata.prefs.mailDraft.subject).includes(EP.title), 'הנושא נשמר כתבנית — בפעם הבאה ייכנס שם התוכנית הבאה');
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /mail/i.test(k) && k !== 'rosh:mailAuthIntroSeen'))), 'שום דבר מהמייל לא נשמר במכשיר');

// מעבר לתוכנית אחרת: הניסוח נשאר, השם מתחלף
const other = catalog.episodes.find((e) => e.id !== EP.id && e.title);
await tab('content');
await page.selectOption('[data-m="ep"]', other.id);
await settle();
check((await page.locator('[data-m="subject"]').inputValue()).includes(other.title) && !(await page.locator('[data-m="subject"]').inputValue()).includes(EP.title), 'מעבר לתוכנית אחרת: השם בנושא מתחלף');
check((await page.locator('[data-mstyle="gold"]').getAttribute('aria-checked')) === 'true', 'והעיצוב נשאר');
check((await page.locator('[data-m="description"]').inputValue()) === (other.description || '') && (await page.locator('[data-m="descTitle"]').inputValue()) === 'מה היה בתוכנית', 'בתוכנית האחרת: התיאור שלה, והכותרת שבחרתם נשארת');
check(userdata?.prefs?.mailDraft?.descTitle === 'מה היה בתוכנית' && !('description' in (userdata?.prefs?.mailDraft || {})), 'הכותרת נשמרת לפעם הבאה; התיאור — רק של התוכנית הזו');

// העתקת המייל (כשאין Gmail API)
await page.click('[data-mop="copy"]');
await settle(300);
check((await page.locator('.notice-host .notice-text').last().innerText()).includes('המייל הועתק'), 'העתקת המייל להדבקה ידנית');

// Gmail API לא מופעל בפרויקט: הסבר ברור
gmailMode = 'disabled';
await tab('people');
await page.click('[data-mmode="all"]');
await page.click('[data-mop="create"]');
await page.waitForSelector('.mc-result .problems', { timeout: 10000 });
check((await page.locator('.mc-result .problems').innerText()).includes('Gmail API עוד לא הופעל'), 'Gmail API לא מופעל: הודעה שמסבירה מה לעשות');
gmailMode = 'ok';

// ג'ימייל נכשל באמצע כמה טיוטות: מה שכבר נוצר נרשם בהיסטוריה, ו"החלפת הטיוטה הקודמת" מוצעת (בלי כפילויות)
{
  await tab('content');
  await page.selectOption('[data-m="ep"]', EP.id);
  await tab('people');
  await page.fill('[data-m="chunk"]', '1');
  const n0 = drafts.length;
  dropDraft = 2;
  await page.click('[data-mop="create"]');
  await page.waitForFunction(() => /מתוך/.test(document.querySelector('.mc-result .problems')?.textContent || ''), null, { timeout: 10000 });
  check(drafts.length === n0 + 1 && (await page.locator('.mc-result .problems').innerText()).includes('נוצרו 1 מתוך 3 טיוטות'), 'כשל באמצע: ההודעה אומרת כמה טיוטות נוצרו');
  check(await page.locator('[data-mop="replace"]').isVisible() && await page.evaluate((id) => window.RoshStore.prefs.get('mailHistory', [])[0]?.drafts?.[0]?.id === id, `r-${drafts.length}`), 'הטיוטה שנוצרה נשמרה בהיסטוריה, ואפשר להחליף אותה');
  await page.fill('[data-m="chunk"]', '400');
  await settle(3500);
  check(userdata?.prefs?.mailHistory?.[0]?.partial === true && userdata.prefs.mailDraft.chunk === 400, 'הטיוטות שנוצרו לפני הכשל נשמרות בהיסטוריה בחשבון');
}

/* ---------- השרת עוד לא מחזיר את הרשימה: ייבוא מקובץ ---------- */
subsMode = 'missing';
await page.goto(`${BASE}/mail.html?standalone=1&ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer');
await page.waitForSelector('[data-m-count] .problems', { state: 'attached' });
check((await page.locator('[data-mbadge="people"]').innerText()) === '!', 'בלי רשימה: סימן אזהרה על לשונית "נמענים"');
await tab('people');
check((await page.locator('[data-m-count]').innerText()).includes('ייבאו את הקובץ'), 'בלי הרשימה מהשרת: הסבר איך לייבא');
check(await page.locator('[data-m-listbox]').evaluate((d) => d.open), 'תיבת הרשימה נפתחת לבד');
await page.setInputFiles('[data-m-file]', { name: 'subscribers.csv', mimeType: 'text/csv', buffer: Buffer.from('email,name\n"a@list.com","מאזין"\nb@list.com,שרה\nA@List.com,כפול\n') });
await page.waitForFunction(() => /2 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check(true, 'ייבוא CSV מאקסל: 2 כתובות, בלי כפילויות');
subsMode = 'ok';

/* ---------- הוספת כתובות לרשימת התפוצה: הדבקה, קובץ אקסל, ושמירה ברשימה ---------- */
await page.goto(`${BASE}/mail.html?standalone=1&ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer');
await page.waitForFunction(() => /3 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
await tab('people');
check(await page.locator('[data-m-save]').isHidden(), 'כשהרשימה כמו בשרת — אין מה לשמור');
await page.click('[data-mop="add-open"]');
check(await page.locator('[data-m-listbox]').evaluate((d) => d.open) && await page.locator('[data-m="list"]').evaluate((t) => document.activeElement === t), '"+ הוספת כתובות לרשימה" פותח את התיבה, מוכנה להקלדה בסוף');
await page.keyboard.type('דוד לוי <David@New.com>');
await page.waitForSelector('[data-m-save]:not([hidden])');
check((await page.locator('[data-m-save-text]').innerText()).includes('כתובת אחת חדשה'), 'כתובת שהודבקה ועוד אינה ברשימה: מוצעת שמירה ברשימת התפוצה');
check(/4 כתובות/.test(await page.locator('[data-m-count]').innerText()), 'והיא נכנסת כבר לטיוטה הזו');
// קובץ אקסל (xlsx) עם שמות
{
  const zipOf = (files) => {
    const locals = [], centrals = []; let offset = 0;
    for (const [name, text] of files) {
      const nb = Buffer.from(name), raw = Buffer.from(text), data = zlib.deflateRawSync(raw);
      const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(nb.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42);
      locals.push(l, nb, data); centrals.push(c, nb); offset += 30 + nb.length + data.length;
    }
    const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  };
  const xlsx = zipOf([
    ['xl/sharedStrings.xml', '<sst><si><t>מייל</t></si><si><t>שם</t></si><si><t>rivka@list.org</t></si><si><t>רבקה</t></si><si><t>one@example.com</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row r="2"><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row><row r="3"><c t="s"><v>4</v></c></row></sheetData></worksheet>'],
  ]);
  await page.setInputFiles('[data-m-file]', { name: 'רשימה.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.waitForFunction(() => /5 כתובות/.test(document.querySelector('[data-m-count]')?.textContent || ''));
  check((await page.locator('[data-m-save-text]').innerText()).includes('2 כתובות חדשות'), 'ייבוא מאקסל: כתובת חדשה נוספה, וזו שכבר ברשימה לא הוכפלה');
}
if (process.env.SHOTS) await page.locator('.mc-sec:has([data-m-listbox])').screenshot({ path: `${process.env.SHOTS}/list-add.png` });
await page.click('[data-mop="save-list"]');
await page.waitForFunction(() => document.querySelector('[data-m-save]')?.hidden && /5 כתובות מרשימת התפוצה/.test(document.querySelector('[data-m-count]')?.textContent || ''), null, { timeout: 10000 });
{
  const sent = listAdds.at(-1) || '';
  check(listAdds.length === 1 && sent.includes('דוד לוי <David@New.com>') && sent.includes('rivka@list.org\tרבקה') && !/one@example\.com/.test(sent), 'שמירה ברשימת התפוצה: רק הכתובות החדשות, עם השמות שלידן');
  check((await page.locator('.notice-host .notice-text').last().innerText()).includes('2 כתובות נוספו לרשימת התפוצה'), 'הודעה כמה נוספו');
  check(await page.locator('[data-m-save]').isHidden(), 'אחרי השמירה הרשימה נטענת מהשרת, ואין עוד מה לשמור');
}
// שמירה שנייה באותו ביקור: לרשימה נכנס בדיוק מה שרואים — כתובת שנמחקה משורה לא נשמרת, ותיקון של כתובת באותיות גדולות נשמר מתוקן
{
  await page.click('[data-mop="add-open"]');
  await page.keyboard.type('x1@new.org, x2@new.org, x3@new.org');
  await page.waitForSelector('[data-m-save]:not([hidden])');
  await page.fill('[data-m="list"]', (await page.locator('[data-m="list"]').inputValue()).replace(', x3@new.org', ''));
  await page.click('[data-mop="add-open"]');
  await page.keyboard.type('Typo2@Gmial.com,שם');
  await page.waitForSelector('[data-mfix="typo2@gmial.com"]');
  await page.click('[data-mfix="typo2@gmial.com"]');
  check((await page.locator('[data-m-save-text]').innerText()).includes('3 כתובות חדשות') && !(await page.locator('[data-mop="save-list"]').isDisabled()), 'שמירה שנייה באותו ביקור: הכפתור פעיל');
  await page.click('[data-mop="save-list"]');
  await page.waitForFunction(() => document.querySelector('[data-m-save]')?.hidden && /8 כתובות מרשימת התפוצה/.test(document.querySelector('[data-m-count]')?.textContent || ''), null, { timeout: 10000 });
  const sent = listAdds.at(-1) || '';
  check(listAdds.length === 2 && sent.includes('x1@new.org') && sent.includes('x2@new.org') && !sent.includes('x3@new.org'), `כתובת שנמחקה מהשורה לא נשמרת ברשימה (${JSON.stringify(sent)})`);
  check(sent.includes('typo2@gmail.com,שם') && !/gmial/i.test(sent), 'תיקון טעות הקלדה באותיות גדולות: נשמרת הכתובת המתוקנת, עם השם');
}
// ייבוא: שורה בלי כתובת תקינה — אומרים; סימני כיוון סביב כתובת לא נכנסים אליה
await page.setInputFiles('[data-m-file]', { name: 'more.csv', mimeType: 'text/csv', buffer: Buffer.from('שם,מייל\nמשה,moshe @gmail.com\nלאה,‪leah@list.org‬\n') });
await page.waitForFunction(() => /בלי כתובת תקינה/.test(document.querySelector('.notice-host .notice-text:last-child')?.textContent || document.querySelector('.notice-host')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check((await page.locator('.notice-host .notice-text').last().innerText()).includes('שורה אחת בלי כתובת תקינה'), 'ייבוא: שורה שלא יצאה ממנה כתובת — ההודעה אומרת');
check((await page.locator('[data-m="list"]').inputValue()).split('\n').includes('leah@list.org'), 'ייבוא: בלי סימני כיוון בכתובת');

/* ---------- הכלי המשוכלל: עבודה שנשמרת, עיצוב טקסט, משתנים, בלוקים, בדיקה, היסטוריה, תבניות, סוגי מייל ---------- */
await page.goto(`${BASE}/mail.html?standalone=1&ep=${encodeURIComponent(EP.slug)}`);
await page.waitForSelector('.mail-composer');
await page.waitForFunction(() => /כתובות מרשימת התפוצה/.test(document.querySelector('[data-m-count]')?.textContent || ''));
check((await page.locator('[data-m="description"]').inputValue()).includes('ראיון בלעדי') && await page.locator('[data-m-work]').isVisible(), 'העבודה על המייל נשמרה בחשבון: חוזרים לתוכנית — והתיאור שכתבתם שם');
check(!!userdata?.prefs?.mailWork?.[`ep:${EP.id}`] && !JSON.stringify(userdata.prefs.mailDraft).includes('ראיון בלעדי'), 'העבודה נשמרת לפי התוכנית, בנפרד מהעיצוב לפעם הבאה');

// סרגל העיצוב: הדגשה
await page.fill('[data-m="intro"]', 'שלום חברים');
await page.locator('[data-m="intro"]').evaluate((el) => el.setSelectionRange(0, 4));
await page.click('[data-mfmt="bold"][data-target="intro"]');
check((await page.locator('[data-m="intro"]').inputValue()) === '**שלום** חברים', 'סרגל העיצוב: הדגשה סביב הטקסט המסומן');
await page.locator('[data-m="intro"]').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
await page.click('[data-mfmt="ul"][data-target="intro"]');
await settle();
{
  const html = await frameHtml();
  check(html.includes('<strong style="font-weight:900">שלום</strong>') && /<ul dir="rtl"[^>]*><li[^>]*><strong/.test(html), 'ההדגשה והרשימה נראות במייל');
}
// משתנה בנושא, והצעות לנושא
await page.fill('[data-m="subject"]', 'תוכנית ');
await page.locator('[data-m="subject"]').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
await page.click('.mc-input-tools .mc-tok summary');
await page.click('.mc-input-tools [data-mtoken="{{number}}"]');
await settle();
check((await page.locator('[data-m-inbox-subject]').innerText()) === `תוכנית ${EP.number}`, 'משתנה {{number}} בנושא מתמלא לפי התוכנית');
await page.click('.mc-sugg summary');
await page.waitForSelector('[data-msubject]');
const sugg = await page.locator('[data-msubject]').first().getAttribute('data-msubject');
await page.locator('[data-msubject]').first().click();
check((await page.locator('[data-m="subject"]').inputValue()) === sugg && sugg.includes(EP.title) && !(await page.locator('.mc-sugg').evaluate((d) => d.open)), 'הצעה לנושא נכנסת בלחיצה, והתפריט נסגר');

// בלוק ציטוט: טקסט, הזזה לראש המייל, כיבוי
await page.click('[data-mexpand="quote"]');
await page.fill('[data-m="quote"]', 'המוזיקה היא הלב של התוכנית');
await settle();
check((await frameHtml()).includes('המוזיקה היא הלב של התוכנית'), 'בלוק ציטוט במייל');
const order = () => page.evaluate(() => [...document.querySelectorAll('.mc-block')].map((li) => li.dataset.block));
for (let i = (await order()).indexOf('quote'); i > 0; i--) await page.click('[data-mmove="up"][data-id="quote"]');
await settle();
{
  const html = await frameHtml();
  check((await order())[0] === 'quote' && html.indexOf('המוזיקה היא הלב') < html.indexOf('להאזנה באתר'), 'הזזת בלוק לראש העורך — וגם לראש המייל');
}
await page.uncheck('[data-mblock="quote"]');
await settle();
check(!(await frameHtml()).includes('המוזיקה היא הלב'), 'כיבוי בלוק מוריד אותו מהמייל');

// הבדיקה: נושא ריק — שגיאה, והיצירה נעצרת עם "ליצור בכל זאת"
await page.fill('[data-m="subject"]', '');
await settle();
check((await page.locator('[data-mbadge="check"]').getAttribute('class')).includes('err'), 'נושא ריק מסומן כשגיאה על לשונית "בדיקה"');
await tab('check');
check((await page.locator('[data-m-audit] .lv-error').first().innerText()).includes('אין נושא'), 'הבדיקה אומרת מה בדיוק לתקן');
{
  const n0 = drafts.length;
  await page.click('[data-mop="create"]');
  await page.waitForSelector('.mc-result [data-mop="create-anyway"]');
  check(drafts.length === n0, 'עם שגיאה — לא נוצרת טיוטה, ומוצע "ליצור בכל זאת"');
}
// גם "החלפת הטיוטה הקודמת" שנעצרה בבדיקה — "ליצור בכל זאת" מחליף, ולא משאיר שתי טיוטות לרשימה
{
  await page.waitForSelector('[data-mop="replace"]:not([hidden])');
  const n0 = drafts.length, prevId = `r-${drafts.length}`;
  await page.click('[data-mop="replace"]');
  await page.waitForSelector('.mc-result [data-mop="create-anyway"]');
  check(drafts.length === n0, 'החלפה עם שגיאה נעצרת');
  await page.click('.mc-result [data-mop="create-anyway"]');
  for (let t = 0; t < 100 && !deleted.includes(prevId); t++) await page.waitForTimeout(100);
  check(drafts.length === n0 + 1 && deleted.includes(prevId), '"ליצור בכל זאת" אחרי "החלפה": הקודמת נמחקה');
}
await tab('check');
await page.click('.mc-audit [data-mgo="content"]');
check(await page.locator('[data-panel="content"]').isVisible(), '"לתיקון" מוביל ללשונית הנכונה');
await page.fill('[data-m="subject"]', 'תוכנית חדשה: {{title}}');
await settle();
check(!(await page.locator('[data-mbadge="check"]').getAttribute('class')).includes('err'), 'אחרי התיקון — בלי שגיאות');

// נמענים: טעות הקלדה ותיקון, "לא לשלוח אל"
await tab('people');
await page.click('[data-mop="add-open"]');
await page.keyboard.type('typo@gmial.com\n');
await page.waitForSelector('[data-mfix="typo@gmial.com"]');
check((await page.locator('[data-m-quality]').innerText()).includes('typo@gmail.com'), 'טעות הקלדה בדומיין: מוצע תיקון');
await page.click('[data-mfix="typo@gmial.com"]');
check((await page.locator('[data-m="list"]').inputValue()).includes('typo@gmail.com') && !(await page.locator('[data-m="list"]').inputValue()).includes('gmial'), 'התיקון נכנס לרשימה');
await page.click('[data-m-excludebox] summary');
await page.fill('[data-m="exclude"]', 'two@example.com');
check(/הוצאו/.test(await page.locator('[data-m-count]').innerText()), 'הספירה מראה כמה הוצאו');
{
  const n1 = drafts.length;
  await page.click('[data-mop="create"]');
  for (let t = 0; t < 100 && drafts.length === n1; t++) await page.waitForTimeout(100);
  const mime = drafts.at(-1), bcc = header(mime, 'Bcc');
  check(bcc.includes('typo@gmail.com') && !bcc.includes('two@example.com') && !bcc.includes('gmial'), 'בטיוטה עצמה: הכתובת המתוקנת, ובלי מי שב"לא לשלוח אל"');
  check(/^List-Unsubscribe: <[^>]*me\.html#me-subscribe>$/m.test(mime.split('\r\n\r\n')[0]), 'כותרת הסרה (List-Unsubscribe) בטיוטה');
}
// החלפת הטיוטה הקודמת: חדשה נוצרת, הקודמת נמחקת מג'ימייל
await page.waitForSelector('[data-mop="replace"]:not([hidden])');
{
  const prevId = `r-${drafts.length}`, n2 = drafts.length;
  await page.click('[data-mop="replace"]');
  for (let t = 0; t < 100 && !deleted.includes(prevId); t++) await page.waitForTimeout(100);
  check(drafts.length === n2 + 1 && deleted.includes(prevId) && alive.has(`r-${drafts.length}`), '"החלפת הטיוטה הקודמת": נוצרה חדשה, והקודמת נמחקה מג\'ימייל');
}
// היסטוריה: מצב הטיוטות (טיוטה שנשלחה כבר לא בטיוטות)
alive.delete('r-1');
await tab('history');
await page.waitForSelector('.mc-hist');
await page.click('[data-mop="hist-check"]');
await page.waitForFunction(() => !document.querySelector('[data-mop="hist-check"]')?.disabled && document.querySelector('.mc-hist .pill')?.textContent.includes('מחכה'));
{
  const cards = page.locator('.mc-hist');
  check((await cards.nth(0).innerText()).includes('מחכה בטיוטות') && (await cards.nth(1).innerText()).includes('הוחלפה בחדשה'), 'היסטוריה: החדשה מחכה, הקודמת סומנה כהוחלפה');
  check(!(await page.locator('.mc-hist.done a[href*="compose"]').count()), 'לטיוטה שהוחלפה אין קישור פתיחה');
  check((await cards.last().innerText()).includes('נשלחה או נמחקה'), 'בדיקת המצב: טיוטה שכבר לא בג\'ימייל מסומנת "נשלחה או נמחקה"');
  const top = `r-${drafts.length}`;
  await cards.nth(0).locator('[data-mhist="delete"]').click();
  await page.waitForFunction(() => document.querySelector('.mc-hist .pill')?.textContent.includes('נמחקה מכאן'));
  check(deleted.includes(top), 'מחיקת טיוטה מג\'ימייל מתוך ההיסטוריה');
}
await settle(3500);
check(Array.isArray(userdata?.prefs?.mailHistory) && userdata.prefs.mailHistory.length >= 7 && userdata.prefs.mailHistory[0].state === 'deleted', 'ההיסטוריה נשמרת בחשבון');

// שליחת בדיקה אליי: מייל אמיתי — רק לחשבון המחובר
{
  const s0 = sent.length;
  await page.click('[data-mop="test"]');
  for (let t = 0; t < 100 && sent.length === s0; t++) await page.waitForTimeout(100);
  const m = sent.at(-1) || '';
  check(header(m, 'To') === 'admin@example.com' && !/^Bcc:/m.test(m.split('\r\n\r\n')[0]) && subjectOf(m).startsWith('[בדיקה] '), '"שליחת בדיקה אליי": רק לחשבון המחובר, בלי הרשימה');
}

// תבניות שמורות
await tab('design');
await page.click('[data-mstyle="ocean"]');
await page.click('[data-mfont="classic"]');
await page.fill('[data-m-tplname]', 'חגים');
await page.click('[data-mop="tpl-save"]');
await page.click('[data-mstyle="clean"]');
await page.click('[data-mfont="modern"]');
await page.click('[data-mtpl="apply"][data-name="חגים"]');
await settle();
check((await page.locator('[data-mstyle="ocean"]').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-mfont="classic"]').getAttribute('aria-checked')) === 'true' && (await frameHtml()).includes('Frank Ruhl'), 'תבנית שמורה מחזירה את העיצוב והגופן');
await shot('composer-design');

// תצוגת טקסט, והורדה כקובץ ‎.eml
await page.click('[data-mview="text"]');
check(await page.locator('[data-m-text]').isVisible() && (await page.locator('[data-m-text]').innerText()).includes('utm_source=email') && await page.locator('[data-m-frame]').isHidden(), 'תצוגת "טקסט": הגרסה הפשוטה של המייל');
await page.click('[data-mview="desktop"]');
{
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('.mc-more summary'); await page.click('[data-mop="eml"]'); })()]);
  const eml = readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename().endsWith('.eml') && /^X-Unsent: 1$/m.test(eml) && /^Bcc: /m.test(eml), 'הורדה כקובץ ‎.eml שנפתח כהודעה חדשה, עם הנמענים בעותק מוסתר');
}

// סיכום של כמה תוכניות
const top3 = catalog.episodes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0)).slice(0, 3);
await page.click('[data-mkind="digest"]');
await tab('content');
await settle();
{
  const html = await frameHtml();
  check(top3.every((e) => html.includes(e.title.replace(/&/g, '&amp;'))) && (await page.locator('[data-m-inbox-subject]').innerText()).includes('3 תוכניות'), 'סיכום: שלוש התוכניות האחרונות, והנושא סופר אותן');
  await page.uncheck(`[data-mpick="${top3[2].id}"]`);
  await settle();
  check((await page.locator('[data-m-inbox-subject]').innerText()).includes('2 תוכניות') && !(await frameHtml()).includes(top3[2].title.replace(/&/g, '&amp;')), 'סיכום: בחירת התוכניות משנה את המייל');
  const n3 = drafts.length;
  await page.click('[data-mop="create"]');
  for (let t = 0; t < 100 && drafts.length === n3; t++) await page.waitForTimeout(100);
  check(partOf(drafts.at(-1), 'text/html').includes('archive.html?utm_source=email'), 'טיוטת הסיכום נוצרה, עם כפתור לארכיון');
}
await shot('composer-digest');
// הודעה חופשית
await page.click('[data-mkind="note"]');
await page.fill('[data-m="headline"]', 'חג שמח מכולנו!');
await page.fill('[data-m="intro"]', 'שלום לכולם!\n\nהתוכנית הבאה תעלה אחרי החג. בינתיים — כל הארכיון מחכה באתר.');
await settle();
check((await frameText()).includes('חג שמח מכולנו!') && (await frameHtml()).includes('?utm_source=email') && !(await frameHtml()).includes('הורדת התוכנית'), 'הודעה חופשית: כותרת, טקסט וכפתור לאתר — בלי כפתורי תוכנית');
// תמונה משלכם שייכת להודעה הזו בלבד
await tab('design');
await page.fill('[data-m="image"]', 'https://media.example/banner.jpg');
await settle();
check((await frameHtml()).includes('https://media.example/banner.jpg'), 'תמונה משלכם בהודעה');
// חזרה לתוכנית: הכל במקום
await page.click('[data-mkind="episode"]');
await tab('content');
check((await page.locator('[data-m="ep"]').inputValue()) === EP.id && (await page.locator('[data-m="description"]').inputValue()).includes('ראיון בלעדי'), 'חזרה ל"תוכנית חדשה": אותה תוכנית ואותו נוסח');
check(!(await frameHtml()).includes('banner.jpg'), 'הבאנר של ההודעה לא עבר למייל על התוכנית');
// "להתחיל מחדש": הנוסח חוזר לברירת המחדל — גם הנושא
await page.click('[data-mop="work-reset"]');
await settle();
check((await page.locator('[data-m="subject"]').inputValue()).startsWith('🎙️ תוכנית חדשה ב') && (await page.locator('[data-m="description"]').inputValue()) === (EP.description || '') && await page.locator('[data-m-work]').isHidden(), '"להתחיל מחדש": הנושא והתיאור חוזרים להתחלה');
await settle(3500);
check(!userdata?.prefs?.mailWork?.[`ep:${EP.id}`] && String(userdata?.prefs?.mailDraft?.subject || '').startsWith('🎙️ תוכנית חדשה ב') && String(userdata.prefs.mailDraft.subject).includes('{{title}}'), 'אחרי "להתחיל מחדש" — העבודה נמחקה מהחשבון, והנושא שמור כברירת המחדל');
// עריכה שאינה בתיאור לא שומרת עותק של התיאור מהאתר
await page.fill('[data-m="intro"]', 'שלום שוב');
await settle(3500);
check(userdata?.prefs?.mailWork?.[`ep:${EP.id}`] && !('description' in userdata.prefs.mailWork[`ep:${EP.id}`].o), 'תיאור שלא נערך לא נשמר — בפעם הבאה ייכנס התיאור העדכני מהאתר');
{
  const n4 = drafts.length;
  await page.focus('[data-m="subject"]');
  await page.keyboard.press('Control+Enter');
  for (let t = 0; t < 100 && drafts.length === n4; t++) await page.waitForTimeout(100);
  check(drafts.length === n4 + 1, 'Ctrl+Enter יוצר טיוטה');
}
await settle(3500);
check(userdata?.prefs?.mailTemplates?.[0]?.name === 'חגים' && userdata.prefs.mailTemplates[0].data.style === 'ocean', 'התבניות נשמרות בחשבון');
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => /mail/i.test(k) && k !== 'rosh:mailAuthIntroSeen'))), 'גם עכשיו — שום דבר מהמייל לא במכשיר');
await page.setViewportSize({ width: 390, height: 844 });
await settle(300);
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'בטלפון: בלי גלילה לצדדים');
await shot('composer-phone');
if (process.env.SHOTS) {
  await page.locator('.mail-composer').evaluate((el) => el.scrollIntoView());
  await shot('composer-phone-top', false);
  await page.locator('[data-mbody="intro"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('composer-phone-intro', false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.locator('.mail-composer').evaluate((el) => el.scrollIntoView());
  await settle(300);
  await shot('composer-dark', false);
  await page.emulateMedia({ colorScheme: 'light' });
}
await page.setViewportSize({ width: 1360, height: 900 });

/* ---------- מנהל שאינו מנהל ---------- */
admin = false;
await page.goto(`${BASE}/mail.html?standalone=1`);
await page.waitForSelector('#mail-gate:not([hidden])');
check((await page.locator('#mail-gate-text').innerText()).includes('אינו מוגדר כמנהל'), 'חשבון שאינו מנהל: הדף נעול');
admin = true;

/* ---------- באזור הניהול: כפתור בתוכנית, וטיוטה אוטומטית אחרי פרסום של תוכנית חדשה ---------- */
await page.evaluate(() => localStorage.setItem('rosh:admin:guided', '1'));
await page.goto(`${BASE}/admin.html?standalone=1&ep=${encodeURIComponent(EP.id)}`);
await page.waitForSelector('#editor [data-op="mail"]', { timeout: 15000 });
await page.click('#editor [data-op="mail"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer');
check((await page.locator('#dlg-mail [data-m="ep"]').inputValue()) === EP.id, 'בניהול: "✉ מייל למאזינים" פותח את העורך על התוכנית');
check(await page.evaluate(() => { const d = document.querySelector('#dlg-mail'); const h = document.getElementById(d.getAttribute('aria-labelledby')); return !!h && d.contains(h); }), 'לחלון יש כותרת נגישה');
// בחלון בניהול: אותו הסבר, דרך "איך מחברים את Gmail?", ו"המשך" מחבר את Gmail
{
  const before = tokenRequests;
  await page.click('#dlg-mail [data-mop="auth-help"]');
  await page.waitForSelector('#dlg-gmail-intro[open]');
  await page.click('#dlg-gmail-intro [data-gi="go"]');
  check(tokenRequests === before + 1, 'בניהול: "איך מחברים את Gmail?" פותח את ההסבר, ו"המשך" פותח את חלון Google');
  await settle(300);
  // Google לא אישר (access_denied) — בפעם הבאה ההסבר מופיע שוב
  await page.reload();
  await page.waitForSelector('#editor [data-op="mail"]', { timeout: 15000 });
  await page.click('#editor [data-op="mail"]');
  await page.waitForSelector('#dlg-mail[open] .mail-composer');
  await page.evaluate(() => { window.__deny = true; });
  await page.click('#dlg-mail [data-mop="test"]');
  check(!(await page.locator('#dlg-gmail-intro').count()), 'מי שכבר ראה את ההסבר — ישר לחלון Google');
  await page.waitForFunction(() => /לא אישרתם/.test(document.querySelector('#dlg-mail [data-m-result]')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { window.__deny = false; });
  await page.click('#dlg-mail [data-mop="test"]');
  check((await page.locator('#dlg-gmail-intro[open]').count()) === 1, 'אחרי "לא אישרתם" — ההסבר מופיע שוב');
  await page.click('#dlg-gmail-intro [data-gi="cancel"] >> nth=0');
}
await page.click('#dlg-mail [data-close]');
await page.click('[data-op="new"]');
await page.fill('[data-f="title"]', 'תוכנית חדשה למייל');
await page.fill('[data-f="audio"]', 'https://media.example/new.mp3');
await settle(300);
await page.click('[data-tab="publish"]');
await page.waitForSelector('#pub-mail');
check(await page.locator('#pub-mail').isChecked(), 'בפרסום של תוכנית חדשה: "להכין טיוטת מייל" מסומן');
await page.click('.pub-card [data-op="publish"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer', { timeout: 15000 });
await settle(600); await shot('admin-dialog');
const newId = await page.locator('#dlg-mail [data-m="ep"]').inputValue();
check(published?.episodes.some((e) => e.id === newId && e.title === 'תוכנית חדשה למייל'), 'אחרי הפרסום נפתחה טיוטת המייל של התוכנית החדשה');
check(!(await page.locator('#dlg-mail [data-m-warn]').innerText()).includes('עוד לא'), 'התוכנית כבר באתר — בלי אזהרה');
// בחלון בניהול: עריכת התיאור למייל לא נוגעת בתוכנית עצמה
await page.fill('#dlg-mail [data-m="description"]', 'רק למייל');
await settle();
check(published.episodes.find((e) => e.id === newId).description !== 'רק למייל' && (await page.locator('#dlg-mail [data-m-frame]').evaluate((f) => f.srcdoc.includes('רק למייל'))), 'התיאור במייל נערך — והתוכנית באתר לא השתנתה');

// "פרסום של התוכנית הזו" לתוכנית חדשה — גם אז נפתחת טיוטת המייל
await page.click('#dlg-mail [data-close]');
await page.click('[data-tab="programs"]');
await page.click('[data-op="new"]');
await page.fill('[data-f="title"]', 'תוכנית שפורסמה לבד');
await settle(300);
await page.click('#editor [data-op="publish-one"]');
await page.waitForSelector('#dlg-mail[open] .mail-composer', { timeout: 15000 });
{
  const id = await page.locator('#dlg-mail [data-m="ep"]').inputValue();
  check(published?.episodes.some((e) => e.id === id && e.title === 'תוכנית שפורסמה לבד'), '"פרסום של התוכנית הזו" לתוכנית חדשה: נפתחת טיוטת המייל שלה');
}

const real = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_|accounts\.google|gsi|status of 40[1349]/i.test(e));
check(real.length === 0, `אין שגיאות JavaScript${real.length ? `: ${real.join(' | ')}` : ''}`);
await browser.close();
if (fails.length) { console.error(`\n${fails.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
