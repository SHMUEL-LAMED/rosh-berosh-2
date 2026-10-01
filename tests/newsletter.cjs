/* המייל למאזינים (assets/js/newsletter.js): התוכן, הקישורים, העיצוב, והקידוד ש־Gmail מקבל. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const w = {};
vm.runInNewContext(fs.readFileSync('assets/js/newsletter.js', 'utf8'), { window: w, TextEncoder, btoa });
const M = w.RoshMail;

const ep = { id: 'ep-90', slug: '2026-09-19', number: 90, title: 'שירי הסתיו <b>& "ציטוט"</b>', description: 'פסקה ראשונה. משפט שני.\n\nפסקה שנייה.', guests: ['דוד לוי'], cover: 'https://media.example/c.jpg', thumb: 'https://media.example/t.jpg', links: [] };
const ctx = { siteName: 'ראש בראש', tagline: 'מוזיקה', siteUrl: 'https://site.example/', listenUrl: 'https://site.example/episode.html?ep=2026-09-19&utm_source=email', downloadUrl: 'https://api.example/api/program/download/ep-90', unsubscribeUrl: 'https://site.example/me.html#me-subscribe', dateText: '19 בספטמבר 2026', durationText: 'שעה', hue: 200, links: [{ label: 'הפלייליסט', url: 'https://p.example/list' }], contacts: { phone: '077-226-2271', phoneNote: 'האזנה בשלוחה 1.' } };

// ברירות המחדל: נושא עם שם התוכנית, פתיחה, חתימה
const d = M.defaults(ep, ctx);
assert.match(d.subject, /ראש בראש/); assert(d.subject.includes(ep.title));
assert.equal(d.style, 'night');

const b = M.build(ep, ctx, {});
// הטקסט של התוכנית מוצג כטקסט, לא כ־HTML
assert(!b.html.includes('<b>& "ציטוט"</b>'), 'Title must be escaped');
assert(b.html.includes('שירי הסתיו &lt;b&gt;&amp; &quot;ציטוט&quot;&lt;/b&gt;'));
// כפתור האזנה באתר וקישור הורדה ישיר
assert(b.html.includes('href="https://site.example/episode.html?ep=2026-09-19&amp;utm_source=email"'), 'Listen link');
assert(b.html.includes('href="https://api.example/api/program/download/ep-90"'), 'Direct download link');
assert(b.text.includes(ctx.listenUrl) && b.text.includes(ctx.downloadUrl), 'Plain-text version carries both links');
// מימין לשמאל, התמונה, האורחים, התיאור, הקישורים, הטלפון וההסרה
assert.match(b.html, /<html lang="he" dir="rtl">/);
assert(b.html.includes('https://media.example/c.jpg') && b.html.indexOf('media.example/c.jpg') < b.html.indexOf('class="h1"'), 'The program image is in the header, above the title');
assert(M.build(ep, ctx, { cover: 'side' }).html.indexOf('media.example/c.jpg') < M.build(ep, ctx, { cover: 'side' }).html.indexOf('class="h1"'), 'An older "side" setting shows the image in the header too');
assert(b.html.includes('עם דוד לוי') && b.html.includes('פסקה שנייה') && b.html.includes('https://p.example/list'));
assert(b.html.includes('077-226-2271') && b.html.includes(ctx.unsubscribeUrl));
assert(b.preheader.length > 0 && b.html.includes(M.STYLES.night.bg));

// אפשרויות העריכה
const off = M.build(ep, ctx, { show: { download: false, description: false, guests: false, links: false, phone: false, unsubscribe: false }, cover: 'none' });
for (const gone of [ctx.downloadUrl, 'פסקה שנייה', 'עם דוד לוי', 'https://p.example/list', '077-226-2271', ctx.unsubscribeUrl, 'media.example']) assert(!off.html.includes(gone), `Toggle left ${gone}`);
assert(M.build(ep, ctx, { cover: 'full' }).html.includes('https://media.example/c.jpg'), 'Full-width cover uses the full image');
const gold = M.build(ep, ctx, { style: 'gold', accent: '#1d4ed8', listenLabel: 'לשמיעה', subject: 'נושא משלי', intro: 'שלום רב', signature: 'בברכה, המגישים' });
assert(gold.html.includes('#f5f0e6') && gold.html.includes('#1d4ed8'), 'Style and accent colour');
assert(gold.html.includes('לשמיעה') && gold.html.includes('שלום רב') && gold.html.includes('בברכה, המגישים') && gold.subject === 'נושא משלי');
assert.equal(M.inkFor('#1d4ed8'), '#ffffff'); assert.equal(M.inkFor('#f0c65a'), '#15110a');
{
  const vivid = M.build(ep, ctx, { style: 'vivid' }).html;
  assert(vivid.includes(M.hslHex(200, 55, 10)) && !/hsl\(/.test(vivid), 'Vivid style follows the episode hue, in hex colours (Outlook has no hsl())');
  assert.equal(M.hslHex(0, 100, 50), '#ff0000'); assert.equal(M.hslHex(240, 100, 50), '#0000ff');
}
// תיאור שנערך למייל בלבד, עם כותרת משלו (או בלי כותרת)
const edited = M.build(ep, ctx, { description: 'תיאור שנכתב למייל.\n\nפסקה נוספת.', descTitle: 'מה היה בתוכנית' });
assert(edited.html.includes('תיאור שנכתב למייל.') && edited.html.includes('פסקה נוספת.') && !edited.html.includes('פסקה שנייה'), 'Edited description replaces the site text');
assert(edited.html.includes('מה היה בתוכנית') && !edited.html.includes('>על התוכנית<') && edited.text.includes('מה היה בתוכנית:\nתיאור שנכתב למייל.'));
assert(!M.build(ep, ctx, { descTitle: '' }).html.includes('על התוכנית'), 'Empty heading is left out');
assert(!M.build(ep, ctx, { description: '   ' }).html.includes('פסקה שנייה'), 'Emptied description leaves the box out');
assert(M.build({ ...ep, description: '' }, ctx, { description: 'נכתב רק במייל' }).html.includes('נכתב רק במייל'), 'A program without a description can get one in the email');
// בלי הקלטה אין כפתור הורדה
assert(!M.build(ep, { ...ctx, downloadUrl: '' }, {}).html.includes('הורדת התוכנית'));

// כתובות: ניקוי, בלי כפילויות, בלי זבל
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
same(M.parseEmails('A@x.com; b@y.co, bad, a@x.com\n"c@z.org",email,name\nd@w.org,דוד\nשרה <Sara@Mail.co.il>.'), ['a@x.com', 'b@y.co', 'c@z.org', 'd@w.org', 'sara@mail.co.il']);
same(M.parseEmails('email,name\n"x@y.com","מאזין"\n'), ['x@y.com']);
// סימני כיוון ותווים בלתי נראים סביב הכתובת (וואטסאפ, וורד) לא נכנסים אליה
same(M.parseEmails('‪david@gmail.com‬\nשרה ‏sara@walla.co.il‏\n​zed@x.org﻿, ⁦David@Gmail.com⁩'), ['david@gmail.com', 'sara@walla.co.il', 'zed@x.org']);
same(M.checkAddresses(M.parseEmails('‪b@gmial.com‬')).typos, [{ email: 'b@gmial.com', fix: 'b@gmail.com' }]);
same(M.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);

// MIME: הנושא בעברית מקודד במילים של עד 75 תווים, הרשימה בעותק מוסתר, שני חלקים
const longSubject = `🎙️ ${'תוכנית חדשה בראש בראש '.repeat(4)}`;
const enc = M.encodeWord(longSubject);
for (const word of enc.split('\r\n ')) assert(word.length <= 75, `Encoded word too long: ${word.length}`);
const decodeWords = (s) => s.split('\r\n ').map((x) => Buffer.from(x.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8')).join('');
assert.equal(decodeWords(enc), longSubject);
assert.equal(M.encodeWord('Plain ASCII'), 'Plain ASCII');

const bcc = Array.from({ length: 120 }, (_, i) => `listener${i}@example.com`);
const raw = M.raw({ to: ['me@example.com'], bcc, replyTo: 'hosts@example.com', subject: longSubject, html: b.html, text: b.text });
assert.match(raw, /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
const mime = Buffer.from(raw, 'base64url').toString('utf8');
const [head, ...rest] = mime.split('\r\n\r\n');
assert(head.split('\r\n').every((line) => line.length <= 998), 'Header lines stay under the RFC limit');
const headers = head.replace(/\r\n /g, ' ');
assert.match(headers, /^To: me@example\.com$/m);
assert.match(headers, /^Reply-To: hosts@example\.com$/m);
assert.equal((headers.match(/^Bcc: (.*)$/m)[1]).split(/,\s*/).length, 120);
assert.equal(decodeWords(head.match(/^Subject: ([\s\S]*?)\r\n(?=[A-Z])/m)[1]), longSubject);
const body = rest.join('\r\n\r\n');
const parts = [...body.matchAll(/Content-Type: (text\/(?:plain|html)); charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)];
assert.equal(parts.length, 2);
const html = Buffer.from(parts.find((p) => p[1] === 'text/html')[2].replace(/\r\n/g, ''), 'base64').toString('utf8');
const text = Buffer.from(parts.find((p) => p[1] === 'text/plain')[2].replace(/\r\n/g, ''), 'base64').toString('utf8');
assert.equal(html, b.html); assert.equal(text, b.text);
// בלי עותק מוסתר (טיוטת בדיקה) — אין שורת Bcc
assert(!Buffer.from(M.raw({ to: ['me@example.com'], subject: 'x', html: '<p>x</p>', text: 'x' }), 'base64url').toString().includes('Bcc:'));

/* ---------- עיצוב קל בטקסט: הדגשה, נטוי, קישורים ורשימות ---------- */
{
  const r = M.build(ep, ctx, { intro: 'שלום **לכולם** ו*ברוכים הבאים*.\nראו [הפלייליסט](https://p.example/list) או https://site.example/x.\n\n- שיר ראשון\n- שיר <שני>\n\n1. אחד\n2. שניים', signature: 'תודה' });
  assert(r.html.includes('<strong style="font-weight:900">לכולם</strong>') && r.html.includes('<em style="font-style:italic">ברוכים הבאים</em>'), 'Bold and italic');
  assert(r.html.includes('href="https://p.example/list"') && r.html.includes('>הפלייליסט</a>') && r.html.includes('href="https://site.example/x"'), 'Markdown link and bare link (without the full stop)');
  assert(/<ul dir="rtl"[^>]*><li[^>]*>שיר ראשון<\/li><li[^>]*>שיר &lt;שני&gt;<\/li><\/ul>/.test(r.html), 'Bullet list, escaped');
  assert(/<ol dir="rtl"[^>]*><li[^>]*>אחד<\/li><li[^>]*>שניים<\/li><\/ol>/.test(r.html), 'Numbered list');
  assert(r.text.includes('ראו הפלייליסט (https://p.example/list)') && r.text.includes('• שיר ראשון') && r.text.includes('2. שניים') && !r.text.includes('**'), 'Plain text keeps links and lists, drops the marks');
  assert(!M.build(ep, ctx, { intro: '[x](javascript:alert(1)) <script>' }).html.includes('href="javascript'), 'Only http(s)/mailto/tel links');
  same(M.plain('a *b* **c**'), 'a b c');
}

/* ---------- משתנים ---------- */
{
  const r = M.build(ep, ctx, { subject: 'תוכנית {{number}}: {{title}} ({{date}})', intro: 'באתר {{site}}, עם {{guests}}. {{nope}}', preheader: 'עכשיו ב{{site}}' });
  assert.equal(r.subject, `תוכנית 90: ${ep.title} (19 בספטמבר 2026)`);
  assert(r.html.includes('באתר ראש בראש, עם דוד לוי.') && r.preheader === 'עכשיו בראש בראש', 'Tokens in the body and a custom preview line');
  same(r.report.leftover, ['{{nope}}']);
  const empty = M.build({ ...ep, guests: [] }, ctx, { intro: 'עם {{guests}}' });
  same(empty.report.empty, ['{{guests}}']);
  assert(M.audit(r).some((x) => x.id === 'tokens' && x.level === 'error'), 'Unknown token is an error');
  const desc = M.build(ep, ctx, { description: 'על {{title}} ו{{oops}}' });
  assert(desc.html.includes(`על ${ep.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}`) && desc.text.includes(`על ${ep.title}`) && desc.report.leftover.includes('{{oops}}'), 'Tokens are filled in the description too, and checked');
  // שם שאינו סגנון/סוג אמיתי ("constructor") לא שובר את המייל
  const odd = M.build(ep, ctx, { kind: 'constructor', style: 'constructor', font: 'toString', shape: '__proto__', blocks: [{ id: 'constructor', on: true }] });
  assert(odd.report.kind === 'episode' && odd.html.includes(M.STYLES.night.bg) && odd.html.includes('להאזנה באתר'), 'Inherited names fall back to the defaults');
}

/* ---------- בלוקים: סדר, הפעלה, ציטוט, כפתור נוסף, שירים, עוד תוכניות, שיתוף ---------- */
{
  const tracks = [{ at: 0, title: 'פתיחה', artist: '' }, { at: 754, title: 'שיר', artist: 'זמר', note: 'בכורה' }];
  const more = [{ title: 'תוכנית קודמת', number: 89, url: 'https://site.example/episode.html?ep=89', downloadUrl: 'https://api.example/d/89', dateText: '5 בספטמבר', hue: 30 }, { title: 'עוד אחת', number: 88, url: 'https://site.example/episode.html?ep=88', thumb: 'https://media.example/88.jpg' }];
  const r = M.build({ ...ep, tracks }, { ...ctx, more, shareUrl: 'https://api.example/p/2026-09-19' }, {
    quote: 'המוזיקה **היא** הלב', quoteBy: 'דוד לוי', ctaLabel: 'להצבעה במצעד', ctaUrl: 'https://vote.example/', moreCount: 1,
    blocks: [{ id: 'quote', on: true }, { id: 'intro', on: true }, { id: 'buttons', on: true }, { id: 'tracks', on: true }, { id: 'cta', on: true }, { id: 'more', on: true }, { id: 'share', on: true }, { id: 'description', on: false }, { id: 'signature', on: true }],
  });
  const at = (s) => r.html.indexOf(s);
  assert(at('המוזיקה') > 0 && at('המוזיקה') < at('תוכנית חדשה עלתה') && at('תוכנית חדשה עלתה') < at('להאזנה באתר'), 'Blocks follow the chosen order');
  assert(!r.html.includes('פסקה שנייה') && !r.report.blocks.includes('description'), 'A block that is off is left out');
  assert(r.html.includes('— דוד לוי') && r.text.includes('"המוזיקה היא הלב" — דוד לוי'), 'Quote');
  assert(r.html.includes('href="https://vote.example/"') && r.text.includes('להצבעה במצעד: https://vote.example/'), 'Extra button');
  assert(r.html.includes('utm_source=email&amp;t=754') && r.html.includes('>12:34</a>') && r.text.includes('12:34  שיר — זמר'), 'Track list with a link to the moment');
  assert(r.html.includes('תוכנית קודמת') && !r.html.includes('עוד אחת'), 'More programs, up to the chosen count');
  assert(r.html.includes(encodeURIComponent('https://api.example/p/2026-09-19')) && r.html.includes('mailto:?subject='), 'Mail-a-friend');
  // בלוק חדש שלא היה בשמירה הישנה נכנס במקומו, כבוי או דלוק כברירת המחדל
  const ids = M.blocksFor({ blocks: [{ id: 'signature', on: true }, { id: 'intro', on: false }] });
  assert.equal(ids.length, Object.keys(M.BLOCKS).length);
  assert(ids.find((b) => b.id === 'intro').on === false && ids.find((b) => b.id === 'more').on === false);
  // כפתור נוסף עם קישור לא תקין
  assert(M.audit(M.build(ep, ctx, { ctaLabel: 'כאן', ctaUrl: 'vote.example' })).some((x) => x.id === 'cta' && x.level === 'error'));
}

/* ---------- סיכום של כמה תוכניות, והודעה חופשית ---------- */
{
  const items = [
    { title: 'תוכנית א', number: 90, url: 'https://site.example/episode.html?ep=a', downloadUrl: 'https://api.example/d/a', dateText: '19 בספטמבר', excerpt: 'על מה דיברנו.', hue: 10 },
    { title: 'תוכנית ב', number: 89, url: 'https://site.example/episode.html?ep=b', dateText: '5 בספטמבר', hue: 200 },
  ];
  const dg = M.build(null, { ...ctx, items, archiveUrl: 'https://site.example/archive.html' }, { kind: 'digest' });
  assert(dg.subject.includes('2 תוכניות') && dg.html.includes('תוכנית א') && dg.html.includes('תוכנית ב') && dg.html.includes('על מה דיברנו.'), 'Digest lists every program');
  assert(dg.html.includes('href="https://api.example/d/a"') && dg.html.includes('href="https://site.example/archive.html"') && dg.html.includes('5 בספטמבר – 19 בספטמבר'), 'Digest: download links, archive button and the date range');
  assert(!dg.html.includes('פסקה שנייה') && !dg.html.includes('הורדת התוכנית'), 'Digest has no single-program blocks');
  assert(dg.text.includes('▶ תוכנית א (תוכנית 90 · 19 בספטמבר)') && dg.text.includes('https://site.example/episode.html?ep=b'));
  assert(M.audit(M.build(null, { ...ctx, items: items.slice(0, 1) }, { kind: 'digest' })).some((x) => x.id === 'items'), 'Digest with one program: a warning');
  const note = M.build(null, ctx, { kind: 'note', headline: 'חג שמח מ{{site}}', intro: 'שלום לכולם!\n\nהתוכנית הבאה תשודר אחרי החג, ובינתיים — כל הארכיון באתר.', ctaLabel: 'לארכיון', ctaUrl: 'https://site.example/archive.html' });
  assert(note.html.includes('חג שמח מראש בראש') && note.html.includes('לארכיון') && note.html.includes('לאתר התוכנית') && !note.html.includes('להאזנה באתר'), 'Free note: headline, text, site button and extra button');
  assert(M.audit(M.build(null, ctx, { kind: 'note', intro: 'שלום' })).some((x) => x.id === 'body'), 'Empty note: a warning');
}

/* ---------- גופנים, צורת הכפתורים, תמונה משלכם, בלי שורת פתיח ---------- */
{
  const r = M.build(ep, ctx, { font: 'classic', shape: 'square', image: 'https://img.example/own.jpg', cover: 'full', show: { tagline: false } });
  assert(r.html.includes("'Frank Ruhl Libre'") && r.html.includes('Frank+Ruhl+Libre') && r.html.includes('border-radius:4px'), 'Font and button shape');
  assert(r.html.includes('https://img.example/own.jpg') && !r.html.includes('media.example/c.jpg'), 'Own image instead of the program cover');
  assert(!r.html.includes('>מוזיקה</span>'), 'Tagline line can be hidden');
  assert(!M.build(ep, ctx, { image: 'http://insecure.example/x.jpg', cover: 'none' }).html.includes('insecure.example'), 'Own image must be https');
  // קישור בצבע שלא קריא על הרקע → בצבע הטקסט
  assert.equal(M.palette({ style: 'clean', accent: '#fafafa' }).link, M.STYLES.clean.text);
  for (const k of Object.keys(M.STYLES)) assert(M.build(ep, ctx, { style: k }).html.includes('<!doctype html>'), `Style ${k}`);
}

/* ---------- הבדיקה לפני יצירה ---------- */
{
  const ok = M.audit(b, { mode: 'all', recipients: 3, limit: 500, live: true });
  assert(!ok.some((x) => x.level === 'error'), 'A normal email passes');
  assert(ok.some((x) => x.id === 'size' && x.level === 'ok') && ok.some((x) => x.id === 'reading'));
  const bad = M.audit(M.build(ep, ctx, { subject: 'חינם!!! FREE 🎉🎉🎉', show: { unsubscribe: false } }), { mode: 'all', recipients: 1200, limit: 500, live: false, typos: [{ email: 'a@gmial.com', fix: 'a@gmail.com' }] });
  const has = (id) => bad.some((x) => x.id === id);
  assert(has('spam') && has('subject-shout') && has('subject-emoji') && has('unsub') && has('live') && has('limit') && has('typos'), 'Spammy subject, no unsubscribe, not live, over the daily limit, typos');
  assert(bad.find((x) => x.id === 'limit').text.includes('3 ימים'));
  const rank = { error: 0, warn: 1, info: 2, ok: 3 };
  assert(bad.every((x, i) => !i || rank[bad[i - 1].level] <= rank[x.level]), 'Sorted: most severe first');
  assert(M.audit(b, { mode: 'all', recipients: 0 }).some((x) => x.id === 'recipients' && x.level === 'error'));
  assert(!M.audit(b, { mode: 'me', recipients: 0 }).some((x) => x.id === 'recipients'), 'Test-to-me needs no list');
  const huge = M.build(ep, ctx, { description: 'מילה '.repeat(30000) });
  assert(huge.size > 102 * 1024 && M.audit(huge).some((x) => x.id === 'size' && x.level === 'error'), 'Gmail clips mails over 102 KB');
}

/* ---------- הצעות לנושא ---------- */
{
  const s = M.suggestSubjects(ep, ctx);
  assert(s.length >= 5 && s.every((x) => typeof x === 'string' && x.trim()) && new Set(s).size === s.length);
  assert(s.some((x) => x.includes('תוכנית 90')) && s.some((x) => x.includes('עם דוד לוי')));
  assert(M.suggestSubjects(null, ctx, 'digest', [{ title: 'א' }, { title: 'ב' }]).some((x) => x.includes('2 תוכניות')));
  assert(M.suggestSubjects(null, ctx, 'note').length >= 3);
}

/* ---------- בדיקת הכתובות: טעויות הקלדה, כתובות שלא מקבלות דואר ---------- */
{
  const r = M.checkAddresses(['a@gmial.com', 'b@gmail.con', 'c@hotmial.com', 'd@gmail.co.il', 'e@walla.co.il', 'f@mail.com', 'g@myband.co.il', 'noreply@site.org', 'h@example.com', 'i@yahoo.co']);
  same(r.typos.map((x) => x.fix), ['a@gmail.com', 'b@gmail.com', 'c@hotmail.com', 'd@gmail.com', 'i@yahoo.com']);
  same(r.risky, ['noreply@site.org', 'h@example.com']);
  assert.equal(r.domains[0][1], 1);
  assert.equal(M.fixAddress('shmuel@gmail.com'), '');
  assert.equal(M.dailyLimit('me@gmail.com'), 500); assert.equal(M.dailyLimit('me@radio.co.il'), 2000);
}

/* ---------- MIME: קובץ ‎.eml שנפתח כהודעה חדשה, וכותרת הסרה ---------- */
{
  const m = M.mime({ to: ['me@example.com'], bcc: ['x@example.com'], subject: 'שלום', html: '<p>x</p>', text: 'x', unsubscribe: 'https://site.example/me.html#me-subscribe', unsent: true });
  const head = m.split('\r\n\r\n')[0];
  assert.match(head, /^X-Unsent: 1$/m); assert.match(head, /^List-Unsubscribe: <https:\/\/site\.example\/me\.html#me-subscribe>$/m); assert.match(head, /^Content-Language: he$/m);
  assert(!M.mime({ to: ['a@b.co'], subject: 'x', html: '', text: '' }).includes('X-Unsent'), 'Gmail drafts are not marked unsent');
  assert(!M.mime({ to: ['a@b.co'], subject: 'x', html: '', text: '', unsubscribe: 'javascript:x' }).includes('List-Unsubscribe'));
  assert.equal(Buffer.from(M.raw({ to: ['a@b.co'], subject: 'x', html: '', text: 'y' }), 'base64url').toString('utf8').split('\r\n')[0], 'To: a@b.co');
}

console.log('Newsletter: content, formatting, tokens, blocks, digest and note, styles, checks, addresses and MIME encoding passed.');
