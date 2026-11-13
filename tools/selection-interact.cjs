/**
 * Selection interaction harness for the Pixel Studio client module.
 *
 * render-smoke.cjs proves the first render; interact-smoke.cjs drives dialog and
 * palette flows. This harness drives the *canvas pointer* flows of the selection
 * tool (create / move frame / carry pixels / mirror / fill / delete) against a
 * stateful mini-React plus a fake Host, so wiring bugs in the new selection code
 * show up without a browser.
 *
 * Geometry: the fake stage is 200×200 CSS pixels, the document is 8×8, so
 * fitToView() picks scale 16 and pan 36. cell(client) = floor((client - 36) / 16),
 * therefore cellCentre(n) = 36 + n * 16 + 8.
 *
 * Usage: node selection-interact.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT = path.resolve(__dirname, '..', 'client.js');

const STAGE_SIZE = 200;
const CELL = 16;
const PAN = 36;

/* -------------------------------------------------------------------------- */
/* browser + host stubs                                                       */
/* -------------------------------------------------------------------------- */

const storage = new Map();
const queue = [];
const listeners = new Map();

function makeContext(rects) {
    return {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: () => {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        setTransform: () => {},
        translate: () => {},
        scale: () => {},
        drawImage: () => {},
        clearRect: () => {},
        fillRect: () => {},
        strokeRect: (x, y, w, h) => {
            if (Array.isArray(rects)) rects.push({ x, y, w, h });
        },
        beginPath: () => {},
        rect: () => {},
        clip: () => {},
        save: () => {},
        restore: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        fill: () => {},
        stroke: () => {},
        globalAlpha: 1,
        setLineDash: () => {},
        lineDashOffset: 0,
        imageSmoothingEnabled: true,
        set lineWidth(_value) {},
        set strokeStyle(_value) {},
        set fillStyle(_value) {},
    };
}

function makeCanvas() {
    // The last strokeRect of a paint pass is the artwork border: its position is
    // what the zoom/centre checks read to confirm the canvas sits where expected.
    const rects = [];
    const context = makeContext(rects);
    return {
        __rects: rects,
        tagName: 'CANVAS',
        width: 300,
        height: 150,
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        getContext: () => context,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: stageSize.width, height: stageSize.height }),
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        removeChild: () => {},
    };
}

const stageListeners = new Map();

const stageSize = { width: STAGE_SIZE, height: STAGE_SIZE };
const resizeObservers = [];

const stageElement = {
    tagName: 'DIV',
    style: {},
    get clientWidth() { return stageSize.width; },
    get clientHeight() { return stageSize.height; },
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: stageSize.width, height: stageSize.height }),
    addEventListener: (type, handler) => {
        if (!stageListeners.has(type)) stageListeners.set(type, []);
        stageListeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
        const list = stageListeners.get(type) || [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
    },
    appendChild: () => {},
    removeChild: () => {},
};

const windowStub = {
    devicePixelRatio: 1,
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    requestAnimationFrame: (fn) => {
        queue.push(() => fn(0));
        return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, delay) => {
        // Debounced work (save) must run; long housekeeping timers (notice
        // auto-clear after 6s) are dropped so the text stays observable.
        if (typeof delay === 'number' && delay > 1500) return -1;
        queue.push(fn);
        return 1;
    },
    clearTimeout: () => {},
    addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
        const set = listeners.get(type);
        if (set) set.delete(fn);
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    location: { reload: () => {} },
    confirm: () => true,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
};

const documentStub = {
    createElement: (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas() : {
        tagName: String(tag).toUpperCase(),
        style: {},
        classList: { add: () => {}, remove: () => {} },
        width: 0,
        height: 0,
        getContext: () => makeContext(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: STAGE_SIZE, height: STAGE_SIZE }),
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {},
        removeChild: () => {},
    }),
    addEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {} },
};

/* -------------------------------------------------------------------------- */
/* fake host API                                                              */
/* -------------------------------------------------------------------------- */

const palette = ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060', '#707070', '#808080'];

const state = {
    docs: [
        {
            id: 'doc1',
            name: '选区测试',
            w: 8,
            h: 8,
            filePath: null,
            palette: palette.slice(),
            layers: [
                {
                    name: '图层 1',
                    visible: true,
                    rows: ['........', '.0......', '........', '........', '........', '........', '........', '........'],
                },
            ],
        },
    ],
};

function summarize(doc) {
    return {
        id: doc.id,
        name: doc.name,
        w: doc.w,
        h: doc.h,
        filePath: doc.filePath || null,
        colors: doc.palette.length,
        layers: doc.layers.length,
        savedAt: 1,
    };
}

const fetchStub = (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const reply = (payload) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
    switch (body.op) {
        case 'list':
            return reply({ ok: true, docs: state.docs.map(summarize) });
        case 'get': {
            const doc = state.docs.find((entry) => entry.id === body.id);
            return reply(doc ? { ok: true, doc } : { ok: false, error: 'not-found' });
        }
        case 'save': {
            const incoming = body.doc || {};
            const existing = state.docs.find((entry) => entry.id === incoming.id);
            if (!existing) return reply({ ok: false, error: 'not-found' });
            Object.assign(existing, {
                name: incoming.name || existing.name,
                palette: (incoming.palette || existing.palette).slice(),
                layers: (incoming.layers || existing.layers).map((layer) => ({ ...layer, rows: layer.rows.slice() })),
                w: incoming.w || existing.w,
                h: incoming.h || existing.h,
                filePath: incoming.filePath === undefined ? existing.filePath : incoming.filePath,
            });
            return reply({ ok: true, doc: existing, savedAt: 2 });
        }
        case 'sessionDir':
            return reply({ ok: true, path: 'D:\\fake\\session' });
        case 'exportTo':
            return reply({ ok: true, path: `${body.path}.png`, width: 8, height: 8, bytes: 90, overwritten: false });
        default:
            return reply({ ok: false, error: 'unknown-op', message: body.op });
    }
};

/* -------------------------------------------------------------------------- */
/* stateful react stub                                                        */
/* -------------------------------------------------------------------------- */

const react = {
    createElement(type, props, ...children) {
        return { type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } };
    },
    Fragment: 'Fragment',
};

let hooks = [];
let hookIndex = 0;
let effects = [];
let dirty = false;
let renderCap = 0;

function scheduleDirty() {
    dirty = true;
}

react.useState = (initial) => {
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
    const set = (value) => {
        const next = typeof value === 'function' ? value(hooks[slot]) : value;
        if (next !== hooks[slot]) {
            hooks[slot] = next;
            scheduleDirty();
        }
    };
    return [hooks[slot], set];
};

react.useRef = (initial) => {
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in hooks)) hooks[slot] = { current: initial };
    return hooks[slot];
};

react.useMemo = (factory) => factory();

react.useCallback = (fn, deps) => {
    const slot = hookIndex;
    hookIndex += 1;
    const previous = hooks[slot];
    if (previous && deps && sameDeps(previous.deps, deps)) return previous.fn;
    hooks[slot] = { fn, deps };
    return fn;
};

function sameDeps(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((entry, index) => Object.is(entry, b[index]));
}

react.useEffect = (fn, deps) => {
    const slot = hookIndex;
    hookIndex += 1;
    effects.push({ slot, fn, deps });
};

react.useLayoutEffect = react.useEffect;
react.useImperativeHandle = () => {};
react.createContext = (value) => ({ Provider: 'Provider', Consumer: 'Consumer', _value: value });
react.useContext = (context) => context && context._value;
react.memo = (component) => component;
react.forwardRef = (render) => render;
react.Component = class Component {
    constructor(props) {
        this.props = props;
        this.state = {};
    }

    setState(update) {
        this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) };
    }
};

const effectState = new Map();

let Component = null;
let tree = null;

function renderOnce() {
    hookIndex = 0;
    effects = [];
    renderCap += 1;
    if (renderCap > 400) throw new Error('render loop exceeded 400 passes');
    tree = Component({ sessionId: 'session-test' });
}

function flushEffects() {
    for (const effect of effects) {
        const previous = effectState.get(effect.slot);
        if (previous && sameDeps(previous.deps, effect.deps)) continue;
        if (previous && typeof previous.cleanup === 'function') previous.cleanup();
        const cleanup = effect.fn();
        effectState.set(effect.slot, { deps: effect.deps, cleanup });
    }
}

async function pump(label) {
    let idlePasses = 0;
    for (let pass = 0; pass < 120; pass += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        const work = queue.splice(0, queue.length);
        if (work.length > 0) idlePasses = 0;
        for (const task of work) {
            try {
                task();
            } catch (error) {
                throw new Error(`${label}: queued work threw — ${error && error.message}`);
            }
        }
        flushEffects();
        if (dirty) {
            renderOnce();
            dirty = false;
            idlePasses = 0;
            continue;
        }
        idlePasses += 1;
        if (idlePasses >= 3 && work.length === 0) return;
    }
    throw new Error(`${label}: pump did not settle`);
}

/* -------------------------------------------------------------------------- */
/* tree helpers                                                               */
/* -------------------------------------------------------------------------- */

function childrenOf(node) {
    const value = node && node.props ? node.props.children : null;
    return flatten(value);
}

function flatten(value, out = []) {
    if (Array.isArray(value)) {
        for (const entry of value) flatten(entry, out);
        return out;
    }
    if (value === undefined || value === null || value === false || value === true) return out;
    out.push(value);
    return out;
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (!node.props) return;
    visit(node);
    for (const child of childrenOf(node)) walk(child, visit);
}

function textOf(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    return childrenOf(node).map(textOf).join('');
}

function findAll(predicate) {
    const found = [];
    walk(tree, (node) => {
        if (predicate(node)) found.push(node);
    });
    return found;
}

function byClass(name) {
    return findAll((node) => typeof node.props.className === 'string'
        && node.props.className.split(/\s+/).includes(name));
}

function byText(text, tag) {
    return findAll((node) => (!tag || node.type === tag) && textOf(node).trim() === text);
}

/* -------------------------------------------------------------------------- */
/* geometry + input helpers                                                   */
/* -------------------------------------------------------------------------- */

function cellCentre(index) {
    return PAN + index * CELL + CELL / 2;
}

function attachRefs() {
    const canvas = byClass('pxs-canvas')[0];
    const stage = byClass('pxs-stage')[0];
    if (!canvas || !stage) throw new Error('canvas/stage node missing');
    canvas.props.ref.current = makeCanvas();
    stage.props.ref.current = stageElement;
}

function pointer(type, cellX, cellY, extra = {}) {
    const canvas = byClass('pxs-canvas')[0];
    const handler = canvas && canvas.props[type];
    if (typeof handler !== 'function') throw new Error(`canvas has no ${type}`);
    const event = {
        pointerId: 1,
        button: 0,
        clientX: cellCentre(cellX),
        clientY: cellCentre(cellY),
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        ...extra,
    };
    event.currentTarget = canvas.props.ref.current;
    handler(event);
}

function key(name, extra = {}) {
    const set = listeners.get('keydown');
    if (!set) throw new Error('keydown listener not registered');
    const event = {
        key: name,
        code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: () => {},
        ...extra,
    };
    for (const handler of [...set]) handler(event);
}

function wheel(deltaY, extra = {}) {
    const set = stageListeners.get('wheel');
    if (!set || set.length === 0) throw new Error('wheel listener not registered');
    const event = {
        deltaY,
        deltaMode: 0,
        clientX: STAGE_SIZE / 2,
        clientY: STAGE_SIZE / 2,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...extra,
    };
    event.currentTarget = stageElement;
    for (const handler of [...set]) handler(event);
}

function zoomLabel() {
    const node = byClass('pxs-hex').find((entry) => /^\d+(?:\.\d+)?×$/.test(textOf(entry).trim()));
    return node ? textOf(node).trim() : null;
}

function artRect() {
    const canvas = byClass('pxs-canvas')[0];
    const rects = canvas && canvas.props.ref.current && canvas.props.ref.current.__rects;
    return rects && rects.length > 0 ? rects[rects.length - 1] : null;
}

function artCentre() {
    const rect = artRect();
    if (!rect) return null;
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

// Pointer coordinates derived from the artwork rect, so the helpers keep working
// after the stage has been resized (cellCentre relies on the initial fit constants).
function pointerAt(type, cellX, cellY, extra = {}) {
    const rect = artRect();
    const doc = state.docs[0];
    if (!rect || !doc) throw new Error('artwork rect missing');
    const px = rect.x + (cellX + 0.5) * rect.w / doc.w;
    const py = rect.y + (cellY + 0.5) * rect.h / doc.h;
    return pointer(type, (px - PAN - CELL / 2) / CELL, (py - PAN - CELL / 2) / CELL, extra);
}

function resizeStage(width, height) {
    stageSize.width = width;
    stageSize.height = height;
    for (const observer of [...resizeObservers]) {
        if (typeof observer.callback === 'function') observer.callback([{ target: stageElement }], observer);
    }
}

function noticeText() {
    const node = byClass('pxs-notice')[0];
    return node ? String(node.props.title || '') : '';
}

function selectionLabel() {
    const label = byClass('pxs-selection-label')[0];
    return label ? textOf(label).trim() : null;
}

function rows() {
    return state.docs[0].layers[0].rows.slice();
}

function rowAt(x, y) {
    return rows()[y][x];
}

/* -------------------------------------------------------------------------- */
/* run                                                                        */
/* -------------------------------------------------------------------------- */

let failures = 0;
function check(labelValue, condition, detail) {
    if (condition) {
        console.log(`  ok   ${labelValue}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${labelValue}${detail === undefined ? '' : ` — ${detail}`}`);
}

function loadModule() {
    let definition = null;
    windowStub.__ModuleLoader__ = { load: (def) => { definition = def; } };
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        HTMLElement: class {},
        ResizeObserver: class {
            constructor(callback) {
                this.callback = callback;
                resizeObservers.push(this);
            }
            observe() {}
            disconnect() {
                const index = resizeObservers.indexOf(this);
                if (index >= 0) resizeObservers.splice(index, 1);
            }
        },
        fetch: fetchStub,
        setTimeout: windowStub.setTimeout,
        clearTimeout: windowStub.clearTimeout,
        requestAnimationFrame: windowStub.requestAnimationFrame,
        cancelAnimationFrame: windowStub.cancelAnimationFrame,
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
        Map,
        Set,
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: CLIENT });
    return definition;
}

(async () => {
    const definition = loadModule();
    if (!definition) {
        console.error('FAIL: client.js never called window.__ModuleLoader__.load');
        process.exit(1);
    }

    const clientModule = definition.factory((name) => {
        if (name === 'react') return react;
        throw new Error(`unexpected require(${name})`);
    });

    let registered = null;
    clientModule.apply({
        slots: {
            inject: (name, factory) => factory(),
            register: (meta, component) => {
                registered = { meta, component };
                return () => {};
            },
        },
    });

    const Boundary = registered.component;
    const boundaryInstance = new Boundary({ sessionId: 'session-test' });
    boundaryInstance.setState = (update) => {
        boundaryInstance.state = {
            ...boundaryInstance.state,
            ...(typeof update === 'function' ? update(boundaryInstance.state) : update),
        };
    };
    const innerElement = boundaryInstance.render();
    Component = innerElement.type;

    renderOnce();
    await pump('mount');

    attachRefs();
    // React mounts refs before effects, but this harness attaches them afterwards;
    // clean up the effects that ran without a stage, then let them mount again so
    // wheel/observer listeners bind to the real stage like they would in a browser.
    for (const entry of effectState.values()) {
        if (entry && typeof entry.cleanup === 'function') entry.cleanup();
    }
    effectState.clear();
    await pump('refs');

    // Fit the view now that the stage has a size (8×8 doc → scale 16, pan 36).
    const fitButton = byText('适应').find((node) => node.type === 'button');
    check('fit-to-view button exists', Boolean(fitButton));
    if (fitButton) fitButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fit');

    // Pick the selection tool exactly like a user does.
    const selectTool = findAll((node) => node.type === 'button'
        && typeof node.props.title === 'string'
        && node.props.title.startsWith('选区'))[0];
    check('selection tool button exists', Boolean(selectTool));
    if (selectTool) selectTool.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('select-tool');

    /* 1. drag a rectangle ------------------------------------------------ */
    pointer('onPointerDown', 1, 1);
    pointer('onPointerMove', 3, 3);
    pointer('onPointerUp', 3, 3);
    await pump('create-selection');
    check('drag creates a 3×3 selection at 1,1', selectionLabel() === '3×3 @ 1,1', selectionLabel());

    /* 2. dragging inside slides the frame, not the pixels ---------------- */
    pointer('onPointerDown', 2, 2);
    pointer('onPointerMove', 4, 4);
    pointer('onPointerUp', 4, 4);
    await pump('move-frame');
    check('dragging inside moves the frame', selectionLabel() === '3×3 @ 3,3', selectionLabel());
    check('frame-only drag leaves the pixel in place', rowAt(1, 1) === '0', rows()[1]);

    /* 3. Shift+drag carries the pixels ----------------------------------- */
    pointer('onPointerDown', 1, 1);
    pointer('onPointerMove', 2, 1);
    pointer('onPointerUp', 2, 1);
    await pump('reselect');
    check('second drag selects 2×1 at 1,1', selectionLabel() === '2×1 @ 1,1', selectionLabel());
    pointer('onPointerDown', 1, 1, { shiftKey: true });
    pointer('onPointerMove', 5, 5, { shiftKey: true });
    pointer('onPointerUp', 5, 5, { shiftKey: true });
    await pump('carry');
    check('shift+drag lands the pixels at 5,5', rowAt(5, 5) === '0', rows()[5]);
    check('shift+drag clears the source pixel', rowAt(1, 1) === '.', rows()[1]);

    /* 4. delete the carried pixel, then fill / mirror --------------------- */
    key('Delete');
    await pump('delete');
    check('Delete empties the selected cell', rowAt(5, 5) === '.', rows()[5]);

    key('a', { metaKey: true });
    await pump('select-all');
    check('Ctrl+A selects the whole canvas', selectionLabel() === '8×8 @ 0,0', selectionLabel());
    key('f', { shiftKey: true });
    await pump('fill');
    check('Shift+F fills the whole canvas', rows()[0] === '00000000', rows()[0]);
    key('h', { shiftKey: true });
    await pump('mirror');
    check('Shift+H keeps a uniform fill unchanged', rows()[0] === '00000000', rows()[0]);

    /* 5. Esc clears the selection ---------------------------------------- */
    key('Escape');
    await pump('escape');
    check('Esc clears the selection', selectionLabel() === null, selectionLabel());

    /* 6. copy / paste moves pixels through the clipboard ------------------- */
    pointer('onPointerDown', 0, 0);
    pointer('onPointerMove', 1, 0);
    pointer('onPointerUp', 1, 0);
    await pump('clip-select');
    check('can select a 2×1 block at 0,0', selectionLabel() === '2×1 @ 0,0', selectionLabel());
    key('c', { metaKey: true });
    await pump('copy');
    check('Ctrl+C reports the copied size', noticeText().includes('已复制'), noticeText());

    pointer('onPointerDown', 0, 0);
    pointer('onPointerMove', 4, 4);
    pointer('onPointerUp', 4, 4);
    await pump('clip-move');
    check('the frame can be parked at 4,4', selectionLabel() === '2×1 @ 4,4', selectionLabel());
    key('v', { metaKey: true });
    await pump('paste');
    check('Ctrl+V writes the clipboard at the frame', rowAt(4, 4) === '0' && rowAt(5, 4) === '0', rows()[4]);
    check('Ctrl+V reports the paste', noticeText().includes('已粘贴'), noticeText());

    /* 7. cut keeps the pixels visible until they are landed ----------------- */
    key('x', { metaKey: true });
    await pump('cut');
    check('Ctrl+X reports the cut', noticeText().includes('已剪切'), noticeText());
    check('Ctrl+X keeps the pixels on the canvas', rows()[4] === '00000000' && selectionLabel() !== null, `${rows()[4]} · ${selectionLabel()}`);
    check('the cut block is floating', selectionLabel() === '2×1 @ 4,4', selectionLabel());
    key('ArrowRight');
    key('ArrowRight');
    await pump('nudge-cut');
    check('the floating block follows the frame', selectionLabel() === '2×1 @ 6,4', selectionLabel());
    const finishButton = byText('✓ 完成').find((node) => node.type === 'button');
    check('the 完成 button exists', Boolean(finishButton));
    if (finishButton) finishButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('finish-cut');
    check('完成 lands the cut pixels at their new home', rows()[4] === '0000..00', rows()[4]);
    check('完成 ends the selection', selectionLabel() === null, selectionLabel());

    /* 8. undo brings the lifted pixels back ---------------------------------- */
    key('z', { metaKey: true });
    await pump('undo');
    check('undo clears the stale selection', selectionLabel() === null, selectionLabel());
    check('undo restores the pre-cut rows', rows()[4] === '00000000', rows()[4]);

    /* 9. a wheel event in the middle of a drag must not zoom ------------------------------------------------------------------ */
    const zoomBefore = zoomLabel();
    pointer('onPointerDown', 2, 2);
    await pump('drag-begin');
    wheel(-120);
    wheel(-120, { shiftKey: true });
    await pump('drag-wheel');
    check('wheel during a drag keeps the zoom', zoomLabel() === zoomBefore, `${zoomBefore} → ${zoomLabel()}`);
    check('wheel during a drag keeps the frame', selectionLabel() === '1×1 @ 2,2', selectionLabel());
    pointer('onPointerUp', 2, 2);
    await pump('drag-end');

    /* 10. a plain wheel still zooms when nothing is dragging --------------- */
    key('Escape');
    await pump('escape-2');
    wheel(-120);
    await pump('plain-wheel');
    check('wheel without a drag still zooms', zoomLabel() !== zoomBefore, `${zoomBefore} → ${zoomLabel()}`);

    /* 11. zooming keeps the artwork centred on the stage -------------------- */
    key('Escape');
    await pump('escape-3');
    fitButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fit-2');
    let rect = artRect();
    check(
        'fit centres the artwork',
        rect !== null
        && Math.abs(rect.x + rect.w / 2 - STAGE_SIZE / 2) <= 1
        && Math.abs(rect.y + rect.h / 2 - STAGE_SIZE / 2) <= 1,
        JSON.stringify(rect),
    );

    const zoomInButton = findAll((node) => node.type === 'button'
        && typeof node.props.title === 'string'
        && node.props.title.startsWith('放大'))[0];
    const zoomOutButton = findAll((node) => node.type === 'button'
        && typeof node.props.title === 'string'
        && node.props.title.startsWith('缩小'))[0];
    check('zoom buttons exist', Boolean(zoomInButton && zoomOutButton));

    if (zoomInButton) zoomInButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('zoom-in');
    const centreAfterZoomIn = artCentre();
    check('zoom in grows around the stage centre', zoomLabel() === '24×', zoomLabel());
    check(
        'zoom in keeps the artwork centred',
        centreAfterZoomIn !== null
        && Math.abs(centreAfterZoomIn.x - STAGE_SIZE / 2) <= 1
        && Math.abs(centreAfterZoomIn.y - STAGE_SIZE / 2) <= 1,
        JSON.stringify(centreAfterZoomIn),
    );

    if (zoomOutButton) zoomOutButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('zoom-out');
    check('zoom out returns to the previous step', zoomLabel() === '16×', zoomLabel());

    /* 12a. the zoom slider reaches fractional levels ------------------------ */
    const zoomRange = byClass('pxs-zoom-range')[0];
    check('the zoom slider exists', Boolean(zoomRange));
    if (zoomRange) {
        check('the slider reflects the current zoom', Number(zoomRange.props.value) === 778, String(zoomRange.props.value));
        zoomRange.props.onChange({ target: { value: 500 } });
        await pump('zoom-range');
        check('the slider reaches a fractional zoom', zoomLabel() === '2.8×', zoomLabel());
        const centreAfterSlider = artCentre();
        check(
            'the slider zooms around the stage centre',
            centreAfterSlider !== null
            && Math.abs(centreAfterSlider.x - STAGE_SIZE / 2) <= 1
            && Math.abs(centreAfterSlider.y - STAGE_SIZE / 2) <= 1,
            JSON.stringify(centreAfterSlider),
        );
        const sliderAfter = byClass('pxs-zoom-range')[0];
        check('the slider follows the applied zoom', Boolean(sliderAfter) && Number(sliderAfter.props.value) === 500, String(sliderAfter && sliderAfter.props.value));
    }

    /* 12. resizing the window keeps the view anchored, fit stays inside ----- */
    resizeStage(320, 240);
    await pump('stage-resize');
    const centreAfterResize = artCentre();
    check(
        'resizing the stage keeps the artwork centred',
        centreAfterResize !== null
        && Math.abs(centreAfterResize.x - 160) <= 1
        && Math.abs(centreAfterResize.y - 120) <= 1,
        JSON.stringify(centreAfterResize),
    );

    fitButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fit-after-resize');
    rect = artRect();
    check(
        'fit after a resize stays inside the stage',
        rect !== null && rect.x >= 0 && rect.y >= 0
        && rect.x + rect.w <= 320 && rect.y + rect.h <= 240,
        JSON.stringify(rect),
    );
    check(
        'fit after a resize is centred',
        rect !== null
        && Math.abs(rect.x + rect.w / 2 - 160) <= 1
        && Math.abs(rect.y + rect.h / 2 - 120) <= 1,
        JSON.stringify(rect),
    );

    /* 13. while the zoom is the fitted one, a resize reframes on its own ---- */
    const refitButton = byText('适应').find((node) => node.type === 'button');
    if (refitButton) refitButton.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fit-before-resize');
    check('fit after the wide stage lands on 24×', zoomLabel() === '24×', zoomLabel());

    resizeStage(400, 300);
    await pump('stage-refit');
    check('resizing at fit zoom reframes the artwork', zoomLabel() === '32×', zoomLabel());
    const refit = artRect();
    check(
        'the reframed artwork is centred in the wider stage',
        refit !== null
        && Math.abs(refit.x + refit.w / 2 - 200) <= 1
        && Math.abs(refit.y + refit.h / 2 - 150) <= 1,
        JSON.stringify(refit),
    );
    check(
        'the reframed artwork still fits the stage',
        refit !== null && refit.x >= 0 && refit.y >= 0
        && refit.x + refit.w <= 400 && refit.y + refit.h <= 300,
        JSON.stringify(refit),
    );

    /* 14. auto-fit off: a resize must leave the canvas size alone ---------- */
    const autoFitOn = byText('自适应开').find((node) => node.type === 'button');
    check('the toolbar offers an auto-fit toggle', Boolean(autoFitOn));
    autoFitOn.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('autofit-off');
    check('the auto-fit toggle flips to 关', byText('自适应关').length > 0);
    const steadyScale = zoomLabel();
    resizeStage(320, 240);
    await pump('stage-resize-manual');
    check('with auto-fit off a resize keeps the zoom', zoomLabel() === steadyScale, `${steadyScale} -> ${zoomLabel()}`);
    const autoFitOff = byText('自适应关').find((node) => node.type === 'button');
    autoFitOff.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('autofit-on');
    check('switching auto-fit back on reframes the artwork', zoomLabel() === '24×', zoomLabel());

    /* 15. nothing but the selection itself may keep it alive -------------- */
    key('m');
    await pump('select-again');
    pointerAt('onPointerDown', 0, 0);
    pointerAt('onPointerMove', 1, 0);
    pointerAt('onPointerUp', 1, 0);
    await pump('selection-before-outside-press');
    check('a 2×1 frame sits at 0,0 before the outside press', selectionLabel() === '2×1 @ 0,0', selectionLabel());

    // A press beside the artwork must end the selection, not extend it to the edge.
    pointerAt('onPointerDown', 8, 3);
    await pump('press-outside');
    check('pressing beside the artwork clears the selection', selectionLabel() === null, selectionLabel());

    pointerAt('onPointerDown', 0, 0);
    pointerAt('onPointerMove', 1, 0);
    pointerAt('onPointerUp', 1, 0);
    await pump('selection-before-swatch');
    check('a 2×1 frame sits at 0,0 before the swatch click', selectionLabel() === '2×1 @ 0,0', selectionLabel());

    // Picking another colour is not part of the selection: it ends it.
    const swatches = byClass('pxs-swatch');
    const otherSwatch = swatches[1];
    check('the palette offers a second swatch', Boolean(otherSwatch));
    if (otherSwatch) {
        otherSwatch.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('swatch-click');
    }
    check('picking another colour ends the selection', selectionLabel() === null, selectionLabel());

    pointerAt('onPointerDown', 0, 0);
    pointerAt('onPointerMove', 1, 0);
    pointerAt('onPointerUp', 1, 0);
    await pump('selection-before-tool');
    check('a 2×1 frame sits at 0,0 before the tool switch', selectionLabel() === '2×1 @ 0,0', selectionLabel());

    // Switching tools is not part of the selection either.
    key('b');
    await pump('tool-switch');
    check('switching to the pencil ends the selection', selectionLabel() === null, selectionLabel());

    /* 16. a stroke stops at the artwork edge ------------------------------ */
    const rowBeforeEdge = rows()[2];
    const rowAfterEdge = rowBeforeEdge.slice(0, 2) + '1' + rowBeforeEdge.slice(3);
    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 20, 2);
    pointerAt('onPointerUp', 20, 2);
    await pump('stroke-leaves-canvas');
    check('the stroke paints where it started', rowAt(2, 2) === '1', rows()[2]);
    check('the stroke does not smear along the edge', rows()[2] === rowAfterEdge, `${rows()[2]} vs ${rowAfterEdge}`);

    /* 17. interrupting a carried selection puts the pixels back ------------ */
    key('m');
    await pump('select-for-carry');
    pointerAt('onPointerDown', 0, 0);
    pointerAt('onPointerMove', 1, 0);
    pointerAt('onPointerUp', 1, 0);
    await pump('carry-select');
    const carriedBefore = rowAt(0, 0);
    pointerAt('onPointerDown', 0, 0, { shiftKey: true });
    await pump('carry-lift');
    key('b');
    await pump('carry-interrupt');
    pointerAt('onPointerUp', 0, 0);
    await pump('carry-release');
    check('interrupting a carried selection clears it', selectionLabel() === null, selectionLabel());
    check('interrupting a carried selection puts the pixels back', rowAt(0, 0) === carriedBefore, `${rowAt(0, 0)} vs ${carriedBefore}`);

    /* 18. shape tools: preview, drag, resize, commit, cancel -------------- */
    const byTitle = (title) => findAll((node) => node.props.title === title);
    const shapeBarCount = () => byClass('pxs-shape-bar').length;
    const shapeLabel = () => {
        if (shapeBarCount() === 0) return null;
        const node = byClass('pxs-shape-bar')[0] && findAll((entry) => typeof entry.props.className === 'string'
            && entry.props.className.split(/\s+/).includes('pxs-selection-label'))[0];
        return node ? textOf(node).trim() : null;
    };

    key('l');
    await pump('shape-line-tool');
    check('the line tool reports itself active', byTitle('直线 (L)').some((node) => node.props['data-active'] === true));

    const blankRows = rows();
    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 6, 2);
    pointerAt('onPointerUp', 6, 2);
    await pump('shape-line-drag');
    check('dragging with the line tool opens the panel', shapeBarCount() === 1);
    check('the panel reports the line size', shapeLabel() === '直线 5×1', shapeLabel());
    check('the preview stays out of the artwork', JSON.stringify(rows()) === JSON.stringify(blankRows));

    key('Escape');
    await pump('shape-escape');
    check('escape drops the preview', shapeBarCount() === 0);
    check('escape leaves the artwork alone', JSON.stringify(rows()) === JSON.stringify(blankRows));

    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 6, 2);
    pointerAt('onPointerUp', 6, 2);
    await pump('shape-line-again');
    const shapeConfirm = byText('✓ 确认', 'button')[0];
    check('the panel offers a confirm button', Boolean(shapeConfirm));
    if (shapeConfirm) {
        shapeConfirm.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('shape-confirm');
    }
    const lineChars = [2, 3, 4, 5, 6].map((x) => rowAt(x, 2));
    check('confirming paints the whole line', lineChars.every((ch) => ch === lineChars[0] && ch !== '.'), lineChars.join(''));
    check('confirming closes the panel', shapeBarCount() === 0);

    key('z', { ctrlKey: true });
    await pump('shape-undo');
    check('one undo removes the shape', JSON.stringify(rows()) === JSON.stringify(blankRows), rows()[2]);

    key('r');
    await pump('shape-rect-tool');
    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 5, 3);
    pointerAt('onPointerUp', 5, 3);
    await pump('shape-rect-drag');
    check('the rectangle panel reports its size', shapeLabel() === '矩形 4×2', shapeLabel());

    pointerAt('onPointerDown', 5, 3);
    pointerAt('onPointerMove', 7, 4);
    pointerAt('onPointerUp', 7, 4);
    await pump('shape-rect-resize');
    check('dragging the corner handle resizes the preview', shapeLabel() === '矩形 6×3', shapeLabel());

    pointerAt('onPointerDown', 30, 2);
    await pump('shape-outside-press');
    check('pressing beside the artwork cancels the preview', shapeBarCount() === 0);

    key('r');
    await pump('shape-rect-again');
    pointerAt('onPointerDown', 1, 1);
    pointerAt('onPointerMove', 6, 3, { shiftKey: true });
    pointerAt('onPointerUp', 6, 3);
    await pump('shape-rect-shift');
    check('shift forces a square', shapeLabel() === '矩形 6×6', shapeLabel());

    key('Escape');
    await pump('shape-final-cleanup');

    /* 19. the fill toggle fills rectangles and ellipses ------------------- */
    key('l');
    await pump('fill-line-tool');
    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 5, 2);
    pointerAt('onPointerUp', 5, 2);
    await pump('fill-line-drag');
    check('a line offers no fill toggle', byText('是否填充', 'button').length === 0);
    key('Escape');
    await pump('fill-line-cancel');

    const hollowRows = rows();
    // Four rows tall, so the two middle rows are interior and not outline.
    key('r');
    await pump('fill-rect-tool');
    pointerAt('onPointerDown', 2, 1);
    pointerAt('onPointerMove', 5, 4);
    pointerAt('onPointerUp', 5, 4);
    await pump('fill-rect-drag');
    const fillToggle = byText('是否填充', 'button')[0];
    check('a rectangle offers a fill toggle', Boolean(fillToggle));
    check('the fill toggle starts off', !fillToggle || fillToggle.props['data-active'] !== true);

    byText('✓ 确认', 'button')[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fill-rect-hollow-commit');
    check('without fill the interior stays empty', rowAt(3, 2) === hollowRows[2][3], rowAt(3, 2));
    check('without fill the outline corners are painted', rowAt(2, 1) !== hollowRows[1][2], rowAt(2, 1));
    key('z', { ctrlKey: true });
    await pump('fill-rect-hollow-undo');
    check('undo removes the hollow rectangle', JSON.stringify(rows()) === JSON.stringify(hollowRows));

    key('r');
    await pump('fill-rect-again');
    pointerAt('onPointerDown', 2, 1);
    pointerAt('onPointerMove', 5, 4);
    pointerAt('onPointerUp', 5, 4);
    await pump('fill-rect-drag-again');
    const fillOn = byText('是否填充', 'button')[0];
    check('the fill toggle is offered again', Boolean(fillOn));
    if (fillOn) {
        fillOn.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('fill-toggled');
    }
    check('clicking fill marks the toggle active', byText('是否填充', 'button')[0].props['data-active'] === true);
    byText('✓ 确认', 'button')[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fill-rect-commit');

    const interior = [[3, 2], [4, 2], [3, 3], [4, 3]].map(([x, y]) => rowAt(x, y));
    check('the filled rectangle has no holes',
        interior.every((ch) => ch === interior[0] && ch !== '.'),
        interior.join(''));
    check('the filled rectangle keeps its outline', rowAt(2, 1) === interior[0] && rowAt(5, 4) === interior[0]);

    key('z', { ctrlKey: true });
    await pump('fill-rect-undo');
    check('undo removes the filled rectangle', JSON.stringify(rows()) === JSON.stringify(hollowRows));

    // An ellipse fills its interior too. Counting the cells painted with the
    // freshly picked pen is independent of whatever the canvas already holds.
    const penSwatch = byClass('pxs-swatch')[2];
    check('a third swatch is available for the ellipse test', Boolean(penSwatch));
    if (penSwatch) {
        penSwatch.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('fill-ellipse-pen');
    }
    let penChar = null;

    const countPen = (x0, y0, x1, y1, pen) => {
        let total = 0;
        for (let y = y0; y <= y1; y += 1) {
            for (let x = x0; x <= x1; x += 1) if (rowAt(x, y) === pen) total += 1;
        }
        return total;
    };
    const drawEllipse = async (label) => {
        key('o');
        await pump(`${label}-tool`);
        pointerAt('onPointerDown', 1, 1);
        pointerAt('onPointerMove', 6, 6);
        pointerAt('onPointerUp', 6, 6);
        await pump(`${label}-drag`);
    };

    await drawEllipse('fill-ellipse-hollow');
    const hollowToggle = byText('是否填充', 'button')[0];
    check('an ellipse offers a fill toggle', Boolean(hollowToggle));
    if (hollowToggle && hollowToggle.props['data-active'] === true) {
        hollowToggle.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('fill-ellipse-hollow-toggled');
    }
    byText('✓ 确认', 'button')[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fill-ellipse-hollow-commit');
    for (let y = 1; y <= 6 && penChar === null; y += 1) {
        for (let x = 1; x <= 6; x += 1) {
            if (rowAt(x, y) !== hollowRows[y][x]) {
                penChar = rowAt(x, y);
                break;
            }
        }
    }
    check('the hollow ellipse paints something', penChar !== null, penChar);
    const hollowOutline = penChar === null ? 0 : countPen(1, 1, 6, 6, penChar);
    check('the hollow ellipse paints its outline', hollowOutline > 0, hollowOutline);
    key('z', { ctrlKey: true });
    await pump('fill-ellipse-hollow-undo');

    await drawEllipse('fill-ellipse-filled');
    const ellipseFill = byText('是否填充', 'button')[0];
    if (ellipseFill && ellipseFill.props['data-active'] !== true) {
        ellipseFill.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('fill-ellipse-toggled');
    }
    byText('✓ 确认', 'button')[0].props.onClick({ preventDefault() {}, stopPropagation() {} });
    await pump('fill-ellipse-commit');
    const filledCells = countPen(1, 1, 6, 6, penChar);
    check('filling the ellipse paints more cells than its outline',
        filledCells > hollowOutline,
        `${hollowOutline} -> ${filledCells}`);
    key('z', { ctrlKey: true });
    await pump('fill-ellipse-undo');
    check('undo removes the filled ellipse', JSON.stringify(rows()) === JSON.stringify(hollowRows));

    /* 20. the fill switch is per tool ------------------------------------ */
    key('r');
    await pump('fill-rect-switch-tool');
    pointerAt('onPointerDown', 2, 1);
    pointerAt('onPointerMove', 5, 4);
    pointerAt('onPointerUp', 5, 4);
    await pump('fill-rect-switch-drag');
    const rectSwitch = byText('是否填充', 'button')[0];
    check('the rectangle remembers its own fill switch',
        Boolean(rectSwitch) && rectSwitch.props['data-active'] === true,
        rectSwitch ? String(rectSwitch.props['data-active']) : 'missing');
    if (rectSwitch) {
        rectSwitch.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump('fill-rect-switch-off');
    }
    const rectSwitchOff = byText('是否填充', 'button')[0];
    check('the fill control is a switch that turns off',
        Boolean(rectSwitchOff) && rectSwitchOff.props['data-active'] === false,
        rectSwitchOff ? String(rectSwitchOff.props['data-active']) : 'missing');
    check('the fill switch answers aria-checked too',
        Boolean(rectSwitchOff) && rectSwitchOff.props['aria-checked'] === false,
        rectSwitchOff ? String(rectSwitchOff.props['aria-checked']) : 'missing');
    key('Escape');
    await pump('fill-rect-switch-cancel');

    key('o');
    await pump('fill-ellipse-switch-tool');
    pointerAt('onPointerDown', 1, 1);
    pointerAt('onPointerMove', 6, 6);
    pointerAt('onPointerUp', 6, 6);
    await pump('fill-ellipse-switch-drag');
    const ellipseSwitch = byText('是否填充', 'button')[0];
    check('turning the rectangle switch off leaves the ellipse alone',
        Boolean(ellipseSwitch) && ellipseSwitch.props['data-active'] === true,
        ellipseSwitch ? String(ellipseSwitch.props['data-active']) : 'missing');
    key('Escape');
    await pump('fill-switch-cleanup');
    check('cancelling a shape leaves the pixels untouched',
        JSON.stringify(rows()) === JSON.stringify(hollowRows));

    /* 21. layers: names, the hidden-layer guard, selection interrupts */

    const byTitleStrict = (title) => findAll((node) => node.props.title === title);
    const clickTitle = async (title, step) => {
        const button = byTitleStrict(title)[0];
        if (!button) throw new Error(`button ${title} missing`);
        button.props.onClick({ preventDefault() {}, stopPropagation() {} });
        await pump(step);
    };
    const layerName = () => {
        const node = byClass('pxs-layer-name')[0];
        return node ? textOf(node).trim() : '';
    };

    await clickTitle('新建图层', 'layer-add-1');
    await clickTitle('新建图层', 'layer-add-2');
    check('a new layer gets a fresh number', layerName() === '图层 3', layerName());
    await clickTitle('删除当前图层', 'layer-delete');
    check('deleting the top layer selects the one below', layerName() === '图层 2', layerName());
    await clickTitle('新建图层', 'layer-add-3');
    const layerNames = byClass('pxs-layer-name').map((node) => textOf(node).trim());
    check('layer names stay unique after add/delete/add',
        layerNames.length === new Set(layerNames).size && layerNames.indexOf('图层 3') >= 0,
        layerNames.join(' / '));

    key('b');
    await pump('layer-pencil');
    const beforeHidden = JSON.stringify(rows());
    const eye = byClass('pxs-layer-eye')[0];
    check('the layer list shows an eye per layer', Boolean(eye));
    if (eye) eye.props.onClick({ stopPropagation() {} });
    await pump('layer-hide');
    pointerAt('onPointerDown', 2, 2);
    pointerAt('onPointerMove', 4, 2);
    pointerAt('onPointerUp', 4, 2);
    await pump('layer-hidden-brush');
    check('a hidden layer refuses the brush', JSON.stringify(rows()) === beforeHidden);
    check('and the status line says why', /隐藏/.test(noticeText()), noticeText());
    const eyeBack = byClass('pxs-layer-eye')[0];
    if (eyeBack) eyeBack.props.onClick({ stopPropagation() {} });
    await pump('layer-show');

    key('m');
    await pump('layer-select-tool');
    pointerAt('onPointerDown', 1, 1);
    pointerAt('onPointerMove', 4, 4);
    pointerAt('onPointerUp', 4, 4);
    await pump('layer-select-rect');
    check('a rectangle is selected before the layer op',
        byClass('pxs-selection-bar').length === 1);
    const rowCount = rows().length;
    await clickTitle('新建图层', 'layer-add-over-selection');
    check('a layer change ends the running selection',
        byClass('pxs-selection-bar').length === 0);
    check('and it leaves the pixels alone', rows().length === rowCount);

    console.log(failures === 0 ? 'PASS: selection interactions behave' : `FAIL: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
    console.error('FAIL: harness threw');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});


