/* ניהול ההודעות הקופצות: הרשימה בלשונית "האתר" (סדר = עדיפות, הפעלה וכיבוי בלחיצה, "להציג שוב לכולם"),
   וחלון היצירה והעריכה — טופס מלא ליד תצוגה מקדימה חיה על דף לדוגמה (אותו ציור כמו באתר, popups.js),
   עם "הפעלה אמיתית" שמקפיצה את ההודעה כאן בניהול בדיוק כמו באתר.
   ההודעות נשמרות בטיוטה המשותפת (settings.popups) ועולות לאתר בלחיצה על "פרסום לאתר", כמו הסקרים.
   הגשר לניהול (window.RoshAdminBridge, admin.js): data, touch, render, cloud. */
(function () {
  'use strict';
  const U = window.RoshUI;
  const S = window.RoshStore;
  const { esc } = U;
  const B = () => window.RoshAdminBridge;
  const R = () => window.RoshPopups;
  const popups = () => (B().data.settings.popups ||= []);
  const newId = (n = 10) => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, n);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nowIL = () => S.nowIL();
  const SITE = 'https://shmuel-lamed.github.io/rosh-berosh-2/';

  const KINDS = [
    ['modal', 'חלון במרכז', 'בולט מאוד — מחשיך את הדף'],
    ['sheet', 'מגירה מלמטה', 'נוח בטלפון'],
    ['toast', 'הודעה בפינה', 'עדין, לא מפריע'],
    ['bar', 'פס צף למעלה', 'שורה אחת קצרה'],
  ];
  const TONES = [['gold', 'זהב'], ['violet', 'סגול'], ['teal', 'תכלת'], ['success', 'ירוק'], ['danger', 'אדום — דחוף'], ['night', 'לילה']];
  const PAGES = [['home', '🏠 דף הבית'], ['archive', '🗂️ הארכיון'], ['episode', '🎙️ דפי התוכניות'], ['me', '👤 האזור האישי'], ['updates', '📰 העדכונים'], ['other', '📄 שאר הדפים']];
  const FREQ = [['once', 'פעם אחת', 'כל מאזין רואה פעם אחת בלבד (במכשיר).'], ['daily', 'פעם ביום', 'שוב למחרת, עד שההודעה יורדת.'], ['session', 'פעם בביקור', 'בכל פעם שפותחים את האתר מחדש.'], ['always', 'בכל דף', 'בכל טעינה של דף מתאים. מתאים רק להודעה דחופה.']];
  const TRIGGERS = [['delay', 'אחרי זמן', 'כמה שניות אחרי שהדף נפתח'], ['scroll', 'אחרי גלילה', 'כשגללו חלק מהדף'], ['exit', 'ביציאה', 'כשהעכבר יוצא מהחלון (בטלפון — אחרי 15 שניות)']];
  const ICONS = ['', '🎙️', '🎵', '🎧', '📢', '⭐', '🎉', '🕯️', '📅', '⏰', '📩', '🗳️', '❤️', '⚠️', '✨', '🔥'];
  const AUD = { all: 'כולם', signed: 'רק מחוברים', guest: 'רק מי שלא מחובר' };
  const VIS = { all: '', new: 'ביקור ראשון', returning: 'מבקרים חוזרים' };
  const KIND_NAME = Object.fromEntries(KINDS.map(([k, t]) => [k, t]));

  /* ---------- מצב ומה חסר ---------- */
  function problems(p) {
    const out = [];
    if (!p.title.trim() && !p.text.trim() && !p.image) out.push('אין כותרת, טקסט או תמונה');
    if (p.until && p.from && p.until <= p.from) out.push('מועד הסיום לפני ההתחלה');
    if (p.kind === 'bar' && p.text.includes('\n')) out.push('בפס צף מוצגת רק השורה הראשונה של הטקסט');
    p.buttons.forEach((b, i) => { if (!b.label.trim() && b.url.trim()) out.push(`לכפתור ${i + 1} יש קישור בלי טקסט`); });
    return out;
  }
  const blocking = (issues) => issues.filter((x) => !x.startsWith('בפס צף'));
  function state(p) {
    const t = nowIL();
    if (!p.enabled) return { cls: 'draft', text: 'כבויה' };
    if (blocking(problems(p)).length) return { cls: 'warn', text: 'לא תוצג — חסרים פרטים' };
    if (p.from && p.from > t) return { cls: 'soon', text: `תקפוץ מ־${fmtWall(p.from)}` };
    if (p.until && p.until <= t) return { cls: 'closed', text: 'הזמן עבר' };
    return { cls: 'live', text: p.until ? `פעילה עד ${fmtWall(p.until)}` : 'פעילה' };
  }
  function fmtWall(w) {
    const [d, time] = String(w).split('T');
    const [y, m, day] = d.split('-').map(Number);
    return `${day}.${m}${y !== Number(nowIL().slice(0, 4)) ? `.${y}` : ''}${time && time !== '00:00' ? ` ${time}` : ''}`;
  }
  function summary(p) {
    const where = p.pages.length && p.pages.length < PAGES.length ? p.pages.map((k) => R().PAGE_NAMES[k]).join(', ') : 'כל הדפים';
    const who = [AUD[p.audience], VIS[p.visitors]].filter(Boolean).join(' · ');
    const when = p.trigger === 'scroll' ? `אחרי גלילה של ${p.scroll}%` : p.trigger === 'exit' ? 'ביציאה מהדף' : p.delay ? `אחרי ${p.delay} שניות` : 'מיד';
    return [KIND_NAME[p.kind], where, who, when, FREQ.find((f) => f[0] === p.freq)[1]];
  }
  const thumb = (p) => `<span class="pp-thumb rpop-tone-${p.tone}" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<i>${esc(p.icon || R().ICON[p.tone] || '✦')}</i>`}</span>`;
  const label = (p) => p.name || p.title || (p.text ? p.text.split('\n')[0].slice(0, 60) : '') || 'הודעה בלי כותרת';
  const liveUrl = (p) => `${SITE}${p.pages.length === 1 ? { home: '', archive: 'archive.html', episode: 'archive.html', me: 'me.html', updates: 'updates.html', other: 'negishut.html' }[p.pages[0]] : ''}?popup=${encodeURIComponent(p.id)}`;

  /* ---------- הרשימה בלשונית "האתר" ---------- */
  function siteCard() {
    const list = popups();
    const live = list.filter((p) => state(p).cls === 'live').length;
    return `
<div class="card" id="popups-card">
  <div class="section-title"><div><p class="kicker">הודעות קופצות</p><h2>הודעות קופצות באתר</h2></div><div class="pp-head-ops">${list.length ? `<span class="pa-state${live ? ' live' : ''}">${live ? `${live} פעילות` : 'אין פעילות'}</span>` : ''}<button type="button" class="btn gold" data-pp="new">+ הודעה חדשה</button></div></div>
  <div class="card-body">
    <p class="help">הודעה שקופצת למאזינים באתר — חלון במרכז, מגירה מלמטה, הודעה בפינה או פס צף. בוחרים באילו דפים, למי (מחוברים, ביקור ראשון…), מתי היא מתחילה ונגמרת, כמה פעמים כל מאזין רואה אותה ומתי בדיוק היא קופצת. ההודעה העליונה ברשימה קודמת לאחרות; משנים סדר בחצים. שינוי עולה לאתר בלחיצה על "פרסום לאתר".</p>
    ${list.length ? `<div class="pa-list">${list.map(row).join('')}</div>` : `<div class="state pa-empty"><span class="mark">✦</span><h3>עדיין אין הודעות קופצות</h3><p>תוכנית חדשה עלתה? ברכה לחג? הסקר נפתח? הודעה אחת — וכל המאזינים רואים.</p><button type="button" class="btn primary" data-pp="new">יצירת ההודעה הראשונה <span>←</span></button></div>`}
  </div>
</div>`;
  }
  function row(p, i, list) {
    const st = state(p);
    return `
<div class="pa-row pp-row" data-pp-row="${esc(p.id)}">
  ${thumb(p)}
  <div class="pa-main">
    <b>${esc(label(p))}</b>
    <div class="pa-meta"><span class="pa-state ${st.cls}">${esc(st.text)}</span>${summary(p).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
  </div>
  <div class="pa-ops">
    <button type="button" class="toggle small${p.enabled ? ' on' : ''}" data-pp="toggle" data-id="${esc(p.id)}" aria-pressed="${p.enabled}">${p.enabled ? '✓ פעילה' : 'כבויה'}</button>
    <button type="button" class="btn small" data-pp="edit" data-id="${esc(p.id)}">עריכה</button>
    <button type="button" class="btn ghost small" data-pp="try" data-id="${esc(p.id)}" title="להקפיץ כאן, כמו באתר">▶ נסיון</button>
    <details class="pp-more"><summary class="btn ghost small" aria-label="עוד פעולות">⋯</summary><div class="pp-menu">
      <button type="button" data-pp="dup" data-id="${esc(p.id)}">שכפול</button>
      <button type="button" data-pp="again" data-id="${esc(p.id)}">להציג שוב לכולם</button>
      <a href="${esc(liveUrl(p))}" target="_blank" rel="noopener">פתיחה באתר (אחרי הפרסום) ↗</a>
      <button type="button" class="danger-text" data-pp="del" data-id="${esc(p.id)}">מחיקה</button>
    </div></details>
    <button type="button" class="icon-btn" data-pp="up" data-id="${esc(p.id)}" aria-label="עדיפות גבוהה יותר" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" class="icon-btn" data-pp="down" data-id="${esc(p.id)}" aria-label="עדיפות נמוכה יותר" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
  </div>
</div>`;
  }

  /* ---------- תבניות להתחלה מהירה ---------- */
  function latestLink() {
    const e = [...B().data.episodes].filter((x) => x.visible !== false).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    return e ? { title: e.title || '', url: `episode.html?ep=${encodeURIComponent(e.slug || e.id)}` } : { title: '', url: 'archive.html' };
  }
  const TEMPLATES = {
    episode: () => { const l = latestLink(); return { name: 'תוכנית חדשה', kind: 'toast', tone: 'gold', icon: '🎙️', title: 'תוכנית חדשה עלתה!', text: l.title ? `**${l.title}** — כבר באתר. האזנה נעימה!` : 'התוכנית החדשה כבר באתר. האזנה נעימה!', buttons: [{ label: 'להאזנה', url: l.url, style: 'primary', newTab: false }], freq: 'once', delay: 3, autoClose: 15, pages: [] }; },
    holiday: () => ({ name: 'ברכה לחג', kind: 'modal', tone: 'violet', icon: '🕯️', title: 'חג שמח!', text: 'צוות ראש בראש מאחל לכל המאזינים חג שמח ומועדים לשמחה.', buttons: [{ label: 'תודה', url: '', style: 'primary', newTab: false }], freq: 'once', delay: 2, pages: ['home'] }),
    subscribe: () => ({ name: 'הצטרפות לתפוצה', kind: 'sheet', tone: 'teal', icon: '📩', title: 'רוצים לדעת ראשונים?', text: 'הצטרפו לרשימת התפוצה ותקבלו הודעה בכל פעם שתוכנית חדשה עולה.', buttons: [{ label: 'להצטרפות', url: 'index.html#follow', style: 'primary', newTab: false }, { label: 'לא עכשיו', url: '', style: 'ghost', newTab: false }], freq: 'once', trigger: 'scroll', scroll: 60, audience: 'all', visitors: 'returning', pages: [] }),
    survey: () => ({ name: 'הסקר נפתח', kind: 'modal', tone: 'success', icon: '🗳️', title: 'ההצבעה למצעד נפתחה!', text: 'בחרו את השירים והזמרים שלכם — התוצאות יוכרזו בתוכנית.', buttons: [{ label: 'להצבעה', url: B().data.settings.survey?.url || 'https://rosh-berosh.smwlyqswkwt232.workers.dev/', style: 'primary', newTab: true }, { label: 'אחר כך', url: '', style: 'ghost', newTab: false }], freq: 'daily', delay: 4, pages: [] }),
    urgent: () => ({ name: 'הודעה דחופה', kind: 'bar', tone: 'danger', icon: '⚠️', title: 'שימו לב:', text: 'התוכנית של השבוע נדחית ליום ראשון.', buttons: [], freq: 'session', delay: 0, pages: [] }),
    welcome: () => ({ name: 'ברוכים הבאים', kind: 'toast', tone: 'night', icon: '✨', title: 'ברוכים הבאים לראש בראש', text: 'כל התוכניות בארכיון, האזנה ישירה מהאתר — ונמשיך בדיוק מאיפה שעצרתם.', buttons: [{ label: 'לארכיון', url: 'archive.html', style: 'primary', newTab: false }], freq: 'once', delay: 6, autoClose: 20, visitors: 'new', pages: ['home'] }),
  };
  function blank(preset = {}) {
    return S.admin.normPopup({
      id: newId(12), enabled: true, name: '', kind: 'modal', tone: 'gold', icon: '', title: '', text: '', image: '', buttons: [],
      from: '', until: '', pages: [], audience: 'all', visitors: 'all', freq: 'once', trigger: 'delay', delay: 2, scroll: 50, autoClose: 0, rev: 0,
      createdAt: new Date().toISOString(), ...preset,
    });
  }

  /* ---------- חלון היצירה והעריכה ---------- */
  let E = null;   // { draft, isNew, dirty, device: 'desk'|'phone', page, uploading }
  (window.RoshBusy = window.RoshBusy || []).push(() => !!E?.dirty || !!E?.uploading);

  function open(popup, preset) {
    const isNew = !popup;
    const draft = clone(popup || blank(preset));
    while (draft.buttons.length < 2) draft.buttons.push({ label: '', url: '', style: draft.buttons.length ? 'ghost' : 'primary', newTab: false });
    E = { draft, isNew, dirty: false, device: 'desk', fresh: isNew && !preset };
    document.getElementById('dlg-popup')?.remove();
    const d = document.createElement('dialog');
    d.id = 'dlg-popup';
    d.className = 'sheet poll-editor popup-editor';
    d.setAttribute('aria-labelledby', 'ppe-title');
    d.innerHTML = frame();
    document.body.appendChild(d);
    wire(d);
    paintAll();
    d.showModal();
    d.querySelector('[data-ppe="title"]')?.focus();
  }

  function frame() {
    return `
<div class="section-title pe-head">
  <div><p class="kicker">${E.isNew ? 'הודעה קופצת חדשה' : 'עריכת הודעה קופצת'}</p><h2 id="ppe-title">${esc(label(E.draft))}</h2></div>
  <button type="button" class="icon-btn" data-ppe-op="close" aria-label="סגירה">✕</button>
</div>
<nav class="pe-steps" aria-label="חלקי ההודעה">
  ${[['c', 'התוכן'], ['d', 'עיצוב'], ['w', 'איפה ולמי'], ['t', 'מתי וכמה']].map(([k, t], i) => `<button type="button" data-ppe-jump="${k}"><i>${i + 1}</i>${t}</button>`).join('')}
</nav>
<div class="pe-body">
  <div class="pe-form" id="ppe-form"></div>
  <aside class="pe-preview" aria-label="תצוגה מקדימה">
    <div class="pe-prev-bar">
      <div class="segmented" role="group" aria-label="גודל מסך"><button type="button" data-ppe-device="desk">מחשב</button><button type="button" data-ppe-device="phone">טלפון</button></div>
      <button type="button" class="btn gold small" data-ppe-op="try">▶ הפעלה אמיתית</button>
    </div>
    <div class="pe-prev-frame" id="ppe-frame"><div class="pp-stage" id="ppe-stage"></div></div>
    <p class="help pe-prev-note" id="ppe-note"></p>
  </aside>
</div>
<div class="card-foot pe-foot">
  <span class="pe-issues" id="ppe-issues" aria-live="polite"></span>
  ${E.isNew ? '' : '<button type="button" class="btn ghost danger-text" data-ppe-op="delete">מחיקה</button><button type="button" class="btn ghost" data-ppe-op="duplicate">שכפול</button>'}
  <button type="button" class="btn" data-ppe-op="close">ביטול</button>
  <button type="button" class="btn primary" data-ppe-op="save">${E.isNew ? 'יצירת ההודעה' : 'שמירה'} <span>←</span></button>
</div>
<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden data-ppe-file>`;
  }

  const seg = (field, value, list) => `<div class="segmented pe-seg" role="group">${list.map(([v, t]) => `<button type="button" data-ppe-set="${field}" data-v="${v}" aria-pressed="${String(value) === v}">${t}</button>`).join('')}</div>`;
  const KIND_ICON = {
    modal: '<svg viewBox="0 0 48 36"><rect x="2" y="2" width="44" height="32" rx="4" opacity=".25"/><rect x="12" y="8" width="24" height="20" rx="4"/></svg>',
    sheet: '<svg viewBox="0 0 48 36"><rect x="2" y="2" width="44" height="32" rx="4" opacity=".25"/><rect x="6" y="20" width="36" height="14" rx="4"/></svg>',
    toast: '<svg viewBox="0 0 48 36"><rect x="2" y="2" width="44" height="32" rx="4" opacity=".25"/><rect x="26" y="22" width="18" height="10" rx="3"/></svg>',
    bar: '<svg viewBox="0 0 48 36"><rect x="2" y="2" width="44" height="32" rx="4" opacity=".25"/><rect x="6" y="5" width="36" height="6" rx="3"/></svg>',
  };
  const radios = (field, value, list) => `<div class="pe-radios">${list.map(([v, t, sub]) => `<label class="pe-radio${value === v ? ' on' : ''}"><input type="radio" name="ppe-${field}" data-ppe="${field}" value="${v}" ${value === v ? 'checked' : ''}><b>${t}</b><small>${sub}</small></label>`).join('')}</div>`;

  function form() {
    const p = E.draft;
    const all = !p.pages.length;
    return `
${E.fresh ? `<section class="pe-sec pe-templates"><h3>להתחיל מתבנית?</h3><div class="pe-chips">${[['episode', '🎙️ תוכנית חדשה עלתה'], ['holiday', '🕯️ ברכה לחג'], ['subscribe', '📩 הצטרפות לתפוצה'], ['survey', '🗳️ ההצבעה נפתחה'], ['urgent', '⚠️ הודעה דחופה'], ['welcome', '✨ ברוכים הבאים']].map(([k, t]) => `<button type="button" class="chip" data-ppe-template="${k}">${t}</button>`).join('')}</div></section>` : ''}

<section class="pe-sec" data-ppe-sec="c">
  <h3><i>1</i>התוכן</h3>
  <div class="form-grid">
    <label class="field span2"><span>כותרת</span><input data-ppe="title" value="${esc(p.title)}" maxlength="120" placeholder="למשל: תוכנית חדשה עלתה!"></label>
    <label class="field span2"><span>הטקסט</span><textarea data-ppe="text" maxlength="1500" rows="4" placeholder="כמה מילים למאזינים. **מודגש**, [מילה](כתובת) לקישור.">${esc(p.text)}</textarea><small>**מודגש** · [טקסט](כתובת) — קישור · שורה ריקה — פסקה חדשה. <span id="ppe-count">${p.text.length}</span>/1500</small></label>
    <label class="field"><span>שם פנימי (רק בניהול)</span><input data-ppe="name" value="${esc(p.name)}" maxlength="80" placeholder="למשל: ברכה לפסח"></label>
    <div class="field"><span>סמל</span><div class="pp-icons" role="group" aria-label="סמל">${ICONS.map((ic) => `<button type="button" class="pp-icon" data-ppe-set="icon" data-v="${esc(ic)}" aria-pressed="${p.icon === ic}" ${ic ? '' : 'title="לפי הצבע"'}>${ic || esc(R().ICON[p.tone])}</button>`).join('')}<input data-ppe="icon" value="${esc(p.icon)}" maxlength="8" class="pp-icon-in center" aria-label="סמל משלכם" placeholder="✎"></div></div>
  </div>
  <div class="pe-image">
    <div class="pe-drop${p.image ? ' has' : ''}" data-ppe-drop tabindex="0" role="button" aria-label="תמונה להודעה — לחיצה לבחירה או גרירה">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span>🖼️</span><b>תמונה (לא חובה)</b><small>לחצו או גררו לכאן (JPG, PNG, WEBP)</small>'}
      <em class="pe-progress" hidden></em>
    </div>
    <div class="pe-image-side">
      <label class="field"><span>או קישור לתמונה</span><input data-ppe="image" value="${esc(p.image)}" class="ltr" placeholder="https://…" spellcheck="false"></label>
      ${p.image ? '<button type="button" class="btn small" data-ppe-op="image-clear">הסרת התמונה</button>' : ''}
      <small class="cue-hint">בפס צף התמונה לא מוצגת.</small>
    </div>
  </div>
  <div class="field"><span>כפתורים <small>(עד שניים; כפתור בלי קישור רק סוגר את ההודעה)</small></span>
    <div class="pp-btns">${p.buttons.map((b, i) => `
      <div class="pp-btn-row">
        <input data-ppb="label" data-i="${i}" value="${esc(b.label)}" maxlength="40" placeholder="${i ? 'כפתור שני (לא חובה)' : 'טקסט הכפתור, למשל: להאזנה'}" aria-label="טקסט כפתור ${i + 1}">
        <input data-ppb="url" data-i="${i}" value="${esc(b.url)}" class="ltr" placeholder="episode.html?ep=… / https://…" aria-label="קישור כפתור ${i + 1}" spellcheck="false">
        <div class="segmented" role="group" aria-label="סגנון כפתור ${i + 1}"><button type="button" data-ppb-style="primary" data-i="${i}" aria-pressed="${b.style !== 'ghost'}">בולט</button><button type="button" data-ppb-style="ghost" data-i="${i}" aria-pressed="${b.style === 'ghost'}">שקט</button></div>
        <label class="check pp-newtab"><input type="checkbox" data-ppb="newTab" data-i="${i}" ${b.newTab ? 'checked' : ''}> בחלון חדש</label>
      </div>`).join('')}
      <div class="pe-chips pp-quick">${quickLinks().map(([t, u]) => `<button type="button" class="chip" data-ppe-link="${esc(u)}">${esc(t)}</button>`).join('')}</div>
    </div>
  </div>
</section>

<section class="pe-sec" data-ppe-sec="d">
  <h3><i>2</i>עיצוב</h3>
  <div class="field"><span>סוג ההודעה</span><div class="pe-tiles" role="group">${KINDS.map(([v, t, sub]) => `<button type="button" class="pe-tile" data-ppe-set="kind" data-v="${v}" aria-pressed="${p.kind === v}">${KIND_ICON[v]}<b>${t}</b><small>${sub}</small></button>`).join('')}</div></div>
  <div class="field"><span>צבע</span><div class="pp-tones" role="group">${TONES.map(([v, t]) => `<button type="button" class="pp-tone rpop-tone-${v}" data-ppe-set="tone" data-v="${v}" aria-pressed="${p.tone === v}"><i aria-hidden="true"></i>${t}</button>`).join('')}</div></div>
  ${p.kind === 'toast' || p.kind === 'bar' ? `<label class="field pe-max"><span>להיסגר לבד אחרי (שניות)</span><input type="number" min="0" max="120" data-ppe="autoClose" value="${p.autoClose}" class="ltr center"><small>0 — נשארת עד שסוגרים.</small></label>` : ''}
</section>

<section class="pe-sec" data-ppe-sec="w">
  <h3><i>3</i>איפה ולמי</h3>
  <div class="field"><span>באילו דפים</span>
    <div class="pe-places">
      <label class="check pe-place"><input type="checkbox" data-ppe-allpages ${all ? 'checked' : ''}> ✦ בכל הדפים</label>
      ${PAGES.map(([k, t]) => `<label class="check pe-place"><input type="checkbox" data-ppe-page="${k}" ${!all && p.pages.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}
    </div>
  </div>
  <div class="pe-two">
    <div class="field"><span>למי</span>${seg('audience', p.audience, [['all', 'כולם'], ['signed', 'מחוברים'], ['guest', 'לא מחוברים']])}</div>
    <div class="field"><span>ביקור</span>${seg('visitors', p.visitors, [['all', 'כל ביקור'], ['new', 'ביקור ראשון'], ['returning', 'חוזרים']])}</div>
  </div>
</section>

<section class="pe-sec" data-ppe-sec="t">
  <h3><i>4</i>מתי וכמה</h3>
  <div class="switches"><button type="button" class="toggle big${p.enabled ? ' on' : ''}" data-ppe-toggle="enabled" aria-pressed="${p.enabled}">${p.enabled ? '✓ פעילה — תקפוץ באתר אחרי הפרסום' : 'כבויה — שמורה רק כאן'}</button></div>
  <div class="form-grid">
    <label class="field"><span>להתחיל ב־ (לא חובה)</span><input type="datetime-local" data-ppe="from" value="${esc(p.from)}"><small>ריק — מיד אחרי הפרסום. שעון ישראל.</small></label>
    <label class="field"><span>לסיים ב־ (לא חובה)</span><input type="datetime-local" data-ppe="until" value="${esc(p.until)}"><small>אחרי זה ההודעה יורדת לבד.</small></label>
  </div>
  <div class="pe-chips">${[['1', 'עד מחר בערב'], ['3', 'ל־3 ימים'], ['7', 'לשבוע'], ['30', 'לחודש'], ['', 'בלי מועד סיום']].map(([d, t]) => `<button type="button" class="chip" data-ppe-until="${d}">${t}</button>`).join('')}</div>
  <div class="field"><span>מתי לקפוץ</span><div class="pe-tiles" role="group">${TRIGGERS.map(([v, t, sub]) => `<button type="button" class="pe-tile" data-ppe-set="trigger" data-v="${v}" aria-pressed="${p.trigger === v}"><b>${t}</b><small>${sub}</small></button>`).join('')}</div></div>
  ${p.trigger === 'scroll'
    ? `<label class="field"><span>אחרי שגללו <b id="ppe-scroll-v">${p.scroll}%</b> מהדף</span><input type="range" min="10" max="100" step="5" data-ppe="scroll" value="${p.scroll}"></label>`
    : `<label class="field pe-max"><span>${p.trigger === 'exit' ? 'לא לפני (שניות בדף)' : 'כמה שניות לחכות'}</span><input type="number" min="0" max="600" data-ppe="delay" value="${p.delay}" class="ltr center"></label>`}
  <div class="field"><span>כמה פעמים כל מאזין רואה</span>${radios('freq', p.freq, FREQ)}</div>
  ${E.isNew ? '' : `<div class="pp-again"><button type="button" class="btn small" data-ppe-op="again">↻ להציג שוב לכולם</button><small class="cue-hint">${p.rev ? `הוצגה מחדש ${p.rev} פעמים. ` : ''}מי שכבר ראה את ההודעה יראה אותה שוב אחרי הפרסום — למשל אחרי שתיקנתם אותה.</small></div>`}
</section>`;
  }
  function quickLinks() {
    const l = latestLink();
    return [['התוכנית האחרונה', l.url], ['הארכיון', 'archive.html'], ['האזור האישי', 'me.html'], ['העדכונים', 'updates.html'], ['הצטרפות לתפוצה', 'index.html#follow']];
  }

  /* ---------- ציור ---------- */
  const $ = (sel) => document.getElementById('dlg-popup')?.querySelector(sel);
  function paintAll() { $('#ppe-form').innerHTML = form(); paintPreview(); paintHead(); }
  let prevTimer = 0;
  function cleanDraft() {
    const p = clone(E.draft);
    p.buttons = p.buttons.filter((b) => b.label.trim());
    return S.admin.normPopup(p);
  }
  function paintPreview(now = false) {
    clearTimeout(prevTimer);
    const run = () => {
      const stage = $('#ppe-stage'); if (!stage) return;
      const p = cleanDraft();
      stage.className = `pp-stage pp-on-${p.kind}`;
      stage.innerHTML = `<div class="pp-fake" aria-hidden="true"><i class="pp-fake-head"></i><i class="pp-fake-hero"></i><i></i><i></i><i class="short"></i><i></i></div><div class="pp-layer" id="ppe-layer"></div>`;
      if (!R().preview($('#ppe-layer'), p)) $('#ppe-layer').innerHTML = '<div class="state"><span class="mark">✦</span><p>כתבו כותרת או טקסט, וההודעה תופיע כאן.</p></div>';
      $('#ppe-frame').classList.toggle('phone', E.device === 'phone');
      document.querySelectorAll('#dlg-popup [data-ppe-device]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ppeDevice === E.device)));
      const note = $('#ppe-note');
      if (note) note.textContent = `${summary(p).join(' · ')}. "הפעלה אמיתית" מקפיצה את ההודעה כאן, בדיוק כמו באתר.`;
    };
    if (now) run(); else prevTimer = setTimeout(run, 90);
  }
  function paintHead() {
    const t = $('#ppe-title'); if (t) t.textContent = label(E.draft);
    const issues = problems(E.draft);
    const el = $('#ppe-issues');
    const st = state(cleanDraft());
    if (el) el.innerHTML = issues.length ? `⚠ ${esc(issues.join(' · '))}` : !E.draft.enabled ? 'ההודעה כבויה — תישמר, אבל לא תקפוץ באתר.' : esc(st.text);
    el?.classList.toggle('bad', blocking(issues).length > 0);
    const c = $('#ppe-count'); if (c) c.textContent = String(E.draft.text.length);
  }
  function change(full = false) {
    E.dirty = true; E.fresh = false;
    if (full) { const y = $('.pe-form')?.scrollTop; paintAll(); if (y != null) $('.pe-form').scrollTop = y; } else { paintPreview(); paintHead(); }
  }

  /* ---------- העלאת תמונה ---------- */
  async function upload(file) {
    if (!file) return;
    if (!B().cloud || typeof window.RoshUpload !== 'function') { U.notify('העלאת תמונות זמינה רק בניהול המחובר לשרת. אפשר להדביק קישור לתמונה.', 'error'); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { U.notify('אפשר להעלות JPG, PNG או WEBP.', 'error'); return; }
    const box = $('[data-ppe-drop]');
    const bar = box?.querySelector('.pe-progress');
    if (bar) { bar.hidden = false; bar.textContent = '0%'; }
    box?.classList.add('busy');
    const ed = E; ed.uploading = (ed.uploading || 0) + 1;
    try {
      const url = await window.RoshUpload(file, `popup-${ed.draft.id}`, 'cover', (pct) => { if (bar) bar.textContent = `${pct}%`; });
      if (E !== ed) return;
      E.draft.image = url;
      change(true);
    } catch (err) { U.notify(`ההעלאה נכשלה: ${err.message}`, 'error'); }
    finally { ed.uploading--; }
    box?.classList.remove('busy');
    if (bar) bar.hidden = true;
  }

  /* ---------- אירועים בחלון ---------- */
  function untilIn(days) {
    if (!days) return '';
    const base = E.draft.from && E.draft.from > nowIL() ? E.draft.from : nowIL();
    const at = new Date(Date.parse(`${base}:00Z`) + days * 86400000);
    return `${at.toISOString().slice(0, 10)}T${days === 1 ? '22:00' : '23:59'}`;
  }
  function wire(d) {
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    d.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-ppe]')) {
        const k = t.dataset.ppe;
        let v = t.value;
        if (k === 'delay' || k === 'autoClose' || k === 'scroll') v = Math.max(0, Math.min(k === 'delay' ? 600 : k === 'scroll' ? 100 : 120, Math.round(Number(v) || 0)));
        if (k === 'from' || k === 'until') v = v ? v.slice(0, 16) : '';
        if (k === 'scroll') { const o = $('#ppe-scroll-v'); if (o) o.textContent = `${v}%`; }
        E.draft[k] = v;
        if (k === 'icon') d.querySelectorAll('.pp-icon').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        change(k === 'freq');
        return;
      }
      if (t.matches('[data-ppb]')) {
        const b = E.draft.buttons[Number(t.dataset.i)];
        b[t.dataset.ppb] = t.type === 'checkbox' ? t.checked : t.value;
        change();
      }
    });
    d.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-ppe-allpages]')) { E.draft.pages = t.checked ? [] : ['home']; change(true); return; }
      if (t.matches('[data-ppe-page]')) {
        const k = t.dataset.ppePage;
        const set = new Set(E.draft.pages);
        if (t.checked) set.add(k); else set.delete(k);
        // כל הדפים סומנו — אותו דבר כמו "בכל הדפים"; אף דף — חוזרים ל"בכל הדפים"
        E.draft.pages = set.size === PAGES.length ? [] : PAGES.map(([x]) => x).filter((x) => set.has(x));
        change(true);
        return;
      }
      if (t.matches('[data-ppe="image"]')) { change(true); return; }
      if (t.matches('[data-ppe-file]')) { const f = t.files?.[0]; t.value = ''; upload(f); }
    });
    d.addEventListener('click', (e) => {
      const t = e.target;
      const btn = t.closest('button, [data-ppe-drop]');
      if (!btn || !d.contains(btn)) return;
      if (btn.dataset.ppeJump) { d.querySelector(`[data-ppe-sec="${btn.dataset.ppeJump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (btn.dataset.ppeDevice) { E.device = btn.dataset.ppeDevice; paintPreview(true); return; }
      if (btn.dataset.ppeTemplate) {
        const tpl = TEMPLATES[btn.dataset.ppeTemplate]();
        Object.assign(E.draft, S.admin.normPopup({ ...E.draft, ...tpl, id: E.draft.id, enabled: true }));
        while (E.draft.buttons.length < 2) E.draft.buttons.push({ label: '', url: '', style: 'ghost', newTab: false });
        change(true);
        $('[data-ppe="title"]')?.focus();
        return;
      }
      if (btn.dataset.ppeSet != null) {
        E.draft[btn.dataset.ppeSet] = btn.dataset.v;
        change(true);
        return;
      }
      if (btn.dataset.ppbStyle) { E.draft.buttons[Number(btn.dataset.i)].style = btn.dataset.ppbStyle; change(true); return; }
      if (btn.dataset.ppeLink != null) {
        // קישור מהיר: לכפתור הראשון שאין לו קישור (או לראשון)
        const bs = E.draft.buttons;
        const b = bs.find((x) => !x.url) || bs[0];
        b.url = btn.dataset.ppeLink;
        if (!b.label) b.label = btn.textContent.trim();
        change(true);
        return;
      }
      if (btn.dataset.ppeToggle) { const k = btn.dataset.ppeToggle; E.draft[k] = !E.draft[k]; change(true); return; }
      if (btn.dataset.ppeUntil != null) { E.draft.until = untilIn(Number(btn.dataset.ppeUntil)); change(true); return; }
      if (btn.matches('[data-ppe-drop]') && !t.closest('button')) { $('[data-ppe-file]').click(); return; }
      switch (btn.dataset.ppeOp) {
        case 'close': close(); break;
        case 'save': save(); break;
        case 'delete': remove(E.draft.id, true); break;
        case 'try': tryLive(cleanDraft()); break;
        case 'again': E.draft.rev = (E.draft.rev || 0) + 1; change(true); U.notify('אחרי השמירה והפרסום — ההודעה תקפוץ שוב גם למי שכבר ראה אותה.', 'info'); break;
        case 'duplicate': {
          const copy = clone(E.draft); copy.id = newId(12); copy.enabled = false; copy.rev = 0; copy.name = `${label(copy)} (עותק)`.slice(0, 80); copy.createdAt = new Date().toISOString();
          E.isNew = true; E.draft = copy; E.dirty = true; E.fresh = false;
          document.getElementById('dlg-popup').innerHTML = frame(); paintAll();
          U.notify('נוצר עותק (כבוי). שמרו כדי להוסיף אותו.', 'info');
          break;
        }
        case 'image-clear': E.draft.image = ''; change(true); break;
        default:
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.target.matches?.('[data-ppe-drop]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('[data-ppe-file]').click(); }
    });
    d.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-ppe-drop]'); if (z && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
    d.addEventListener('dragleave', (e) => { e.target.closest?.('[data-ppe-drop]')?.classList.remove('over'); });
    d.addEventListener('drop', (e) => {
      const z = e.target.closest?.('[data-ppe-drop]');
      if (!z || !e.dataTransfer?.files?.length) return;
      e.preventDefault(); z.classList.remove('over');
      upload(e.dataTransfer.files[0]);
    });
  }

  /** "הפעלה אמיתית": מקפיצה את ההודעה כאן בניהול — אותו קוד כמו באתר. חלון העריכה מוסתר לרגע. */
  function tryLive(p) {
    if (!p.title.trim() && !p.text.trim() && !p.image) { U.notify('כתבו קודם כותרת או טקסט.', 'info'); return; }
    const dlg = document.getElementById('dlg-popup');
    const temp = { ...p, id: `try-${p.id}`, pages: [] };
    R().close(temp.id);
    const back = () => { if (dlg && !dlg.open && document.body.contains(dlg)) dlg.showModal(); };
    if (dlg?.open && (p.kind === 'modal' || p.kind === 'sheet')) {
      dlg.close();
      R().show(temp, { force: true });
      const shown = document.querySelector(`.rpop[data-popup="${CSS.escape(temp.id)}"]`);
      // חלון העריכה חוזר כשסוגרים את ההודעה
      const obs = new MutationObserver(() => { if (!document.body.contains(shown)) { obs.disconnect(); back(); } });
      obs.observe(document.body, { childList: true });
    } else R().show(temp, { force: true });
  }

  function close() {
    if (E?.uploading) { U.notify('התמונה עוד עולה — רגע…', 'info'); return; }
    if (E?.dirty && !confirm('יש שינויים שלא נשמרו. לסגור בלי לשמור?')) return;
    const d = document.getElementById('dlg-popup');
    d?.close(); d?.remove();
    E = null;
  }
  function save() {
    if (E.uploading) { U.notify('התמונה עוד עולה — רגע…', 'info'); return; }
    const p = E.draft;
    const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    ['title', 'name', 'icon'].forEach((k) => { p[k] = tidy(p[k]); });
    p.text = String(p.text ?? '').split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    p.buttons.forEach((b) => { b.label = tidy(b.label); b.url = String(b.url || '').trim(); });
    const issues = blocking(problems(p));
    if (p.enabled && issues.length && !confirm(`${issues.join(', ')}.\nההודעה תישמר, אבל לא תקפוץ באתר עד שזה יתוקן. לשמור?`)) return;
    const bad = p.buttons.filter((b) => b.label && b.url && !S.admin.normPopup({ id: 'x', buttons: [b] }).buttons[0].url);
    if (bad.length) { U.notify(`הקישור "${bad[0].url}" לא תקין — אפשר https://…, mailto:, tel: או דף באתר.`, 'error'); return; }
    const clean = cleanDraft();
    const list = popups();
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.unshift(clean);
    E.dirty = false;
    close();
    B().touch();
    B().render();
    U.notify(`ההודעה נשמרה בטיוטה. היא ${clean.enabled ? 'תעלה לאתר' : 'תישמר (כבויה)'} בלחיצה על "פרסום לאתר".`, 'success');
  }
  function remove(id, fromEditor = false) {
    if (fromEditor && E?.uploading) { U.notify('התמונה עוד עולה — רגע…', 'info'); return; }
    const p = popups().find((x) => x.id === id); if (!p) { if (fromEditor) { E.dirty = false; close(); } return; }
    if (!confirm(`למחוק את ההודעה "${label(p)}"? היא תרד מהאתר בפרסום הבא.`)) return;
    B().data.settings.popups = popups().filter((x) => x.id !== id);
    if (fromEditor) { E.dirty = false; close(); }
    B().touch(); B().render();
    U.notify('ההודעה נמחקה מהטיוטה.', 'success');
  }

  /* ---------- כפתורי הרשימה ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pp]'); if (!b || !document.getElementById('panel')?.contains(b)) return;
    const list = popups();
    const id = b.dataset.id;
    const i = list.findIndex((x) => x.id === id);
    const p = list[i];
    b.closest('details')?.removeAttribute('open');
    switch (b.dataset.pp) {
      case 'new': open(null); break;
      case 'edit': if (p) open(p); break;
      case 'try': if (p) tryLive(p); break;
      case 'toggle': if (p) { p.enabled = !p.enabled; B().touch(); B().render(); U.notify(p.enabled ? 'ההודעה הופעלה — תעלה לאתר בפרסום.' : 'ההודעה כובתה — תרד מהאתר בפרסום.', 'info'); } break;
      case 'up': if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; B().touch(); B().render(); } break;
      case 'down': if (i >= 0 && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; B().touch(); B().render(); } break;
      case 'again': if (p) { p.rev = (p.rev || 0) + 1; B().touch(); B().render(); U.notify('אחרי הפרסום ההודעה תקפוץ שוב גם למי שכבר ראה אותה.', 'success'); } break;
      case 'dup': if (p) { const copy = clone(p); copy.id = newId(12); copy.enabled = false; copy.rev = 0; copy.name = `${label(p)} (עותק)`.slice(0, 80); copy.createdAt = new Date().toISOString(); open(null, copy); E.isNew = true; } break;
      case 'del': remove(id); break;
      default:
    }
  });

  window.RoshPopupAdmin = { siteCard, open };
})();
