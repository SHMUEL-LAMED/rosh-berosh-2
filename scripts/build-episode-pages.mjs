/* בונה דף סטטי לכל תוכנית שהציבור רואה: episodes/<slug>.html — כדי שגוגל (ותצוגות
   קישור) יראו כותרת, תיאור ותוכן אמיתיים בלי להריץ JavaScript.

   כל דף הוא עותק של episode.html עם:
   - <base href="../"> ראשון ב־<head>, כך שכל הכתובות היחסיות (עיצוב, סקריפטים, קישורים)
     ממשיכות להצביע לשורש האתר; קישורים בתוך הדף ("#main") הופכים ל־episodes/<slug>.html#main;
   - <title>, תיאור, canonical, Open Graph / Twitter ונתונים מובנים (RadioEpisode);
   - data-ep="<slug>" על <body> (episode.js קורא אותו כשאין ?ep=);
   - התוכן עצמו (כותרת, תאריך, תיאור, אורחים) בתוך <article id="episode">, במקום
     "טוענים…" — episode.js מצייר אותו מחדש עם הנגן.

   רץ בפריסה אחרי מפת האתר (.github/workflows/pages.yml). התיקייה episodes/ לא נשמרת
   במאגר (.gitignore). אותו קטלוג כמו מפת האתר: החי, או data/episodes.json כגיבוי. */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { site, base, loadCatalog, publicEpisodes, safeSlug } from './catalog.mjs';

const OUT = 'episodes';
const NAME = site.name || 'ראש בראש';
const DEFAULT_IMAGE = `${base}assets/img/og-default.png`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** JSON בתוך <script>: בלי "</script>" ובלי הערות HTML */
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const heDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const heWeekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'UTC' });
const heHebrew = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const isoDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
function fmtDate(iso) { const d = isoDate(iso); return d ? heDate.format(d) : ''; }
function fmtWeekday(iso) { const d = isoDate(iso); return d ? heWeekday.format(d) : ''; }
/* אורך בשעות ודקות — כמו fmtDuration ב־ui.js */
function fmtDuration(sec) {
  sec = Number(sec) || 0;
  if (!sec) return '';
  const total = Math.round(sec / 60), h = Math.floor(total / 60), m = total % 60;
  if (!h) return m === 1 ? 'דקה אחת' : `${m} דקות`;
  const hw = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  return m ? `${hw} ו${m === 1 ? 'דקה אחת' : `־${m} דקות`}` : hw;
}
/* תאריך עברי באותיות — כמו fmtHebDate ב־ui.js */
function gematria(n) {
  n = Math.floor(n) % 1000;
  let out = '';
  for (const [v, c] of [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק']]) while (n >= v) { out += c; n -= v; }
  if (n === 15) out += 'טו'; else if (n === 16) out += 'טז';
  else { if (n >= 10) { out += 'יכלמנסעפצ'[Math.floor(n / 10) - 1]; n %= 10; } if (n) out += 'אבגדהוזחט'[n - 1]; }
  return out.length > 1 ? `${out.slice(0, -1)}״${out.slice(-1)}` : `${out}׳`;
}
function fmtHebDate(iso) {
  const d = isoDate(iso); if (!d) return '';
  try {
    const p = Object.fromEntries(heHebrew.formatToParts(d).map((x) => [x.type, x.value]));
    return `${gematria(Number(p.day))} ב${p.month} ${gematria(Number(p.year))}`;
  } catch { return ''; }
}
/* הגוון של התוכנית — כמו hue() ב־ui.js, כדי שהדף הסטטי ייראה כמו הדף אחרי הציור */
const seasonHue = { slater: 268, levi: 202, trio: 328, legacy: 26, sets: 158 };
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function hue(e) {
  const b = seasonHue[e?.season] ?? (hash(e?.season || 'x') % 360);
  return (b + (hash(e?.id || e?.slug || '') % 46) - 23 + 360) % 360;
}
/* תיאור: פסקאות קצרות וקישורים — כמו paragraphs() ו־linkify() ב־episode.js (לעדכן יחד) */
function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).flatMap((block) => {
    if (block.length < 480 || block.includes('\n')) return [block];
    const out = []; let cur = '';
    for (const s of block.replace(/([.!?]+)\s+/g, '$1\u0000').split('\u0000')) {
      cur = cur ? `${cur} ${s}` : s;
      if (cur.length >= 300) { out.push(cur); cur = ''; }
    }
    if (cur) { if (out.length && cur.length < 120) out[out.length - 1] += ` ${cur}`; else out.push(cur); }
    return out;
  });
}
const URL_TAIL = /(?:&amp;|&quot;|&#39;|&lt;|&gt;|[.,;:!?)\]}״׳])+$/;
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[x]);
function linkify(safe) {   // מקבל טקסט שכבר עבר esc
  return safe.replace(/\bhttps?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<>"'])+/gi, (m) => {   // הכתובת נגמרת ברווח או במירכאה/סוגר זווית (מוברחים)
    const tail = m.match(URL_TAIL)?.[0] || '';
    const raw = unesc(m.slice(0, m.length - tail.length));
    let u; try { u = new URL(raw); } catch { return m; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return m;
    const shown = raw.replace(/^https?:\/\/(www\.)?/i, '');
    return `<a class="ep-link" href="${esc(u.href)}" title="${esc(u.href)}" target="_blank" rel="noopener nofollow ugc" dir="ltr">${esc(shown.length > 36 ? `${shown.slice(0, 34)}…` : shown)}</a>${tail}`;
  });
}
/** 160 תווים ראשונים, בלי לחתוך באמצע מילה כשאפשר */
function clip(text, n = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

/** אותו מבנה (ואותן מחלקות) כמו רצועת הפתיחה ו"על התוכנית" ש־episode.js מצייר — כך הדף כמעט לא זז
    כשהסקריפט מצייר אותו מחדש עם הנגן. מקום פס הפעולות נשמר ריק (.ep-actionbar:empty). */
function staticArticle(e, season) {
  const num = e.number != null && e.number !== '' ? e.number : null;
  const kicker = `<span class="ep-kick"><span>${num != null ? `תוכנית ${esc(num)}` : (e.season === 'sets' ? 'סט' : 'תוכנית')}</span>${season?.title ? `<span class="ep-kick-sep"> · </span><span>${esc(season.title)}</span>` : ''}</span>`;
  const tags = (Array.isArray(e.tags) ? e.tags : []).map(String).filter(Boolean);
  const details = [
    season?.title ? `<div><dt>עונה</dt><dd><a href="archive.html?season=${encodeURIComponent(season.id)}">${esc(season.title)} <span aria-hidden="true">←</span></a></dd></div>` : '',
    tags.length ? `<div><dt>נושאים</dt><dd class="ep-tags">${tags.map((t) => `<a class="chip" href="archive.html?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</dd></div>` : '',
  ].filter(Boolean);
  const guests = (Array.isArray(e.guests) ? e.guests : []).map(String).filter(Boolean);
  const facts = [
    fmtDate(e.date) ? `<time datetime="${esc(e.date)}">${esc(fmtWeekday(e.date))}, <span class="ep-nw">${esc(fmtDate(e.date))}</span></time>` : '',
    fmtHebDate(e.date) ? `<span>${esc(fmtHebDate(e.date))}</span>` : '',
    fmtDuration(e.duration) ? `<span>${esc(fmtDuration(e.duration))}</span>` : '',
    guests.length ? `<span>עם ${guests.map((g) => `<a class="guest-link" href="guest.html?g=${encodeURIComponent(g)}">${esc(g)}</a>`).join(', ')}</span>` : '',
  ].filter(Boolean);
  const paras = paragraphs(e.description);
  return `
        <header class="ep-hero ep-album">
          <div class="ep-art" aria-hidden="true">
            <div class="ep-disc"><div class="vinyl" data-num="" style="--label:${hue(e)}"><i></i></div></div>
            <div class="ep-sleeve${isHttps(e.cover) ? ' has-cover' : ''}">${isHttps(e.cover) ? `<img class="ep-sleeve-fill" src="${esc(e.cover)}" alt=""><img src="${esc(e.cover)}" alt="">` : `<b>${num != null ? esc(num) : '♫'}</b><small>${esc(NAME)}</small>`}</div>
          </div>
          <div class="ep-head">
            <p class="kicker">${kicker}</p>
            <h1${String(e.title || '').length > 22 ? ' class="ep-title-long"' : ''}>${esc(e.title)}</h1>
            ${facts.length ? `<p class="ep-facts">${facts.join('<i aria-hidden="true">·</i>')}</p>` : ''}
          </div>
          <div class="ep-actionbar"></div>
        </header>
        <div class="ep-body">
          <section class="card card-body ep-section ep-about">
            <div class="ep-about-main">
              <div class="grid-head"><div><p class="kicker">מה בתוכנית</p><h2>על התוכנית</h2></div></div>
              ${paras.length ? `<div class="ep-desc"><div class="ep-desc-text">${paras.map((p) => `<p>${linkify(esc(p))}</p>`).join('')}</div></div>` : ''}
            </div>
            ${details.length ? `<dl class="ep-details" aria-label="פרטי התוכנית">${details.join('')}</dl>` : ''}
          </section>
        </div>
      `;
}

function page(template, e, seasons) {
  const slug = String(e.slug);
  const url = `${base}${OUT}/${encodeURIComponent(slug)}.html`;
  const title = `${e.title || 'תוכנית'} — ${NAME}`;
  const description = clip(e.description) || e.title || NAME;
  const hasCover = isHttps(e.cover);
  const image = hasCover ? e.cover : DEFAULT_IMAGE;
  const season = seasons.find((s) => s.id === e.season);
  const ld = {
    '@context': 'https://schema.org', '@type': 'RadioEpisode', name: e.title, url,
    datePublished: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : undefined,
    episodeNumber: e.number != null && e.number !== '' ? e.number : undefined,
    description: e.description || undefined, image,
    partOfSeries: { '@type': 'RadioSeries', name: NAME, url: base },
  };
  const head = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${esc(NAME)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    ...(hasCover ? [] : ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">']),
    `<meta property="og:image:alt" content="${esc(hasCover ? e.title : `${NAME} — ${site.tagline || ''}`)}">`,
    `<meta property="og:locale" content="he_IL">`,
    ...(/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? [`<meta property="article:published_time" content="${esc(e.date)}">`] : []),
    `<meta name="twitter:card" content="${hasCover ? 'summary' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<script type="application/ld+json">${jsonScript(ld)}</script>`,
    // בלי JavaScript הכפתורים לא יצוירו — בלי המקום הריק ששמור להם
    '<noscript><style>#episode .ep-actionbar:empty{display:none}</style></noscript>',
  ].map((l) => `  ${l}`).join('\n');

  let html = template;
  const must = (re, fn) => { if (!re.test(html)) throw new Error(`episode.html: ${re} not found`); html = html.replace(re, fn); };
  // קישורים בתוך הדף ("#main" של קישור הדילוג): עם <base href="../"> הם היו נפתרים לשורש האתר — מפנים אותם לדף עצמו
  html = html.replace(/href="#([^"]*)"/g, (_, frag) => `href="${OUT}/${encodeURIComponent(slug)}.html#${frag}"`);
  must(/<head>\n?/, () => '<head>\n  <base href="../">\n');
  must(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`);
  must(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${esc(description)}">\n${head}`);
  must(/<body([^>]*)>/, (_, attrs) => `<body${attrs.replace(/\s+data-ep="[^"]*"/, '')} data-ep="${esc(slug)}">`);
  must(/(<article id="episode"[^>]*>)[\s\S]*?(<\/article>)/, (_, open, close) => `${open.replace(/>$/, ` style="--h:${hue(e)}">`)}${staticArticle(e, season)}${close}`);
  return html;
}

const catalog = await loadCatalog();
const seasons = Array.isArray(catalog.seasons) ? catalog.seasons : [];
const template = readFileSync('episode.html', 'utf8');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let n = 0; const skipped = [];
for (const e of publicEpisodes(catalog)) {
  if (!safeSlug(e.slug)) { skipped.push(e.slug); continue; }
  writeFileSync(`${OUT}/${e.slug}.html`, page(template, e, seasons));
  n++;
}
console.log(`${OUT}/: ${n} episode pages${skipped.length ? ` (skipped unsafe slugs: ${skipped.join(', ')})` : ''}`);
