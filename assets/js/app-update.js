/* ראש בראש — רישום ה־Service Worker, ועדכון בכוח: כשעולה גרסה חדשה של האתר, דף פתוח נטען
   מחדש לבד, בלי הודעה.

   נטען מכל דף (<script src="assets/js/app-update.js" defer>). כך אין בדפים סקריפט
   בתוך ה־HTML, ומדיניות האבטחה (CSP) יכולה לאסור סקריפטים כאלה.
   - רושם את sw.js (רק ב־https; data-sw="off" על תגית הסקריפט מדלג — אזור הניהול ועורך המייל).
   - הגרסה: כל פריסה מסמנת את הסקריפט ב־?v=<commit> וכותבת את אותו ערך ל־version.json
     (pages.yml). הדף שואל את version.json כל שתי דקות, וכשחוזרים ללשונית, לחלון או לרשת;
     ערך אחר = גרסה חדשה. גם החלפת sw.js בגרסה חדשה (controllerchange) נחשבת עדכון.
     מקומית (בלי ?v=) אין בדיקה.
   - הטעינה מחכה לרגע בטוח: לא בזמן ניגון (body.is-playing או נגן שמתנגן), לא באמצע הקלדה,
     לא כשחלון (dialog) פתוח, ולא כל עוד דף מחזיק (window.RoshBusy — רשימת פונקציות; הניהול
     מחזיק כשיש שינויים שלא נשמרו, שמירה, פרסום, העלאה או עבודה שרצה). בדף ניהול שלא רשם
     פונקציה משלו (עורך המייל) כל הקלדה מחזיקה, כי אין דרך לדעת אם נשמרה.
   - אם אחרי הטעינה version.json עדיין אחר (מטמון בדרך), לא טוענים שוב לאותה גרסה במשך עשר
     דקות — כדי שלא ייווצר מעגל טעינות. */
(function () {
  'use strict';
  var sw = navigator.serviceWorker;
  var me = document.currentScript;
  var tool = !!(me && me.getAttribute('data-sw') === 'off');
  var src = null;
  try { src = me && me.src ? new URL(me.src) : null; } catch (e) { src = null; }
  var current = src ? src.searchParams.get('v') || '' : '';
  var versionUrl = src ? new URL('../../version.json', src).href : '';   // assets/js/ → שורש האתר

  var CHECK_EVERY = 2 * 60 * 1000, MIN_GAP = 30 * 1000, SAFE_RETRY = 3000, SAME_VERSION_PAUSE = 10 * 60 * 1000;
  var RELOADED_KEY = 'rosh-reloaded-for';

  var registration = null;
  var hadController = !!(sw && sw.controller);   // בטעינה הראשונה אין — אז החלפה אינה "עדכון"
  if (sw && location.protocol === 'https:' && !tool) {
    sw.register(new URL('sw.js', document.baseURI).href).then(function (reg) { registration = reg; }).catch(function () {});
  }
  if (sw) sw.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }
    reloadWhenSafe('sw');
  });

  var typed = false;
  if (tool) document.addEventListener('input', function () { typed = true; }, true);

  function playing() {
    if (document.body && document.body.classList.contains('is-playing')) return true;
    var media = document.querySelectorAll('audio, video');
    for (var i = 0; i < media.length; i++) if (!media[i].paused && !media[i].ended) return true;
    return false;
  }
  var TEXT = /^(text|search|email|url|tel|number|password|date|time|datetime-local|month|week)$/;
  function typing() {
    var el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT.test(el.type);
  }
  function held() {
    var list = window.RoshBusy || [];
    for (var i = 0; i < list.length; i++) { try { if (list[i]()) return true; } catch (e) { return true; } }
    return tool && !list.length && typed;
  }
  function busy() { return playing() || typing() || !!document.querySelector('dialog[open]') || held(); }

  function mayReload(version) {
    try {
      var last = JSON.parse(sessionStorage.getItem(RELOADED_KEY) || 'null');
      if (last && last.v === version && Date.now() - (last.at || 0) < SAME_VERSION_PAUSE) return false;
      sessionStorage.setItem(RELOADED_KEY, JSON.stringify({ v: version, at: Date.now() }));
    } catch (e) { /* בלי sessionStorage — טוענים בכל זאת */ }
    return true;
  }

  var waiting = 0, done = false;
  function reloadWhenSafe(version) {
    if (waiting || done) return;
    function attempt() {
      if (busy()) return;
      clearInterval(waiting);
      done = true;
      if (mayReload(version)) location.reload();
    }
    waiting = setInterval(attempt, SAFE_RETRY);
    attempt();
  }

  var lastCheck = 0;
  function check(force) {
    if (!current || waiting || done) return;
    if (!force && Date.now() - lastCheck < MIN_GAP) return;
    lastCheck = Date.now();
    if (registration) registration.update().catch(function () {});
    fetch(versionUrl, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var v = d && typeof d.v === 'string' ? d.v : '';
      if (v && v !== current) reloadWhenSafe(v);
    }).catch(function () { /* בלי רשת — ננסה בפעם הבאה */ });
  }
  function soon() { if (document.visibilityState === 'visible') check(false); }
  setInterval(function () { check(true); }, CHECK_EVERY);
  document.addEventListener('visibilitychange', soon);
  window.addEventListener('focus', soon);
  window.addEventListener('online', soon);
  window.addEventListener('pageshow', soon);

  // לבדיקות: RoshAppUpdate.check() בודק מיד
  window.RoshAppUpdate = { check: function () { check(true); } };
})();
