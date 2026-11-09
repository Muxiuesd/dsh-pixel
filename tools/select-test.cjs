/**
 * Unit tests for the rectangle-selection helpers in client.js.
 *
 * The helpers live inside the client module closure, so they are reached
 * through the `window.__PXS_TEST__.selection` hook that the module installs
 * when the host page defines it. The harness below is the same stub set as
 * render-smoke.cjs: no real browser, no React.
 *
 * Usage: node tools/select-test.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT = path.resolve(__dirname, '..', 'client.js');

/* -------------------------------------------------------------------------- */
/* browser stubs                                                              */
/* -------------------------------------------------------------------------- */

const storage = new Map();

const windowStub = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    location: { reload: () => {} },
    confirm: () => false,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    __PXS_TEST__: {},
};

const documentStub = {
    createElement: () => ({
        style: {},
        getContext: () => ({
            createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
            putImageData: () => {},
            getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
            setTransform: () => {},
            translate: () => {},
            scale: () => {},
            drawImage: () => {},
        }),
        appendChild: () => {},
    }),
    addEventListener: () => {},
    body: { appendChild: () => {} },
};

class HTMLElementStub {}
class ResizeObserverStub {
    observe() {}
    disconnect() {}
}

const reactStub = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useReducer: (reducer, initial) => [initial, () => {}],
    memo: (component) => component,
    forwardRef: (render) => render,
    Component: class Component {
        constructor(props) {
            this.props = props;
            this.state = {};
        }

        setState() {}
    },
};

/* -------------------------------------------------------------------------- */
/* load the client module                                                     */
/* -------------------------------------------------------------------------- */

let definition = null;
windowStub.__ModuleLoader__ = {
    load(def) {
        definition = def;
    },
};

const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    HTMLElement: HTMLElementStub,
    ResizeObserver: ResizeObserverStub,
    fetch: () => Promise.reject(new Error('fetch is not available in the smoke test')),
    setTimeout: () => 1,
    clearTimeout: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    Uint8Array,
    Uint8ClampedArray,
    Math,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    Error,
    Promise,
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: CLIENT });

if (!definition) {
    console.error('FAIL: client.js did not call window.__ModuleLoader__.load');
    process.exit(1);
}

definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error(`unexpected require(${name})`);
});

const selection = windowStub.__PXS_TEST__.selection;
if (!selection) {
    console.error('FAIL: window.__PXS_TEST__.selection hook is missing');
    process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* assertions                                                                 */
/* -------------------------------------------------------------------------- */

let failures = 0;

function same(label, actual, expected) {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left === right) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}\n       expected ${right}\n       actual   ${left}`);
}

function truthy(label, value) {
    if (value) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}`);
}

function near(label, actual, expected, tolerance) {
    if (Math.abs(actual - expected) <= tolerance) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}\n       expected ${expected} ±${tolerance}\n       actual   ${actual}`);
}

const {
    selectionBetween,
    clampRectangle,
    moveRectangle,
    pointInRectangle,
    readRegion,
    writeRegion,
    blankRegion,
    fillRows,
    emptyRows,
    mirrorRows,
    mergedRegion,
} = selection;

console.log('selection geometry');

same('drag down-right spans both cells', selectionBetween({ x: 2, y: 1 }, { x: 5, y: 5 }), { x: 2, y: 1, w: 4, h: 5 });
same('drag up-left normalises', selectionBetween({ x: 5, y: 5 }, { x: 2, y: 1 }), { x: 2, y: 1, w: 4, h: 5 });
same('single click is a 1×1 box', selectionBetween({ x: 3, y: 4 }, { x: 3, y: 4 }), { x: 3, y: 4, w: 1, h: 1 });

same('rectangle pulled above/left of the canvas is clamped', clampRectangle({ x: -3, y: -4, w: 9, h: 9 }, 8, 6), { x: 0, y: 0, w: 8, h: 6 });
same('rectangle shrinks at the far edge', clampRectangle({ x: 6, y: 5, w: 10, h: 10 }, 8, 6), { x: 6, y: 5, w: 2, h: 1 });
same('rectangle fully outside lands on the last cell', clampRectangle({ x: 99, y: 99, w: 4, h: 4 }, 8, 6), { x: 7, y: 5, w: 1, h: 1 });

same('move keeps the size and clamps at 0', moveRectangle({ x: 2, y: 2, w: 3, h: 3 }, -5, -5, 8, 6), { x: 0, y: 0, w: 3, h: 3 });
same('move clamps at the far edge', moveRectangle({ x: 2, y: 2, w: 3, h: 3 }, 99, 99, 8, 6), { x: 5, y: 3, w: 3, h: 3 });

truthy('inside point is inside', pointInRectangle({ x: 2, y: 2, w: 3, h: 3 }, { x: 2, y: 4 }));
truthy('bottom-right cell is inside', pointInRectangle({ x: 2, y: 2, w: 3, h: 3 }, { x: 4, y: 4 }));
truthy('right neighbour is outside', !pointInRectangle({ x: 2, y: 2, w: 3, h: 3 }, { x: 5, y: 4 }));
truthy('top neighbour is outside', !pointInRectangle({ x: 2, y: 2, w: 3, h: 3 }, { x: 2, y: 1 }));

console.log('region copy / paste');

const art = ['0123456789', 'abcdefghij', '..........', '..........'];
same('readRegion slices the box', readRegion(art, { x: 2, y: 0, w: 4, h: 2 }), ['2345', 'cdef']);
same('readRegion pads past the row end', readRegion(['ab'], { x: 1, y: 0, w: 3, h: 2 }), ['b..', '...']);
same('readRegion pads missing rows', readRegion([], { x: 0, y: 0, w: 2, h: 2 }), ['..', '..']);

const pasted = writeRegion(art, ['XY', 'zw'], 4, 2);
same('writeRegion writes only the box', pasted, ['0123456789', 'abcdefghij', '....XY....', '....zw....']);
same('writeRegion leaves the source array alone', art, ['0123456789', 'abcdefghij', '..........', '..........']);
same('writeRegion clips at the right edge', writeRegion(['abcd'], ['WXYZ'], 2, 0), ['abWX']);
same('writeRegion clips at the bottom edge', writeRegion(['abcd'], ['W', 'X'], 0, 1), ['abcd']);

same('blankRegion is a transparent block', blankRegion({ x: 0, y: 0, w: 3, h: 2 }), ['...', '...']);
same('fillRows paints the box', fillRows(art, { x: 1, y: 1, w: 2, h: 2 }, 'z'), ['0123456789', 'azzdefghij', '.zz.......', '..........']);
same('emptyRows clears the box', emptyRows(art, { x: 0, y: 0, w: 2, h: 1 }), ['..23456789', 'abcdefghij', '..........', '..........']);

console.log('mirror');

same('horizontal mirror reverses each row of the box', mirrorRows(art, { x: 0, y: 0, w: 3, h: 2 }, true), ['2103456789', 'cbadefghij', '..........', '..........']);
same('vertical mirror reverses the row order', mirrorRows(art, { x: 0, y: 0, w: 2, h: 3 }, false), ['..23456789', 'abcdefghij', '01........', '..........']);
same('mirroring a square twice restores it', mirrorRows(mirrorRows(art, { x: 1, y: 0, w: 4, h: 2 }, true), { x: 1, y: 0, w: 4, h: 2 }, true), art);

console.log('merged preview');

const layers = [
    { visible: true, rows: ['aa..', '....'] },
    { visible: true, rows: ['..bb', '.c..'] },
    { visible: false, rows: ['dddd', 'dddd'] },
];
same('top-most non-transparent cell wins', mergedRegion(layers, { x: 0, y: 0, w: 4, h: 2 }), ['aabb', '.c..']);
same('hidden layers never show up', mergedRegion([layers[2]], { x: 0, y: 0, w: 2, h: 1 }), ['..']);

console.log('colour wheel maths');

const color = windowStub.__PXS_TEST__.color;
if (!color) {
    console.error('FAIL: window.__PXS_TEST__.color hook is missing');
    process.exit(1);
}
const { rgbToHsv, hsvToRgb, hsvToHex, hexToRgb, complementHsv, wheelGeometry, wheelHitTest } = color;

same('red sits at hue 0', hsvToHex(0, 1, 1), '#ff0000');
same('green sits at hue 120', hsvToHex(120, 1, 1), '#00ff00');
same('blue sits at hue 240', hsvToHex(240, 1, 1), '#0000ff');
same('zero saturation is white', hsvToHex(200, 0, 1), '#ffffff');
same('zero value is black', hsvToHex(200, 1, 0), '#000000');
same('hsvToRgb agrees with hsvToHex', hsvToRgb(30, 0.5, 0.8), [204, 153, 102]);

const roundTrip = rgbToHsv(hexToRgb('#3366cc'));
near('rgbToHsv recovers the hue', roundTrip.h, 220, 1);
near('rgbToHsv recovers the saturation', roundTrip.s, 0.75, 0.01);
near('rgbToHsv recovers the value', roundTrip.v, 0.8, 0.01);

const redComplement = complementHsv(0, 1, 1);
same('complement of red is cyan', hsvToHex(redComplement.h, redComplement.s, redComplement.v), '#00ffff');
const greenComplement = complementHsv(120, 1, 1);
same('complement of green is magenta', hsvToHex(greenComplement.h, greenComplement.s, greenComplement.v), '#ff00ff');
const greyComplement = complementHsv(210, 0, 0.2);
same('greys keep their hue slot', greyComplement.h, 210);
near('greys flip their lightness instead', greyComplement.v, 0.8, 0.001);

console.log('colour wheel hit testing');

const geo = wheelGeometry();
same('wheel size', geo.size, 184);
same('wheel inner radius', geo.inner, 73);
same('wheel square side', geo.side, 86);
same('wheel square left edge', geo.left, 49);

const middleHit = wheelHitTest(geo.centre, geo.centre);
same('the centre is the saturation square', middleHit.mode, 'sv');
near('the centre is half saturation', (middleHit.x - geo.left) / geo.side, 0.5, 0.001);
near('the centre is half value', 1 - (middleHit.y - geo.top) / geo.side, 0.5, 0.001);

const cornerHit = wheelHitTest(geo.left, geo.top);
same('the square corner stays saturation/value', cornerHit.mode, 'sv');
near('the top-left corner is zero saturation', (cornerHit.x - geo.left) / geo.side, 0, 0.001);
near('the top-left corner is full value', 1 - (cornerHit.y - geo.top) / geo.side, 1, 0.001);

const overCornerHit = wheelHitTest(geo.left - 4, geo.top - 4);
same('pointer just past a corner keeps the square mode', overCornerHit.mode, 'sv');
near('past the corner clamps to zero saturation', (overCornerHit.x - geo.left) / geo.side, 0, 0.001);

const ringTopHit = wheelHitTest(geo.centre, geo.centre - 82);
same('the hue ring is reachable above the square', ringTopHit.mode, 'hue');
near('the ring above is hue -90 degrees', (ringTopHit.angle * 180) / Math.PI, -90, 0.001);

const ringRightHit = wheelHitTest(geo.centre + 84, geo.centre);
same('the hue ring is reachable right of the square', ringRightHit.mode, 'hue');
near('the ring on the right is hue 0', ringRightHit.angle, 0, 0.001);

const ringDiagonalHit = wheelHitTest(geo.centre + 60, geo.centre - 60);
same('the hue ring is reachable on the diagonal', ringDiagonalHit.mode, 'hue');

const gapHit = wheelHitTest(geo.centre, geo.centre - (geo.inner - 6));
same('the gap just inside the ring still uses the square', gapHit.mode, 'sv');
near('the gap clamps to full value', 1 - (gapHit.y - geo.top) / geo.side, 1, 0.001);

console.log('palette edits never repaint the canvas');

const paletteApi = windowStub.__PXS_TEST__.palette;
if (!paletteApi) {
    console.error('FAIL: window.__PXS_TEST__.palette hook is missing');
    process.exit(1);
}
const { detachSlot, recolourSlot, slotInUse, chars } = paletteApi;

function artDoc(rows, colours) {
    return {
        w: rows[0].length,
        h: rows.length,
        palette: colours.slice(),
        layers: [{ name: 'base', visible: true, rows: rows.slice() }],
    };
}

/** What the canvas actually shows, cell by cell, as colours instead of chars. */
function canvasColours(doc) {
    return doc.layers[0].rows.map((row) => row.split('').map((ch) => {
        if (ch === '.') return null;
        const slot = chars.indexOf(ch);
        const colour = slot >= 0 && slot < doc.palette.length ? doc.palette[slot] : 'missing';
        return colour.toLowerCase();
    }));
}

const pixelDoc = artDoc(['00.', '.00'], ['#ff0000', '#00ff00', '#0000ff']);
same('a painted slot counts as in use', slotInUse(pixelDoc, 0), true);
same('an empty slot counts as unused', slotInUse(pixelDoc, 2), false);

const detached = detachSlot(pixelDoc, 0);
same('detach parks the pixels on the first free slot', detached.target, 1);
same('the free slot takes over the old colour', detached.doc.palette[1], '#ff0000');
same('the pixels now point at the new slot', detached.doc.layers[0].rows, ['11.', '.11']);
same('detach leaves the source document alone', pixelDoc.layers[0].rows, ['00.', '.00']);

const untouched = detachSlot(pixelDoc, 2);
same('detaching an unused slot is a no-op', untouched.target, -1);
truthy('an unused slot keeps the document object', untouched.doc === pixelDoc);

const accepted = recolourSlot(pixelDoc, 0, '#123456');
truthy('recolouring a painted slot is allowed', !accepted.error);
same('the edited slot takes the new colour', accepted.doc.palette[0], '#123456');
same('recolouring moves the pixels off the edited slot', accepted.movedTo, 1);
same('the canvas looks exactly the same afterwards', canvasColours(accepted.doc), canvasColours(pixelDoc));
truthy('recolouring keeps the palette size', accepted.doc.palette.length === pixelDoc.palette.length);

const again = recolourSlot(accepted.doc, 0, '#abcdef');
same('a second edit of the same slot needs no move', again.movedTo, -1);
same('a second edit keeps the canvas identical', canvasColours(again.doc), canvasColours(pixelDoc));

const duplicateDoc = artDoc(['0..'], ['#ff0000', '#00ff00', '#ff0000']);
const reused = recolourSlot(duplicateDoc, 0, '#000000');
same('a slot that already holds the colour is preferred', reused.movedTo, 2);
same('reuse does not grow the palette', reused.doc.palette.length, 3);
same('reuse leaves the canvas alone', canvasColours(reused.doc), canvasColours(duplicateDoc));

let fullRows = '';
for (let i = 0; i < chars.length; i += 1) fullRows += chars[i];
const fullDoc = artDoc([fullRows], Array.from({ length: chars.length }, (_v, i) => `#${(i * 7 % 256).toString(16).padStart(2, '0')}0000`));
same('a palette with every slot painted is refused', JSON.stringify(recolourSlot(fullDoc, 0, '#123456')), JSON.stringify({ error: 'full' }));
same('the refused edit leaves the document untouched', fullDoc.palette[0], '#000000');
same('recolouring the same colour is a no-op', recolourSlot(pixelDoc, 0, '#ff0000').error, 'same');
same('bad hex is rejected', recolourSlot(pixelDoc, 0, 'red').error, 'colour');
same('out-of-range slots are rejected', recolourSlot(pixelDoc, 9, '#123456').error, 'index');

console.log('shell width handle sweep');

const handlesApi = windowStub.__PXS_TEST__.handles;
if (!handlesApi) {
    console.error('FAIL: window.__PXS_TEST__.handles hook is missing');
    process.exit(1);
}
const { hideShellHandles, restoreShellHandles, selector } = handlesApi;

same('the sweep matches the width handle hooks', selector, '[data-width-handle], [class*="widthHandle"]');

const makeNode = (className, display) => ({ style: { display }, className });
const leftHandle = makeNode('an3WzG_widthHandle', '');
const rightHandle = makeNode('an3WzG_widthHandle', '');
const splitters = [makeNode('pxs-splitter', ''), makeNode('pxs-splitter', '')];
const studioRoot = { contains: (element) => splitters.indexOf(element) >= 0 };
const shellBody = {
    querySelectorAll: (query) => (query === selector ? [leftHandle, rightHandle, ...splitters] : []),
};
const hiddenNodes = new Map();
same('both shell handles are hidden', hideShellHandles(studioRoot, shellBody, hiddenNodes, null), 2);
same('the left handle is display:none', leftHandle.style.display, 'none');
same('the right handle is display:none', rightHandle.style.display, 'none');
same('studio splitters are never touched', splitters[1].style.display, '');
same('every hidden node is recorded once', hiddenNodes.size, 2);
restoreShellHandles(hiddenNodes);
same('restoring brings the handles back', [leftHandle.style.display, rightHandle.style.display], ['', '']);
same('restoring clears the bookkeeping', hiddenNodes.size, 0);

// Fallback: nothing carries the hashed class, so the sweep inspects computed
// styles and only picks absolutely positioned col-resize strips.
const plainNode = makeNode('chat-column', '');
const mysteryNode = makeNode('mystery-box', '');
const fallbackBody = {
    querySelectorAll: (query) => (query === selector ? [] : [plainNode, mysteryNode]),
};
const fallbackHidden = new Map();
const computedStyle = (element) => (element === mysteryNode
    ? { cursor: 'col-resize', position: 'absolute' }
    : { cursor: 'auto', position: 'static' });
same('the computed-style fallback finds the handle', hideShellHandles(null, fallbackBody, fallbackHidden, computedStyle), 1);
same('the fallback hides the strip', mysteryNode.style.display, 'none');

const staticStrip = makeNode('static-strip', '');
const staticBody = { querySelectorAll: (query) => (query === selector ? [] : [staticStrip]) };
same('a statically placed col-resize strip is ignored',
    hideShellHandles(null, staticBody, new Map(), () => ({ cursor: 'col-resize', position: 'static' })), 0);
same('the ignored strip keeps its display', staticStrip.style.display, '');

const bareBody = { appendChild() {}, removeChild() {} };
same('a document without querySelectorAll is tolerated', hideShellHandles(null, bareBody, new Map(), null), 0);

console.log('shell composer sweep');

const { hideShellComposer, composerSelector } = handlesApi;
same('the composer sweep matches the seat hooks', composerSelector,
    '[data-composer-seat], [data-conversation-region="composer"]');

const seat = makeNode('an3WzG_composerSeat', 'flex');
const studioInner = makeNode('pxs-root', 'flex');
const composerBody = {
    querySelectorAll: (query) => (query === composerSelector ? [seat, studioInner] : []),
};
const hiddenSeats = new Map();
const composerRoot = { contains: (element) => element === studioInner };
same('the composer seat is hidden', hideShellComposer(composerRoot, composerBody, hiddenSeats), 1);
same('the seat loses its display', seat.style.display, 'none');
same('the studio root is never hidden by the composer sweep', studioInner.style.display, 'flex');
same('the original display is remembered', hiddenSeats.get(seat), 'flex');
same('a second sweep is a no-op', hideShellComposer(composerRoot, composerBody, hiddenSeats), 0);
restoreShellHandles(hiddenSeats);
same('restoring the composer brings back its display', seat.style.display, 'flex');
same('the composer bookkeeping is cleared', hiddenSeats.size, 0);
same('a document without querySelectorAll is tolerated by the composer sweep',
    hideShellComposer(null, bareBody, new Map()), 0);

console.log('palette document interchange');

const { parsePaletteDocument, mergePalettes, trimRowsToPalette, maxColors } = paletteApi;

same('a palette holds 256 slots', maxColors, 256);
same('the character table has 256 entries', paletteApi.chars.length, 256);
same('the legacy ascii characters still lead the table', paletteApi.chars.slice(0, 36), '0123456789abcdefghijklmnopqrstuvwxyz');

function thrownMessage(fn) {
    try {
        fn();
        return '';
    } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
    }
}

same('a plain array file is parsed and cleaned',
    parsePaletteDocument('["#FF0000","#00ff00","#00FF00","bogus","#12345"]'),
    ['#ff0000', '#00ff00']);
same('a wrapped colors file is parsed',
    parsePaletteDocument('{"colors":["#AbCdEf"]}'),
    ['#abcdef']);
same('invalid json is rejected',
    thrownMessage(() => parsePaletteDocument('{"colors":[')).startsWith('不是有效的 JSON 文件（支持 JSON、.gpl、.pal）'),
    true);
same('the rejected file shows its opening text',
    thrownMessage(() => parsePaletteDocument('garbage')).includes('文件开头是「garbage」'),
    true);
same('an empty file is rejected',
    thrownMessage(() => parsePaletteDocument('   ')),
    '文件是空的');
same('a file without colors is rejected',
    thrownMessage(() => parsePaletteDocument('{"name":"x"}')),
    '缺少 colors 数组');
same('a file without usable colors is rejected',
    thrownMessage(() => parsePaletteDocument('["red","blue"]')),
    '文件里没有找到颜色（支持 #rrggbb、#rgb、rgb(r,g,b)）');
same('a byte order mark is ignored',
    parsePaletteDocument('\uFEFF["#fff"]'),
    ['#ffffff']);
same('short hex is expanded',
    parsePaletteDocument('["#abc"]'),
    ['#aabbcc']);
same('eight digit hex drops its alpha',
    parsePaletteDocument('["#ff0000ff"]'),
    ['#ff0000']);
same('rgb() text is understood',
    parsePaletteDocument('["rgb(1,2,3)"]'),
    ['#010203']);
same('numbers are understood',
    parsePaletteDocument('[16711680]'),
    ['#ff0000']);
same('an object map of colours is understood',
    parsePaletteDocument('{"colors":{"a":"#fff","b":"#000"}}'),
    ['#ffffff', '#000000']);
same('a gimp palette is understood',
    parsePaletteDocument('GIMP Palette\nName: demo\nColumns: 2\n#\n255 0 0\tred\n  0 255 0\tgreen'),
    ['#ff0000', '#00ff00']);
same('a jasc palette is understood',
    parsePaletteDocument('JASC-PAL\r\n0100\r\n2\r\n0 0 255\r\n255 255 0'),
    ['#0000ff', '#ffff00']);
same('colours are scraped out of loose text',
    parsePaletteDocument('my palette #ff0000 and #00ff00 plus #000'),
    ['#ff0000', '#00ff00', '#000000']);
same('an image file is rejected with a clear message',
    thrownMessage(() => parsePaletteDocument('\uFFFD' + 'PNG\r\n\u001a\n\u0000')).startsWith('这是图片文件'),
    true);
same('the exported document round trips',
    parsePaletteDocument(JSON.stringify({ format: 'dsh-pixel-studio-palette', version: 1, name: '作品 6', colors: ['#000000', '#1d2b53', '#7e2553'] })),
    ['#000000', '#1d2b53', '#7e2553']);
same('oversized palettes are truncated to the limit',
    parsePaletteDocument(JSON.stringify(Array.from({ length: 300 }, (_, i) => `#${String(i % 1000).padStart(3, '0')}000`.slice(0, 7)))).length,
    256);

const mergedSmall = mergePalettes(['#111111'], ['#111111', '#222222'], 4);
same('merging skips colours already present', mergedSmall.palette, ['#111111', '#222222']);
same('merging reports how many colours were added', mergedSmall.added, 1);
same('merging reports nothing skipped while there is room', mergedSmall.skipped, 0);

const mergedFull = mergePalettes(['#111111', '#222222'], ['#333333', '#444444', '#555555'], 3);
same('merging stops at the limit', mergedFull.palette, ['#111111', '#222222', '#333333']);
same('merging counts the colours over the limit', mergedFull.skipped, 2);

const trimmed = trimRowsToPalette([{ name: 'a', visible: true, rows: ['001', '110'] }], 1);
same('trimming clears cells beyond the palette', trimmed[0].rows, ['00.', '..0']);
same('trimming leaves shorter palettes alone',
    trimRowsToPalette([{ name: 'a', visible: true, rows: ['012'] }], 8)[0].rows[0],
    '012');

if (failures > 0) {
    console.error(`FAIL: ${failures} selection assertion(s) failed`);
    process.exit(1);
}
console.log('PASS: selection helpers behave');
