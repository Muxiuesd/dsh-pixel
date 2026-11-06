/**
 * Render-path smoke test for the Pixel Studio client module.
 *
 * The real browser is not available here, so this harness loads client.js with a
 * tiny React stub and calls the component function once. That catches the class
 * of failure that blanks the view in the browser: TDZ errors, undefined
 * identifiers, and anything else thrown while building the element tree.
 *
 * Usage: node render-smoke.cjs
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
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    requestAnimationFrame: (fn) => {
        void fn;
        return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
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

/* -------------------------------------------------------------------------- */
/* react stub                                                                 */
/* -------------------------------------------------------------------------- */

const elements = [];

function createElement(type, props, ...children) {
    const node = { type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } };
    elements.push(node);
    return node;
}

const reactStub = {
    createElement,
    Fragment: 'Fragment',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useReducer: (reducer, initial) => [initial, () => {}],
    useImperativeHandle: () => {},
    createContext: (value) => ({ Provider: 'Provider', Consumer: 'Consumer', _value: value }),
    useContext: (context) => context && context._value,
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

console.log(`module id: ${definition.id}`);

const clientModule = definition.factory((name) => {
    if (name === 'react') return reactStub;
    throw new Error(`unexpected require(${name})`);
});

let registered = null;
const ctx = {
    slots: {
        inject: (name, factory) => {
            void name;
            const entry = factory();
            return entry;
        },
        register: (meta, component) => {
            registered = { meta, component };
            return () => {};
        },
    },
};

clientModule.apply(ctx);

if (!registered) {
    console.error('FAIL: apply() did not register a view');
    process.exit(1);
}

console.log(`registered: ${registered.meta.id} order=${registered.meta.order} label=${registered.meta.label()}`);

const Component = registered.component;
const isClass = typeof Component === 'function' && /^class\s/.test(Function.prototype.toString.call(Component));

try {
    if (isClass) {
        const instance = new Component({ sessionId: 'smoke-session' });
        const tree = instance.render();
        console.log(`rendered boundary class: ${tree && tree.type}`);
    } else {
        const tree = Component({ sessionId: 'smoke-session' });
        console.log(`rendered component tree: ${tree && tree.type} (${elements.length} elements)`);
        const classes = new Set();
        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            const props = node.props || {};
            if (typeof props.className === 'string') {
                props.className.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
            }
            const children = props.children;
            if (Array.isArray(children)) children.forEach(walk);
            else walk(children);
        };
        walk(tree);
        console.log(`class names: ${[...classes].sort().join(' ')}`);
    }
} catch (error) {
    console.error('FAIL: render threw');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}

console.log('PASS: render path built without throwing');
