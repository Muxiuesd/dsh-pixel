// One-off helper: search inside app.asar (read-only) for a text needle.
// Usage: node asar-grep.cjs <needle> [maxFiles] [snippetChars]
const fs = require('fs');

const ASAR = 'D:\\app\\dsh\\resources\\app.asar';
const needle = process.argv[2];
const maxFiles = Number(process.argv[3] || 10);
const snippetChars = Number(process.argv[4] || 260);
if (!needle) {
  console.error('needle required');
  process.exit(2);
}

const fd = fs.openSync(ASAR, 'r');
const totalSize = fs.fstatSync(fd).size;
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const pickleSize = head.readUInt32LE(4);
const jsonLen = head.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 8 + pickleSize;

const files = [];
(function walk(node, prefix) {
  const entries = node.files || {};
  for (const key of Object.keys(entries)) {
    const value = entries[key];
    const cur = prefix ? prefix + '/' + key : key;
    if (value.files) walk(value, cur);
    else files.push({ p: cur, start: dataStart + Number(value.offset || 0), size: Number(value.size || 0), unpacked: Boolean(value.unpacked) });
  }
})(header, '');

const byStart = files.filter((f) => !f.unpacked && f.size > 0).sort((a, b) => a.start - b.start);
function fileAt(absPos) {
  let lo = 0;
  let hi = byStart.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (byStart[mid].start <= absPos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  const f = byStart[ans];
  return absPos < f.start + f.size ? f : null;
}

const needleBuf = Buffer.from(needle, 'utf8');
const chunk = 4 * 1024 * 1024;
const skipFiles = (p) => /\.(map|d\.ts|ntfs|wasm|png|jpg|woff2?|ttf|ico|gz|zip)$/i.test(p);
const hits = new Map();
let pos = dataStart;
let carry = null;
let carryAbs = 0;
while (pos < totalSize) {
  const len = Math.min(chunk, totalSize - pos);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  const hay = carry ? Buffer.concat([carry, buf]) : buf;
  const hayAbs = carry ? carryAbs : pos;
  let idx = hay.indexOf(needleBuf);
  while (idx !== -1) {
    const absPos = hayAbs + idx;
    const f = fileAt(absPos);
    if (f && !skipFiles(f.p) && f.size < 4 * 1024 * 1024) {
      if (!hits.has(f.p)) hits.set(f.p, []);
      const arr = hits.get(f.p);
      if (arr.length < 2) arr.push(absPos - f.start);
    }
    idx = hay.indexOf(needleBuf, idx + 1);
  }
  const keepLen = Math.min(hay.length, needleBuf.length - 1);
  carry = Buffer.from(hay.subarray(hay.length - keepLen));
  carryAbs = hayAbs + hay.length - keepLen;
  pos += len;
}

console.log(`needle=${JSON.stringify(needle)} fileHits=${hits.size}`);
const ordered = [...hits.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, maxFiles);
for (const [p, offsets] of ordered) {
  const f = files.find((x) => x.p === p);
  const fd2 = fs.openSync(ASAR, 'r');
  console.log('\n=== ' + p + ` (${f.size}B)`);
  for (const off of offsets) {
    const readStart = Math.max(0, off - Math.floor(snippetChars / 3));
    const readLen = Math.min(f.size - readStart, snippetChars);
    const b = Buffer.alloc(readLen);
    fs.readSync(fd2, b, 0, readLen, f.start + readStart);
    console.log('--- @' + off + '\n' + b.toString('utf8').replace(/\r/g, ''));
  }
  fs.closeSync(fd2);
}
fs.closeSync(fd);
