/* ניהול הסקרים: רשימת הסקרים (לשונית "האתר"), סקר לתוכנית (בעורך התוכנית),
   וחלון היצירה והעריכה — טופס מלא ליד תצוגה מקדימה חיה (אותו ציור כמו באתר, polls.js).
   הסקרים נשמרים בטיוטה המשותפת (settings.polls) ועולים לאתר בלחיצה על "פרסום לאתר",
   כמו ההודעה בדף הבית. ההצבעות עצמן בשרת — המספרים כאן מגיעים מ־/api/program/polls.
   הגשר לניהול (window.RoshAdminBridge, admin.js): data, touch, render, cloud. */
(function () {
  'use strict';
  const U = window.RoshUI;
  const S = window.RoshStore;
  const { esc } = U;
  const B = () => window.RoshAdminBridge;
  const P = () => window.RoshPolls;
  const polls = () => (B().data.settings.polls ||= []);
  const newId = (n = 10) => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, n);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const n2 = (n) => Number(n || 0).toLocaleString('he-IL');
  const HUES = [42, 24, 8, 340, 300, 270, 240, 210, 190, 160, 130, 90];
  const nowIL = () => S.nowIL();
  let stats = null;   // { [pollId]: { total, counts } } — מהשרת, רק לסקרים שכבר פורסמו
  let statsError = '';

  /* ---------- מצב, מקום ומה חסר ---------- */
  function filled(p) { return p.options.filter((o) => o.label.trim()); }
  function problems(p) {
    const out = [];
    if (!p.question.trim() && !p.title.trim()) out.push('חסרה שאלה');
    if (filled(p).length < 2) out.push('צריך לפחות שתי תשובות');
    if (p.until && p.from && p.until <= p.from) out.push('מועד הסיום לפני ההתחלה');
    return out;
  }
  function places(p) {
    const s = p.show, out = [];
    if (s.home) out.push('דף הבית');
    if (s.archive) out.push('הארכיון');
    if (s.me) out.push('האזור האישי');
    if (s.allEpisodes) out.push('כל דפי התוכניות');
    else if (s.episodes.length) out.push(s.episodes.length === 1 ? `דף תוכנית: ${epLabel(s.episodes[0])}` : `${s.episodes.length} דפי תוכניות`);
    return out;
  }
  function epLabel(id) { const e = B().data.episodes.find((x) => x.id === id || x.slug === id); return e ? (e.title || 'תוכנית בלי שם') : 'תוכנית שנמחקה'; }
  function state(p) {
    const t = nowIL();
    if (!p.enabled) return { cls: 'draft', text: 'כבוי' };
    if (problems(p).length) return { cls: 'warn', text: 'לא יוצג — חסרים פרטים' };
    if (!places(p).length) return { cls: 'warn', text: 'לא נבחר איפה להציג' };
    if (p.from && p.from > t) return { cls: 'soon', text: `ייפתח ב־${fmtWall(p.from)}` };
    if (p.until && p.until <= t) return { cls: 'closed', text: 'ההצבעה נסגרה' };
    return { cls: 'live', text: p.until ? `פתוח עד ${fmtWall(p.until)}` : 'פתוח להצבעה' };
  }
  function fmtWall(w) {
    const [d, time] = String(w).split('T');
    const [y, m, day] = d.split('-').map(Number);
    return `${day}.${m}${y !== Number(nowIL().slice(0, 4)) ? `.${y}` : ''}${time && time !== '00:00' ? ` ${time}` : ''}`;
  }
  const thumb = (p, cls = 'pa-thumb') => {
    const img = p.image || p.options.find((o) => o.image)?.image;
    return `<span class="${cls}" style="--poll-h:${p.hue}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<i aria-hidden="true">?</i>'}</span>`;
  };

  /* ---------- הרשימה בלשונית "האתר" ---------- */
  function siteCard() {
    const list = polls();
    return `
<div class="card" id="polls-card">
  <div class="section-title"><div><p class="kicker">סקרים</p><h2>סקרים באתר</h2></div><button type="button" class="btn gold" data-pa="new">+ סקר חדש</button></div>
  <div class="card-body">
    <p class="help">שאלה למאזינים, עם תשובות (אפשר עם תמונה לכל תשובה). בוחרים איפה הסקר מופיע — בדף של תוכנית מסוימת, בדף הבית, בארכיון או באזור האישי — ומתי הוא נפתח ונסגר. מצביעים עם חשבון Google, כל מאזין פעם אחת. סקר חדש או שינוי עולים לאתר בפרסום הבא.</p>
    ${statsError ? `<p class="cue-hint">${esc(statsError)}</p>` : ''}
    ${list.length ? `<div class="pa-list">${list.map(row).join('')}</div>` : `<div class="state pa-empty"><span class="mark">?</span><h3>עדיין אין סקרים</h3><p>שאלה אחת, כמה תשובות — והמאזינים מצביעים ישר מהאתר.</p><button type="button" class="btn primary" data-pa="new">יצירת הסקר הראשון <span>←</span></button></div>`}
  </div>
</div>`;
  }
  function row(p) {
    const st = state(p), where = places(p);
    return `
<div class="pa-row" data-pa-row="${esc(p.id)}">
  ${thumb(p)}
  <div class="pa-main">
    <b>${esc(p.question || p.title || 'סקר בלי שאלה')}</b>
    <div class="pa-meta"><span class="pa-state ${st.cls}">${esc(st.text)}</span>${where.length ? `<span>${esc(where.join(' · '))}</span>` : ''}<span>${filled(p).length} תשובות${p.multi ? ` · עד ${p.maxChoices} בחירות` : ''}</span></div>
    <div class="pa-stats" data-pa-stats="${esc(p.id)}">${statsHtml(p)}</div>
  </div>
  <div class="pa-ops">
    <button type="button" class="btn small" data-pa="edit" data-id="${esc(p.id)}">עריכה</button>
    <button type="button" class="btn ghost small" data-pa="dup" data-id="${esc(p.id)}">שכפול</button>
    ${stats?.[p.id]?.total ? `<button type="button" class="btn ghost small" data-pa="reset" data-id="${esc(p.id)}">איפוס ההצבעות</button>` : ''}
    <button type="button" class="icon-btn del" data-pa="del" data-id="${esc(p.id)}" aria-label="מחיקת הסקר">✕</button>
  </div>
</div>`;
  }
  function statsHtml(p) {
    const s = stats?.[p.id];
    if (!s) return stats ? '<small class="cue-hint">עוד לא פורסם — אחרי הפרסום יופיעו כאן ההצבעות.</small>' : '';
    const opts = filled(p);
    const sum = opts.reduce((a, o) => a + (s.counts?.[o.id] || 0), 0);
    if (!s.total) return '<small class="cue-hint">עוד אין הצבעות.</small>';
    const top = [...opts].sort((a, b) => (s.counts?.[b.id] || 0) - (s.counts?.[a.id] || 0)).slice(0, 3);
    return `<small class="pa-total">${s.total === 1 ? 'הצבעה אחת' : `${n2(s.total)} הצביעו`}</small>${top.map((o) => { const pct = sum ? Math.round(((s.counts?.[o.id] || 0) / sum) * 100) : 0; return `<span class="pa-bar" style="--pct:${pct}%;--poll-h:${p.hue}"><i></i><em>${esc(o.label)}</em><b>${pct}%</b></span>`; }).join('')}`;
  }
  async function afterSite() {
    if (!B().cloud || !S.sb.user?.isAdmin || !polls().length) return;
    try {
      const r = await S.sb.polls.status(polls().map((p) => p.id));
      stats = r.polls || {}; statsError = '';
    } catch (err) { stats = null; statsError = err.status === 404 ? 'השרת עוד לא עודכן לגרסה עם סקרים — אפשר כבר ליצור סקרים, וההצבעה תיפתח כשהשרת יתעדכן.' : ''; }
    const card = document.getElementById('polls-card');
    if (card) card.outerHTML = siteCard();
  }

  /* ---------- בעורך התוכנית: הסקרים של התוכנית ---------- */
  function episodeCard(e) {
    const mine = polls().filter((p) => p.show.episodes.includes(e.id) || p.show.episodes.includes(e.slug));
    const all = polls().filter((p) => p.show.allEpisodes && !mine.includes(p));
    return `
<div class="card">
  <div class="section-title"><div><p class="kicker">סקר</p><h2>סקר לתוכנית</h2></div><button type="button" class="btn gold small" data-pa="new-ep" data-ep="${esc(e.id)}">+ סקר לתוכנית הזו</button></div>
  <div class="card-body">
    ${mine.length || all.length ? `<div class="pa-list compact">${[...mine, ...all].map((p) => `<div class="pa-row">${thumb(p)}<div class="pa-main"><b>${esc(p.question || p.title || 'סקר בלי שאלה')}</b><div class="pa-meta"><span class="pa-state ${state(p).cls}">${esc(state(p).text)}</span>${all.includes(p) ? '<span>מוצג בכל דפי התוכניות</span>' : ''}</div></div><div class="pa-ops"><button type="button" class="btn small" data-pa="edit" data-id="${esc(p.id)}">עריכה</button></div></div>`).join('')}</div>`
      : '<p class="help" style="margin:0">לתוכנית הזו אין סקר. סקר מופיע בדף התוכנית באופן בולט, מיד מתחת לפתיחה — למשל "איזה שיר הכי אהבתם בתוכנית?".</p>'}
  </div>
</div>`;
  }

  /* ---------- תבניות להתחלה מהירה ---------- */
  const opt = (label, sub = '') => ({ id: newId(8), label, sub, image: '' });
  const TEMPLATES = {
    song: { title: 'השיר של השבוע', question: 'איזה שיר הכי אהבתם בתוכנית?', layout: 'list', optionShape: 'rounded', options: [opt('', 'הזמר'), opt('', 'הזמר'), opt('', 'הזמר')] },
    artist: { title: 'מצעד', question: 'מי הזמר שלכם?', layout: 'grid', optionShape: 'circle', optionSize: 'l', options: [opt(''), opt(''), opt(''), opt('')] },
    yesno: { title: 'מה דעתכם?', question: '', layout: 'list', optionShape: 'circle', options: [opt('כן'), opt('לא'), opt('עוד לא החלטתי')] },
    rate: { title: 'דרגו', question: 'כמה נהניתם מהתוכנית?', layout: 'grid', optionSize: 's', optionShape: 'circle', options: ['😍 מאוד', '🙂 נהניתי', '😐 בסדר', '🙁 פחות'].map((l) => opt(l)) },
  };
  function blank(preset = {}) {
    return S.admin.normPoll({
      id: newId(12), enabled: true, title: '', question: '', description: '', image: '', imageShape: 'wide', hue: 42,
      layout: 'list', optionShape: 'circle', optionSize: 'm', multi: false, maxChoices: 2, allowChange: true, results: 'after',
      from: '', until: '', thanks: '', buttonLabel: '', show: { home: false, archive: false, me: false, allEpisodes: false, episodes: [] },
      options: [opt(''), opt('')], createdAt: new Date().toISOString(), ...preset,
    });
  }

  /* ---------- חלון היצירה והעריכה ---------- */
  let E = null;   // { draft, isNew, dirty, mode: 'vote'|'results', device: 'desk'|'phone', target, epQuery }

  function open(poll, preset) {
    const isNew = !poll;
    const draft = clone(poll || blank(preset));
    // תשובות ריקות בעריכה — תמיד לפחות שתיים לכתוב בהן
    while (draft.options.length < 2) draft.options.push(opt(''));
    E = { draft, isNew, dirty: false, mode: 'vote', device: 'desk', target: null, epQuery: '' };
    document.getElementById('dlg-poll')?.remove();
    const d = document.createElement('dialog');
    d.id = 'dlg-poll';
    d.className = 'sheet poll-editor';
    d.setAttribute('aria-labelledby', 'pe-title');
    d.innerHTML = frame();
    document.body.appendChild(d);
    wire(d);
    paintAll();
    d.showModal();
    d.querySelector('[data-pe="question"]')?.focus();
  }

  function frame() {
    return `
<div class="section-title pe-head">
  <div><p class="kicker">${E.isNew ? 'סקר חדש' : 'עריכת סקר'}</p><h2 id="pe-title">${esc(E.draft.question || E.draft.title || 'סקר חדש')}</h2></div>
  <button type="button" class="icon-btn" data-pe-op="close" aria-label="סגירה">✕</button>
</div>
<nav class="pe-steps" aria-label="חלקי הסקר">
  ${[['q', 'השאלה'], ['o', 'התשובות'], ['d', 'עיצוב'], ['v', 'ההצבעה'], ['w', 'איפה ומתי']].map(([k, t], i) => `<button type="button" data-pe-jump="${k}"><i>${i + 1}</i>${t}</button>`).join('')}
</nav>
<div class="pe-body">
  <div class="pe-form" id="pe-form"></div>
  <aside class="pe-preview" aria-label="תצוגה מקדימה">
    <div class="pe-prev-bar">
      <div class="segmented" role="group" aria-label="מה להראות"><button type="button" data-pe-mode="vote">לפני ההצבעה</button><button type="button" data-pe-mode="results">עם תוצאות</button></div>
      <div class="segmented" role="group" aria-label="גודל מסך"><button type="button" data-pe-device="desk">מחשב</button><button type="button" data-pe-device="phone">טלפון</button></div>
    </div>
    <div class="pe-prev-frame" id="pe-frame"><div class="polls-zone" id="pe-prev"></div></div>
    <p class="help pe-prev-note">כך הסקר ייראה באתר. אפשר ללחוץ על התשובות כדי לנסות. במצב "עם תוצאות" המספרים לדוגמה.</p>
  </aside>
</div>
<div class="card-foot pe-foot">
  <span class="pe-issues" id="pe-issues" aria-live="polite"></span>
  ${E.isNew ? '' : '<button type="button" class="btn ghost danger-text" data-pe-op="delete">מחיקה</button><button type="button" class="btn ghost" data-pe-op="duplicate">שכפול</button>'}
  <button type="button" class="btn" data-pe-op="close">ביטול</button>
  <button type="button" class="btn primary" data-pe-op="save">${E.isNew ? 'יצירת הסקר' : 'שמירה'} <span>←</span></button>
</div>
<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden data-pe-file>`;
  }

  const seg = (field, value, list) => `<div class="segmented pe-seg" role="group">${list.map(([v, t]) => `<button type="button" data-pe-set="${field}" data-v="${v}" aria-pressed="${value === v}">${t}</button>`).join('')}</div>`;
  const ICON = {
    list: '<svg viewBox="0 0 48 36"><rect x="4" y="4" width="40" height="8" rx="3"/><rect x="4" y="14" width="40" height="8" rx="3"/><rect x="4" y="24" width="40" height="8" rx="3"/></svg>',
    grid: '<svg viewBox="0 0 48 36"><rect x="4" y="4" width="12" height="12" rx="6"/><rect x="18" y="4" width="12" height="12" rx="6"/><rect x="32" y="4" width="12" height="12" rx="6"/><rect x="4" y="20" width="12" height="12" rx="6"/><rect x="18" y="20" width="12" height="12" rx="6"/><rect x="32" y="20" width="12" height="12" rx="6"/></svg>',
    cards: '<svg viewBox="0 0 48 36"><rect x="4" y="4" width="18" height="28" rx="4"/><rect x="26" y="4" width="18" height="28" rx="4"/></svg>',
    circle: '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="13"/></svg>',
    square: '<svg viewBox="0 0 36 36"><rect x="5" y="5" width="26" height="26" rx="2"/></svg>',
    rounded: '<svg viewBox="0 0 36 36"><rect x="5" y="5" width="26" height="26" rx="8"/></svg>',
    single: '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="12" fill="none" stroke-width="3"/><circle cx="18" cy="18" r="6"/></svg>',
    multi: '<svg viewBox="0 0 36 36"><rect x="6" y="6" width="24" height="24" rx="6" fill="none" stroke-width="3"/><path d="M11 18l5 5 9-10" fill="none" stroke-width="3.5"/></svg>',
  };
  ICON.false = ICON.single; ICON.true = ICON.multi;   // "כמה אפשר לבחור": multi=false/true
  const tiles = (field, value, list) => `<div class="pe-tiles" role="group">${list.map(([v, t, sub]) => `<button type="button" class="pe-tile" data-pe-set="${field}" data-v="${v}" aria-pressed="${String(value) === v}">${ICON[v] || ''}<b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div>`;

  function form() {
    const p = E.draft;
    const eps = [...B().data.episodes].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || 0) - (a.number || 0));
    return `
${E.isNew && !p.question && filled(p).length === 0 ? `<section class="pe-sec pe-templates"><h3>להתחיל מתבנית?</h3><div class="pe-chips">${[['song', '🎵 השיר של השבוע'], ['artist', '🎤 מי הזמר שלכם'], ['yesno', '👍 כן / לא'], ['rate', '⭐ דירוג התוכנית']].map(([k, t]) => `<button type="button" class="chip" data-pe-template="${k}">${t}</button>`).join('')}</div></section>` : ''}

<section class="pe-sec" data-pe-sec="q">
  <h3><i>1</i>השאלה</h3>
  <div class="form-grid">
    <label class="field span2"><span>השאלה</span><input data-pe="question" value="${esc(p.question)}" maxlength="300" placeholder="למשל: איזה שיר הכי אהבתם בתוכנית?"></label>
    <label class="field"><span>כותרת קטנה מעל (לא חובה)</span><input data-pe="title" value="${esc(p.title)}" maxlength="120" placeholder="למשל: השיר של השבוע"></label>
    <label class="field"><span>טקסט הכפתור</span><input data-pe="buttonLabel" value="${esc(p.buttonLabel)}" maxlength="40" placeholder="הצבעה"></label>
    <label class="field span2"><span>הסבר (לא חובה)</span><textarea data-pe="description" maxlength="1000" placeholder="למשל: התוצאות יוקראו בתוכנית הבאה.">${esc(p.description)}</textarea></label>
  </div>
  <div class="pe-image">
    <div class="pe-drop${p.image ? ' has' : ''}" data-pe-drop="poll" tabindex="0" role="button" aria-label="תמונה לסקר — לחיצה לבחירה או גרירה">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span>🖼️</span><b>תמונה לסקר</b><small>לחצו או גררו לכאן (JPG, PNG, WEBP)</small>'}
      <em class="pe-progress" hidden></em>
    </div>
    <div class="pe-image-side">
      <div class="field"><span>צורת התמונה</span>${seg('imageShape', p.imageShape, [['wide', 'רחבה, מעל'], ['square', 'ריבוע ליד השאלה'], ['circle', 'עיגול ליד השאלה']])}</div>
      <label class="field"><span>או קישור לתמונה</span><input data-pe="image" value="${esc(p.image)}" class="ltr" placeholder="https://…" spellcheck="false"></label>
      ${p.image ? '<button type="button" class="btn small" data-pe-op="image-clear">הסרת התמונה</button>' : ''}
    </div>
  </div>
</section>

<section class="pe-sec" data-pe-sec="o">
  <h3><i>2</i>התשובות <small>${filled(p).length} מתוך ${40}</small></h3>
  <p class="help">לכל תשובה אפשר להוסיף שורה שנייה (למשל שם הזמר) ותמונה (למשל תמונת אמן או עטיפת אלבום). גוררים את ⋮⋮ כדי לשנות את הסדר.</p>
  <div class="pe-opts" id="pe-opts">${p.options.map(optRow).join('')}</div>
  <div class="pe-opt-tools">
    <button type="button" class="btn gold small" data-pe-op="opt-add">+ תשובה</button>
    ${guestsFor(p).length ? `<button type="button" class="btn small" data-pe-op="opt-guests">+ מהאורחים של התוכנית (${guestsFor(p).length})</button>` : ''}
    <details class="pe-bulk"><summary>הוספת הרבה תשובות בבת אחת</summary>
      <textarea data-pe-bulk placeholder="שורה לכל תשובה. שורה שנייה אחרי מקף:&#10;אנא בכח — מוטי שטיינמץ&#10;ימים — ישי ריבו"></textarea>
      <button type="button" class="btn small" data-pe-op="bulk-add">הוספה</button>
    </details>
  </div>
</section>

<section class="pe-sec" data-pe-sec="d">
  <h3><i>3</i>עיצוב</h3>
  <div class="field"><span>איך התשובות מסודרות</span>${tiles('layout', p.layout, [['list', 'רשימה', 'שורה לכל תשובה'], ['grid', 'רשת', 'תמונות קטנות בשורות'], ['cards', 'כרטיסים', 'תמונות גדולות']])}</div>
  <div class="pe-two">
    <div class="field"><span>צורת התמונות של התשובות</span>${tiles('optionShape', p.optionShape, [['circle', 'עיגול'], ['rounded', 'ריבוע מעוגל'], ['square', 'ריבוע']])}</div>
    <div class="field"><span>גודל</span>${seg('optionSize', p.optionSize, [['s', 'קטן'], ['m', 'בינוני'], ['l', 'גדול']])}</div>
  </div>
  <div class="field"><span>צבע</span>
    <div class="pe-hues">${HUES.map((h) => `<button type="button" class="pe-hue" data-pe-set="hue" data-v="${h}" style="--h:${h}" aria-pressed="${p.hue === h}" aria-label="גוון ${h}"></button>`).join('')}<input type="range" min="0" max="359" data-pe="hue" value="${p.hue}" aria-label="גוון מדויק" style="--h:${p.hue}"></div>
  </div>
</section>

<section class="pe-sec" data-pe-sec="v">
  <h3><i>4</i>ההצבעה</h3>
  <div class="field"><span>כמה אפשר לבחור</span>${tiles('multi', String(p.multi), [['false', 'תשובה אחת', 'הכי ברור'], ['true', 'כמה תשובות', 'עד מספר שתבחרו']])}</div>
  ${p.multi ? `<label class="field pe-max"><span>עד כמה בחירות</span><input type="number" min="1" max="${Math.max(1, filled(p).length)}" data-pe="maxChoices" value="${p.maxChoices}" class="ltr center"></label>` : ''}
  <div class="field"><span>מתי המאזינים רואים את התוצאות</span>
    <div class="pe-radios">${[['after', 'אחרי שהצביעו', 'מי שהצביע רואה מיד איך כולם הצביעו.'], ['always', 'תמיד', 'כולם רואים את התוצאות, גם לפני שהצביעו.'], ['closed', 'רק כשההצבעה נסגרת', 'מתח עד הסוף — מתאים להכרזה בתוכנית.'], ['admin', 'רק אתם', 'המאזינים לא רואים תוצאות; אתם רואים כאן בניהול.']].map(([v, t, sub]) => `<label class="pe-radio${p.results === v ? ' on' : ''}"><input type="radio" name="pe-results" data-pe="results" value="${v}" ${p.results === v ? 'checked' : ''}><b>${t}</b><small>${sub}</small></label>`).join('')}</div>
  </div>
  <div class="switches"><button type="button" class="toggle${p.allowChange ? ' on' : ''}" data-pe-toggle="allowChange" aria-pressed="${p.allowChange}">${p.allowChange ? '✓ אפשר לשנות הצבעה' : 'הצבעה סופית — בלי שינוי'}</button></div>
  <div class="form-grid">
    <label class="field span2"><span>הודעה אחרי ההצבעה</span><input data-pe="thanks" value="${esc(p.thanks)}" maxlength="200" placeholder="ההצבעה שלכם נקלטה. תודה!"></label>
  </div>
</section>

<section class="pe-sec" data-pe-sec="w">
  <h3><i>5</i>איפה ומתי</h3>
  <div class="switches"><button type="button" class="toggle big${p.enabled ? ' on' : ''}" data-pe-toggle="enabled" aria-pressed="${p.enabled}">${p.enabled ? '✓ פעיל — יוצג באתר אחרי הפרסום' : 'כבוי — שמור רק כאן'}</button></div>
  <div class="field"><span>איפה להציג</span>
    <div class="pe-places">
      ${[['home', '🏠 דף הבית'], ['archive', '🗂️ הארכיון'], ['me', '👤 האזור האישי'], ['allEpisodes', '🎙️ בכל דפי התוכניות']].map(([k, t]) => `<label class="check pe-place"><input type="checkbox" data-pe="show.${k}" ${p.show[k] ? 'checked' : ''}> ${t}</label>`).join('')}
    </div>
  </div>
  ${p.show.allEpisodes ? '' : `<div class="field"><span>בדף של תוכניות מסוימות <small>(${p.show.episodes.length} נבחרו)</small></span>
    <input type="search" class="input" data-pe-epq placeholder="חיפוש תוכנית…" value="${esc(E.epQuery)}">
    <div class="pe-eps" id="pe-eps">${epList(eps)}</div>
  </div>`}
  <div class="form-grid">
    <label class="field"><span>נפתח ב־ (לא חובה)</span><input type="datetime-local" data-pe="from" value="${esc(p.from)}"><small>ריק — מיד אחרי הפרסום. עד אז הסקר לא מוצג.</small></label>
    <label class="field"><span>נסגר ב־ (לא חובה)</span><input type="datetime-local" data-pe="until" value="${esc(p.until)}"><small>אחרי זה אי אפשר להצביע, והתוצאות נשארות (לפי ההגדרה למעלה).</small></label>
  </div>
  <div class="pe-chips">${[['1', 'נסגר בעוד יום'], ['3', 'בעוד 3 ימים'], ['7', 'בעוד שבוע'], ['14', 'בעוד שבועיים'], ['', 'בלי מועד סיום']].map(([d, t]) => `<button type="button" class="chip" data-pe-until="${d}">${t}</button>`).join('')}</div>
</section>`;
  }

  function optRow(o, i) {
    return `
<div class="pe-opt" data-i="${i}" draggable="true">
  <span class="pe-grip" title="גררו לשינוי הסדר" aria-hidden="true">⋮⋮</span>
  <button type="button" class="pe-opt-img${o.image ? ' has' : ''}" data-pe-op="opt-img" data-i="${i}" data-pe-drop="opt" aria-label="${o.image ? 'החלפת התמונה של התשובה' : 'הוספת תמונה לתשובה'}">${o.image ? `<img src="${esc(o.image)}" alt="">` : '<span>+</span><small>תמונה</small>'}<em class="pe-progress" hidden></em></button>
  <div class="pe-opt-text">
    <input data-po="label" data-i="${i}" value="${esc(o.label)}" maxlength="120" placeholder="תשובה ${i + 1}" aria-label="תשובה ${i + 1}">
    <input data-po="sub" data-i="${i}" value="${esc(o.sub)}" maxlength="120" placeholder="שורה שנייה (לא חובה) — למשל הזמר" aria-label="שורה שנייה לתשובה ${i + 1}">
  </div>
  <div class="pe-opt-ops">
    <button type="button" class="icon-btn" data-pe-op="opt-up" data-i="${i}" aria-label="למעלה" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" class="icon-btn" data-pe-op="opt-down" data-i="${i}" aria-label="למטה" ${i === E.draft.options.length - 1 ? 'disabled' : ''}>↓</button>
    ${o.image ? `<button type="button" class="icon-btn" data-pe-op="opt-img-clear" data-i="${i}" aria-label="הסרת התמונה" title="הסרת התמונה">🖼️✕</button>` : ''}
    <button type="button" class="icon-btn del" data-pe-op="opt-del" data-i="${i}" aria-label="מחיקת התשובה">✕</button>
  </div>
</div>`;
  }

  function epList(eps) {
    const q = E.epQuery.trim();
    const sel = new Set(E.draft.show.episodes);
    const chosen = eps.filter((e) => sel.has(e.id));
    const rest = eps.filter((e) => !sel.has(e.id));
    const found = q ? S.searchEpisodes(q, rest) : rest;
    const list = [...chosen, ...found.slice(0, q ? 40 : 12)];
    if (!list.length) return '<p class="cue-hint">לא נמצאו תוכניות.</p>';
    return list.map((e) => `<label class="pe-ep${sel.has(e.id) ? ' on' : ''}"><input type="checkbox" data-pe-ep="${esc(e.id)}" ${sel.has(e.id) ? 'checked' : ''}><b>${esc(e.title || 'תוכנית בלי שם')}</b><small>${[e.number != null ? `תוכנית ${e.number}` : '', e.date ? U.fmtDate(e.date) : ''].filter(Boolean).join(' · ')}</small></label>`).join('')
      + (!q && rest.length > 12 ? `<p class="cue-hint">ועוד ${rest.length - 12} — חפשו כדי למצוא.</p>` : '');
  }
  function guestsFor(p) {
    const ids = new Set(p.show.episodes);
    const have = new Set(p.options.map((o) => o.label.trim()));
    return [...new Set(B().data.episodes.filter((e) => ids.has(e.id)).flatMap((e) => e.guests))].filter((g) => !have.has(g));
  }

  /* ---------- ציור ---------- */
  const $ = (sel) => document.getElementById('dlg-poll')?.querySelector(sel);
  function paintAll() { $('#pe-form').innerHTML = form(); paintPreview(); paintHead(); }
  let prevTimer = 0;
  function paintPreview(now = false) {
    clearTimeout(prevTimer);
    const run = () => {
      const el = $('#pe-prev'); if (!el) return;
      const shown = P().preview(el, E.draft, { results: E.mode === 'results', voted: E.mode === 'results' });
      if (!shown) el.innerHTML = '<div class="state"><span class="mark">?</span><p>כתבו שתי תשובות לפחות, והסקר יופיע כאן.</p></div>', el.hidden = false;
      $('#pe-frame').classList.toggle('phone', E.device === 'phone');
      document.querySelectorAll('#dlg-poll [data-pe-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.peMode === E.mode)));
      document.querySelectorAll('#dlg-poll [data-pe-device]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.peDevice === E.device)));
    };
    if (now) run(); else prevTimer = setTimeout(run, 90);
  }
  function paintHead() {
    const t = $('#pe-title'); if (t) t.textContent = E.draft.question || E.draft.title || 'סקר חדש';
    const issues = problems(E.draft);
    const where = places(E.draft);
    const el = $('#pe-issues');
    if (el) el.innerHTML = issues.length ? `⚠ ${esc(issues.join(' · '))}` : !E.draft.enabled ? 'הסקר כבוי — יישמר, אבל לא יוצג באתר.' : where.length ? `יוצג ב: ${esc(where.join(' · '))}` : '⚠ לא נבחר איפה להציג';
    el?.classList.toggle('bad', issues.length > 0 || (E.draft.enabled && !where.length));
  }
  function repaintOpts() { $('#pe-opts').innerHTML = E.draft.options.map(optRow).join(''); const h = $('[data-pe-sec="o"] h3 small'); if (h) h.textContent = `${filled(E.draft).length} מתוך 40`; }
  function change(full = false) { E.dirty = true; if (full) { const y = $('.pe-form')?.scrollTop; paintAll(); if (y != null) $('.pe-form').scrollTop = y; } else { paintPreview(); paintHead(); } }

  /* ---------- העלאת תמונות ---------- */
  async function upload(file, target) {
    if (!file) return;
    if (!B().cloud || typeof window.RoshUpload !== 'function') { U.notify('העלאת תמונות זמינה רק בניהול המחובר לשרת. אפשר להדביק קישור לתמונה.', 'error'); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) { U.notify('אפשר להעלות JPG, PNG או WEBP.', 'error'); return; }
    const box = target === 'poll' ? $('[data-pe-drop="poll"]') : $(`.pe-opt-img[data-i="${target}"]`);
    const bar = box?.querySelector('.pe-progress');
    if (bar) { bar.hidden = false; bar.textContent = '0%'; }
    box?.classList.add('busy');
    try {
      const url = await window.RoshUpload(file, `poll-${E.draft.id}`, 'cover', (pct) => { if (bar) bar.textContent = `${pct}%`; });
      if (target === 'poll') E.draft.image = url; else if (E.draft.options[target]) E.draft.options[target].image = url;
      change(target === 'poll');
      if (target !== 'poll') repaintOpts();
    } catch (err) { U.notify(`ההעלאה נכשלה: ${err.message}`, 'error'); }
    box?.classList.remove('busy');
    if (bar) bar.hidden = true;
  }

  /* ---------- אירועים בחלון ---------- */
  function set(path, value) {
    const keys = path.split('.');
    let o = E.draft;
    while (keys.length > 1) o = o[keys.shift()];
    o[keys[0]] = value;
  }
  function wire(d) {
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    d.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-pe]')) {
        const k = t.dataset.pe;
        let v = t.type === 'checkbox' ? t.checked : t.value;
        if (k === 'hue') { v = Number(v); t.style.setProperty('--h', v); d.querySelectorAll('.pe-hue').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v))); }
        if (k === 'maxChoices') v = Math.max(1, Math.min(filled(E.draft).length || 1, Number(v) || 1));
        if (k === 'from' || k === 'until') v = v ? v.slice(0, 16) : '';
        set(k, v);
        // שינוי שמשנה את הטופס עצמו (תיבות "איפה", סוג התוצאות) — מציירים את הטופס מחדש
        change(k === 'show.allEpisodes' || k === 'results');
        return;
      }
      if (t.matches('[data-po]')) { E.draft.options[Number(t.dataset.i)][t.dataset.po] = t.value; change(); return; }
      if (t.matches('[data-pe-epq]')) { E.epQuery = t.value; $('#pe-eps').innerHTML = epList([...B().data.episodes].sort((a, b) => (b.date || '').localeCompare(a.date || ''))); }
    });
    d.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-pe-ep]')) {
        const id = t.dataset.peEp, list = E.draft.show.episodes;
        if (t.checked && !list.includes(id)) list.push(id);
        if (!t.checked) E.draft.show.episodes = list.filter((x) => x !== id);
        change(true);
        return;
      }
      if (t.matches('[data-pe="image"]')) { change(true); return; }   // קישור שהודבק — אזור התמונה מתעדכן כשיוצאים מהשדה
      if (t.matches('[data-pe-file]')) { const f = t.files?.[0]; const target = E.target; t.value = ''; upload(f, target); }
    });
    d.addEventListener('click', (e) => {
      const t = e.target;
      const btn = t.closest('button, [data-pe-drop]');
      if (!btn || !d.contains(btn)) return;
      if (btn.dataset.peJump) { d.querySelector(`[data-pe-sec="${btn.dataset.peJump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (btn.dataset.peMode) { E.mode = btn.dataset.peMode; paintPreview(true); return; }
      if (btn.dataset.peDevice) { E.device = btn.dataset.peDevice; paintPreview(true); return; }
      if (btn.dataset.peTemplate) {
        const tpl = clone(TEMPLATES[btn.dataset.peTemplate]);
        tpl.options = tpl.options.map((o) => ({ ...o, id: newId(8) }));
        Object.assign(E.draft, tpl);
        change(true);
        $('[data-pe="question"]')?.focus();
        return;
      }
      if (btn.dataset.peSet) {
        const f = btn.dataset.peSet, raw = btn.dataset.v;
        const v = f === 'hue' ? Number(raw) : f === 'multi' ? raw === 'true' : raw;
        set(f, v);
        if (f === 'multi' && v) E.draft.maxChoices = Math.min(Math.max(2, E.draft.maxChoices || 2), Math.max(1, filled(E.draft).length));
        change(true);
        return;
      }
      if (btn.dataset.peToggle) { const k = btn.dataset.peToggle; E.draft[k] = !E.draft[k]; change(true); return; }
      if (btn.dataset.peUntil != null) {
        const days = Number(btn.dataset.peUntil);
        if (!btn.dataset.peUntil) E.draft.until = '';
        else {
          const base = E.draft.from && E.draft.from > nowIL() ? E.draft.from : nowIL();
          const at = new Date(Date.parse(`${base}:00Z`) + days * 86400000);
          E.draft.until = `${at.toISOString().slice(0, 10)}T${days ? '20:00' : base.slice(11, 16)}`;
        }
        change(true);
        return;
      }
      if (btn.dataset.peDrop === 'poll' && !t.closest('button')) { E.target = 'poll'; $('[data-pe-file]').click(); return; }
      const op = btn.dataset.peOp; if (!op) return;
      const i = Number(btn.dataset.i);
      const o = E.draft.options;
      switch (op) {
        case 'close': close(); break;
        case 'save': save(); break;
        case 'delete': remove(E.draft.id, true); break;
        case 'duplicate': { const copy = clone(E.draft); copy.id = newId(12); copy.enabled = false; copy.question = copy.question ? `${copy.question} (עותק)` : copy.question; copy.createdAt = new Date().toISOString(); E.isNew = true; E.draft = copy; E.dirty = true; document.getElementById('dlg-poll').innerHTML = frame(); paintAll(); U.notify('נוצר עותק (כבוי). שמרו כדי להוסיף אותו.', 'info'); break; }
        case 'image-clear': E.draft.image = ''; change(true); break;
        case 'opt-add': o.push(opt('')); change(); repaintOpts(); $(`[data-po="label"][data-i="${o.length - 1}"]`)?.focus(); break;
        case 'opt-del': if (o.length <= 2 && !o[i].label && !o[i].image) { U.notify('סקר צריך לפחות שתי תשובות.', 'info'); break; } o.splice(i, 1); while (o.length < 2) o.push(opt('')); change(); repaintOpts(); break;
        case 'opt-up': if (i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; change(); repaintOpts(); $(`[data-pe-op="opt-up"][data-i="${i - 1}"]`)?.focus(); } break;
        case 'opt-down': if (i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; change(); repaintOpts(); $(`[data-pe-op="opt-down"][data-i="${i + 1}"]`)?.focus(); } break;
        case 'opt-img': E.target = i; $('[data-pe-file]').click(); break;
        case 'opt-img-clear': o[i].image = ''; change(); repaintOpts(); break;
        case 'opt-guests': { const add = guestsFor(E.draft); const empty = o.filter((x) => !x.label.trim() && !x.image); E.draft.options = o.filter((x) => !empty.includes(x)).concat(add.map((g) => opt(g))); while (E.draft.options.length < 2) E.draft.options.push(opt('')); change(true); U.notify(`נוספו ${add.length} תשובות מהאורחים.`, 'success'); break; }
        case 'bulk-add': {
          const lines = String($('[data-pe-bulk]').value || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
          if (!lines.length) break;
          const add = lines.map((l) => { const [a, ...rest] = l.split(/\s+[—–-]\s+/); return opt(a.slice(0, 120), rest.join(' — ').slice(0, 120)); });
          E.draft.options = o.filter((x) => x.label.trim() || x.image).concat(add).slice(0, 40);
          while (E.draft.options.length < 2) E.draft.options.push(opt(''));
          change(true);
          U.notify(`נוספו ${add.length} תשובות.`, 'success');
          break;
        }
        default:
      }
    });
    d.addEventListener('keydown', (e) => {
      if (e.target.matches?.('[data-pe-drop="poll"]') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); E.target = 'poll'; $('[data-pe-file]').click(); }
    });
    // גרירת תמונה על אזור התמונה של הסקר או של תשובה
    d.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-pe-drop]'); if (z && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
    d.addEventListener('dragleave', (e) => { e.target.closest?.('[data-pe-drop]')?.classList.remove('over'); });
    d.addEventListener('drop', (e) => {
      const z = e.target.closest?.('[data-pe-drop]');
      if (!z || !e.dataTransfer?.files?.length) return;
      e.preventDefault(); z.classList.remove('over');
      upload(e.dataTransfer.files[0], z.dataset.peDrop === 'poll' ? 'poll' : Number(z.dataset.i));
    });
    // שינוי סדר התשובות בגרירה
    let dragFrom = -1;
    d.addEventListener('dragstart', (e) => { const r = e.target.closest?.('.pe-opt'); if (!r) return; dragFrom = Number(r.dataset.i); r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
    d.addEventListener('dragend', (e) => { e.target.closest?.('.pe-opt')?.classList.remove('dragging'); dragFrom = -1; });
    d.addEventListener('dragover', (e) => { const r = e.target.closest?.('.pe-opt'); if (r && dragFrom >= 0) { e.preventDefault(); } });
    d.addEventListener('drop', (e) => {
      const r = e.target.closest?.('.pe-opt');
      if (!r || dragFrom < 0 || e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const to = Number(r.dataset.i);
      if (to === dragFrom) return;
      const [m] = E.draft.options.splice(dragFrom, 1);
      E.draft.options.splice(to, 0, m);
      dragFrom = -1;
      change(); repaintOpts();
    });
  }

  function close() {
    if (E?.dirty && !confirm('יש שינויים שלא נשמרו. לסגור בלי לשמור?')) return;
    const d = document.getElementById('dlg-poll');
    d?.close(); d?.remove();
    E = null;
  }
  function save() {
    const p = E.draft;
    const issues = problems(p);
    if (p.enabled && issues.length && !confirm(`${issues.join(', ')}.\nהסקר יישמר, אבל לא יוצג באתר עד שזה יתוקן. לשמור?`)) return;
    p.options = p.options.filter((o) => o.label.trim() || o.image);
    const clean = S.admin.normPoll(p);
    const list = polls();
    const i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.unshift(clean);
    E.dirty = false;
    close();
    B().touch();
    B().render();
    U.notify(`הסקר נשמר בטיוטה. הוא ${clean.enabled ? 'יעלה לאתר' : 'יישמר (כבוי)'} בלחיצה על "פרסום לאתר".`, 'success');
  }
  function remove(id, fromEditor = false) {
    const p = polls().find((x) => x.id === id); if (!p) { if (fromEditor) { E.dirty = false; close(); } return; }
    if (!confirm(`למחוק את הסקר "${p.question || p.title || 'בלי שאלה'}"? ההצבעות שכבר נאספו יישארו בשרת, אבל הסקר ייעלם מהאתר בפרסום הבא.`)) return;
    B().data.settings.polls = polls().filter((x) => x.id !== id);
    if (fromEditor) { E.dirty = false; close(); }
    B().touch(); B().render();
    U.notify('הסקר נמחק מהטיוטה.', 'success');
  }

  /* ---------- כפתורי הרשימה ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-pa]'); if (!b || !document.getElementById('panel')?.contains(b)) return;
    const id = b.dataset.id;
    switch (b.dataset.pa) {
      case 'new': open(null); break;
      case 'new-ep': { const ep = B().data.episodes.find((x) => x.id === b.dataset.ep); open(null, { show: { home: false, archive: false, me: false, allEpisodes: false, episodes: [b.dataset.ep] }, title: ep?.title ? `סקר · ${ep.title}`.slice(0, 120) : '' }); break; }
      case 'edit': { const p = polls().find((x) => x.id === id); if (p) open(p); break; }
      case 'dup': { const p = polls().find((x) => x.id === id); if (!p) break; const copy = clone(p); copy.id = newId(12); copy.enabled = false; copy.createdAt = new Date().toISOString(); open(null, copy); E.isNew = true; break; }
      case 'del': remove(id); break;
      case 'reset': {
        const p = polls().find((x) => x.id === id);
        if (!p || !confirm(`לאפס את כל ההצבעות בסקר "${p.question || p.title}"? אי אפשר לבטל.`)) break;
        b.disabled = true;
        try { await S.sb.polls.reset(id); U.notify('ההצבעות אופסו.', 'success'); afterSite(); }
        catch (err) { U.notify(err.message, 'error'); b.disabled = false; }
        break;
      }
      default:
    }
  });

  window.RoshPollAdmin = { siteCard, afterSite, episodeCard, open };
})();
