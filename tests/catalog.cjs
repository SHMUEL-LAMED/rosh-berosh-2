const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const data = JSON.parse(fs.readFileSync('data/episodes.json','utf8'));
assert.equal(data.episodes.length,86);
assert.equal(new Set(data.episodes.map(e=>e.slug)).size,86);
for(let n=55;n<=89;n++) assert(data.episodes.some(e=>e.number===n),`Missing episode ${n}`);
assert.equal(data.episodes.filter(e=>e.season==='sets').length,4);
assert.equal(data.episodes.filter(e=>e.season==='slater').length,10);
assert.equal(data.episodes.filter(e=>e.season==='trio').length,1);
assert.equal(data.episodes.filter(e=>e.season==='levi').length,25);
assert.equal(data.episodes.filter(e=>e.season==='legacy').length,46);
assert(!data.episodes.some(e=>/demo\.wav|לדוגמה/.test(JSON.stringify(e))));
const sandbox = { window:{}, document:{addEventListener(){}}, navigator:{}, location:{href:'https://example.com/'}, Intl, URL, URLSearchParams, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync('assets/js/ui.js','utf8'),sandbox);
const {driveId, streamUrl, publicLinks, isDriveUrl} = sandbox.window.RoshUI;
for(const e of data.episodes) assert(driveId(e),`No playback source: ${e.title}`);
assert.equal(driveId({audio:'https://drive.google.com.evil.test/file/d/abc/view'}),null);
assert.equal(driveId({audio:'javascript:alert(1)'}),null);
assert.equal(driveId({audio:'https://cdn.example.com/song.mp3',links:data.episodes[0].links}),null);

// Every recording streams straight into the site's own player: a Drive file becomes a
// direct usercontent download URL (206 ranges, CORS *), a direct file stays as is, and
// nothing that is not http(s) ever reaches an <audio> or <a download>.
for(const e of data.episodes){
 const url=streamUrl(e);
 assert.match(url,/^https:\/\/drive\.usercontent\.google\.com\/download\?id=[\w-]+&export=download&confirm=t$/,`Bad stream URL: ${e.title}`);
 assert.equal(new URL(url).searchParams.get('id'),driveId(e));
 assert.equal(publicLinks(e).length,0,`Drive link would be shown publicly: ${e.title}`);
}
assert.equal(streamUrl({audio:'https://cdn.example.com/song.mp3',links:data.episodes[0].links}),'https://cdn.example.com/song.mp3');
assert.equal(streamUrl({audio:'assets/audio/demo.wav'}),'assets/audio/demo.wav');
assert.equal(streamUrl({audio:'javascript:alert(1)'}),'');
assert.equal(streamUrl({audio:'',links:[{label:'x',url:'https://example.com'}]}),'');
assert(isDriveUrl('https://drive.google.com/file/d/abc/view')&&isDriveUrl('https://docs.google.com/uc?id=abc')&&!isDriveUrl('https://example.com'));
assert.deepEqual(publicLinks({links:[{label:'d',url:'https://drive.google.com/file/d/abc/view'},{label:'x',url:'https://example.com'}]}).map(l=>l.label),['x']);
// Updates: a word can link to an address or a file, **bold**, bare addresses become links,
// and nothing unsafe ever becomes a link or raw HTML.
{
 const {updateText, updateExtras, updateUrl, updatePlain} = sandbox.window.RoshUI;
 const html = updateText('שלום [להרשמה](https://example.com/a?b=1&c=2) ו**חשוב**\nשורה שנייה https://site.test/x.\n\nפסקה <script>alert(1)</script>');
 assert.match(html, /^<p>שלום <a class="update-link" href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener">להרשמה<\/a> ו<strong>חשוב<\/strong><br>שורה שנייה <a class="update-link" href="https:\/\/site\.test\/x" target="_blank" rel="noopener" dir="ltr">site\.test\/x<\/a>\.<\/p><p>פסקה &lt;script&gt;/);
 assert.doesNotMatch(updateText('[x](javascript:alert(1)) [y](//evil.test) [z](data:text/html,1)'), /<a /, 'unsafe targets stay plain text');
 assert.match(updateText('[q](" onmouseover="x)'), /^<p>\[q\]\(&quot;/);
 assert.match(updateText('[טופס](updates.html) [מייל](mailto:a@b.co) [קובץ](https://w.dev/media/program/u-1/a.pdf)'), /href="updates\.html">טופס<\/a>.*href="mailto:a@b\.co">מייל<\/a>.*href="https:\/\/w\.dev\/media\/program\/u-1\/a\.pdf" target="_blank"/);
 assert.equal(updateUrl('javascript:alert(1)'), '');
 assert.equal(updatePlain('ראו [כאן](https://x.test) **עכשיו**'), 'ראו כאן עכשיו');
 const extras = updateExtras({ links: [{ label: 'להרשמה', url: 'https://x.test' }, { label: 'רע', url: 'javascript:1' }], files: [{ name: 'לוח שידורים', url: 'https://w.dev/media/program/u-1/a.pdf', size: 2.5 * 1024 * 1024 }, { name: 'רע', url: 'javascript:1' }] });
 assert.match(extras, /class="update-file" href="https:\/\/w\.dev\/media\/program\/u-1\/a\.pdf"[^>]*>.*📄.*לוח שידורים.*PDF · 2\.5 MB/);
 assert.equal((extras.match(/class="update-file"/g) || []).length, 1);
 assert.equal((extras.match(/class="btn small/g) || []).length, 1, 'the unsafe button is dropped');
 assert.match(updateExtras({ link: 'updates.html' }), /href="updates\.html">לפרטים/, 'the old single link still shows');
}
// The public pages never mention the storage provider.
for(const f of ['assets/js/home.js','assets/js/archive.js','assets/js/episode.js','assets/js/me.js','assets/js/player.js','index.html','archive.html','episode.html','me.html']){
 const src=fs.readFileSync(f,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 assert(!/drive\.google|Google Drive|דרייב|Drive/.test(src),`Storage provider leaks into ${f}`);
}

// Cloudflare uploads must require an administrator, send the bearer token and
// preserve the exact file bytes while reporting progress. A large file goes up in
// parts, several at a time; a part that fails is retried by itself, an upload that
// was cut off resumes from the parts that already arrived when the same file is
// chosen again, and a permission error is never retried.
async function uploadCheck() {
 const file=new Blob([new Uint8Array(1024).fill(73)],{type:'audio/mpeg'});
 file.name='test.mp3'; file.lastModified=123;
 let request;
 class XHR {
  constructor(){this.headers={};this.upload={};}
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(k,v){this.headers[k]=v;}
  abort(){}
  async send(body){request={method:this.method,url:this.url,headers:this.headers,body:Buffer.from(await body.arrayBuffer())};this.upload.onprogress?.({lengthComputable:true,loaded:body.size,total:body.size});this.status=200;this.responseText=JSON.stringify({url:'https://api.example/media/program/ep-90/file.mp3'});this.onload();}
 }
 const storage=new Map();
 const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 // ההמתנות בין ניסיונות מקוצרות; שעון התקיעה (45 שניות) נשאר אמיתי ואינו מחזיק את התהליך
 const fast=(fn,ms)=>{const stall=ms>=45000;const t=setTimeout(fn,stall?ms:Math.min(ms||0,2));if(stall)t.unref?.();return t;};
 const sb={session:{token:'secret'},base:p=>'https://api.example'+p,isAdmin:async()=>true};
 const sandbox=(xhr)=>{const ctx={window:{RoshStore:{sb}},XMLHttpRequest:xhr,encodeURIComponent,setTimeout:fast,clearTimeout,localStorage};vm.runInNewContext(fs.readFileSync('assets/js/upload.js','utf8'),ctx);return ctx;};
 const ctx=sandbox(XHR);
 const progress=[];
 const url=await ctx.window.RoshUpload(file,'ep-90','audio',p=>progress.push(p));
 assert.equal(url,'https://api.example/media/program/ep-90/file.mp3');
 assert.equal(request.method,'POST'); assert.equal(request.headers.Authorization,'Bearer secret');
 assert.deepEqual(request.body,Buffer.from(await file.arrayBuffer())); assert(progress.includes(100));

 // קובץ גדול (הקלטה של שעה וחצי) עולה בחלקים, כמה במקביל, בלי מגבלת גודל; חלק שנכשל פעם אחת עולה שוב לבד
 const big=new Blob([new Uint8Array(45*1024*1024).fill(7)],{type:'audio/mpeg'}); big.name='long.mp3'; big.lastModified=5;
 const parts=[]; const calls=[]; const failOnce=new Set(); let inFlight=0, peak=0;
 const partOf=(xhr)=>Number(new URL(xhr.url).searchParams.get('part'));
 class XHR2 extends XHR {
  async send(body){
   if(this.method!=='PUT') return super.send(body);
   const part=partOf(this);
   inFlight++; peak=Math.max(peak,inFlight); await new Promise(r=>setTimeout(r,1)); inFlight--;
   if(failOnce.delete(part)) return this.onerror();
   parts.push({part,size:body.size}); this.upload.onprogress?.({lengthComputable:true,loaded:body.size});
   this.status=200; this.responseText=JSON.stringify({etag:`e${part}`}); this.onload();
  }
 }
 sb.call=async(path,opts)=>{ calls.push({path,body:opts?.body}); if(path.includes('/upload/start')) return {key:'program/ep-90/x.mp3',uploadId:'u1',partSize:10*1024*1024}; if(path.includes('/upload/complete')) return {url:'https://api.example/media/program/ep-90/x.mp3'}; return {}; };
 const allParts=JSON.stringify([1,2,3,4,5].map(part=>({part,etag:`e${part}`})));
 const ctx2=sandbox(XHR2);
 const bigProgress=[];
 failOnce.add(2);
 assert.equal(await ctx2.window.RoshUpload(big,'ep-90','audio',p=>bigProgress.push(p)),'https://api.example/media/program/ep-90/x.mp3');
 assert.equal(parts.length,5); assert.equal(parts.reduce((n,p)=>n+p.size,0),big.size);
 assert(peak>1,'parts upload in parallel');
 assert.equal(JSON.stringify(calls.find(c=>c.path.includes('/upload/complete')).body.parts),allParts);
 assert(bigProgress.includes(100));
 assert(!calls.some(c=>c.path.includes('/upload/abort')));
 assert.equal(storage.size,0,'a finished upload is forgotten');

 // ניתוק ממושך: החלקים שעלו נשארים בשרת ובזיכרון, ובחירה חוזרת של אותו הקובץ ממשיכה מהם
 parts.length=0; calls.length=0;
 class XHR3 extends XHR2 { async send(body){ if(this.method==='PUT'&&partOf(this)>=3){ await new Promise(r=>setTimeout(r,1)); return this.onerror(); } return super.send(body); } }
 const ctx3=sandbox(XHR3);
 await assert.rejects(ctx3.window.RoshUpload(big,'ep-90','audio',()=>{}),/תמשיך מאותה נקודה/);
 assert(!calls.some(c=>c.path.includes('/upload/abort')),'an interrupted upload stays on the server for resuming');
 assert.equal(storage.size,1);
 assert.deepEqual(parts.map(p=>p.part).sort(),[1,2]);
 parts.length=0; calls.length=0;
 const ctx4=sandbox(XHR2);
 const resumed=[];
 assert.equal(await ctx4.window.RoshUpload(big,'ep-90','audio',p=>resumed.push(p)),'https://api.example/media/program/ep-90/x.mp3');
 assert(!calls.some(c=>c.path.includes('/upload/start')),'no new upload is started');
 assert.deepEqual(parts.map(p=>p.part).sort(),[3,4,5]);
 assert.equal(JSON.stringify(calls.find(c=>c.path.includes('/upload/complete')).body.parts),allParts);
 assert(resumed.find(p=>p>0)>=40,'progress starts where the upload stopped');
 assert.equal(storage.size,0);

 // העלאה שנזכרה אבל כבר לא קיימת בשרת (410): מתחילים מחדש, בלי לתקוע את המנהל
 storage.set('rosh:upload:resume',JSON.stringify({[`ep-90|audio|long.mp3|${big.size}|5`]:{key:'program/ep-90/old.mp3',uploadId:'old',partSize:10*1024*1024,etags:{1:'x1'},at:Date.now()}}));
 parts.length=0; calls.length=0;
 class XHR5 extends XHR2 { async send(body){ if(this.method==='PUT'&&this.url.includes('uploadId=old')){ this.status=410; this.responseText=JSON.stringify({error:'ההעלאה כבר לא קיימת.'}); return this.onload(); } return super.send(body); } }
 const ctx5=sandbox(XHR5);
 assert.equal(await ctx5.window.RoshUpload(big,'ep-90','audio',()=>{}),'https://api.example/media/program/ep-90/x.mp3');
 assert.equal(calls.filter(c=>c.path.includes('/upload/start')).length,1);
 assert.deepEqual(parts.map(p=>p.part).sort(),[1,2,3,4,5]);
 assert.equal(storage.size,0);

 // שגיאת הרשאה אינה מנוסה שוב: ההעלאה מבוטלת בשרת ונשכחת
 parts.length=0; calls.length=0;
 class XHR6 extends XHR2 { async send(body){ if(this.method==='PUT'){ this.status=403; this.responseText=JSON.stringify({error:'אין הרשאת ניהול.'}); return this.onload(); } return super.send(body); } }
 const ctx6=sandbox(XHR6);
 await assert.rejects(ctx6.window.RoshUpload(big,'ep-90','audio',()=>{}),/אין הרשאת ניהול/);
 assert.equal(parts.length,0);
 assert(calls.some(c=>c.path.includes('/upload/abort')));
 assert.equal(storage.size,0);

 sb.isAdmin=async()=>false;
 await assert.rejects(ctx.window.RoshUpload(file,'ep-90','audio',()=>{}),/מנהל/);
 console.log('Catalog, stream URLs, public links, Cloudflare upload authorization, parallel parts, retries, resuming and byte integrity passed.');
}
uploadCheck().catch(e=>{console.error(e);process.exitCode=1;});
