// One-off helper: dump a file (or byte range) from app.asar.
// Usage: node asar-get.cjs <path-inside-asar> [startByte] [length]
const fs = require('fs');

const ASAR = 'D:\\app\\dsh\\resources\\app.asar';
const want = (process.argv[2] || '').replace(/\\/g, '/');
const startByte = Number(process.argv[3] || 0);
const length = Number(process.argv[4] || 0);

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

function find(node, parts, idx) {
  if (idx === parts.length) return node;
  const next = (node.files || {})[parts[idx]];
  if (!next) return null;
  return find(next, parts, idx + 1);
}

const parts = want.split('/').filter(Boolean);
const node = find(header, parts, 0);
if (!node) {
  console.error('not found: ' + want);
  process.exit(3);
}
if (node.files) {
  console.log('DIRECTORY: ' + want);
  console.log(Object.keys(node.files).join('\n'));
  process.exit(0);
}
const size = Number(node.size || 0);
const offset = dataStart + Number(node.offset || 0);
const take = length > 0 ? Math.min(length, size - startByte) : size - startByte;
const buf = Buffer.alloc(take);
fs.readSync(fd, buf, 0, take, offset + startByte);
process.stdout.write(buf);
fs.closeSync(fd);
