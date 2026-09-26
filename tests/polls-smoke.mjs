/* בדיקת דפדפן לסקרים מול Worker מדומה: יצירה בניהול (כולל תמונה לתשובה), פרסום,
   הופעה בולטת בדף התוכנית ובדף הבית, בקשת כניסה למי שלא מחובר, הצבעה ותוצאות,
   ושום סקר כשהשרת עוד לא מכיר סקרים.
   הרצה:  npx http-server -p 4180 .   (בחלון אחד)
          node tests/polls-smoke.mjs  (בחלון שני; דורש Playwright כמו browser-smoke) */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:4180';
const API = 'https://rosh-berosh.smwlyqswkwt232.workers.dev';
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✕'} ${msg}`); if (!ok) fails.push(msg); };
const catalog = JSON.parse(readFileSync(new URL('../data/episodes.json', import.meta.url), 'utf8'));
let settings = { banner: { enabled: false, text: '' }, updates: [], polls: [] };
let published = null; let publishBody = null; let draft = null; let pollsDown = false; const votes = {}; let uploads = 0;
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
    const polls = user?.isAdmin ? settings.polls : settings.polls.filter((x) => x.enabled);
    return json({ ...(published || catalog), settings: { ...settings, polls }, ...(user?.isAdmin ? { versionId: 'v1' } : {}) });
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
  if (p === '/api/program/subscribe') return json({ subscribed: false });
  return json({ error: 'לא נמצא' }, 404);
});
await ctx.route('https://accounts.google.com/**', (route) => route.abort());
await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await ctx.route('https://media.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
await ctx.addInitScript(() => { try { sessionStorage.setItem('rosh:holiday', 'off'); } catch { /* */ } });
const page = await ctx.newPage();
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
await page.waitForSelector('#polls-card');
check((await page.locator('#polls-card .pa-empty').count()) === 1, 'בלשונית "האתר": כרטיס סקרים עם הזמנה ליצור את הראשון');
await page.click('#polls-card [data-pa="new"] >> nth=0');
await page.waitForSelector('#dlg-poll[open]');
check((await page.locator('#dlg-poll .pe-templates [data-pe-template]').count()) === 4, 'חלון יצירה עם תבניות להתחלה מהירה');
await page.click('[data-pe-template="song"]');
check((await page.inputValue('[data-pe="question"]')) === 'איזה שיר הכי אהבתם בתוכנית?', 'תבנית ממלאת שאלה ותשובות');
await page.fill('[data-pe="question"]', 'איזה שיר הכי אהבתם?');
await page.fill('[data-po="label"][data-i="0"]', 'אנא בכח');
await page.fill('[data-po="sub"][data-i="0"]', 'מוטי שטיינמץ');
await page.fill('[data-po="label"][data-i="1"]', 'ימים');
await page.fill('[data-po="label"][data-i="2"]', 'שיר המעלות');
await page.waitForFunction(() => document.querySelectorAll('#pe-prev .poll-opt').length === 3);
check((await page.locator('#pe-prev .poll-opt b').first().innerText()) === 'אנא בכח', 'התצוגה המקדימה מתעדכנת תוך כדי כתיבה');
// תמונה לתשובה הראשונה
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.pe-opt-img[data-i="0"]')]);
await chooser.setFiles({ name: 'artist.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
await page.waitForSelector('.pe-opt-img[data-i="0"].has img');
await page.waitForFunction(() => document.querySelector('#pe-prev .poll-opt img'), null, { timeout: 3000 }).catch(() => {});
check(uploads === 1 && (await page.locator('#pe-prev .poll-opt').first().locator('img').count()) === 1, 'העלאת תמונה לתשובה — מופיעה גם בתצוגה המקדימה');
// שינוי סדר, עיצוב וצבע
await page.click('[data-pe-op="opt-down"][data-i="1"]');
check((await page.inputValue('[data-po="label"][data-i="2"]')) === 'ימים', 'הזזת תשובה למטה');
await page.click('[data-pe-set="layout"][data-v="grid"]');
await page.click('[data-pe-set="optionShape"][data-v="square"]');
await page.click('[data-pe-set="hue"][data-v="300"]');
await page.waitForFunction(() => document.querySelector('#pe-prev .poll.poll-grid.shape-square')?.style.getPropertyValue('--poll-h') === '300', null, { timeout: 3000 }).catch(() => {});
check(await page.evaluate(() => { const el = document.querySelector('#pe-prev .poll'); return el.classList.contains('poll-grid') && el.classList.contains('shape-square') && el.style.getPropertyValue('--poll-h') === '300'; }), 'העיצוב שנבחר (רשת, ריבוע, צבע) — בתצוגה המקדימה');
await page.click('[data-pe-mode="results"]');
check((await page.locator('#pe-prev .poll-pct').count()) === 3, 'תצוגה מקדימה עם תוצאות לדוגמה');
await page.click('[data-pe-device="phone"]');
check(await page.evaluate(() => document.getElementById('pe-frame').classList.contains('phone')), 'תצוגה מקדימה בגודל טלפון');
await page.check('#dlg-poll [data-pe="results"][value="after"]');
// איפה: דף הבית ודף של תוכנית מסוימת
const ep = catalog.episodes.find((e) => e.season === 'slater');
await page.check('[data-pe="show.home"]');
await page.fill('[data-pe-epq]', ep.title.slice(0, 12));
await page.check(`[data-pe-ep="${ep.id}"]`);
check((await page.locator('#pe-issues').innerText()).includes('דף הבית'), 'שורת הסיכום אומרת איפה הסקר יוצג');
await page.click('[data-pe-until="7"]');
check(/T20:00$/.test(await page.inputValue('[data-pe="until"]')), 'כפתור "נסגר בעוד שבוע" ממלא מועד סיום');
await page.click('#dlg-poll [data-pe-op="save"]');
await page.waitForSelector('#dlg-poll', { state: 'detached' });
check((await page.locator('#polls-card .pa-row').count()) === 1 && (await page.locator('#polls-card .pa-row .pa-state').innerText()).includes('פתוח'), 'הסקר ברשימה, פתוח');
// בעורך התוכנית: הסקר של התוכנית
await page.click('[data-tab="programs"]');
await page.click(`#ep-list .ep-item[data-id="${ep.id}"]`).catch(async () => { await page.fill('#ep-search', ep.title); await page.click('#ep-list .ep-item >> nth=0'); });
await page.waitForSelector('[data-pa="new-ep"]');
check((await page.locator('#editor .pa-row').count()) === 1, 'בעורך התוכנית: "סקר לתוכנית" מראה את הסקר');
// פרסום
await page.click('[data-tab="publish"]');
await page.click('.pub-card [data-op="publish"]');
await page.waitForFunction(() => document.querySelector('#status-text').textContent.includes('הכול מפורסם'), null, { timeout: 10000 }).catch(() => {});
const pub = publishBody?.settings?.polls?.[0];
check(pub && pub.layout === 'grid' && pub.optionShape === 'square' && pub.hue === 300 && pub.options.length === 3 && pub.options[0].image && pub.show.episodes[0] === ep.id && pub.show.home, 'הסקר מתפרסם עם הקטלוג, עם כל ההגדרות');

/* ---------- באתר ---------- */
await page.evaluate(() => localStorage.removeItem('rosh:cf:session'));
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(ep.slug)}`);
await page.waitForSelector('#ep-polls .poll');
check(await page.evaluate(() => { const z = document.getElementById('ep-polls'); const h = document.querySelector('.ep-album'); return !z.hidden && z.querySelector('.poll-featured') && (h.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'בדף התוכנית: הסקר בולט, מיד אחרי הפתיחה');
await page.click('#ep-polls [data-opt] >> nth=1');
await page.click('#ep-polls [data-poll-vote]');
await page.waitForSelector('#ep-polls .poll-login');
check(true, 'מי שלא מחובר מתבקש להתחבר, והבחירה נשמרת');
const other = catalog.episodes.find((e) => e.id !== ep.id);
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(other.slug)}`);
await page.waitForSelector('#episode .ep-album');
await page.waitForTimeout(400);
check(await page.evaluate(() => document.getElementById('ep-polls').hidden && !document.querySelector('#ep-polls .poll')), 'בתוכנית בלי סקר — לא מוצג כלום');
await signIn('listener');
await page.goto(`${BASE}/episode.html?ep=${encodeURIComponent(ep.slug)}`);
await page.waitForSelector('#ep-polls .poll');
check((await page.locator('#ep-polls .poll-pct').count()) === 0, 'לפני ההצבעה התוצאות מוסתרות ("אחרי שהצביעו")');
await page.click('#ep-polls [data-opt] >> nth=0');
await page.click('#ep-polls [data-poll-vote]');
await page.waitForSelector('#ep-polls .poll-done');
check(votes[pub.id]?.['u-1']?.length === 1 && (await page.locator('#ep-polls .poll-pct').count()) === 3, 'הצבעה נשלחת, ואחריה רואים את התוצאות');
check((await page.locator('#ep-polls [data-poll-change]').count()) === 1, 'אפשר לשנות הצבעה');
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#home-polls .poll');
check((await page.locator('#home-polls .poll-opt.mine').count()) === 1, 'בדף הבית: אותו סקר, עם הבחירה שלי מסומנת');
pollsDown = true;
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#featured .card');
await page.waitForTimeout(800);
check(!(await page.locator('#home-polls .poll:visible').count()), 'שרת בלי סקרים (404) — הסקר לא מוצג');

const real = errors.filter((e) => !/favicon|manifest|sw\.js|serviceWorker|net::ERR_|accounts\.google|gsi|status of 40[149]/i.test(e));
check(real.length === 0, `אין שגיאות JavaScript${real.length ? `: ${real.join(' | ')}` : ''}`);
await browser.close();
if (fails.length) { console.error(`\n${fails.length} בדיקות נכשלו`); process.exit(1); }
console.log('\nכל הבדיקות עברו');
