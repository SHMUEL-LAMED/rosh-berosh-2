/* טעינת הקטלוג לסקריפטי הבנייה (מפת האתר ודפי התוכניות הסטטיים).
   הקטלוג החי מה־Worker; אם השרת לא עונה — העותק שבמאגר (data/episodes.json). */
import { readFileSync } from 'node:fs';

export const site = JSON.parse(readFileSync('data/site.json', 'utf8'));
/** כתובת האתר, עם / בסוף */
export const base = site.url.replace(/\/?$/, '/');

let cached = null;
/** האם הקטלוג שנטען הגיע מהשרת החי (ולא מהעותק שבמאגר) */
export let fromLive = false;
export async function loadCatalog() {
  if (cached) return cached;
  const api = site.storage?.cloudflare?.apiBase;
  let catalog = null;
  if (api) {
    try {
      const r = await fetch(`${api.replace(/\/$/, '')}/api/program/catalog`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) catalog = await r.json();
    } catch (err) { console.warn(`catalog fetch failed: ${err.message}`); }
  }
  fromLive = !!catalog?.episodes?.length;
  if (!fromLive) {
    // בפריסה (pages.yml) הקטלוג החי חובה: בלי תוכנית חדשה שעלתה היום עדיף לא לפרסם כלום
    // ולהשאיר באוויר את הפריסה הקודמת, מאשר לפרסם אתר ישן מהעותק שבמאגר.
    if (process.env.REQUIRE_LIVE_CATALOG) { console.error('live catalog unavailable — not publishing a stale site'); process.exit(1); }
    console.warn('using data/episodes.json');
    catalog = JSON.parse(readFileSync('data/episodes.json', 'utf8'));
  }
  cached = catalog;
  return catalog;
}

/* שעון ישראל — כמו RoshStore.nowIL: "2026-09-22T23:45" */
const ilParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function nowIL(at = new Date()) {
  const p = Object.fromEntries(ilParts.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** תוכנית מתוזמנת שעוד לא הגיע זמנה (publishAt בשעון ישראל) */
export function scheduled(e, now = new Date()) {
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(e.publishAt || '')) ? String(e.publishAt).slice(0, 16) : '';
  return !!at && at > nowIL(now);
}

/** התוכניות שהציבור רואה: מוצגות, עם slug, ושזמן הפרסום שלהן הגיע */
export function publicEpisodes(catalog) {
  return (catalog.episodes || []).filter((e) => e && e.visible !== false && e.slug && !scheduled(e));
}

/** slug שאפשר לשמור כשם קובץ (בלי תיקיות, בלי תווי בקרה) */
export function safeSlug(slug) {
  const s = String(slug || '');
  return !!s && s.length <= 150 && !/[/\\?#%\x00-\x1f\x7f]/.test(s) && !s.startsWith('.');
}

/** הנתיב (יחסי לשורש האתר) של דף התוכנית הסטטי, או null כשאין כזה */
export function episodePagePath(e) {
  return safeSlug(e.slug) ? `episodes/${encodeURIComponent(e.slug)}.html` : null;
}
/** הכתובת המלאה של דף התוכנית (הסטטי אם יש; אחרת episode.html?ep=) */
export function episodeUrl(e) {
  return base + (episodePagePath(e) || `episode.html?ep=${encodeURIComponent(e.slug)}`);
}
