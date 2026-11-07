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

if (failures > 0) {
    console.error(`FAIL: ${failures} selection assertion(s) failed`);
    process.exit(1);
}
console.log('PASS: selection helpers behave');
