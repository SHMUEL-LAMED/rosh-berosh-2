/* קריאת רשימה מקובץ אקסל (assets/js/sheet-read.js) — בלי ספריות, עם מה שהדפדפן יודע לפתוח לבד. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

/** קובץ zip כמו שאקסל שומר: חלק מהקבצים דחוסים (deflate) וחלק לא */
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text, deflate] of files) {
    const nameBytes = Buffer.from(name), raw = Buffer.from(text), data = deflate ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const shared = '<sst><si><t>כתובת</t></si><si><t>שם</t></si><si><t>Sara@Example.com</t></si><si><r><t>שרה </t></r><r><rPr><b/></rPr><t>כהן &amp; בנות</t></r></si></sst>';
const sheet1 = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>david@example.com</t></is></c><c r="B3"/><c r="C3"><v>42</v></c></row></sheetData></worksheet>';
const sheet2 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>other@sheet.org</t></is></c></row></sheetData></worksheet>';
const book = zip([['[Content_Types].xml', '<Types/>', false], ['xl/sharedStrings.xml', shared, true], ['xl/worksheets/sheet1.xml', sheet1, true], ['xl/worksheets/sheet2.xml', sheet2, false]]);

const w = {};
vm.runInNewContext(fs.readFileSync('assets/js/sheet-read.js', 'utf8'), { window: w, Blob, Response, DecompressionStream, TextDecoder });
(async () => {
  assert.equal(await w.RoshSheet.xlsxText(book), 'כתובת\tשם\nSara@Example.com\tשרה כהן & בנות\ndavid@example.com\t\t42\nother@sheet.org');
  const file = (name, bytes, type = '') => ({ name, type, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => Buffer.from(bytes).toString('utf8') });
  assert.equal(await w.RoshSheet.text(file('רשימה.xlsx', book)), await w.RoshSheet.xlsxText(book), 'an .xlsx file is opened');
  assert.equal(await w.RoshSheet.text(file('list.csv', new Uint8Array(Buffer.from('a@b.co,דוד')))), 'a@b.co,דוד', 'CSV is read as text');
  // CSV מאקסל בעברית (Windows-1255), ו"טקסט Unicode" (UTF-16 עם BOM) — השמות לא משתבשים
  const cp1255 = (s) => new Uint8Array([...s].map((c) => { const k = c.charCodeAt(0); return k >= 0x5d0 && k <= 0x5ea ? k - 0x5d0 + 0xe0 : k; }));
  assert.equal(await w.RoshSheet.text(file('list.csv', cp1255('שם,מייל\r\nדוד כהן,david@gmail.com'))), 'שם,מייל\r\nדוד כהן,david@gmail.com', 'Windows-1255 CSV');
  assert.equal(await w.RoshSheet.text(file('list.txt', new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('דוד\tdavid@gmail.com', 'utf16le')])))), 'דוד\tdavid@gmail.com', 'UTF-16LE text');
  assert.equal(await w.RoshSheet.text(file('list.csv', new Uint8Array(Buffer.from('﻿a@b.co,דוד')))), 'a@b.co,דוד', 'UTF-8 with BOM');
  await assert.rejects(w.RoshSheet.text(file('old.xls', new Uint8Array(4))), /xlsx|CSV/);
  await assert.rejects(w.RoshSheet.xlsxText(new Uint8Array(Buffer.from('not a zip'))), /אקסל/);
  console.log('Spreadsheet import: xlsx (deflate and stored, shared and inline strings, all sheets), CSV and errors passed.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
