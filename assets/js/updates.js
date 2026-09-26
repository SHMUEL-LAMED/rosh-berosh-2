/* דף העדכונים: ההודעות הקצרות שמנהל כתב באזור הניהול, מהחדשה לישנה. */
(async function () {
  'use strict';
  const U = window.RoshUI, S = window.RoshStore;
  const { esc, fmtDate } = U;

  await S.ready;
  const site = S.site || {};
  document.getElementById('site-header').innerHTML = U.header('updates', site);
  document.getElementById('site-footer').innerHTML = U.footer(site);

  const fresh = new Set(U.newUpdates().map((u) => u.id));
  const list = (S.settings.updates || []).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.date || '').localeCompare(a.date || ''));
  const box = document.getElementById('updates');
  box.innerHTML = list.length ? list.map((u) => `
<article class="card update${fresh.has(u.id) ? ' is-new' : ''}" data-reveal>
  <time datetime="${esc(u.date)}">${esc(fmtDate(u.date) || '')}${fresh.has(u.id) ? '<span class="new-tag">חדש</span>' : ''}${u.pinned ? '<span class="pin">נעוץ</span>' : ''}</time>
  ${u.title ? `<h2>${esc(u.title)}</h2>` : ''}
  ${u.text ? `<p>${esc(u.text)}</p>` : ''}
  ${u.link ? `<div class="actions"><a class="btn small" href="${esc(u.link)}" ${/^https?:/.test(u.link) ? 'target="_blank" rel="noopener"' : ''}>לפרטים <span>←</span></a></div>` : ''}
</article>`).join('') : '<div class="card"><div class="state"><span class="mark">✦</span><h3>אין עדכונים כרגע</h3><p>כשיהיה משהו חדש, הוא יופיע כאן.</p></div></div>';
  U.reveal();
  // נכנסתם לדף — כל העדכונים נחשבים "ראיתם" (הסימון "חדש" נשאר עד הביקור הבא)
  U.markUpdatesSeen();
})();
