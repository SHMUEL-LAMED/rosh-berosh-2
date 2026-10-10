/* בדיקת דפדפן להודעות הקופצות מול Worker מדומה: יצירה בניהול (תבנית, עיצוב, דפים, תזמון, כפתורים),
   "הפעלה אמיתית", סדר ועדיפות, פרסום, והקפיצה באתר לפי הדף ולפי כמה פעמים כבר הוצגה.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/popups-smoke.mjs (בחלון שני; דורש Playwright כמו browser-smoke) */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const API = 'https://rosh-berosh.smwlyqswkwt232.workers.dev';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) fails.push(msg); };
const catalog = JSON.parse(readFileSync(new URL('../data/episodes.json', import.meta.url), 'utf8'));
let settings = { banner: { enabled: false, text: '' }, updates: [], polls: [], popups: [] };
let subscribed = true; let published = null; let publishBody = null; let draft = null; let pollsDown = false; const votes = {}; let uploads = 0;
const users = { admin: { sub: 'u-admin', email: 'admin@example.com', name: 'מנהל', isAdmin: true }, listener: { sub: 'u-1', email: 'l@example.com', name: 'מאזין', isAdmin: false } };
const status = (p, user) => {
  const mine = votes[p.id]?.[user?.sub] || [];
  const all = Object.values(votes[p.id] || {});
  const counts = Object.fromEntries(p.options.map((o) => [o.id, all.filter((c) => c.includes(o.id)).length]));
  const show = user?.isAdmin || p.results === 'always' || (p.results === 'after' && mine.length);
  return { open: true, closed: false, mine, total: show ? all.length : null, counts: show ? counts : null };
};

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ locale: 'he-IL', viewport: { width: 1280, height: 900 } });
const errors = [];
await ctx.route(`${API}/**`, async (route) => {
  const req = route.request(); const url = new URL(req.url()); const p = url.pathname; const m = req.method();
  const token = (req.headers().authorization || '').replace('Bearer ', '');
  const user = users[token] || null;
  const json = (body, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' }, body: JSON.stringify(body) });
  if (m === 'OPTIONS') return json({});
  if (p === '/api/program/me') return user ? json({ user }) : json({ user: null }, 401);
  if (p === '/api/program/catalog' && m === 'GET') {
    const popups = user?.isAdmin ? settings.popups : settings.popups.filter((x) => x.enabled);
    return json({ ...(published || catalog), settings: { ...settings, popups }, ...(user?.isAdmin ? { versionId: 'v1' } : {}) });
  }
  if (p === '/api/program/catalog' && m === 'POST') { const b = req.postDataJSON(); publishBody = b; published = { seasons: b.seasons, episodes: b.episodes }; if (b.settings) settings = { ...settings, ...b.settings }; draft = null; return json({ ok: true, versionId: 'v2', notified: 0 }); }
  if (p === '/api/program/draft' && m === 'GET') return json({ draft });
  if (p === '/api/program/draft' && m === 'PUT') { draft = { data: req.postDataJSON().data, updatedAt: new Date().toISOString() }; return json({ ok: true, updatedAt: draft.updatedAt }); }
  if (p === '/api/program/draft' && m === 'DELETE') { draft = null; return json({ ok: true }); }
  if (p === '/api/program/upload' && m === 'POST') { uploads++; return json({ url: `https://media.example/poll-${uploads}.png` }); }
  if (p === '/api/program/polls' && m === 'GET') {
    if (pollsDown) return json({ error: 'הנתיב לא נמצא.' }, 404);
    const ids = (url.searchParams.get('ids') || '').split(',');
    return json({ polls: Object.fromEntries(settings.polls.filter((x) => ids.includes(x.id) && (x.enabled || user?.isAdmin)).map((x) => [x.id, status(x, user)])) });
  }
  if (p === '/api/program/polls/vote' && m === 'POST') {
    if (!user) return json({ error: 'צריך להתחבר כדי להצביע.' }, 401);
    const b = req.postDataJSON(); const poll = settings.polls.find((x) => x.id === b.pollId);
    (votes[poll.id] ||= {})[user.sub] = b.choices;
    return json({ ok: true, poll: status(poll, user) });
  }
  if (p === '/api/program/userdata') return m === 'GET' ? json({ data: null, updatedAt: null }) : json({ ok: true, updatedAt: new Date().toISOString() });
  if (p === '/api/program/likes') return json({ counts: {}, mine: [] });
  if (p === '/api/program/subscribe') { if (m === 'DELETE') subscribed = false; if (m === 'POST') subscribed = true; return json({ subscribed, ok: true }); }
  return json({ error: 'לא נמצא' }, 404);
});
await ctx.route('https://accounts.google.com/**', (route) => route.abort());
await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route('https://media.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
await ctx.addInitScript(() => { try { sessionStorage.setItem('rosh:holiday', 'off'); } catch { /* */ } });
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
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => d.accept());
const signIn = (who) => page.evaluate((u) => { localStorage.setItem('rosh:cf:session', JSON.stringify({ token: u.token, user: u.user })); localStorage.setItem('rosh:admin:guided', '1'); }, { token: who, user: users[who] });


/* ---------- יצירה בניהול ---------- */
await page.goto(`${BASE}/index.html`);
await signIn('admin');
await page.goto(`${BASE}/admin.html?standalone=1`);
await page.waitForSelector('#panel .workspace', { timeout: 15000 });
await page.evaluate(() => document.querySelector('#dlg-guide')?.close());
await page.click('[data-tab="site"]');
await page.waitForSelector('#popups-card');
check((await page.locator('#popups-card .pa-empty').count()) === 1, 'בלשונית "האתר": כרטיס הודעות קופצות עם הזמנה ליצור את הראשונה');
await page.click('#popups-card [data-pp="new"] >> nth=0');
await page.waitForSelector('#dlg-popup[open]');
await page.click('[data-ppe-template="episode"]');
check((await page.inputValue('[data-ppe="title"]')).includes('תוכנית חדשה'), 'תבנית "תוכנית חדשה" ממלאת כותרת');
check(await page.waitForSelector('#ppe-stage .rpop-toast.is-preview', { timeout: 3000 }).then(() => true, () => false), 'התצוגה המקדימה מציירת הודעה בפינה');
await page.fill('[data-ppe="title"]', '  מבצע   קיץ ');
await page.fill('[data-ppe="name"]', 'מבצע');
await page.fill('[data-ppe="text"]', 'טקסט עם **הדגשה** ו[קישור](archive.html)');
await page.click('[data-ppe-set="kind"][data-v="modal"]');
check(await page.waitForSelector('#ppe-stage .rpop-modal.is-preview strong', { timeout: 3000 }).then(() => true, () => false), 'הדגשה בטקסט מצוירת, והסוג מתחלף לחלון במרכז');
await page.click('[data-ppe-set="tone"][data-v="violet"]');
check(await page.waitForSelector('#ppe-stage .rpop-tone-violet', { timeout: 3000 }).then(() => true, () => false), 'הצבע מתחלף בתצוגה');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/admin-editor.png` });
await page.click('[data-ppe-device="phone"]');
check(await page.locator('#ppe-frame.phone').count() === 1, 'תצוגת טלפון');
await page.uncheck('[data-ppe-allpages]');
await page.check('[data-ppe-page="episode"]');
await page.uncheck('[data-ppe-page="home"]');
await page.click('[data-ppe-set="trigger"][data-v="scroll"]');
await page.click('[data-ppe-until="7"]');
check(/T23:59$/.test(await page.inputValue('[data-ppe="until"]')), '"לשבוע" ממלא מועד סיום');
await page.check('[data-ppe="freq"][value="daily"]');
await page.fill('[data-ppb="url"][data-i="1"]', 'javascript:alert(1)');
await page.fill('[data-ppb="label"][data-i="1"]', 'רע');
await page.click('#dlg-popup [data-ppe-op="save"]');
check(await page.locator('#dlg-popup[open]').count() === 1, 'קישור javascript: נחסם בשמירה');
await page.fill('[data-ppb="url"][data-i="1"]', '');
await page.fill('[data-ppb="label"][data-i="1"]', 'סגירה');
// הפעלה אמיתית: החלון קופץ כאן, ועורך ההודעה חוזר כשסוגרים
await page.click('#dlg-popup [data-ppe-op="try"]');
await page.waitForSelector('dialog.rpop-modal[open]');
check(await page.locator('#dlg-popup[open]').count() === 0, '"הפעלה אמיתית" מקפיצה את החלון ומסתירה את העורך');
await page.click('dialog.rpop-modal [data-pop-close].btn');
await page.waitForSelector('#dlg-popup[open]');
check(true, 'אחרי סגירת ההודעה — העורך חוזר');
await page.click('#dlg-popup [data-ppe-op="save"]');
await page.waitForSelector('#dlg-popup', { state: 'detached' });
check((await page.locator('#popups-card .pp-row').count()) === 1 && (await page.locator('#popups-card .pp-row .pa-state').innerText()).includes('פעילה'), 'ההודעה ברשימה, פעילה');

// הודעה שנייה: פס צף לכל הדפים, כבויה — ואז מפעילים מהרשימה ומעלים לראש
await page.click('#popups-card [data-pp="new"]');
await page.click('[data-ppe-template="urgent"]');
await page.click('[data-ppe-toggle="enabled"]');
await page.click('#dlg-popup [data-ppe-op="save"]');
await page.waitForSelector('#dlg-popup', { state: 'detached' });
check((await page.locator('#popups-card .pp-row').count()) === 2, 'שתי הודעות ברשימה');
await page.click('#popups-card .pp-row >> nth=0 >> [data-pp="toggle"]');
check((await page.locator('#popups-card .pp-row >> nth=0 >> .pa-state').innerText()).includes('פעילה'), 'הפעלה בלחיצה מהרשימה');
await page.click('#popups-card .pp-row >> nth=1 >> [data-pp="up"]');
check((await page.locator('#popups-card .pp-row >> nth=0 >> b').first().innerText()).includes('מבצע'), 'שינוי סדר העדיפות בחצים');

if (process.env.SHOTS) await page.locator('#popups-card').screenshot({ path: `${process.env.SHOTS}/admin-list.png` });
await page.click('[data-tab="publish"]');
await page.click('.pub-card [data-op="publish"]');
await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('הכול מפורסם'), null, { timeout: 10000 }).catch(() => {});
const pub = publishBody?.settings?.popups || [];
if (process.env.DEBUG) console.log(JSON.stringify(pub, null, 1));
check(pub.length === 2 && pub[0].title === 'מבצע קיץ' && pub[0].kind === 'modal' && pub[0].tone === 'violet' && pub[0].pages.join() === 'episode' && pub[0].trigger === 'scroll' && pub[0].freq === 'daily' && pub[0].buttons.length === 2 && pub[0].buttons[1].url === '', 'ההודעות מתפרסמות עם הקטלוג, עם כל ההגדרות ובסדר החדש');

/* ---------- באתר ---------- */
await page.evaluate(() => { localStorage.removeItem('rosh:cf:session'); localStorage.removeItem('rosh:popups-seen'); sessionStorage.clear(); });
// הפס הדחוף — בכל הדפים, מיד
settings.popups = settings.popups.map((p) => (p.kind === 'modal' ? { ...p, trigger: 'delay', delay: 0 } : p));
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('.rpop-bar.in', { timeout: 8000 });
check((await page.locator('.rpop-bar').innerText()).includes('נדחית'), 'הפס הדחוף קופץ בדף הבית');
check(await page.locator('dialog.rpop-modal').count() === 0, 'החלון של דפי התוכניות לא קופץ בדף הבית');
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/site-bar.png` });
await page.click('.rpop-bar .rpop-x');
await page.waitForSelector('.rpop-bar', { state: 'detached' });
const ep = catalog.episodes.find((e) => e.visible !== false);
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(ep.slug || ep.id)}`);
await page.waitForSelector('dialog.rpop-modal[open]', { timeout: 8000 });
check((await page.locator('dialog.rpop-modal .rpop-title').innerText()) === 'מבצע קיץ', 'החלון קופץ בדף תוכנית');
check(await page.locator('.rpop-bar').count() === 0, 'הפס ("פעם בביקור") לא חוזר באותו ביקור');
await page.keyboard.press('Escape');
await page.waitForSelector('dialog.rpop-modal', { state: 'detached' });
await page.reload();
await page.waitForTimeout(1500);
check(await page.locator('dialog.rpop-modal').count() === 0, '"פעם ביום" — לא קופץ שוב באותו יום');
await page.goto(`${BASE}/index.html?popup=${pub[0].id}`);
if (process.env.DEBUG) { await page.waitForTimeout(3000); console.log(await page.evaluate(() => JSON.stringify({ n: document.querySelectorAll('.rpop').length, html: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), pops: (window.RoshStore.settings.popups || []).map((p) => p.id), q: location.search }))); }
await page.waitForSelector('dialog.rpop-modal[open]', { timeout: 8000 });
check(true, '?popup=<מזהה> מקפיץ את ההודעה לבדיקה, גם בדף אחר');

const real = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_|accounts\.google|gsi|status of 40[149]/i.test(e));
check(real.length === 0, `אין שגיאות JavaScript${real.length ? `: ${real.join(' | ')}` : ''}`);
await browser.close();
if (fails.length) { console.error(`\n${fails.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
