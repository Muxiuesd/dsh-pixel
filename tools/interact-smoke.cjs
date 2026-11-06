/**
 * Interaction smoke test for the Pixel Studio client module.
 *
 * render-smoke.cjs only proves the *first* render builds. This harness adds a
 * stateful mini-React (useState/useEffect/useCallback with real updates) plus a
 * fake Host API, so it can drive real UI flows: open the new-work dialog, pick a
 * preset, create the document, open the colour editor, and change a palette
 * colour while asserting the artwork rows are untouched.
 *
 * Usage: node interact-smoke.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT = path.resolve(__dirname, '..', 'dsh-pixel-studio', 'client.js');

/* -------------------------------------------------------------------------- */
/* browser + host stubs                                                       */
/* -------------------------------------------------------------------------- */

const storage = new Map();

const canvasContext = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    setTransform: () => {},
    translate: () => {},
    scale: () => {},
    drawImage: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    set lineWidth(_value) {},
    set strokeStyle(_value) {},
    set fillStyle(_value) {},
};

const windowStub = {
    devicePixelRatio: 2,
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
    setTimeout: (fn) => {
        queue.push(fn);
        return 1;
    },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    location: { reload: () => {} },
    confirm: () => false,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
};

const documentStub = {
    createElement: (tag) => ({
        tagName: String(tag).toUpperCase(),
        style: {},
        width: 0,
        height: 0,
        getContext: () => canvasContext,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
        appendChild: () => {},
        removeChild: () => {},
    }),
    addEventListener: () => {},
    body: { appendChild: () => {}, removeChild: () => {} },
};

const queue = [];

/* -------------------------------------------------------------------------- */
/* fake host API                                                              */
/* -------------------------------------------------------------------------- */

const state = { docs: [], nextId: 1 };

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

function makeDoc(input) {
    const w = Math.max(1, Math.round(Number(input.w) || 16));
    const h = Math.max(1, Math.round(Number(input.h) || w));
    const palette = Array.isArray(input.palette) && input.palette.length > 0
        ? input.palette.slice(0, 64).map((c) => String(c).toLowerCase())
        : ['#000000', '#ffffff'];
    const rows = Array.from({ length: h }, () => '.'.repeat(w));
    return {
        id: `doc${state.nextId++}`,
        name: String(input.name || '作品').slice(0, 60),
        w,
        h,
        palette,
        filePath: null,
        layers: [{ name: '图层 1', visible: true, rows }],
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
            return reply(doc ? { ok: true, doc } : { ok: false, error: 'not-found', message: '找不到作品' });
        }
        case 'create': {
            const doc = makeDoc(body);
            state.docs.push(doc);
            return reply({ ok: true, doc });
        }
        case 'save': {
            const incoming = body.doc || {};
            const existing = state.docs.find((entry) => entry.id === incoming.id);
            if (!existing) {
                const doc = makeDoc({ ...incoming, id: undefined });
                state.docs.push(doc);
                return reply({ ok: true, doc });
            }
            Object.assign(existing, {
                name: String(incoming.name || existing.name).slice(0, 60),
                palette: (incoming.palette || existing.palette).slice(),
                layers: incoming.layers || existing.layers,
                w: incoming.w || existing.w,
                h: incoming.h || existing.h,
                filePath: incoming.filePath === undefined ? existing.filePath : incoming.filePath,
            });
            return reply({ ok: true, doc: existing, savedAt: 2 });
        }
        case 'delete': {
            state.docs = state.docs.filter((entry) => entry.id !== body.id);
            return reply({ ok: true });
        }
        case 'sessionDir':
            return reply({ ok: true, path: 'D:\\fake\\session' });
        case 'browse':
            return reply({ ok: true, path: body.path || 'D:\\fake\\session', parent: 'D:\\fake', root: 'D:\\', dirs: [] });
        case 'exportTo':
            return reply({ ok: true, path: `${body.path}.png`, width: 16, height: 16, bytes: 90, overwritten: false });
        case 'render':
            return reply({ ok: true, dataUrl: 'data:image/png;base64,AAAA', width: 16, height: 16 });
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

react.useReducer = (reducer, initial) => {
    const slot = hookIndex;
    hookIndex += 1;
    if (!(slot in hooks)) hooks[slot] = initial;
    const dispatch = (action) => {
        const next = reducer(hooks[slot], action);
        if (next !== hooks[slot]) {
            hooks[slot] = next;
            scheduleDirty();
        }
    };
    return [hooks[slot], dispatch];
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
    if (renderCap > 200) throw new Error('render loop exceeded 200 passes');
    const next = Component({ sessionId: 'session-test' });
    tree = next;
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

function clearHooksOnMount() {
    hooks = [];
    effectState.clear();
    dirty = false;
    renderCap = 0;
}

async function pump(label) {
    // A couple of extra passes let queued promises (fetch, dynamic import)
    // settle before the loop decides nothing is pending any more.
    const idlePassesNeeded = 3;
    let idlePasses = 0;
    for (let pass = 0; pass < 80; pass += 1) {
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
        if (idlePasses >= idlePassesNeeded && work.length === 0) return;
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

/** React flattens nested child arrays; so must the test walker. */
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

function event(extra = {}) {
    const base = {
        preventDefault() {},
        stopPropagation() {},
        target: {},
        currentTarget: {},
        clientX: 0,
        clientY: 0,
        button: 0,
        pointerId: 1,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        ...extra,
    };
    base.target = extra.target || base;
    base.currentTarget = extra.currentTarget || base;
    return base;
}

/* -------------------------------------------------------------------------- */
/* run                                                                        */
/* -------------------------------------------------------------------------- */

let failures = 0;
function check(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
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
            observe() {}
            disconnect() {}
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

    // Instantiate the error boundary directly, then mount the inner component.
    const boundaryInstance = new Boundary({ sessionId: 'session-test' });
    boundaryInstance.setState = (update) => {
        boundaryInstance.state = { ...boundaryInstance.state, ...(typeof update === 'function' ? update(boundaryInstance.state) : update) };
    };
    if (boundaryInstance.state.error) throw new Error('boundary started in an error state');
    const innerElement = boundaryInstance.render();
    check('boundary renders the pixel studio component', innerElement && typeof innerElement.type === 'function');

    Component = innerElement.type;
    clearHooksOnMount();
    renderOnce();
    await pump('mount');

    // 1. empty library shows the new-work button
    check('empty library offers a 新建作品 button', byText('新建作品').some((node) => node.type === 'button'));

    // 2. open the new-work dialog
    const createButton = byText('新建作品').find((node) => node.type === 'button');
    createButton.props.onClick(event());
    await pump('open-new-dialog');
    check('new-work dialog is mounted', byClass('pxs-new-dialog').length === 1);

    // 3. pick the 16×16 preset
    const chip = findAll((node) => node.type === 'button'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-size-chip')
        && textOf(node).startsWith('16×16'))[0];
    check('16×16 preset chip exists', Boolean(chip));
    chip.props.onClick(event());
    await pump('pick-preset');
    const numberInputs = findAll((node) => node.type === 'input' && node.props.type === 'number');
    check('width input follows the preset', numberInputs[0] && numberInputs[0].props.value === 16, numberInputs[0] && numberInputs[0].props.value);
    check('height input follows the preset', numberInputs[1] && numberInputs[1].props.value === 16, numberInputs[1] && numberInputs[1].props.value);

    // 4. type a name and create
    const nameInput = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-input')
        && node.props.placeholder === undefined
        && node.props.spellCheck === false)[0];
    check('name input exists in the dialog', Boolean(nameInput));
    nameInput.props.onChange(event({ target: { value: '测试作品' } }));
    await pump('type-name');
    const confirmButton = byText('创建').find((node) => node.type === 'button');
    check('create button exists', Boolean(confirmButton));
    confirmButton.props.onClick(event());
    await pump('create-doc');

    check('dialog closed after creating', byClass('pxs-new-dialog').length === 0);
    check('host received one document', state.docs.length === 1, `count=${state.docs.length}`);
    const created = state.docs[0];
    check('document keeps the typed name', created && created.name === '测试作品', created && created.name);
    check('document uses the preset size', created && created.w === 16 && created.h === 16, created && `${created.w}×${created.h}`);
    check('document starts with the 8-colour PICO-8 palette', created && created.palette.length === 8, created && created.palette.length);

    const sw = byClass('pxs-swatches')[0];
    // 5. open the colour editor on the first swatch
    const swatch = byClass('pxs-swatch')[0];
    check('first palette swatch is rendered', Boolean(swatch));
    swatch.props.onDoubleClick(event());
    await pump('open-editor');
    check('colour editor panel is mounted', byClass('pxs-color-edit').length === 1);
    check('colour editor shows a native colour input', byClass('pxs-native-color').length === 1);

    // 6. recolour the slot; the artwork rows must not change
    const rowsBefore = created.layers.map((layer) => layer.rows.join('')).join('|');
    const hexInput = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-hex-input'))[0];
    check('hex input exists', Boolean(hexInput));
    hexInput.props.onBlur(event({ currentTarget: { value: '#123456' } }));
    await pump('recolour-slot');
    check('palette slot 0 took the new colour', created.palette[0] === '#123456', created.palette[0]);
    const rowsAfter = created.layers.map((layer) => layer.rows.join('')).join('|');
    check('artwork rows are untouched by the recolour', rowsBefore === rowsAfter);

    // 7. unsaved-pixel safety: a second recolour must not add palette slots on an empty canvas
    const paletteSize = created.palette.length;
    const hexInput2 = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-hex-input'))[0];
    hexInput2.props.onBlur(event({ currentTarget: { value: '#654321' } }));
    await pump('recolour-again');
    check('palette keeps its size on an untouched canvas', created.palette.length === paletteSize, `${created.palette.length} vs ${paletteSize}`);

    console.log(failures === 0 ? 'PASS: interaction flow works end to end' : `FAIL: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
    console.error('FAIL: harness threw');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});





