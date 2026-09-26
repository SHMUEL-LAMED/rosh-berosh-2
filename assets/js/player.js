/* הנגן הקבוע של ראש בראש: נגן אחד לכל האתר, פס התקדמות,
   המשך מאיפה שעצרתם, מהירות, קיצורי מקלדת ו־Media Session. */
(function () {
  'use strict';
  const { esc, fmtTime } = window.RoshUI;
  const S = window.RoshStore;

  /** המהירויות האפשריות — אותה רשימה בנגן, בקיצורי המקלדת ובאזור האישי */
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const audio = new Audio();
  audio.preload = 'metadata';

  const P = {
    episode: null,
    dock: null,
    els: {},
    candidates: null,   // כתובות ההזרמה של התוכנית הנוכחית, לפי עדיפות
    candidateIndex: 0,
    wantPlay: false,
    lastSaved: 0,
    dragging: false,
  };

  /** אייקוני הנגן (SVG קטנים, בצבע הטקסט) */
  const svg = (d, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"${fill ? ' class="fill"' : ''}><path d="${d}"/></svg>`;
  const ICONS = {
    prev: svg('M6 5.5v13M18.5 5.5 9 12l9.5 6.5z', true),
    next: svg('M18 5.5v13M5.5 5.5 15 12l-9.5 6.5z', true),
    play: svg('M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8a1 1 0 0 0 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z', true).replace('<svg', '<svg data-i="play"'),
    pause: svg('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', true).replace('<svg', '<svg data-i="pause"'),
    heart: svg('M12 20s-7.2-4.4-8.8-9C2 7.6 4.2 4.8 7.3 4.8c1.9 0 3.5 1 4.7 2.7 1.2-1.7 2.8-2.7 4.7-2.7 3.1 0 5.3 2.8 4.1 6.2C19.2 15.6 12 20 12 20z'),
    share: svg('M12 3.5v11M7.8 7.7 12 3.5l4.2 4.2M5.5 12.5V18a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5.5'),
    download: svg('M12 3.5v11M7.8 10.3 12 14.5l4.2-4.2M5.5 19.5h13'),
    close: svg('M6.5 6.5l11 11M17.5 6.5l-11 11'),
    vol: svg('M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11').replace('<svg', '<svg data-i="vol"'),
    volLow: svg('M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4.2 4.2 0 0 1 0 6').replace('<svg', '<svg data-i="low"'),
    mute: svg('M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9.5l5 5M20.5 9.5l-5 5').replace('<svg', '<svg data-i="mute"'),
  };

  /** בחלק מהמכשירים (אייפון ואייפד) האתר לא יכול לשנות את עוצמת הקול — רק כפתורי המכשיר. שם יש רק השתקה. */
  const VOLUME_WORKS = (() => { try { const a = new Audio(); a.volume = 0.5; return Math.abs(a.volume - 0.5) < 0.01; } catch { return false; } })();

  const emit = (type, detail = {}) => window.dispatchEvent(new CustomEvent('rosh:player', { detail: { type, episode: P.episode, time: audio.currentTime, ...detail } }));

  /* ---------- בניית הנגן ---------- */

  function build() {
    if (P.dock) return;
    const d = document.createElement('div');
    d.className = 'dock';
    d.id = 'dock';
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'נגן התוכנית');
    d.innerHTML = `
<div class="dock-inner">
  <div class="dock-now">
    <div class="dock-art" data-art aria-hidden="true"><i></i></div>
    <div class="dock-text">
      <a data-link href="#"><b data-title>—</b></a>
      <small class="now"><span class="dock-live" aria-hidden="true"><i style="--d:0s"></i><i style="--d:.2s"></i><i style="--d:.1s"></i><i style="--d:.3s"></i></span><span data-now aria-live="polite"></span></small>
    </div>
  </div>
  <div class="dock-center">
    <div class="dock-controls">
      <select class="dock-speed" data-speed aria-label="מהירות ניגון" title="מהירות ניגון">
        ${RATES.map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')}
      </select>
      <button type="button" class="dock-btn" data-prev aria-label="לתוכנית הקודמת" title="לתוכנית הקודמת">${ICONS.prev}</button>
      <button type="button" class="dock-btn dock-skip" data-back aria-label="15 שניות אחורה" title="15 שניות אחורה">−15</button>
      <button type="button" class="dock-play" data-toggle data-state="paused" aria-label="ניגון">${ICONS.play}${ICONS.pause}</button>
      <button type="button" class="dock-btn dock-skip" data-fwd aria-label="15 שניות קדימה" title="15 שניות קדימה">+15</button>
      <button type="button" class="dock-btn" data-next aria-label="לתוכנית הבאה" title="לתוכנית הבאה">${ICONS.next}</button>
      <button type="button" class="dock-btn moment-btn" data-moment aria-pressed="false" aria-label="סימון הרגע הזה" title="סימון הרגע הזה ברשימת הרגעים שאהבתם">${ICONS.heart}</button>
    </div>
    <div class="dock-bar">
      <time data-cur>0:00</time>
      <div class="scrub" data-scrub role="slider" tabindex="0" aria-label="מיקום בתוכנית" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">
        <div class="segs" data-segs></div>
        <div class="markers" data-markers aria-hidden="true"></div>
        <div class="knob" data-knob style="left:0"></div>
        <div class="tip" data-tip></div>
      </div>
      <time data-dur>0:00</time>
    </div>
  </div>
  <div class="dock-extra">
    <div class="dock-vol${VOLUME_WORKS ? '' : ' no-range'}" data-vol-wrap>
      <button type="button" class="dock-btn" data-mute aria-label="עוצמת הקול" title="עוצמת הקול (M להשתקה)" aria-expanded="false">${ICONS.vol}${ICONS.volLow}${ICONS.mute}</button>
      ${VOLUME_WORKS ? `<div class="dock-vol-pop" data-vol-pop><input type="range" class="dock-vol-range" data-vol min="0" max="100" step="5" value="100" aria-label="עוצמת הקול" dir="ltr"><button type="button" class="dock-vol-mute" data-mute-only>השתקה</button></div>` : ''}
    </div>
    <button type="button" class="dock-btn" data-share aria-label="שיתוף הרגע הזה" title="שיתוף הרגע הזה">${ICONS.share}</button>
    <a class="dock-btn hide-sm" data-download href="#" download rel="noopener" aria-label="הורדת ההקלטה" title="הורדת ההקלטה">${ICONS.download}</a>
    <button type="button" class="dock-btn dock-close" data-close aria-label="סגירת הנגן" title="סגירת הנגן">${ICONS.close}</button>
  </div>
</div>`;
    document.body.appendChild(d);
    P.dock = d;
    const q = (s) => d.querySelector(s);
    P.els = {
      art: q('[data-art]'), link: q('[data-link]'), title: q('[data-title]'), now: q('[data-now]'),
      toggle: q('[data-toggle]'), cur: q('[data-cur]'), dur: q('[data-dur]'),
      scrub: q('[data-scrub]'), segs: q('[data-segs]'), markers: q('[data-markers]'), knob: q('[data-knob]'), tip: q('[data-tip]'),
      speed: q('[data-speed]'), download: q('[data-download]'),
      volWrap: q('[data-vol-wrap]'), mute: q('[data-mute]'), vol: q('[data-vol]'), muteOnly: q('[data-mute-only]'),
    };

    q('[data-toggle]').addEventListener('click', toggle);
    q('[data-back]').addEventListener('click', () => seek(audio.currentTime - 15));
    q('[data-fwd]').addEventListener('click', () => seek(audio.currentTime + 15));
    q('[data-prev]').addEventListener('click', prevEpisode);
    q('[data-next]').addEventListener('click', nextEpisode);
    q('[data-close]').addEventListener('click', close);
    q('[data-share]').addEventListener('click', shareMoment);
    q('[data-moment]').addEventListener('click', toggleMoment);
    P.els.speed.addEventListener('change', () => setRate(Number(P.els.speed.value)));

    // עוצמת הקול: במחשב — כפתור השתקה ופס ליד; בטלפון הכפתור פותח פס קטן מעל הנגן
    const phone = () => matchMedia('(max-width: 760px)').matches;
    const closeVol = () => { P.els.volWrap.classList.remove('open'); P.els.mute.setAttribute('aria-expanded', 'false'); };
    P.els.mute.addEventListener('click', () => {
      if (VOLUME_WORKS && phone()) {
        const open = P.els.volWrap.classList.toggle('open');
        P.els.mute.setAttribute('aria-expanded', String(open));
        if (open) P.els.vol.focus();
        return;
      }
      toggleMute();
    });
    P.els.muteOnly?.addEventListener('click', toggleMute);
    P.els.vol?.addEventListener('input', () => setVolume(Number(P.els.vol.value) / 100));
    P.els.vol?.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.stopPropagation(); if (e.key === 'Escape') { closeVol(); P.els.mute.focus(); } });
    document.addEventListener('pointerdown', (e) => { if (P.els.volWrap.classList.contains('open') && !P.els.volWrap.contains(e.target)) closeVol(); });

    // גרירה על הפס
    const sc = P.els.scrub;
    const ratioFromEvent = (e) => {
      const r = sc.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    sc.addEventListener('pointerdown', (e) => { P.dragging = true; sc.setPointerCapture(e.pointerId); preview(ratioFromEvent(e)); });
    sc.addEventListener('pointermove', (e) => { const r = ratioFromEvent(e); showTip(r); if (P.dragging) preview(r); });
    sc.addEventListener('pointerup', (e) => { if (!P.dragging) return; P.dragging = false; seek(ratioFromEvent(e) * dur()); });
    sc.addEventListener('pointerleave', () => { P.els.tip.style.opacity = ''; });
    sc.addEventListener('keydown', (e) => {
      const map = { ArrowRight: 5, ArrowLeft: -5, ArrowUp: 30, ArrowDown: -30, PageUp: 300, PageDown: -300 };
      // stopPropagation: אחרת גם קיצורי המקלדת הכלליים (±15 שניות) מופעלים על אותה לחיצה
      if (e.key in map) { e.preventDefault(); e.stopPropagation(); seek(audio.currentTime + map[e.key]); }
      if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); seek(0); }
      if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); seek(dur() - 1); }
    });

    // העדפות (החלה של מה ששמור — לא שינוי של המאזין, ולכן לא נשמר מחדש בחשבון)
    setRate(S.prefs.get('rate', 1), true);
    if (VOLUME_WORKS) audio.volume = S.prefs.get('volume', 1);
    paintVolume();

    // גובה הנגן בפועל (משתנה עם רוחב המסך, עם שבירת השורות ועם השוליים הבטוחים בטלפון),
    // כדי שסוף הדף וההודעות לא יוסתרו מאחוריו. בלי ResizeObserver נשאר הערך הקבוע שב־rosh.css.
    if (typeof ResizeObserver === 'function') {
      P.fitDock = () => {
        if (d.classList.contains('open')) document.body.style.setProperty('--dock-height', `${Math.ceil(d.offsetHeight)}px`);   // הנגן + השוליים שמתחתיו
        else document.body.style.removeProperty('--dock-height');
      };
      const ro = new ResizeObserver(() => P.fitDock());
      ro.observe(d.querySelector('.dock-inner'));
      ro.observe(d);   // סיבוב המסך משנה גם את השוליים הבטוחים
    }
  }

  const dur = () => (isFinite(audio.duration) && audio.duration) || P.episode?.duration || 0;

  function open() { build(); P.dock.classList.add('open'); document.body.classList.add('has-dock'); P.fitDock?.(); }
  function close() {
    pause();
    P.dock?.classList.remove('open');
    document.body.classList.remove('has-dock');
    P.fitDock?.();
    emit('close');
  }

  /* ---------- טעינת תוכנית ---------- */

  /* ההקלטה מוזרמת ישירות לנגן של האתר (ep.stream) — גם כשהקובץ שמור בדרייב.
     אין הפניה החוצה ואין נגן חיצוני.
     restored: התוכנית האחרונה שמוכנה בנגן בטעינת הדף (restore) — עד שנוגעים בה לא נשמר
     מיקום, והיא נכנסת להיסטוריה ולסטטיסטיקה רק כשמנגנים אותה באמת. */
  function load(ep, { at = null, autoplay = true, quiet = false, restored = false } = {}) {
    const candidates = window.RoshUI.streamCandidates(ep);
    if (!candidates.length) { window.RoshUI.notify('לתוכנית הזו אין עדיין הקלטה להאזנה.', 'info'); return false; }
    open();
    const same = P.episode && P.episode.id === ep.id && P.candidates && audio.src === P.candidates[P.candidateIndex];
    P.episode = ep;
    if (!same) {
      flushListen();
      P.candidates = candidates;
      P.candidateIndex = 0;
      audio.src = candidates[0];
      audio.load();
      P.listened = 0;
      P.uncounted = true;
      if (!restored) countPlay();
    }
    P.els.title.textContent = ep.title;
    P.els.link.href = `episode.html?ep=${encodeURIComponent(ep.slug)}`;
    P.els.art.style.setProperty('--h', String(window.RoshUI.hue(ep)));
    const dl = window.RoshUI.downloadUrl(ep);
    P.els.download.hidden = !dl;
    if (dl) { P.els.download.href = dl; P.els.download.setAttribute('download', `${ep.title}.mp3`); }   // השרת קובע את שם הקובץ
    P.els.art.innerHTML = ep.cover ? `<img src="${esc(ep.cover)}" alt=""><i></i>` : '<i></i>';
    P.els.dur.textContent = fmtTime(dur());
    renderSegments();
    updateNow(true);

    let start = at;
    if (start == null && !same) {
      const saved = S.positions.get(ep.id);
      if (saved && saved.t > 20 && (!saved.dur || saved.t < saved.dur - 30)) {
        start = saved.t;
        if (!quiet) window.RoshUI.notify(`ממשיכים מ־${fmtTime(saved.t)}`, 'info', { action: 'מההתחלה', onAction: () => seek(0) });
      }
    }
    if (start != null) seek(start);
    P.restored = restored;   // אחרי seek (שמסמן נגיעה)
    if (autoplay) play();
    mediaSession();
    emit('episode');
    return true;
  }
  /** האזנה לתוכנית: נכנסת להיסטוריה, ולסטטיסטיקה — האזנה אחת לכל טעינה של הקלטה (בלי פרטים מזהים) */
  function countPlay() {
    if (!P.uncounted || !P.episode) return;
    P.uncounted = false;
    S.history.add(P.episode.id);
    S.sb.event('play', P.episode.id);
  }

  function play() {
    if (!P.episode) return;
    P.wantPlay = true;
    P.restored = false;
    countPlay();
    audio.play().catch((err) => {
      if (err?.name === 'NotAllowedError') return; // דורש מחווה של המשתמש
      if (err?.name === 'AbortError' || err?.name === 'NotSupportedError') return; // מקור הוחלף / נכשל — מטופל ב־error
      window.RoshUI.notify('ניגון ההקלטה נכשל. בדקו את החיבור ונסו שוב.', 'error', { action: 'ניסיון חוזר', onAction: () => { audio.load(); play(); } });
    });
  }
  function pause() { P.wantPlay = false; audio.pause(); }
  function toggle() { audio.paused ? play() : pause(); }

  /** עוצמה 0–1. הזזה של הפס מבטלת השתקה; עוצמה 0 נחשבת השתקה. */
  function setVolume(v) {
    v = Math.min(1, Math.max(0, Number(v) || 0));
    if (VOLUME_WORKS) audio.volume = v;
    audio.muted = v === 0;
  }
  function toggleMute() {
    if (audio.muted || (VOLUME_WORKS && audio.volume === 0)) {
      audio.muted = false;
      if (VOLUME_WORKS && audio.volume === 0) audio.volume = 0.5;
    } else audio.muted = true;
  }
  function paintVolume() {
    if (!P.els.mute) return;
    const v = VOLUME_WORKS ? audio.volume : 1, silent = audio.muted || v === 0;
    P.els.mute.dataset.level = silent ? 'mute' : v < 0.5 ? 'low' : 'vol';
    P.els.mute.setAttribute('aria-label', silent ? 'הקול מושתק' : `עוצמת הקול ${Math.round(v * 100)}%`);
    if (P.els.vol) {
      const pct = silent ? 0 : Math.round(v * 100);
      P.els.vol.value = String(pct);
      P.els.vol.style.setProperty('--v', `${pct}%`);
      P.els.vol.setAttribute('aria-valuetext', silent ? 'מושתק' : `${pct}%`);
    }
    if (P.els.muteOnly) P.els.muteOnly.textContent = silent ? 'ביטול השתקה' : 'השתקה';
  }
  function seek(t) {
    t = Math.min(Math.max(0, t), dur() ? dur() - 0.25 : t);
    if (!isFinite(t)) return;
    P.restored = false;
    audio.currentTime = t;
    paint();
    updateNow();
    // לפני שהאורך האמיתי ידוע אין מה לשמור (אחרת האורך השמור נדרס ב־0); השמירה תגיע עם הניגון
    if (isFinite(audio.duration) && audio.duration) save(true);
  }
  /** silent: החלה של ההעדפה השמורה (בבניית הנגן) — בלי לשמור אותה שוב ובלי אירוע */
  function setRate(r, silent) {
    r = Number(r) || 1;
    r = RATES.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), 1);
    audio.playbackRate = r;
    if (P.els.speed) P.els.speed.value = String(r);
    if (silent) return;
    S.prefs.set('rate', r);
    emit('rate', { rate: r });
  }

  /* ---------- תוכנית קודמת / הבאה ---------- */

  /** בסדר הארכיון: "הבאה" היא החדשה יותר, "הקודמת" היא הישנה יותר. */
  function nextEpisode() { const nb = P.episode && S.neighbors(P.episode.id); if (nb?.newer?.stream) load(nb.newer, { at: 0 }); else window.RoshUI.notify('זו התוכנית האחרונה.', 'info'); }
  function prevEpisode() {
    if (audio.currentTime > 3) { seek(0); return; }   // כמו בנגנים: לחיצה באמצע חוזרת להתחלה
    const nb = P.episode && S.neighbors(P.episode.id); if (nb?.older?.stream) load(nb.older, { at: 0 }); else window.RoshUI.notify('זו התוכנית הראשונה.', 'info');
  }
  /** תוכנית אקראית עם הקלטה — לא זו שמתנגנת עכשיו. */
  function random() {
    const pool = S.episodes().filter((e) => e.stream && e.id !== P.episode?.id);
    if (!pool.length) return false;
    const ep = pool[Math.floor(Math.random() * pool.length)];
    window.RoshUI.notify(`✦ ${ep.title}`, 'info', { ttl: 5000 });
    return load(ep, { at: 0 });
  }
  function updateNow(force) {
    if (!force) return;
    P.els.now.textContent = P.episode?.date ? window.RoshUI.fmtDate(P.episode.date) : '';
    mediaSession();
  }
  /* סימנים על פס ההתקדמות: רגעים שמאזינים הגיבו עליהם (מדף התוכנית) */
  const markers = new Map();   // episodeId → [{ at, label }]
  function setMarkers(id, list) { markers.set(id, list || []); paintMarkers(); }
  function paintMarkers() {
    if (!P.els.markers) return;
    const D = dur(), list = (P.episode && markers.get(P.episode.id)) || [];
    P.els.markers.innerHTML = D ? list.filter((m) => m.at < D).map((m) => `<i style="left:${(m.at / D) * 100}%" title="${esc(`${fmtTime(m.at)} · ${m.label}`)}"></i>`).join('') : '';
  }
  function renderSegments() {
    const D = dur();
    P.segs = [{ from: 0, to: D || 1 }];
    P.els.segs.innerHTML = '<span class="seg" style="flex-grow:1"><i></i></span>';
    P.els.scrub.setAttribute('aria-valuemax', String(Math.floor(D)));
    paintMarkers();
  }
  function paint(ratioOverride) {
    const D = dur();
    const t = ratioOverride != null ? ratioOverride * D : audio.currentTime;
    if (P.els.dur.textContent !== fmtTime(D)) { P.els.dur.textContent = fmtTime(D); renderSegments(); }
    P.els.cur.textContent = fmtTime(t);
    const ratio = D ? t / D : 0;
    P.els.knob.style.left = `${ratio * 100}%`;
    P.els.scrub.setAttribute('aria-valuenow', String(Math.floor(t)));
    P.els.scrub.setAttribute('aria-valuetext', fmtTime(t));
    const segEls = P.els.segs.children;
    (P.segs || []).forEach((s, i) => {
      const el = segEls[i]; if (!el) return;
      const fill = el.firstElementChild;
      if (t >= s.to) { el.classList.add('done'); el.classList.remove('on'); fill.style.width = '100%'; }
      else if (t >= s.from) { el.classList.remove('done'); el.classList.add('on'); fill.style.width = `${((t - s.from) / Math.max(.001, s.to - s.from)) * 100}%`; }
      else { el.classList.remove('done', 'on'); fill.style.width = '0'; }
    });
    const state = audio.paused ? 'paused' : 'playing';
    if (P.els.toggle.dataset.state !== state) { P.els.toggle.dataset.state = state; P.els.toggle.setAttribute('aria-label', audio.paused ? 'ניגון' : 'השהיה'); }
  }
  function preview(ratio) { paint(ratio); }
  function showTip(ratio) {
    const D = dur();
    const t = ratio * D;
    P.els.tip.style.left = `${ratio * 100}%`;
    P.els.tip.textContent = fmtTime(t);
    P.els.tip.style.opacity = '1';
  }

  /* ---------- שמירת מיקום ---------- */

  // דקות האזנה לסטטיסטיקה: כל שתי דקות של ניגון נשלחות כאירוע אחד, ומה שנשאר
  // נשלח גם בעצירה, במעבר לתוכנית אחרת ובסגירת הדף — כדי ששום דקה לא תלך לאיבוד.
  // עם כל אירוע נשלח גם עד איפה הגיעו (באחוזים) — לגרף "עד איפה מאזינים".
  // בשרת, האזנה נספרת רק כששמעו כמה דקות באותו יום (ברירת מחדל 10; המנהלים קובעים).
  const pctNow = () => { const D = dur(); return D ? Math.min(100, Math.round((audio.currentTime / D) * 100)) : 0; };
  function flushListen(closing = false) {
    if (!P.episode || !P.listened) return;
    // השרת מקבל עד 600 שניות באירוע — זמן ארוך (אחרי מסך נעול) נשלח בכמה אירועים
    while (P.listened > 0) {
      const secs = Math.min(P.listened, 600);
      S.sb.event('listen', P.episode.id, secs, { pct: pctNow() }, { beacon: closing });
      P.listened -= secs;
    }
  }

  /* האזנה מלאה: אילו קטעים של 10 שניות בתוכנית באמת נשמעו (ניגון רציף, לא קפיצה). כשנשמעו
     90% מהקטעים נשלח אירוע complete — פעם אחת לכל תוכנית בביקור. מהירות הניגון לא משנה
     (גם ב־2× כל הקטעים נשמעים), ומי שקפץ לסוף לא נחשב כמי ששמע את כולה. */
  const HEARD_STEP = 10, HEARD_FULL = 0.9;
  const heard = new Map();   // מזהה תוכנית → { parts: Set, done }
  function markHeard(from, to) {
    const D = dur(); if (!D || !P.episode) return;
    let h = heard.get(P.episode.id);
    if (!h) { h = { parts: new Set(), done: false }; heard.set(P.episode.id, h); }
    for (let i = Math.floor(from / HEARD_STEP), last = Math.floor(Math.min(to, D - 0.001) / HEARD_STEP); i <= last; i++) h.parts.add(i);
    if (h.done || h.parts.size < Math.ceil(D / HEARD_STEP) * HEARD_FULL) return;
    h.done = true;
    S.sb.event('complete', P.episode.id, 0, { pct: pctNow() });
  }

  /* כל שנייה של ניגון. כשהטלפון עוצר את הטיימרים (מסך נעול) והנגן ממשיך לנגן, בחזרה נספר כל
     הזמן שעבר — לפי כמה שההקלטה התקדמה, ולא יותר מהזמן שעבר בשעון. */
  let tick = null;   // { at, t, id }: השנייה הקודמת של ניגון רציף; מתאפס בעצירה ובקפיצה
  audio.addEventListener('seeking', () => { tick = null; });
  setInterval(() => {
    if (audio.paused || !P.episode) { tick = null; return; }
    const now = Date.now(), t = audio.currentTime, rate = audio.playbackRate || 1;
    let secs = 1;
    if (tick && tick.id === P.episode.id) {
      const wall = (now - tick.at) / 1000, moved = t - tick.t;
      // ההקלטה התקדמה כמו שאפשר בזמן שעבר — ניגון רציף
      if (moved >= 0 && moved <= wall * rate + 2) {
        markHeard(tick.t, t);
        if (wall > 3) secs = Math.max(1, Math.round(Math.min(wall, moved / rate)));
      }
    }
    tick = { at: now, t, id: P.episode.id };
    P.listened = (P.listened || 0) + secs;
    S.listening.tick(secs);   // זמן האזנה אמיתי באזור האישי
    if (P.listened >= 120) flushListen();
  }, 1000);

  function save(force) {
    // לא שומרים: תוכנית ששוחזרה בטעינת הדף ועוד לא נגעו בה (אחרת כל צפייה בדף "מעדכנת" את המיקום
    // ושולחת שמירה לחשבון), ותוכנית שנגמרה (המיקום שלה נמחק ב־ended — לא מחזירים אותו בסוף)
    if (!P.episode || P.restored || audio.ended) return;
    const now = Date.now();
    if (!force && now - P.lastSaved < 5000) return;
    P.lastSaved = now;
    S.positions.set(P.episode.id, audio.currentTime, dur());
    S.last.set(P.episode.id, audio.currentTime);
  }

  /* ---------- Media Session ---------- */

  /** סוג התמונה לפי הסיומת; כשלא ידוע — בלי סוג (הדפדפן מזהה לבד) */
  const ART_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const artType = (src) => ART_TYPES[(/\.([a-z0-9]+)$/i.exec(String(src || '').split(/[?#]/)[0]) || [])[1]?.toLowerCase()] || '';

  function mediaSession() {
    if (!('mediaSession' in navigator) || !P.episode) return;
    try {
      const coverType = artType(P.episode.cover);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: P.episode.title,
        artist: S.site?.name || 'ראש בראש',
        album: P.episode.title,
        // תמונת התוכנית במסך הנעילה ובשעון; כשאין תמונה — הלוגו של התוכנית
        artwork: P.episode.cover
          ? [{ src: P.episode.cover, sizes: '1400x1400', ...(coverType ? { type: coverType } : {}) }]
          : [{ src: new URL('assets/img/icon-512.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
      });
      const h = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      h('play', play); h('pause', pause);
      h('seekbackward', () => seek(audio.currentTime - 15)); h('seekforward', () => seek(audio.currentTime + 15));
      h('previoustrack', prevEpisode); h('nexttrack', nextEpisode);
      h('seekto', (d) => seek(d.seekTime));
    } catch { /* */ }
  }

  /* ---------- ♥ על רגע: נשמר ב"הרגעים שסימנתם" באזור האישי ---------- */
  async function toggleMoment() {
    if (!P.episode) return;
    try {
      const r = await S.moments.toggle(P.episode.id, audio.currentTime);
      paintMomentBtn();
      window.RoshUI.notify(r.on ? `♥ נשמר: ${fmtTime(r.at)}. תמצאו את זה באזור האישי.` : 'הסימון הוסר.', 'success');
    } catch (err) {
      window.RoshUI.notify(err.message, 'info', err.login ? { action: 'להתחברות', onAction: () => (window.RoshApp ? window.RoshApp.navigate('me.html') : (location.href = 'me.html')) } : {});
    }
  }
  function paintMomentBtn() {
    const b = P.dock?.querySelector('[data-moment]'); if (!b || !P.episode) return;
    const on = S.moments.near(P.episode.id, audio.currentTime) != null;
    if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
  }

  /* ---------- שיתוף ---------- */

  async function shareMoment() {
    if (!P.episode) return;
    const t = Math.floor(audio.currentTime);
    const url = window.RoshUI.shareUrl(P.episode, t);
    const text = `${P.episode.title} (${fmtTime(t)})`;
    if (navigator.share) { try { await navigator.share({ title: P.episode.title, text, url }); return; } catch { /* בוטל */ } }
    (await window.RoshUI.copy(url)) ? window.RoshUI.notify('הקישור לרגע הזה הועתק.', 'success') : window.RoshUI.notify('ההעתקה נכשלה. העתיקו מהשורה: ' + url, 'error');
  }

  /* ---------- אירועי אודיו ---------- */

  audio.addEventListener('timeupdate', () => { if (!P.dragging) { paint(); updateNow(); save(); paintMomentBtn(); } emit('time'); });
  audio.addEventListener('loadedmetadata', () => { paint(); renderSegments(); paint(); });
  audio.addEventListener('durationchange', () => { renderSegments(); paint(); });
  const paintPlaying = () => document.body.classList.toggle('is-playing', !audio.paused && !audio.ended);
  audio.addEventListener('play', () => { paint(); paintPlaying(); emit('play'); });
  audio.addEventListener('playing', paintPlaying);
  audio.addEventListener('waiting', () => document.body.classList.remove('is-playing'));
  audio.addEventListener('pause', () => { paint(); paintPlaying(); save(true); flushListen(); emit('pause'); });
  /* סוף תוכנית: אם יש תור — ממשיכים לבאה בתור מיד. אחרת מציעים את "התוכנית
     הבאה" — אותו כיוון כמו הכפתור ▸▸ בנגן (החדשה יותר). */
  audio.addEventListener('ended', () => {
    paintPlaying(); paint();
    if (!P.episode) return;
    const id = P.episode.id;
    // השניות האחרונות, מאז הסימון האחרון, עד הסוף
    if (tick?.id === id && Date.now() - tick.at < 5000) markHeard(tick.t, dur());
    flushListen();
    // ה־pause שלפני ended כבר לא שומר (audio.ended), ו"התוכנית האחרונה" חוזרת להתחלה — כדי שהביקור הבא לא ייפתח בסוף
    S.positions.clear(id); S.last.set(id, 0); S.listening.finish(id);
    emit('end');
    const queued = S.queue.shift(id);
    if (queued) { window.RoshUI.notify(`ממשיכים בתור: ${queued.title}`, 'info', { ttl: 5000 }); load(queued, { at: 0 }); return; }
    const nb = S.neighbors(id);
    if (nb.newer?.stream) window.RoshUI.notify(`נגמר. להמשיך לתוכנית הבאה, "${nb.newer.title}"?`, 'info', { action: 'כן, נגנו', onAction: () => load(nb.newer, { at: 0 }), ttl: 12000 });
  });
  audio.addEventListener('error', () => {
    paintPlaying();
    if (!P.episode || !audio.src) return;
    // מקור נוסף? (למשל הכתובת הישירה כשה־Worker לא זמין)
    if (P.candidates && P.candidateIndex + 1 < P.candidates.length) {
      const wasPlaying = !audio.paused || P.wantPlay;
      const t = audio.currentTime;
      P.candidateIndex += 1;
      audio.src = P.candidates[P.candidateIndex];
      audio.load();
      if (t > 0) { try { audio.currentTime = t; } catch { /* */ } }
      if (wasPlaying) play();
      return;
    }
    const src = audio.src;
    const dl = window.RoshUI.downloadUrl(P.episode);
    window.RoshUI.notify('ההקלטה לא נטענה כרגע. אפשר לנסות שוב או להוריד אותה.', 'error', {
      action: 'ניסיון חוזר', ttl: 15000,
      onAction: () => { P.candidateIndex = 0; audio.src = P.candidates?.[0] || src; audio.load(); play(); },
    });
    if (dl) P.els.download.href = dl;
  });
  // רק שינוי אמיתי של העוצמה נשמר — לא החלת העוצמה השמורה בבניית הנגן
  audio.addEventListener('volumechange', () => {
    if (VOLUME_WORKS && audio.volume !== S.prefs.get('volume', 1)) S.prefs.set('volume', audio.volume);
    paintVolume();
  });
  // כשהדף נסגר או עובר לרקע (בטלפון זה לפעמים הרגע האחרון) — שליחה ב־sendBeacon, שלא נחתכת
  document.addEventListener('visibilitychange', () => { if (document.hidden) { save(true); flushListen(true); } });
  window.addEventListener('pagehide', () => { save(true); flushListen(true); });

  /* ---------- קיצורי מקלדת ---------- */

  // רווח על אחד מאלה מפעיל אותו (כפתור, קישור, בורר…) — ולא גם את הנגן
  const CONTROLS = 'button,a,select,input,textarea,[role="button"],[role="slider"],[contenteditable]';
  document.addEventListener('keydown', (e) => {
    if (window.RoshUI.isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    // לפי המקש הפיזי (e.code), כדי שהקיצורים יעבדו גם כשהמקלדת בעברית; "?" נשאר לפי e.key (ui.js)
    const code = e.code || (e.key === ' ' ? 'Space' : /^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : '');
    if (!P.episode && code !== 'Space' && code !== 'KeyR') return;
    const open = document.querySelector('dialog[open]');
    if (open) return;
    switch (code) {
      case 'Space': case 'KeyK':
        if (code === 'Space' && e.target?.closest?.(CONTROLS)) break;
        if (P.episode) { e.preventDefault(); toggle(); }
        break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? nextEpisode() : seek(audio.currentTime + 15); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? prevEpisode() : seek(audio.currentTime - 15); break;
      case 'KeyJ': seek(audio.currentTime - 15); break;
      case 'KeyL': seek(audio.currentTime + 15); break;
      case 'KeyR': random(); break;
      case 'KeyM': toggleMute(); break;
      case 'Equal': case 'NumpadAdd': setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(audio.playbackRate) + 1)] || 1); break;
      case 'Minus': case 'NumpadSubtract': setRate(RATES[Math.max(0, RATES.indexOf(audio.playbackRate) - 1)] || 1); break;
      default:
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); seek(dur() * (Number(e.key) / 10)); }
    }
  });

  /* ---------- שחזור הנגן בכל דף ---------- */

  // התוכנית האחרונה מהחשבון (בכל מכשיר) — מוכנה בנגן, מושהית. עד שנוגעים בה לא נשמר
  // שום מיקום (P.restored), כך שעצם הצפייה בדף לא משנה את מה ששמור בחשבון.
  const restore = () => {
    const l = S.last.get();
    const ep = l && S.byId(l.id);
    if (ep && ep.visible && !S.scheduled(ep) && ep.stream && !P.episode) load(ep, { at: l.t, autoplay: false, quiet: true, restored: true });
  };
  S.ready.then(() => {
    restore();
    if (S.me.loaded) return;
    // ready לא מחכה לנתונים האישיים יותר מ־2.5 שניות: כשהם מגיעים באיחור — משחזרים אז, פעם אחת
    const off = S.me.onChange(() => { if (!S.me.loaded) return; off(); restore(); });
  });
  S.onSession(() => S.ready.then(restore));

  window.RoshPlayer = {
    load, play, pause, toggle, seek, nextEpisode, prevEpisode, random, close, setRate, shareMoment, setMarkers, setVolume, toggleMute, RATES, VOLUME_WORKS,
    get episode() { return P.episode; },
    get time() { return audio.currentTime; },
    get duration() { return dur(); },
    get paused() { return audio.paused; },
    get volume() { return audio.volume; },
    get muted() { return audio.muted; },
    get src() { return audio.currentSrc || audio.src; },
    isCurrent(id) { return P.episode?.id === id; },
  };
})();
