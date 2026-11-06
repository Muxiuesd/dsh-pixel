/**
 * Host half of dsh-pixel-studio.
 *
 * Owns the artwork store (plain JSON file under the profile directory) and a tiny
 * same-origin HTTP API that the Client half calls with `fetch`. The Client half is
 * an installed bundle module, so it has no direct RPC bridge to the Host: the
 * official webServer route is the supported transport (same pattern as dsh-m).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

export const name = 'pixel-studio';
export const inject = ['webServer'];

const API_PATH = '/dsh-pixel-studio';
const HEADER = 'x-pixel-studio';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_SIDE = 256;
const MAX_COLORS = 64;
const MAX_LAYERS = 8;
const MAX_EXPORT_PIXELS = 4096 * 4096;

const ID_PATTERN = /^[a-z0-9]{6,24}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const FALLBACK_COLOR = '#000000';

const DEFAULT_PALETTE = [
    '#000000', '#1d2b53', '#7e2553', '#008751',
    '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436',
    '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

/* -------------------------------------------------------------------------- */
/* store                                                                      */
/* -------------------------------------------------------------------------- */

function storeDirectory() {
    const profile = process.env.DSH_PROFILE_DIR;
    if (profile && profile.trim() !== '') return path.join(profile, 'pixel-studio');
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    return path.join(home, 'pixel-studio');
}

function storeFile() {
    return path.join(storeDirectory(), 'works.json');
}

let cache = null;
let writeChain = Promise.resolve();

async function readStore() {
    if (cache !== null) return cache;
    try {
        const text = await fsp.readFile(storeFile(), 'utf8');
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && parsed.works && typeof parsed.works === 'object') {
            cache = { version: 1, works: parsed.works };
        } else {
            cache = { version: 1, works: {} };
        }
    } catch {
        cache = { version: 1, works: {} };
    }
    return cache;
}

function persist(store) {
    const run = async () => {
        const dir = storeDirectory();
        await fsp.mkdir(dir, { recursive: true });
        const target = storeFile();
        const temporary = path.join(dir, `works.${process.pid}.${Date.now()}.tmp`);
        await fsp.writeFile(temporary, JSON.stringify(store), 'utf8');
        await fsp.rename(temporary, target);
    };
    writeChain = writeChain.then(run, run);
    return writeChain;
}

/* -------------------------------------------------------------------------- */
/* document model                                                             */
/* -------------------------------------------------------------------------- */

function newId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
    return id;
}

function clampInt(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, 60);
    return trimmed === '' ? fallback : trimmed;
}

/**
 * Palette slots are POSITIONAL: slot #n is the character `n` in every layer
 * grid. So this must never drop or reorder an entry — dropping one would shift
 * every later character to a different color and silently repaint the artwork.
 * Invalid entries keep their slot and fall back to opaque black.
 */
function cleanPalette(value) {
    const source = Array.isArray(value) ? value : [];
    const palette = [];
    for (const entry of source) {
        if (palette.length >= MAX_COLORS) break;
        const color = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
        palette.push(COLOR_PATTERN.test(color) ? color : FALLBACK_COLOR);
    }
    if (palette.length === 0) return DEFAULT_PALETTE.slice(0, 8);
    return palette;
}

function blankRows(width, height) {
    return Array.from({ length: height }, () => '.'.repeat(width));
}

/** Rewrites one layer's character grid so it matches width/height/palette exactly. */
function cleanRows(value, width, height, paletteLength) {
    const rows = [];
    const source = Array.isArray(value) ? value : [];
    const allowed = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, paletteLength);
    for (let y = 0; y < height; y += 1) {
        const raw = typeof source[y] === 'string' ? source[y] : '';
        let row = '';
        for (let x = 0; x < width; x += 1) {
            const ch = raw[x] === undefined ? '.' : raw[x];
            row += allowed.includes(ch) ? ch : '.';
        }
        rows.push(row);
    }
    return rows;
}

function cleanLayers(value, width, height, paletteLength, fallbackName) {
    const source = Array.isArray(value) ? value : [];
    const layers = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        layers.push({
            name: cleanName(entry.name, fallbackName),
            visible: entry.visible !== false,
            rows: cleanRows(entry.rows, width, height, paletteLength),
        });
        if (layers.length >= MAX_LAYERS) break;
    }
    if (layers.length === 0) {
        layers.push({ name: fallbackName, visible: true, rows: blankRows(width, height) });
    }
    return layers;
}

/** Validates and normalizes an incoming document. Throws on structural problems. */
function normalizeWork(input, previous) {
    if (!input || typeof input !== 'object') throw new Error('invalid-document');
    const base = previous || {};
    const width = clampInt(input.w !== undefined ? input.w : base.w, 1, MAX_SIDE, 32);
    const height = clampInt(input.h !== undefined ? input.h : base.h, 1, MAX_SIDE, 32);
    const palette = cleanPalette(input.palette !== undefined ? input.palette : base.palette);
    const rawPath = input.filePath !== undefined ? input.filePath : base.filePath;
    const filePath = typeof rawPath === 'string' && rawPath.trim() !== '' ? path.resolve(rawPath.trim()) : null;
    const work = {
        id: typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : (base.id || newId()),
        name: cleanName(input.name !== undefined ? input.name : base.name, '未命名作品'),
        w: width,
        h: height,
        palette,
        filePath,
        layers: cleanLayers(input.layers !== undefined ? input.layers : base.layers, width, height, palette.length, '图层 1'),
        updatedAt: Date.now(),
    };
    return work;
}

function summarize(work) {
    return {
        id: work.id,
        name: work.name,
        w: work.w,
        h: work.h,
        colors: work.palette.length,
        layers: work.layers.length,
        filePath: work.filePath || null,
        updatedAt: work.updatedAt,
    };
}

/* -------------------------------------------------------------------------- */
/* PNG encoding (no dependencies: IHDR + IDAT stored in zlib + CRC32)          */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolor + alpha
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function paletteRgb(palette) {
    return palette.map((color) => [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
    ]);
}

/** Composes all visible layers into an RGBA buffer upscaled by `scale`. */
function renderRgba(work, scale) {
    const width = work.w * scale;
    const height = work.h * scale;
    const rgba = Buffer.alloc(width * height * 4);
    const rgb = paletteRgb(work.palette);
    const layers = work.layers.filter((layer) => layer.visible !== false);
    for (let y = 0; y < work.h; y += 1) {
        for (let x = 0; x < work.w; x += 1) {
            let color = null;
            for (let l = layers.length - 1; l >= 0; l -= 1) {
                const row = layers[l].rows[y];
                const ch = row === undefined ? '.' : row[x];
                const index = ch === undefined || ch === '.' ? -1 : Number.parseInt(ch, 36);
                if (Number.isInteger(index) && index >= 0 && index < rgb.length) {
                    color = rgb[index];
                    break;
                }
            }
            if (color === null) continue;
            for (let dy = 0; dy < scale; dy += 1) {
                let offset = ((y * scale + dy) * width + x * scale) * 4;
                for (let dx = 0; dx < scale; dx += 1) {
                    rgba[offset] = color[0];
                    rgba[offset + 1] = color[1];
                    rgba[offset + 2] = color[2];
                    rgba[offset + 3] = 255;
                    offset += 4;
                }
            }
        }
    }
    return { width, height, rgba };
}

function renderDataUrl(work, scale) {
    const { width, height, rgba } = renderRgba(work, scale);
    return {
        dataUrl: `data:image/png;base64,${encodePng(width, height, rgba).toString('base64')}`,
        width,
        height,
    };
}

/* -------------------------------------------------------------------------- */
/* HTTP API                                                                   */
/* -------------------------------------------------------------------------- */

/** Directory the exported file should land in: the Session's own directory when known. */
function resolveDirectory(ctx, sessionId) {
    const workingDirectory = ctx.get('workingDirectory');
    const sessions = ctx.get('sessions');
    const session = sessions && typeof sessions.get === 'function' && typeof sessionId === 'string' && sessionId !== ''
        ? sessions.get(sessionId)
        : undefined;
    if (session && workingDirectory && typeof workingDirectory.get === 'function') {
        try {
            const directory = workingDirectory.get(session);
            if (typeof directory === 'string' && directory !== '') return directory;
        } catch {
            // Fall through to the directory recorded in the Session header.
        }
    }
    if (session && session.header && typeof session.header.cwd === 'string' && session.header.cwd !== '') {
        return session.header.cwd;
    }
    if (workingDirectory && typeof workingDirectory.defaultDirectory === 'string') {
        return workingDirectory.defaultDirectory;
    }
    return os.homedir();
}

function fileStem(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    const cleaned = raw
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return (cleaned === '' ? 'pixel-art' : cleaned).slice(0, 80);
}

/** Writes `<name>.png` into `dir` without silently overwriting an existing file. */
async function writePng(dir, name, png) {
    const stem = fileStem(name);
    let target = path.join(dir, `${stem}.png`);
    for (let index = 2; index <= 100; index += 1) {
        try {
            await fsp.access(target);
        } catch {
            break;
        }
        target = path.join(dir, `${stem}-${index}.png`);
    }
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(target, png);
    return target;
}

/** Present drive letters as pick-able entries when the listing sits at a filesystem root. */
async function listDrives() {
    const found = [];
    for (let code = 65; code <= 90; code += 1) {
        const drive = `${String.fromCharCode(code)}:\\`;
        try {
            await fsp.access(drive);
            found.push({ name: drive, path: drive, hidden: false });
        } catch {
            // Absent drive letter.
        }
    }
    return found;
}

/** Lists one directory level (directories only) for the Client's save dialog. */
async function listDirectories(directory, showHidden) {
    const resolved = path.resolve(directory);
    const root = path.parse(resolved).root;
    let entries;
    try {
        entries = await fsp.readdir(resolved, { withFileTypes: true });
    } catch (error) {
        const code = error && error.code;
        if (code === 'ENOENT') throw new Error('目录不存在');
        if (code === 'EACCES' || code === 'EPERM') throw new Error('没有访问该目录的权限');
        if (code === 'ENOTDIR') throw new Error('不是目录');
        throw error;
    }
    const dirs = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const hidden = entry.name.startsWith('.');
        if (hidden && showHidden !== true) continue;
        dirs.push({ name: entry.name, path: path.join(resolved, entry.name), hidden });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    const parent = resolved === root ? null : path.dirname(resolved);
    if (parent === null) {
        const drives = await listDrives();
        dirs.unshift(...drives);
    }
    return { path: resolved, parent, root, dirs };
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-length', Buffer.byteLength(body));
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('body-too-large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function handleRequest(ctx, req, res) {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
        return;
    }
    if (req.headers[HEADER] !== '1') {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
    }
    let payload;
    try {
        const text = await readBody(req);
        payload = text === '' ? {} : JSON.parse(text);
    } catch (error) {
        const tooLarge = error instanceof Error && error.message === 'body-too-large';
        sendJson(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body-too-large' : 'bad-json' });
        return;
    }
    const op = payload && typeof payload === 'object' ? payload.op : undefined;

    try {
        const store = await readStore();
        if (op === 'list') {
            const docs = Object.values(store.works).map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
            sendJson(res, 200, { ok: true, docs });
            return;
        }
        if (op === 'get') {
            const work = store.works[payload.id];
            if (!work) {
                sendJson(res, 404, { ok: false, error: 'not-found' });
                return;
            }
            sendJson(res, 200, { ok: true, doc: work });
            return;
        }
        if (op === 'create') {
            const width = clampInt(payload.w, 1, MAX_SIDE, 32);
            const height = clampInt(payload.h, 1, MAX_SIDE, 32);
            const palette = cleanPalette(payload.palette);
            const work = {
                id: newId(),
                name: cleanName(payload.name, '未命名作品'),
                w: width,
                h: height,
                palette,
                filePath: null,
                layers: [{ name: '图层 1', visible: true, rows: blankRows(width, height) }],
                updatedAt: Date.now(),
            };
            store.works[work.id] = work;
            await persist(store);
            sendJson(res, 200, { ok: true, doc: work });
            return;
        }
        if (op === 'save') {
            const source = payload && payload.doc;
            if (!source || typeof source !== 'object') {
                sendJson(res, 400, { ok: false, error: 'invalid-document' });
                return;
            }
            const previous = typeof source.id === 'string' ? store.works[source.id] : undefined;
            const work = normalizeWork(source, previous);
            store.works[work.id] = work;
            await persist(store);
            sendJson(res, 200, { ok: true, doc: work, savedAt: work.updatedAt });
            return;
        }
        if (op === 'delete') {
            const id = typeof payload.id === 'string' ? payload.id : '';
            if (!ID_PATTERN.test(id)) {
                sendJson(res, 400, { ok: false, error: 'invalid-id' });
                return;
            }
            delete store.works[id];
            await persist(store);
            sendJson(res, 200, { ok: true });
            return;
        }
        if (op === 'png') {
            const work = store.works[payload.id];
            if (!work) {
                sendJson(res, 404, { ok: false, error: 'not-found' });
                return;
            }
            const maxScale = Math.max(1, Math.floor(Math.sqrt(MAX_EXPORT_PIXELS / (work.w * work.h))));
            const scale = clampInt(payload.scale, 1, Math.min(64, maxScale), 8);
            const rendered = renderDataUrl(work, scale);
            sendJson(res, 200, { ok: true, ...rendered, scale });
            return;
        }
        if (op === 'render') {
            // Renders a document that has not been saved yet (used by the export button).
            const work = normalizeWork(payload.doc, null);
            const maxScale = Math.max(1, Math.floor(Math.sqrt(MAX_EXPORT_PIXELS / (work.w * work.h))));
            const scale = clampInt(payload.scale, 1, Math.min(64, maxScale), 8);
            const rendered = renderDataUrl(work, scale);
            sendJson(res, 200, { ok: true, ...rendered, scale });
            return;
        }
        if (op === 'export') {
            // Exports an unsaved document at 1× straight into the conversation directory.
            const work = normalizeWork(payload.doc, null);
            const scale = clampInt(payload.scale, 1, 64, 1);
            const { width, height, rgba } = renderRgba(work, scale);
            const png = encodePng(width, height, rgba);
            const directory = resolveDirectory(ctx, payload.sessionId);
            const target = await writePng(directory, payload.name || work.name, png);
            sendJson(res, 200, { ok: true, path: target, width, height, bytes: png.length });
            return;
        }
        if (op === 'sessionDir') {
            sendJson(res, 200, { ok: true, dir: resolveDirectory(ctx, payload.sessionId) });
            return;
        }
        if (op === 'browse') {
            const requested = typeof payload.path === 'string' && payload.path.trim() !== ''
                ? payload.path.trim()
                : resolveDirectory(ctx, payload.sessionId);
            const listing = await listDirectories(requested, payload.showHidden === true);
            sendJson(res, 200, { ok: true, ...listing });
            return;
        }
        if (op === 'mkdir') {
            const parent = typeof payload.path === 'string' && payload.path.trim() !== '' ? path.resolve(payload.path.trim()) : '';
            const raw = typeof payload.name === 'string' ? payload.name.trim() : '';
            if (parent === '' || raw === '') {
                sendJson(res, 400, { ok: false, error: 'invalid-path' });
                return;
            }
            const created = path.join(parent, fileStem(raw).replace(/^\.+/, '') || '新建文件夹');
            await fsp.mkdir(created, { recursive: false });
            sendJson(res, 200, { ok: true, path: created });
            return;
        }
        if (op === 'exportTo') {
            // Writes the render at an explicit path, replacing an existing file.
            const work = normalizeWork(payload.doc, null);
            const scale = clampInt(payload.scale, 1, 64, 1);
            const rawTarget = typeof payload.path === 'string' ? payload.path.trim() : '';
            if (rawTarget === '') {
                sendJson(res, 400, { ok: false, error: 'invalid-path' });
                return;
            }
            const { width, height, rgba } = renderRgba(work, scale);
            const png = encodePng(width, height, rgba);
            const target = path.resolve(/\.png$/i.test(rawTarget) ? rawTarget : `${rawTarget}.png`);
            let existed = false;
            try {
                await fsp.access(target);
                existed = true;
            } catch {
                existed = false;
            }
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, png);
            sendJson(res, 200, { ok: true, path: target, width, height, bytes: png.length, overwritten: existed });
            return;
        }
        if (op === 'ping') {
            sendJson(res, 200, { ok: true, dir: storeDirectory(), count: Object.keys(store.works).length });
            return;
        }
        sendJson(res, 400, { ok: false, error: 'unknown-op' });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { ok: false, error: 'internal', message });
    }
}

/* -------------------------------------------------------------------------- */
/* plugin entry                                                               */
/* -------------------------------------------------------------------------- */

export function apply(ctx) {
    // Warm the store so the first Client request does not pay for a cold read.
    void readStore().catch(() => {});

    ctx.effect(() => {
        const dispose = ctx.webServer.register({
            kind: 'exact',
            path: API_PATH,
            handler: (req, res) => {
                void handleRequest(ctx, req, res);
            },
        });
        return () => {
            dispose();
        };
    });
}
