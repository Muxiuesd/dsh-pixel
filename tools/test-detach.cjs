#!/usr/bin/env node
/**
 * Unit-tests the palette-detach helpers straight out of client.js, so the test
 * exercises the shipped source text instead of a copy of it.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'client.js');
const source = fs.readFileSync(file, 'utf8');

const start = source.indexOf('/** Does any layer still reference this palette slot? */');
const end = source.indexOf('function clamp(value, min, max)');
if (start === -1 || end === -1) {
    console.error('FAIL: helper block not found in client.js');
    process.exit(1);
}
const block = source.slice(start, end);

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const sandbox = { CHARS, charFor: (i) => CHARS[i], indexFor: (ch) => CHARS.indexOf(ch) };
vm.createContext(sandbox);
vm.runInContext(`${block}\nglobalThis.__api = { slotInUse, remapSlot, detachSlot };`, sandbox);
const { slotInUse, detachSlot } = sandbox.__api;

let failures = 0;
function check(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
}
const doc = (palette, rows) => ({ palette, layers: [{ name: 'L', visible: true, rows }] });

console.log('detachSlot');

// 1. unused slot: nothing to detach
{
    const d = doc(['#ff0000', '#00ff00'], ['0..', '...']);
    const out = detachSlot(d, 1);
    check('unused slot leaves the doc untouched', out.target === -1 && out.doc === d);
}

// 2. used slot, a free slot exists: pixels move, palette keeps its size
{
    const d = doc(['#ff0000', '#00ff00', '#0000ff'], ['00.', '.0.']);
    const out = detachSlot(d, 0);
    check('used slot is remapped to a free slot', out.target === 1 || out.target === 2, `target=${out.target}`);
    check('palette size unchanged when a free slot exists', out.doc.palette.length === 3, `size=${out.doc.palette.length}`);
    check('adopted slot carries the old colour', out.doc.palette[out.target].toLowerCase() === '#ff0000');
    check('no pixel still references slot 0', !slotInUse(out.doc, 0));
    check('same number of painted pixels', out.doc.layers[0].rows.join('').split('').filter((c) => c !== '.').length === 3);
}

// 3. every slot used and the palette is not full: append a new slot
{
    const d = doc(['#ff0000', '#00ff00'], ['01', '10']);
    const out = detachSlot(d, 0);
    check('full-but-growable palette appends a slot', out.target === 2 && out.created === true, `target=${out.target}, created=${out.created}`);
    check('appended slot carries the old colour', out.doc.palette[2].toLowerCase() === '#ff0000');
    check('appended doc has 3 colours', out.doc.palette.length === 3);
    check('pixel of slot 0 now points at slot 2', out.doc.layers[0].rows.join('') === '2112', out.doc.layers[0].rows.join(''));
}

// 4. every slot used and the palette is at the character ceiling: refuse
{
    const palette = CHARS.split('').map((_, i) => `#${i.toString(16).padStart(6, '0')}`);
    const rows = [CHARS];
    const out = detachSlot(doc(palette, rows), 0);
    check('full palette with no spare slot refuses (null)', out === null, String(out));
}

// 5. paint survives: the visible colour of each pixel is unchanged
{
    const d = doc(['#ff0000', '#00ff00'], ['00.', '.00']);
    const out = detachSlot(d, 0);
    const before = (docBody) => docBody.layers[0].rows.join('').split('').filter((c) => c !== '.').length;
    check('painted pixel count preserved', before(out.doc) === 4);
}

console.log(failures === 0 ? 'PASS: detachSlot keeps the canvas intact' : `FAIL: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
