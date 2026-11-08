// Minimal ASAR reader: list entries matching a regex, or extract one file.
// usage: node tools/asar-ls.cjs <archive> <regex> [outDir]
const fs = require('node:fs');
const path = require('node:path');

const archive = process.argv[2];
const pattern = new RegExp(process.argv[3] || '.', 'i');
const outDir = process.argv[4] || null;

const fd = fs.openSync(archive, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerSize = sizeBuf.readUInt32LE(4);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 8);
const raw = headerBuf.slice(0, headerSize).toString('utf8');
const header = JSON.parse(raw.slice(raw.indexOf('{')));
const dataOffset = 8 + headerSize;

const hits = [];
function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files || {})) {
        const full = prefix ? `${prefix}/${name}` : name;
        if (entry.files) {
            walk(entry, full);
            continue;
        }
        if (pattern.test(full)) hits.push({ path: full, size: entry.size, offset: Number(entry.offset) });
    }
}
walk(header, '');

if (!outDir) {
    hits.sort((a, b) => b.size - a.size);
    for (const hit of hits.slice(0, 60)) console.log(`${String(hit.size).padStart(9)}  ${hit.path}`);
    console.log(`total hits: ${hits.length}`);
    fs.closeSync(fd);
    return;
}

fs.mkdirSync(outDir, { recursive: true });
for (const hit of hits) {
    const buf = Buffer.alloc(hit.size);
    fs.readSync(fd, buf, 0, hit.size, dataOffset + hit.offset);
    const dest = path.join(outDir, path.basename(hit.path));
    fs.writeFileSync(dest, buf);
    console.log(`${dest}  ${hit.size}`);
}
fs.closeSync(fd);
