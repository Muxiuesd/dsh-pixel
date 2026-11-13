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

const CLIENT = path.resolve(__dirname, '..', 'client.js');

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

const windowListeners = new Map();

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
    addEventListener: (type, fn) => {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
        const list = windowListeners.get(type);
        if (!list) return;
        const index = list.indexOf(fn);
        if (index >= 0) list.splice(index, 1);
    },
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

const PALETTE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** What the canvas really shows, per visible layer and cell, as colours. */
function canvasColours(doc) {
    return doc.layers.map((layer) => {
        if (layer.visible === false) return null;
        return layer.rows.map((row) => row.split('').map((ch) => {
            if (ch === '.') return null;
            const slot = PALETTE_CHARS.indexOf(ch);
            if (slot < 0 || slot >= doc.palette.length) return 'missing';
            return String(doc.palette[slot]).toLowerCase();
        }));
    });
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

/** Fire a keydown at the window-level handler the editor installs. */
function fireKey(key, extra = {}) {
    const handlers = (windowListeners.get('keydown') || []).slice();
    if (handlers.length === 0) throw new Error('the editor never registered a keydown handler');
    for (const handler of handlers) {
        handler(event({
            key,
            target: { tagName: 'BODY', isContentEditable: false },
            ...extra,
        }));
    }
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
    // 5. paint the whole canvas so the palette edit has pixels to protect
    fireKey('a', { ctrlKey: true });
    await pump('select-all');
    const selectionLabel = byClass('pxs-selection-label')[0];
    check('select all marks the whole canvas', Boolean(selectionLabel), selectionLabel && textOf(selectionLabel));
    const fillButton = byText('▣ 填充', 'button')[0];
    check('the selection bar offers a fill button', Boolean(fillButton));
    fillButton.props.onClick(event());
    await pump('fill-selection');
    check('the fill painted the whole layer', created.layers[0].rows.join('') === '0'.repeat(16 * 16), created.layers[0].rows[0]);

    // 6. open the colour editor on the first swatch
    const swatch = byClass('pxs-swatch')[0];
    check('first palette swatch is rendered', Boolean(swatch));
    swatch.props.onDoubleClick(event());
    await pump('open-editor');
    check('colour editor panel is mounted', byClass('pxs-color-edit').length === 1);
    check('colour editor shows a native colour input', byClass('pxs-native-color').length === 1);
    check('colour editor offers the hue wheel', findAll((node) => typeof node.type === 'function'
        && node.type.name === 'ColorWheel').length === 1);

    // 7. colour edits are a draft: nothing lands in the palette before 「完成」
    const coloursBefore = canvasColours(created);
    const hexInput = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-hex-input'))[0];
    check('hex input exists', Boolean(hexInput));
    hexInput.props.onBlur(event({ currentTarget: { value: '#123456' } }));
    await pump('draft-colour');
    check('a draft edit leaves the palette untouched', created.palette[0] !== '#123456', created.palette[0]);
    check('the draft is not saved to disk by itself', created.palette[0] !== '#123456', created.palette[0]);
    const compareChips = byClass('pxs-compare-chip');
    check('colour editor compares old and new colour', compareChips.length === 2, String(compareChips.length));
    check('compare strip keeps the untouched colour on the left',
        compareChips[0].props.style.background === created.palette[0], compareChips[0].props.style.background);
    check('compare strip shows the draft colour on the right',
        compareChips[1].props.style.background === '#123456', compareChips[1].props.style.background);

    const finish = byText('完成', 'button')[0];
    check('colour editor offers a 完成 button', Boolean(finish));
    finish.props.onClick();
    await pump('commit-colour');
    check('「完成」 writes the colour into the slot', created.palette[0] === '#123456', created.palette[0]);
    check('the filled canvas still points at a slot', created.layers[0].rows[0][0] !== '.', created.layers[0].rows[0]);
    check('the recolour never repaints the canvas', JSON.stringify(canvasColours(created)) === JSON.stringify(coloursBefore),
        JSON.stringify(canvasColours(created)[0][0]));
    check('the editor closes after committing', byClass('pxs-color-edit').length === 0);

    // 8. switching swatches with an unfinished edit must discard it
    const swatchAgain = byClass('pxs-swatch')[0];
    check('palette swatches are clickable', Boolean(swatchAgain && swatchAgain.props.onDoubleClick));
    swatchAgain.props.onDoubleClick();
    await pump('reopen-editor');
    const hexInput2 = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-hex-input'))[0];
    hexInput2.props.onBlur(event({ currentTarget: { value: '#654321' } }));
    await pump('draft-colour-2');
    check('second draft also stays out of the palette', created.palette[0] === '#123456', created.palette[0]);
    const cancel = byText('取消', 'button')[0];
    check('colour editor offers 取消', Boolean(cancel));
    cancel.props.onClick();
    await pump('cancel-colour');
    check('取消 throws the draft away', created.palette[0] === '#123456', created.palette[0]);
    check('cancelling keeps the picture identical', JSON.stringify(canvasColours(created)) === JSON.stringify(coloursBefore));

    // 9. an unfinished edit is dropped when the user double-clicks another swatch
    const swatches = byClass('pxs-swatch');
    check('palette has at least two swatches', swatches.length >= 2, String(swatches.length));
    swatches[0].props.onDoubleClick();
    await pump('reopen-editor-2');
    const hexInput3 = findAll((node) => node.type === 'input'
        && typeof node.props.className === 'string'
        && node.props.className.includes('pxs-hex-input'))[0];
    hexInput3.props.onBlur(event({ currentTarget: { value: '#0f0f0f' } }));
    await pump('draft-colour-3');
    swatches[1].props.onDoubleClick();
    await pump('switch-swatch');
    check('switching swatches drops the previous draft', created.palette[0] === '#123456', created.palette[0]);
    check('switching swatches did not write slot 1', created.palette[1] === '#0f0f0f' ? 'wrote' : created.palette[1],
        'slot 1 must keep its colour');
    check('the editor now shows the newly picked slot', byClass('pxs-color-edit').length === 1);

    // 10. the studio must strip the shell's conversation-width handle while open
    const clientSource = fs.readFileSync(CLIENT, 'utf8');
    check('studio sweeps the shell width handle', clientSource.includes('hideShellHandles(studioRoot, studioBody'));
    check('width handles are handed back on unmount', clientSource.includes('restoreShellHandles(hiddenHandles)'));
    check('the sweep skips its own splitter nodes', clientSource.includes('root.contains(element)'));
    check('studio hides the shell composer seat', clientSource.includes('hideShellComposer(studioRoot, studioBody'));
    check('the notice owns a flexible centre slot', clientSource.includes("className: 'pxs-bar-center'"));
    check('the centre slot collapses before it overlaps', clientSource.includes('flex: 1 1 0; min-width: 0; overflow: hidden;'));
    check('the bar wraps its controls for layout', clientSource.includes("className: 'pxs-bar-main'"));
    check('the notice no longer floats over the buttons', !clientSource.includes('position: absolute; left: 50%'));

    // 10b. the canvas side limit is raised to 2048 on both halves
    const hostSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    check('the studio raises the canvas side limit to 2048',
        clientSource.includes('const MAX_SIDE = 2048;') && hostSource.includes('const MAX_SIDE = 2048;'));
    check('the new-canvas dialog advertises the 2048 limit', clientSource.includes('最大 \${MAX_SIDE}'));
    check('composing reuses a cached canvas', clientSource.includes('composeCacheRef'));
    check('palette lookups go through a table, not a scan', clientSource.includes('CHAR_SLOTS'));

    // 11. composer + auto-fit toggles in the toolbar
    const hideToggle = byText('对话框隐藏', 'button')[0];
    check('toolbar offers a composer toggle', Boolean(hideToggle));
    hideToggle.props.onClick();
    await pump('toggle-composer');
    check('the composer toggle flips to 显示', byText('对话框显示', 'button').length === 1);
    check('the composer preference is remembered', storage.get('pxs:hideComposer') === '0', String(storage.get('pxs:hideComposer')));
    const fitToggle = byText('自适应开', 'button')[0];
    check('toolbar offers an auto-fit toggle', Boolean(fitToggle));
    fitToggle.props.onClick();
    await pump('toggle-autofit');
    check('the auto-fit toggle flips to 关', byText('自适应关', 'button').length === 1);

    // 12. the auto-fit toggle sits right after the fit button, notice is centred
    const fitIndex = clientSource.indexOf("onClick: fitToView }, '适应'),");
    const autoFitIndex = clientSource.indexOf("'data-active': autoFit,");
    const gridIndex = clientSource.indexOf("'data-active': showGrid,");
    check('the auto-fit button follows the fit button', fitIndex > 0 && autoFitIndex > fitIndex && autoFitIndex < gridIndex,
        `${fitIndex} / ${autoFitIndex} / ${gridIndex}`);
    check('only one auto-fit button exists', clientSource.indexOf("'data-active': autoFit,") === clientSource.lastIndexOf("'data-active': autoFit,"));
    check('the notice lives in a centred bar cluster', clientSource.includes("className: 'pxs-bar-center'")
        && clientSource.includes('.pxs-bar-center {'));
    check('the auto-fit preference is remembered', storage.get('pxs:autoFit') === '0', String(storage.get('pxs:autoFit')));

    // 13. the palette panel offers a scroll box, JSON export and import
    check('the swatch grid scrolls on demand', byClass('pxs-swatch-scroll').length === 1);
    check('the palette panel counts towards the 256 colour limit',
        clientSource.includes('${MAX_COLORS}') && clientSource.includes('const MAX_COLORS = CHARS.length;'));
    check('the palette panel exports JSON', byText('⇩ 导出', 'button').length === 1);
    check('the palette panel imports JSON', byText('⇧ 导入', 'button').length === 1);
    check('the export reuses the save dialog in palette mode',
        clientSource.includes("openSaveDialog('palette')") && clientSource.includes("mode === 'palette'"));
    check('the save dialog titles the palette export', clientSource.includes('导出调色板 JSON'));
    check('the palette import dialog offers replace and append',
        clientSource.includes("applyPaletteImport('replace')") && clientSource.includes("applyPaletteImport('append')"));
    check('the palette import reads json files', clientSource.includes("accept: '.json,.gpl,.pal,.txt,.hex,application/json,text/plain'"));
    check('the new-work dialog can keep the current palette', clientSource.includes('沿用当前调色板'));
    check('the import dialog can map onto the current palette', clientSource.includes('使用图片自己的调色板'));
    check('an overridden import reports the current palette as its mode',
        clientSource.includes("mode: dialog.overridePalette === false ? 'current' : dialog.mode"));
    check('the colour chips follow the override checkbox',
        clientSource.includes("importDialog.overridePalette === false && mode.id !== 'current'"));

    // 14. picking a palette file really parses it and can replace the palette
    const paletteInput = findAll((node) => node.type === 'input'
        && node.props && typeof node.props.accept === 'string' && node.props.accept.includes('.json'))[0];
    check('the palette picker is wired to the panel', Boolean(paletteInput));
    const exportedJson = JSON.stringify({
        format: 'dsh-pixel-studio-palette',
        version: 1,
        name: 'demo',
        colors: ['#000000', '#1d2b53', '#7e2553'],
    });
    paletteInput.props.onChange(event({
        target: { files: [{ name: 'demo.json', text: async () => exportedJson }] },
    }));
    await pump('palette import');
    const importPanel = byClass('pxs-palette-import')[0];
    check('the picked palette file is parsed and shown', Boolean(importPanel)
        && textOf(importPanel).includes('demo.json · 3 个颜色'), importPanel ? textOf(importPanel) : 'missing panel');
    const replaceButton = byText('覆盖', 'button')[0];
    check('the import panel offers a replace button', Boolean(replaceButton));
    replaceButton.props.onClick();
    await pump('palette replace');
    check('replacing the palette applies the picked colours',
        Array.isArray(created.palette) && created.palette.join(',') === '#000000,#1d2b53,#7e2553',
        JSON.stringify(created.palette));
    check('the import panel closes once applied', byClass('pxs-palette-import').length === 0);

    // 15. a new work reuses the current palette when the box stays ticked
    const openNew = () => byText('新建', 'button')[0];
    const newButton = openNew();
    check('the toolbar offers 新建 once a work exists', Boolean(newButton));
    newButton.props.onClick(event());
    await pump('open-new-dialog-2');
    const keepBox = findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];
    check('the new-work dialog ticks 沿用当前调色板 by default', Boolean(keepBox) && keepBox.props.checked === true,
        keepBox && String(keepBox.props.checked));
    byText('创建', 'button')[0].props.onClick(event());
    await pump('create-doc-shared');
    const sharedWork = state.docs[state.docs.length - 1];
    check('a new work copies the current palette', Boolean(sharedWork)
        && sharedWork.palette.join(',') === created.palette.join(','),
        sharedWork && sharedWork.palette.join(','));

    // 16. unticking falls back to the default 8 colours
    openNew().props.onClick(event());
    await pump('open-new-dialog-3');
    const keepBox2 = findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0];
    keepBox2.props.onChange(event({ target: { checked: false } }));
    await pump('untick-keep-palette');
    byText('创建', 'button')[0].props.onClick(event());
    await pump('create-doc-default');
    const defaultWork = state.docs[state.docs.length - 1];
    check('unticking 沿用当前调色板 gives the default palette', Boolean(defaultWork) && defaultWork.palette.length === 8,
        defaultWork && defaultWork.palette.length);

    // 17. deleting a palette slot is undoable
    fireKey('a', { ctrlKey: true });
    await pump('select-all-delete');
    byText('▣ 填充', 'button')[0].props.onClick(event());
    await pump('fill-before-delete');
    const paintedRows = defaultWork.layers[0].rows.slice();
    check('the active work fills with the first colour',
        paintedRows.every((row) => row === '0'.repeat(row.length)), paintedRows[0]);
    byClass('pxs-swatch')[0].props.onDoubleClick();
    await pump('edit-slot-before-delete');
    byText('删除该色', 'button')[0].props.onClick(event());
    await pump('delete-slot');
    check('deleting a slot wipes the pixels that used it',
        defaultWork.layers[0].rows.every((row) => /^\.+$/.test(row)), defaultWork.layers[0].rows[0]);
    check('the palette shrinks by one', defaultWork.palette.length === 7, String(defaultWork.palette.length));
    fireKey('z', { ctrlKey: true });
    await pump('undo-slot-delete');
    check('undo brings the slot and its pixels back', defaultWork.palette.length === 8
        && JSON.stringify(defaultWork.layers[0].rows) === JSON.stringify(paintedRows),
        `${defaultWork.palette.length} / ${defaultWork.layers[0].rows[0]}`);

    // 17. the grid lines adapt to the artwork under them
    check('the grid strokes a dark line for light cells',
        clientSource.includes("context.globalCompositeOperation = 'darken'"));
    check('the grid strokes a light line for dark cells',
        clientSource.includes("context.globalCompositeOperation = 'lighten'"));
    check('the grid no longer uses one flat stroke colour',
        !clientSource.includes("context.strokeStyle = 'rgba(255,255,255,0.09)'"));

    console.log(failures === 0 ? 'PASS: interaction flow works end to end' : `FAIL: ${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
    console.error('FAIL: harness threw');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});





