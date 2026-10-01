/* offline.html: "ניסיון חוזר" וטעינה מחדש כשהחיבור חוזר (קובץ נפרד בגלל מדיניות האבטחה — בלי סקריפט בתוך הדף). */
(function () {
  'use strict';
  var status = document.getElementById('offline-status');
  function retry() { if (status) status.textContent = 'מנסים שוב…'; location.reload(); }
  var btn = document.getElementById('retry');
  if (btn) btn.addEventListener('click', retry);
  window.addEventListener('online', retry);
  // לחיצה על התראה (sw.js) כשהדף הזה מוצג במקום דף שלא נטען: אין כאן router.js — עוברים בטעינה רגילה
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'rosh-navigate' || typeof d.url !== 'string') return;
    try { if (new URL(d.url, location.href).origin === location.origin) location.href = d.url; } catch (err) { /* */ }
  });
})();
