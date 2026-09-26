/* סקרים: תצוגה, בחירה, הצבעה ותוצאות — אותו קוד באתר ובתצוגה המקדימה בניהול.
   ההגדרה של כל סקר מגיעה עם הקטלוג (settings.polls, נערכת בניהול ומתפרסמת כמו
   ההודעה בדף הבית); המצב — פתוח/סגור, מה בחרתי והתוצאות — מהשרת
   (/api/program/polls). הצבעה דורשת כניסה עם Google, מאזין אחד — הצבעה אחת.

   איפה סקר מוצג (show): דף הבית, הארכיון, האזור האישי, דפי תוכניות מסוימות,
   או כל דפי התוכניות. סקר בלי מקום, כבוי, או שעוד לא הגיע מועד הפתיחה שלו — לא מוצג.
   אם השרת עוד לא מכיר סקרים (404) — לא מציגים כלום, כדי שלא יופיע סקר שאי אפשר להצביע בו. */
(function () {
  'use strict';
  const U = window.RoshUI;
  const S = window.RoshStore;
  const { esc } = U;

  const now = () => S.nowIL();
  const started = (p, t = now()) => !p.from || p.from <= t;
  const isOpen = (p, t = now()) => !!p.enabled && started(p, t) && (!p.until || t < p.until);
  const isClosed = (p, t = now()) => !!p.enabled && !!p.until && t >= p.until;
  const options = (p) => p.options.filter((o) => o.label.trim());
  /** אפשר להציג: פעיל, יש שאלה ולפחות שתי אפשרויות */
  const valid = (p) => !!p?.enabled && options(p).length >= 2 && !!(p.question.trim() || p.title.trim());

  /** הסקרים למקום מסוים באתר. בדף תוכנית — הסקרים של התוכנית קודם, אחריהם "כל התוכניות". */
  function forPlace(place, ep = null) {
    const list = (S.settings.polls || []).filter((p) => valid(p) && started(p));
    if (place === 'episode') {
      if (!ep) return [];
      const own = list.filter((p) => p.show.episodes.includes(ep.id) || p.show.episodes.includes(ep.slug));
      return [...own, ...list.filter((p) => p.show.allEpisodes && !own.includes(p))];
    }
    return list.filter((p) => p.show[place]);
  }

  /* ---------- זמן ---------- */
  const ms = (wall) => Date.parse(`${wall}:00Z`);   // שני זמנים בשעון ישראל — ההפרש נכון
  function left(wall) {
    const d = ms(wall) - ms(now());
    if (!(d > 0)) return '';
    const min = Math.ceil(d / 60000), h = Math.floor(min / 60), days = Math.floor(h / 24);
    if (days >= 2) return `${days} ימים`;
    if (days === 1) return 'יום';
    if (h >= 2) return `${h} שעות`;
    if (h === 1) return 'שעה';
    return min <= 1 ? 'דקה' : `${min} דקות`;
  }
  const n2 = (n) => Number(n || 0).toLocaleString('he-IL');

  /* ---------- ציור ---------- */

  /** st — המצב מהשרת (או null בזמן טעינה); ui — מה המאזין עושה עכשיו בסקר */
  function render(p, st, ui, opts = {}) {
    const opts2 = options(p);
    const open = st ? st.open : isOpen(p);
    const closed = st ? st.closed : isClosed(p);
    const mine = st?.mine || [];
    const voted = mine.length > 0;
    const counts = st?.counts || null;
    const total = st?.total ?? null;
    const canVote = open && (!voted || (p.allowChange && ui.changing));
    const chosen = canVote ? ui.selected : new Set(mine);
    const max = p.multi ? p.maxChoices : 1;
    const top = counts ? Math.max(0, ...opts2.map((o) => counts[o.id] || 0)) : 0;
    const sum = counts ? opts2.reduce((a, o) => a + (counts[o.id] || 0), 0) : 0;
    const pct = (o) => (sum ? Math.round(((counts[o.id] || 0) / sum) * 100) : 0);
    const chip = !p.enabled ? '<span class="poll-chip">טיוטה</span>'
      : closed ? '<span class="poll-chip closed">ההצבעה נסגרה</span>'
      : !open ? `<span class="poll-chip">נפתח בעוד ${esc(left(p.from) || 'מעט')}</span>`
      : `<span class="poll-chip live"><i aria-hidden="true"></i>פתוח להצבעה${p.until && left(p.until) ? ` · עוד ${esc(left(p.until))}` : ''}</span>`;
    const img = (src, cls) => (src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async">` : '');
    const initial = (o) => esc([...o.label.trim()][0] || '?');
    const kicker = p.title && p.question ? esc(p.title) : 'סקר';
    const heading = esc(p.question || p.title);

    const optionHtml = (o, i) => {
      const on = chosen.has(o.id), isMine = mine.includes(o.id), win = counts && top > 0 && (counts[o.id] || 0) === top;
      const media = o.image ? `<span class="poll-img">${img(o.image, '')}</span>` : p.layout === 'list' ? '' : `<span class="poll-img empty" aria-hidden="true">${initial(o)}</span>`;
      const res = counts ? `<span class="poll-bar" style="--pct:${pct(o)}%" aria-hidden="true"></span><span class="poll-pct">${pct(o)}%</span>` : '';
      return `<button type="button" class="poll-opt${on ? ' on' : ''}${isMine ? ' mine' : ''}${win ? ' win' : ''}${counts ? ' has-res' : ''}" data-opt="${esc(o.id)}" ${p.multi ? `aria-pressed="${on}"` : `role="radio" aria-checked="${on}"`} ${canVote ? '' : 'aria-disabled="true"'} style="--i:${i}" aria-label="${esc(o.label)}${o.sub ? ` — ${esc(o.sub)}` : ''}${counts ? `, ${pct(o)}%` : ''}${isMine ? ', הבחירה שלכם' : ''}">
  ${res}${media}<span class="poll-txt"><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span><span class="poll-mark" aria-hidden="true"></span>
</button>`;
    };

    let foot = '';
    if (canVote) {
      const hint = p.multi ? `בחרו עד ${max}${ui.selected.size ? ` · נבחרו ${ui.selected.size}` : ''}` : 'בחרו תשובה אחת';
      foot = `<span class="poll-hint">${hint}</span>
<div class="poll-actions">${ui.changing ? '<button type="button" class="btn ghost small" data-poll-cancel>ביטול</button>' : ''}<button type="button" class="btn primary" data-poll-vote ${ui.selected.size && !ui.busy ? '' : 'disabled'}>${ui.busy ? 'שולחים…' : esc(p.buttonLabel || (ui.changing ? 'עדכון ההצבעה' : 'הצבעה'))} <span>←</span></button></div>`;
    } else if (voted) {
      const why = counts ? '' : p.results === 'admin' ? ' התוצאות נשמרות אצל המגישים.' : ' התוצאות יפורסמו כשההצבעה תיסגר.';
      foot = `<span class="poll-done">✓ ${esc(p.thanks || 'ההצבעה שלכם נקלטה. תודה!')}${why}</span>${open && p.allowChange ? '<button type="button" class="btn ghost small" data-poll-change>שינוי ההצבעה</button>' : ''}`;
    } else if (closed) {
      foot = `<span class="poll-hint">${counts ? 'אלה התוצאות הסופיות.' : 'ההצבעה נסגרה.'}</span>`;
    } else if (!open) {
      foot = `<span class="poll-hint">ההצבעה תיפתח בעוד ${esc(left(p.from) || 'מעט')}.</span>`;
    }
    const totalLine = total != null && (counts || voted) ? `<span class="poll-total">${total === 1 ? 'הצבעה אחת' : `${n2(total)} הצביעו`}</span>` : '';

    return `<article class="poll poll-${p.layout} shape-${p.optionShape} size-${p.optionSize}${opts.featured ? ' poll-featured' : ''}${counts ? ' show-res' : ''}${ui.justVoted ? ' just-voted' : ''}" data-poll="${esc(p.id)}" style="--poll-h:${Number(p.hue) || 0}" aria-labelledby="poll-q-${esc(p.id)}">
  ${p.image && p.imageShape === 'wide' ? `<div class="poll-banner">${img(p.image, '')}</div>` : ''}
  <header class="poll-head">
    ${p.image && p.imageShape !== 'wide' ? `<span class="poll-thumb ${p.imageShape}">${img(p.image, '')}</span>` : ''}
    <div class="poll-headtext">
      <div class="poll-meta"><span class="poll-kicker">${kicker}</span>${chip}</div>
      <h3 class="poll-q" id="poll-q-${esc(p.id)}">${heading}</h3>
      ${p.description ? `<p class="poll-desc">${esc(p.description)}</p>` : ''}
    </div>
  </header>
  <div class="poll-options" role="${p.multi ? 'group' : 'radiogroup'}" aria-labelledby="poll-q-${esc(p.id)}">${opts2.map(optionHtml).join('')}</div>
  <footer class="poll-foot">${foot}${totalLine}</footer>
  ${ui.login ? `<div class="poll-login"><p>כדי שכל מאזין יצביע פעם אחת, מתחברים עם Google — בלחיצה אחת. הבחירה שלכם נשמרת.</p><div class="google-slot" data-poll-google></div><a href="#" class="cue-hint" data-poll-site-login>בעיה עם הכפתור? כניסה דרך אתר הסקר</a></div>` : ''}
  ${ui.error ? `<p class="poll-error" role="alert">${esc(ui.error)}</p>` : ''}
</article>`;
  }

  /* ---------- סקר חי באתר ---------- */

  function controller(p, slot, opts) {
    const c = { p, slot, opts, st: null, ui: { selected: new Set(), changing: false, busy: false, login: false, error: '', justVoted: false } };
    c.paint = () => {
      const focus = document.activeElement && slot.contains(document.activeElement) ? document.activeElement.dataset.opt || (document.activeElement.hasAttribute('data-poll-vote') ? 'vote' : '') : '';
      slot.innerHTML = render(p, c.st, c.ui, opts);
      if (focus) slot.querySelector(focus === 'vote' ? '[data-poll-vote]' : `[data-opt="${CSS.escape(focus)}"]`)?.focus();
      if (c.ui.login) mountLogin();
    };
    const mountLogin = () => {
      const g = slot.querySelector('[data-poll-google]'); if (!g || g.dataset.on) return;
      g.dataset.on = '1';
      S.sb.google(g, { onDone: () => { c.ui.login = false; c.vote(); }, onError: (err) => U.notify(`ההתחברות לא הצליחה: ${err.message}`, 'error') })
        .catch((err) => { g.innerHTML = `<span class="cue-hint">${esc(err.message)}</span>`; });
    };
    c.pick = (id) => {
      const open = c.st ? c.st.open : isOpen(p);
      const mine = c.st?.mine || [];
      if (!open || (mine.length && !c.ui.changing)) return;
      const sel = c.ui.selected;
      if (!p.multi) { sel.clear(); sel.add(id); }
      else if (sel.has(id)) sel.delete(id);
      else if (sel.size >= p.maxChoices) { U.notify(`אפשר לבחור עד ${p.maxChoices}. בטלו בחירה אחרת קודם.`, 'info'); return; }
      else sel.add(id);
      c.ui.error = '';
      c.paint();
    };
    c.vote = async () => {
      if (!c.ui.selected.size || c.ui.busy) return;
      if (opts.preview) { U.notify('זו תצוגה מקדימה — באתר ההצבעה תישמר.', 'info'); return; }
      if (!S.sb.user) { c.ui.login = true; c.paint(); return; }
      c.ui.busy = true; c.ui.error = ''; c.paint();
      try {
        const r = await S.sb.polls.vote(p.id, [...c.ui.selected]);
        c.st = r.poll; c.ui.changing = false; c.ui.justVoted = true;
        U.notify('ההצבעה נקלטה. תודה!', 'success');
      } catch (err) {
        if (err.status === 401) { S.forgetSession?.(); c.ui.login = true; }
        else c.ui.error = err.message;
        if (err.status === 409) c.load();
      }
      c.ui.busy = false;
      c.paint();
      setTimeout(() => { c.ui.justVoted = false; slot.querySelector('.poll')?.classList.remove('just-voted'); }, 1600);
    };
    c.load = async () => {
      if (opts.preview) return;
      try {
        const r = await S.sb.polls.status([p.id]);
        c.st = r.polls?.[p.id] || null;
        if (!c.st) { slot.hidden = true; return; }
        slot.hidden = false;
        if (c.st.mine?.length && !c.ui.selected.size) c.ui.selected = new Set(c.st.mine);
      } catch (err) {
        // השרת עוד לא מכיר סקרים — לא מציגים סקר שאי אפשר להצביע בו
        if (err.status === 404) { slot.hidden = true; return; }
      }
      c.paint();
    };
    return c;
  }

  /** מציג את הסקרים בתוך container; מחזיר כמה הוצגו */
  function mount(container, polls, opts = {}) {
    if (!container) return 0;
    if (!polls.length || (!S.sb?.configured && !opts.preview)) { container.innerHTML = ''; container.hidden = true; return 0; }
    container.hidden = false;
    container.innerHTML = polls.map((p) => `<div class="poll-slot" data-slot="${esc(p.id)}"></div>`).join('');
    const ctrls = new Map();
    for (const p of polls) {
      const c = controller(p, container.querySelector(`[data-slot="${CSS.escape(p.id)}"]`), opts);
      if (opts.state?.[p.id]) c.st = opts.state[p.id];
      ctrls.set(p.id, c);
      c.paint();
      c.load();
    }
    container.onclick = (e) => {
      const el = e.target.closest('[data-poll]'); if (!el) return;
      const c = ctrls.get(el.dataset.poll); if (!c) return;
      const opt = e.target.closest('[data-opt]');
      if (opt) { c.pick(opt.dataset.opt); return; }
      if (e.target.closest('[data-poll-vote]')) { c.vote(); return; }
      if (e.target.closest('[data-poll-change]')) { c.ui.changing = true; c.ui.selected = new Set(c.st?.mine || []); c.paint(); container.querySelector(`[data-poll="${CSS.escape(c.p.id)}"] [data-opt]`)?.focus(); return; }
      if (e.target.closest('[data-poll-cancel]')) { c.ui.changing = false; c.ui.selected = new Set(c.st?.mine || []); c.paint(); return; }
      if (e.target.closest('[data-poll-site-login]')) { e.preventDefault(); S.sb.signIn().then(() => { c.ui.login = false; c.vote(); }).catch((err) => U.notify(err.message, 'error')); }
    };
    // מקלדת: חצים בין האפשרויות (כמו קבוצת כפתורי רדיו)
    container.onkeydown = (e) => {
      const opt = e.target.closest?.('[data-opt]'); if (!opt || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const all = [...opt.parentElement.querySelectorAll('[data-opt]')];
      const step = e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? 1 : -1;   // מימין לשמאל: שמאלה = הבא
      const next = all[(all.indexOf(opt) + step + all.length) % all.length];
      e.preventDefault(); next.focus();
    };
    // נכנסו או יצאו מהחשבון — מה שבחרתי והתוצאות משתנים
    if (!opts.preview) {
      const off = S.onSession(() => { if (!container.isConnected) { off(); return; } ctrls.forEach((c) => { c.ui.login = false; c.load(); }); });
    }
    if (opts.preview) container.__polls = ctrls;
    return polls.length;
  }

  /** תצוגה מקדימה בניהול: בלי שרת; results — להראות תוצאות לדוגמה */
  function preview(container, poll, { results = false, voted = false } = {}) {
    const p = S.admin?.normPoll ? S.admin.normPoll(poll) : poll;
    const opts2 = options(p);
    const sample = {};
    opts2.forEach((o, i) => { sample[o.id] = Math.max(1, Math.round(40 / (i + 1.3))); });
    const state = { [p.id]: { open: isOpen({ ...p, enabled: true }), closed: isClosed({ ...p, enabled: true }), mine: voted && opts2[0] ? [opts2[0].id] : [], total: results ? Object.values(sample).reduce((a, b) => a + b, 0) : null, counts: results ? sample : null } };
    return mount(container, opts2.length ? [{ ...p, enabled: true, options: p.options }] : [], { preview: true, featured: true, state });
  }

  window.RoshPolls = { forPlace, mount, preview, render, valid, isOpen, isClosed, left };
})();
