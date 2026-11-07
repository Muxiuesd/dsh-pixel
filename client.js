/* global window, document, fetch */
/**
 * Client half of dsh-pixel-studio: a three-column pixel editor registered as a
 * Conversation view. Tools on the left, zoomable canvas in the middle, palette on
 * the right. Documents live in the Host half, reached over the plugin's own
 * same-origin HTTP route.
 */
window.__ModuleLoader__.load({
    id: '@muxiuesd/dsh-pixel-studio',
    factory(require) {
        const React = require('react');
        const h = React.createElement;
        const { useState, useEffect, useRef, useCallback } = React;

        const API = '/dsh-pixel-studio';
        const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
        const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
        const HISTORY_LIMIT = 60;
        const MAX_LAYERS = 8;

        const PRESETS = [
            {
                id: 'pico8',
                name: 'PICO-8',
                colors: [
                    '#000000', '#1d2b53', '#7e2553', '#008751',
                    '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
                    '#ff004d', '#ffa300', '#ffec27', '#00e436',
                    '#29adff', '#83769c', '#ff77a8', '#ffccaa',
                ],
            },
            {
                id: 'gameboy',
                name: 'Game Boy',
                colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
            },
            {
                id: 'icecream',
                name: 'Ice Cream',
                colors: [
                    '#7c3f58', '#eb6b6f', '#f9a875', '#fff6d3',
                    '#d6d6d6', '#8b8b8b', '#3d3d3d', '#ffffff',
                ],
            },
            {
                id: 'mono',
                name: '黑白',
                colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'],
            },
        ];

        /** Sizes pixel artists actually reach for, plus room for anything custom. */
        const NEW_PRESETS = [
            { w: 8, h: 8, label: '8×8', hint: '图标' },
            { w: 16, h: 16, label: '16×16', hint: '精灵' },
            { w: 24, h: 24, label: '24×24', hint: '角色' },
            { w: 32, h: 32, label: '32×32', hint: '常用' },
            { w: 48, h: 48, label: '48×48', hint: '场景' },
            { w: 64, h: 64, label: '64×64', hint: '场景' },
            { w: 128, h: 128, label: '128×128', hint: '大图' },
            { w: 160, h: 144, label: '160×144', hint: 'GB' },
            { w: 16, h: 32, label: '16×32', hint: '竖版' },
            { w: 32, h: 16, label: '32×16', hint: '横版' },
            { w: 64, h: 32, label: '64×32', hint: '横幅' },
        ];
        /** Keep in sync with MAX_SIDE in index.js. */
        const MAX_SIDE = 256;
        /** Keep in sync with MAX_EXPORT_PIXELS in index.js. */
        const MAX_EXPORT_PIXELS = 4096 * 4096;
        /** Magnifications offered by the Save-as dialog. */
        const EXPORT_SCALES = [1, 2, 3, 4, 6, 8, 12, 16];
        /** One character per palette slot, so an import can never use more colours than this. */
        const IMPORT_MAX_COLORS = CHARS.length;
        /** Where existing content sits when the canvas grows or shrinks. */
        const ANCHORS = [
            { id: 'nw', label: '↖' }, { id: 'n', label: '↑' }, { id: 'ne', label: '↗' },
            { id: 'w', label: '←' }, { id: 'c', label: '·' }, { id: 'e', label: '→' },
            { id: 'sw', label: '↙' }, { id: 's', label: '↓' }, { id: 'se', label: '↘' },
        ];

        const TOOLS = [
            { id: 'pencil', label: '铅笔', key: 'B', icon: 'pencil' },
            { id: 'eraser', label: '橡皮', key: 'E', icon: 'eraser' },
            { id: 'bucket', label: '油漆桶', key: 'G', icon: 'bucket' },
            { id: 'picker', label: '吸管', key: 'I', icon: 'picker' },
            { id: 'select', label: '选区', key: 'M', icon: 'select' },
        ];

        /* ------------------------------------------------------------------ */
        /* transport                                                          */
        /* ------------------------------------------------------------------ */

        async function callApi(payload) {
            const response = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-pixel-studio': '1' },
                body: JSON.stringify(payload),
            });
            let data = null;
            try {
                data = await response.json();
            } catch {
                throw new Error('响应无法解析');
            }
            if (!data || data.ok !== true) {
                const error = new Error((data && data.error) || `请求失败（${response.status}）`);
                error.code = data && data.error;
                throw error;
            }
            return data;
        }

        /* ------------------------------------------------------------------ */
        /* grid helpers                                                       */
        /* ------------------------------------------------------------------ */

        function blankRows(width, height) {
            return Array.from({ length: height }, () => '.'.repeat(width));
        }

        function charFor(index) {
            return index >= 0 && index < CHARS.length ? CHARS[index] : '.';
        }

        function indexFor(ch) {
            const position = CHARS.indexOf(ch);
            return position;
        }

        function setPixel(rows, x, y, ch) {
            const row = rows[y];
            if (row === undefined || x < 0 || x >= row.length) return rows;
            if (row[x] === ch) return rows;
            const next = rows.slice();
            next[y] = row.slice(0, x) + ch + row.slice(x + 1);
            return next;
        }

        /** Composited color of one cell: the topmost visible palette entry, '' if empty. */
        function colorAt(doc, x, y) {
            for (let l = doc.layers.length - 1; l >= 0; l -= 1) {
                const layer = doc.layers[l];
                if (layer.visible === false) continue;
                const row = layer.rows[y];
                const ch = row === undefined ? '.' : row[x];
                const index = ch === undefined ? -1 : indexFor(ch);
                if (index >= 0) return doc.palette[index] || '';
            }
            return '';
        }

        /**
         * Fills the region that looks contiguous *after compositing*: cells sharing one
         * visible color are covered even when they come from another palette entry or
         * from a lower layer. Returns null when the fill would change nothing.
         */
        function fillRegion(doc, layerIndex, startX, startY, replacement) {
            const layer = doc.layers[layerIndex];
            if (!layer) return null;
            const width = doc.w;
            const height = doc.h;
            if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null;
            const replacementColor = replacement === '.' ? '' : (doc.palette[indexFor(replacement)] || '');
            const target = colorAt(doc, startX, startY);
            if (target === replacementColor) return null;
            const seen = new Uint8Array(width * height);
            const grid = layer.rows.map((row) => row.split(''));
            const stack = [[startX, startY]];
            let changed = false;
            while (stack.length > 0) {
                const [x, y] = stack.pop();
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                const offset = y * width + x;
                if (seen[offset] === 1) continue;
                if (colorAt(doc, x, y) !== target) continue;
                seen[offset] = 1;
                if (grid[y] !== undefined && grid[y][x] !== replacement) {
                    grid[y][x] = replacement;
                    changed = true;
                }
                stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
            }
            if (!changed) return null;
            return grid.map((row) => row.join(''));
        }

        function lineCells(x0, y0, x1, y1) {
            const cells = [];
            let dx = Math.abs(x1 - x0);
            let dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1;
            const sy = y0 < y1 ? 1 : -1;
            let err = dx - dy;
            let x = x0;
            let y = y0;
            for (let guard = 0; guard < 4096; guard += 1) {
                cells.push([x, y]);
                if (x === x1 && y === y1) break;
                const e2 = err * 2;
                if (e2 > -dy) {
                    err -= dy;
                    x += sx;
                }
                if (e2 < dx) {
                    err += dx;
                    y += sy;
                }
            }
            return cells;
        }

        function hexToRgb(hex) {
            return [
                parseInt(hex.slice(1, 3), 16),
                parseInt(hex.slice(3, 5), 16),
                parseInt(hex.slice(5, 7), 16),
            ];
        }

        function readableText(hex) {
            const [r, g, b] = hexToRgb(hex.toLowerCase());
            return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
        }

        /**
         * Picks a swatch color that is not already on the palette, so "add color"
         * always produces a visibly new slot. Duplicated slots are legal (two
         * indices may share one color), they are just confusing as a default.
         */
        function nextFreeColor(palette) {
            const used = palette.map((color) => String(color).toLowerCase());
            const candidates = [
                '#ffffff', '#000000', '#ff004d', '#00e436', '#29adff', '#ffec27',
                '#ff77a8', '#83769c', '#ab5236', '#1d2b53', '#c2c3c7', '#7e2553',
            ];
            for (const candidate of candidates) {
                if (used.indexOf(candidate) === -1) return candidate;
            }
            for (let step = 0; step < 64; step += 1) {
                const level = (step * 37) % 256;
                const hex = `#${level.toString(16).padStart(2, '0').repeat(3)}`;
                if (used.indexOf(hex) === -1) return hex;
            }
            return '#ffffff';
        }

        /** Does any layer still reference this palette slot? */
        function slotInUse(doc, index) {
            if (!doc || index < 0) return false;
            const ch = charFor(index);
            if (!ch) return false;
            for (const layer of doc.layers) {
                for (const row of layer.rows) {
                    if (row.indexOf(ch) !== -1) return true;
                }
            }
            return false;
        }

        /** Rewrite every pixel of slot `from` so it points at slot `to`. */
        function remapSlot(layers, from, to) {
            const previous = charFor(from);
            const next = charFor(to);
            if (!previous || !next) return layers;
            return layers.map((layer) => ({
                ...layer,
                rows: layer.rows.map((row) => row.split('').map((ch) => (ch === previous ? next : ch)).join('')),
            }));
        }

        /**
         * Palette editing must never repaint the artwork. Before a slot's colour
         * changes we move the pixels that already use it onto a different slot
         * that takes over the old colour, so the canvas stays pixel-identical and
         * the edited slot is free to become the next drawing colour.
         */
        function detachSlot(doc, index) {
            const oldColor = doc.palette[index];
            if (oldColor === undefined) return { doc, target: -1, created: false };
            if (!slotInUse(doc, index)) return { doc, target: -1, created: false };
            let target = -1;
            for (let slot = 0; slot < doc.palette.length; slot += 1) {
                if (slot === index) continue;
                if (!slotInUse(doc, slot)) {
                    target = slot;
                    break;
                }
            }
            let palette = doc.palette.slice();
            let created = false;
            if (target === -1) {
                if (palette.length >= CHARS.length) return null;
                palette = palette.concat(oldColor);
                target = palette.length - 1;
                created = true;
            } else if (palette[target].toLowerCase() !== oldColor.toLowerCase()) {
                palette[target] = oldColor;
            }
            const layers = remapSlot(doc.layers, index, target);
            return { doc: { ...doc, palette, layers }, target, created };
        }

        function clamp(value, min, max) {
            return value < min ? min : (value > max ? max : value);
        }

        function readStored(key, fallback) {
            try {
                const value = window.localStorage.getItem(key);
                return value === null ? fallback : value;
            } catch {
                return fallback;
            }
        }

        function readStoredNumber(key, fallback) {
            const value = Number(readStored(key, ''));
            return Number.isFinite(value) && value > 0 ? value : fallback;
        }

        function storeValue(key, value) {
            try {
                window.localStorage.setItem(key, String(value));
            } catch {
                /* private mode: widths simply stay session-local */
            }
        }

        /* ------------------------------------------------------------------ */
        /* save-dialog path helpers                                           */
        /* ------------------------------------------------------------------ */

        function pathSeparator(value) {
            return typeof value === 'string' && value.includes('\\') ? '\\' : '/';
        }

        function joinPath(directory, name) {
            const dir = typeof directory === 'string' ? directory : '';
            const sep = pathSeparator(dir);
            if (dir === '') return name;
            return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
        }

        function baseNameOf(filePath) {
            if (typeof filePath !== 'string') return '';
            const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
            return cut >= 0 ? filePath.slice(cut + 1) : filePath;
        }

        function dirNameOf(filePath) {
            if (typeof filePath !== 'string') return '';
            const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
            return cut > 0 ? filePath.slice(0, cut) : '';
        }

        function ensurePngName(value) {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (trimmed === '') return 'pixel-art.png';
            return /\.png$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
        }

        /* ------------------------------------------------------------------ */
        /* canvas resize                                                      */
        /* ------------------------------------------------------------------ */

        /** Undo snapshot; width/height ride along so a canvas resize can be undone. */
        function snapshotOf(doc) {
            return {
                palette: doc.palette.slice(),
                layers: doc.layers.map((layer) => ({ ...layer, rows: layer.rows.slice() })),
                w: doc.w,
                h: doc.h,
            };
        }

        /** Offset that keeps existing pixels at the chosen anchor when the canvas changes size. */
        function anchorOffsets(anchor, oldWidth, oldHeight, newWidth, newHeight) {
            const id = typeof anchor === 'string' && anchor.length > 0 ? anchor : 'c';
            const dx = id.includes('w') ? 0
                : id.includes('e') ? newWidth - oldWidth
                    : Math.round((newWidth - oldWidth) / 2);
            const dy = id.includes('n') ? 0
                : id.includes('s') ? newHeight - oldHeight
                    : Math.round((newHeight - oldHeight) / 2);
            return [dx, dy];
        }

        /** Re-frames one layer onto a new canvas: grown areas become transparent, cropped pixels go away. */
        function resizeRows(rows, oldWidth, oldHeight, newWidth, newHeight, anchor) {
            const [dx, dy] = anchorOffsets(anchor, oldWidth, oldHeight, newWidth, newHeight);
            const next = [];
            for (let y = 0; y < newHeight; y += 1) {
                const sourceY = y - dy;
                const row = sourceY >= 0 && sourceY < oldHeight ? String(rows[sourceY] === undefined ? '' : rows[sourceY]) : '';
                let line = '';
                for (let x = 0; x < newWidth; x += 1) {
                    const sourceX = x - dx;
                    const ch = sourceX >= 0 && sourceX < oldWidth ? row[sourceX] : undefined;
                    line += ch === undefined || ch === '' ? '.' : ch;
                }
                next.push(line);
            }
            return next;
        }

        /* ------------------------------------------------------------------ */
        /* selection                                                          */
        /* ------------------------------------------------------------------ */

        const MIN_SELECTION = 1;

        /** Normalised rectangle spanning two grid cells (both inclusive). */
        function selectionBetween(a, b) {
            return {
                x: Math.min(a.x, b.x),
                y: Math.min(a.y, b.y),
                w: Math.abs(a.x - b.x) + 1,
                h: Math.abs(a.y - b.y) + 1,
            };
        }

        /** Keeps a rectangle inside the canvas, shrinking it at the far edges. */
        function clampRectangle(rect, width, height) {
            const x = clamp(Math.round(rect.x), 0, Math.max(0, width - MIN_SELECTION));
            const y = clamp(Math.round(rect.y), 0, Math.max(0, height - MIN_SELECTION));
            const w = clamp(Math.round(rect.w), MIN_SELECTION, Math.max(MIN_SELECTION, width - x));
            const h = clamp(Math.round(rect.h), MIN_SELECTION, Math.max(MIN_SELECTION, height - y));
            return { x, y, w, h };
        }

        /** Slides a rectangle to (x, y) without changing its size or leaving the canvas. */
        function moveRectangle(rect, x, y, width, height) {
            return {
                x: clamp(Math.round(x), 0, Math.max(0, width - rect.w)),
                y: clamp(Math.round(y), 0, Math.max(0, height - rect.h)),
                w: rect.w,
                h: rect.h,
            };
        }

        function pointInRectangle(rect, cell) {
            return cell.x >= rect.x && cell.x < rect.x + rect.w && cell.y >= rect.y && cell.y < rect.y + rect.h;
        }

        /** Copies the selected characters out of one layer, padding short rows. */
        function readRegion(rows, rect) {
            const region = [];
            for (let y = 0; y < rect.h; y += 1) {
                const line = rows[rect.y + y] || '';
                region.push(line.slice(rect.x, rect.x + rect.w).padEnd(rect.w, '.'));
            }
            return region;
        }

        /** Writes characters back into one layer, leaving every other cell untouched. */
        function writeRegion(rows, region, x, y) {
            const next = rows.slice();
            for (let row = 0; row < region.length; row += 1) {
                const target = y + row;
                if (target < 0 || target >= next.length) continue;
                const chars = (next[target] || '').split('');
                for (let column = 0; column < region[row].length; column += 1) {
                    const at = x + column;
                    if (at >= 0 && at < chars.length) chars[at] = region[row][column] || '.';
                }
                next[target] = chars.join('');
            }
            return next;
        }

        function blankRegion(rect) {
            const region = [];
            for (let y = 0; y < rect.h; y += 1) region.push('.'.repeat(rect.w));
            return region;
        }

        function fillRows(rows, rect, ch) {
            const region = [];
            for (let y = 0; y < rect.h; y += 1) region.push(ch.repeat(rect.w));
            return writeRegion(rows, region, rect.x, rect.y);
        }

        function emptyRows(rows, rect) {
            return writeRegion(rows, blankRegion(rect), rect.x, rect.y);
        }

        /** Mirrors the selected characters inside the box. */
        function mirrorRows(rows, rect, horizontal) {
            const region = readRegion(rows, rect);
            const flipped = horizontal
                ? region.map((line) => line.split('').reverse().join(''))
                : region.slice().reverse();
            return writeRegion(rows, flipped, rect.x, rect.y);
        }

        /** Top-most visible character in every cell of the rectangle, for the move preview. */
        function mergedRegion(layers, rect) {
            const region = blankRegion(rect);
            layers.forEach((layer) => {
                if (layer.visible === false) return;
                for (let y = 0; y < rect.h; y += 1) {
                    const line = layer.rows[rect.y + y] || '';
                    const chars = region[y].split('');
                    for (let x = 0; x < rect.w; x += 1) {
                        const ch = line[rect.x + x];
                        if (ch && ch !== '.') chars[x] = ch;
                    }
                    region[y] = chars.join('');
                }
            });
            return region;
        }

        /* ------------------------------------------------------------------ */
        /* image import                                                       */
        /* ------------------------------------------------------------------ */

        /** Largest integer magnification whose PNG stays under the host's pixel cap. */
        function maxScaleFor(width, height) {
            return Math.max(1, Math.floor(Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, width * height))));
        }

        /** Remembered export magnification, clamped to what the host can encode for this canvas. */
        function clampExportScale(value, width, height) {
            const wanted = Math.round(Number(value) || 1);
            if (!Number.isFinite(wanted) || wanted < 1) return 1;
            const ceiling = Math.min(64, maxScaleFor(width, height));
            return wanted > ceiling ? ceiling : wanted;
        }

        function clampByte(value) {
            const number = Math.round(Number(value) || 0);
            if (number < 0) return 0;
            return number > 255 ? 255 : number;
        }

        function hex2(value) {
            return clampByte(value).toString(16).padStart(2, '0');
        }

        function rgbOf(color) {
            return [Number(color[0]) || 0, Number(color[1]) || 0, Number(color[2]) || 0];
        }

        function colorDistanceSq(a, b) {
            const dr = a[0] - b[0];
            const dg = a[1] - b[1];
            const db = a[2] - b[2];
            return dr * dr + dg * dg + db * db;
        }

        function nearestColorIndex(paletteRgb, color) {
            let best = 0;
            let bestDistance = Infinity;
            for (let i = 0; i < paletteRgb.length; i += 1) {
                const distance = colorDistanceSq(paletteRgb[i], color);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    best = i;
                }
            }
            return best;
        }

        /** RGB extent of a colour box: [ranges, channel with the widest range]. */
        function boxExtent(box) {
            let minR = 255; let minG = 255; let minB = 255;
            let maxR = 0; let maxG = 0; let maxB = 0;
            for (const color of box) {
                if (color[0] < minR) minR = color[0];
                if (color[1] < minG) minG = color[1];
                if (color[2] < minB) minB = color[2];
                if (color[0] > maxR) maxR = color[0];
                if (color[1] > maxG) maxG = color[1];
                if (color[2] > maxB) maxB = color[2];
            }
            const ranges = [maxR - minR, maxG - minG, maxB - minB];
            let channel = 0;
            if (ranges[1] > ranges[channel]) channel = 1;
            if (ranges[2] > ranges[channel]) channel = 2;
            return { ranges, channel, widest: ranges[channel] };
        }

        function averageColor(box) {
            let r = 0; let g = 0; let b = 0;
            for (const color of box) {
                r += color[0]; g += color[1]; b += color[2];
            }
            const count = box.length === 0 ? 1 : box.length;
            return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
        }

        /** Median cut: fold thousands of photo colours into at most `limit` representative ones. */
        function quantizeColors(colors, limit) {
            if (colors.length <= limit) return colors.slice();
            const boxes = [colors.slice()];
            while (boxes.length < limit) {
                let index = -1;
                let score = -1;
                for (let i = 0; i < boxes.length; i += 1) {
                    const box = boxes[i];
                    if (box.length < 2) continue;
                    const extent = boxExtent(box);
                    const weight = extent.widest * Math.min(box.length, 256);
                    if (weight > score) {
                        score = weight;
                        index = i;
                    }
                }
                if (index === -1) break;
                const box = boxes[index];
                const channel = boxExtent(box).channel;
                const sorted = box.slice().sort((a, b) => a[channel] - b[channel]);
                const middle = Math.max(1, Math.floor(sorted.length / 2));
                boxes.splice(index, 1, sorted.slice(0, middle), sorted.slice(middle));
            }
            return boxes.map(averageColor);
        }

        /** Most common opaque colours of a sampled image, as hex strings plus RGB triples. */
        function paletteFromSample(sample, limit) {
            const counts = new Map();
            const total = sample.width * sample.height;
            for (let i = 0; i < total; i += 1) {
                if (sample.data[i * 4 + 3] < 128) continue;
                const key = (sample.data[i * 4] << 16) | (sample.data[i * 4 + 1] << 8) | sample.data[i * 4 + 2];
                counts.set(key, (counts.get(key) || 0) + 1);
            }
            const ordered = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([key]) => [Number((key >> 16) & 255), Number((key >> 8) & 255), Number(key & 255)]);
            const limited = ordered.length > limit ? quantizeColors(ordered, limit) : ordered;
            const rgb = limited.map((color) => [color[0], color[1], color[2]]);
            return {
                palette: rgb.map(([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`),
                rgb,
                original: ordered.length,
            };
        }

        /** Maps sampled pixels onto the palette; optional Floyd–Steinberg dithering spreads the error. */
        function buildImportRows(sample, paletteRgb, dither) {
            const { width, height, data } = sample;
            const work = new Float32Array(width * height * 3);
            for (let i = 0; i < width * height; i += 1) {
                work[i * 3] = data[i * 4];
                work[i * 3 + 1] = data[i * 4 + 1];
                work[i * 3 + 2] = data[i * 4 + 2];
            }
            const rows = [];
            const spread = (x, y, error, dx, dy, weight) => {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny >= height) return;
                const at = ny * width + nx;
                if (data[at * 4 + 3] < 128) return;
                work[at * 3] += error[0] * weight;
                work[at * 3 + 1] += error[1] * weight;
                work[at * 3 + 2] += error[2] * weight;
            };
            for (let y = 0; y < height; y += 1) {
                let line = '';
                for (let x = 0; x < width; x += 1) {
                    const at = y * width + x;
                    if (data[at * 4 + 3] < 128) {
                        line += '.';
                        continue;
                    }
                    const color = [work[at * 3], work[at * 3 + 1], work[at * 3 + 2]];
                    const index = nearestColorIndex(paletteRgb, color);
                    line += charFor(index);
                    if (dither) {
                        const chosen = paletteRgb[index];
                        const error = [color[0] - chosen[0], color[1] - chosen[1], color[2] - chosen[2]];
                        spread(x, y, error, 1, 0, 7 / 16);
                        spread(x, y, error, -1, 1, 3 / 16);
                        spread(x, y, error, 0, 1, 5 / 16);
                        spread(x, y, error, 1, 1, 1 / 16);
                    }
                }
                rows.push(line);
            }
            return rows;
        }

        /** PNG data URL of a char grid, shown as the import preview. */
        function previewDataUrl(palette, rows) {
            const height = rows.length;
            const width = height > 0 ? rows[0].length : 0;
            if (width === 0 || height === 0) return '';
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) return '';
            const image = context.createImageData(width, height);
            const rgb = palette.map(hexToRgb);
            for (let y = 0; y < height; y += 1) {
                const row = rows[y];
                for (let x = 0; x < width; x += 1) {
                    const index = indexFor(row === undefined ? '.' : row[x]);
                    const offset = (y * width + x) * 4;
                    if (index < 0 || index >= rgb.length) {
                        image.data[offset + 3] = 0;
                        continue;
                    }
                    image.data[offset] = rgb[index][0];
                    image.data[offset + 1] = rgb[index][1];
                    image.data[offset + 2] = rgb[index][2];
                    image.data[offset + 3] = 255;
                }
            }
            context.putImageData(image, 0, 0);
            return canvas.toDataURL('image/png');
        }

        /** Decoded pixels of a picked file, downscaled into the editor's size cap. */
        async function readImagePixels(file) {
            const url = window.URL.createObjectURL(file);
            try {
                const image = await new Promise((resolve, reject) => {
                    const element = new window.Image();
                    element.onload = () => resolve(element);
                    element.onerror = () => reject(new Error('无法解码这张图片（试 PNG / JPG）'));
                    element.src = url;
                });
                const sourceW = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
                const sourceH = Math.max(1, Math.round(image.naturalHeight || image.height || 1));
                const ratio = Math.min(1, MAX_SIDE / Math.max(sourceW, sourceH));
                const width = Math.max(1, Math.round(sourceW * ratio));
                const height = Math.max(1, Math.round(sourceH * ratio));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('浏览器不支持读取图片');
                context.imageSmoothingEnabled = ratio < 1;
                context.drawImage(image, 0, 0, width, height);
                const data = context.getImageData(0, 0, width, height).data;
                return { width, height, sourceW, sourceH, data };
            } finally {
                window.URL.revokeObjectURL(url);
            }
        }

        function importName(file) {
            const raw = file && typeof file.name === 'string' ? file.name : '';
            const stem = raw.replace(/\.[^.]+$/, '').trim();
            return (stem || '导入的图片').slice(0, 60);
        }

        /** Rebuilds palette + rows + preview for the current import options. */
        function buildImportDocument(dialog, currentPalette) {
            const sample = dialog.sample;
            let palette;
            let rgb;
            let note = '';
            if (dialog.mode === 'current' && Array.isArray(currentPalette) && currentPalette.length > 0) {
                palette = currentPalette.slice(0, IMPORT_MAX_COLORS);
                rgb = palette.map(hexToRgb).map(rgbOf);
            } else if (dialog.mode === 'pico8') {
                palette = PRESETS[0].colors.slice(0, IMPORT_MAX_COLORS);
                rgb = palette.map(hexToRgb).map(rgbOf);
            } else {
                const auto = paletteFromSample(sample, IMPORT_MAX_COLORS);
                palette = auto.palette;
                rgb = auto.rgb;
                note = auto.original > palette.length
                    ? `${auto.original} 种颜色压到 ${palette.length} 种`
                    : `${auto.original} 种颜色`;
            }
            if (palette.length === 0) {
                palette = ['#000000'];
                rgb = [[0, 0, 0]];
            }
            const rows = buildImportRows(sample, rgb, dialog.dither === true);
            return {
                ...dialog,
                palette,
                rows,
                note,
                preview: previewDataUrl(palette, rows),
                error: '',
            };
        }

        /* ------------------------------------------------------------------ */
        /* icons                                                              */
        /* ------------------------------------------------------------------ */

        function ToolIcon({ name }) {
            const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' };
            if (name === 'pencil') {
                return h('svg', common, h('path', {
                    d: 'M11.6 1.9 14.1 4.4 5.6 12.9 2.3 13.7 3.1 10.4z',
                    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
                }));
            }
            if (name === 'eraser') {
                return h('svg', common,
                    h('path', {
                        d: 'M9.8 2.2 13.8 6.2 8.3 11.7 4.3 7.7z',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
                    }),
                    h('path', { d: 'M4.3 7.7 2 10v3.5h5.2L8.3 11.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }));
            }
            if (name === 'bucket') {
                return h('svg', common,
                    h('path', {
                        d: 'M6.2 2.6 12.9 9.3 8 14.2 1.9 8.1z',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
                    }),
                    h('path', { d: 'M13.2 10.4c1 1.2 1.5 2 1.5 2.6a1.5 1.5 0 0 1-3 0c0-.6.5-1.4 1.5-2.6z', fill: 'currentColor' }));
            }
            if (name === 'select') {
                return h('svg', common,
                    h('rect', {
                        x: 2.5, y: 2.5, width: 11, height: 11, rx: 1,
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeDasharray: '3 2',
                    }),
                    h('path', { d: 'M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));
            }
            return h('svg', common,
                h('path', {
                    d: 'M9.9 2.6a3.4 3.4 0 1 0 3.5 3.4c0-.6-.2-1.2-.5-1.7l1.6-1.6-1.1-1.1-1.6 1.6a3.4 3.4 0 0 0-1.9-.6z',
                    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
                }),
                h('path', { d: 'M8.2 6.4 2.1 12.5a1.6 1.6 0 0 0 2.2 2.2l6.1-6.1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }));
        }

        function UndoIcon({ flipped }) {
            return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: flipped ? { transform: 'scaleX(-1)' } : undefined },
                h('path', { d: 'M6 3.5 2.8 6.7 6 9.9', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                h('path', { d: 'M3.2 6.7h5.4a4 4 0 0 1 0 8H6.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }));
        }

        /* ------------------------------------------------------------------ */
        /* styles                                                             */
        /* ------------------------------------------------------------------ */

        const CSS = `
.pxs-root {
  height: 100%; min-height: 520px; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base, #16181d); color: var(--dsw-alias-label-primary, #e8e8ea);
  font-size: 12px; line-height: 1.45; position: relative; overflow: hidden;
}
.pxs-bar {
  flex: 0 0 auto; height: 40px; display: flex; align-items: center; gap: 6px; padding: 0 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1));
  background: var(--dsw-alias-bg-layer-1, #1c1f26);
}
.pxs-main {
  flex: 1 1 auto; min-height: 0; display: grid;
  grid-template-columns:
    var(--pxs-left, 196px) 5px minmax(0, 1fr) 5px var(--pxs-right, 216px);
}
.pxs-panel {
  min-height: 0; overflow-y: auto; padding: 10px; position: relative;
  background: var(--dsw-alias-bg-layer-1, #1c1f26);
}
.pxs-panel-left { border-right: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1)); }
.pxs-panel-right { border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.1)); }
.pxs-splitter {
  position: relative; z-index: 4; cursor: col-resize; background: transparent; touch-action: none;
}
.pxs-splitter::after {
  content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 1px;
  background: var(--dsw-alias-border-l1, rgba(255,255,255,.1));
}
.pxs-splitter:hover, .pxs-splitter[data-dragging="true"] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 32%, transparent);
}
.pxs-layers { display: flex; flex-direction: column; gap: 3px; }
.pxs-layer {
  display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 6px;
  border: 1px solid transparent; cursor: pointer; user-select: none;
}
.pxs-layer:hover { background: var(--dsw-alias-bg-layer-2, #232730); }
.pxs-layer[data-active="true"] {
  border-color: var(--dsw-alias-brand-primary, #4c8dff);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 16%, transparent);
}
.pxs-layer[data-hidden="true"] .pxs-layer-name { opacity: .45; }
.pxs-layer-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pxs-layer-eye {
  width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); flex: 0 0 auto;
}
.pxs-layer-eye:hover { background: rgba(255,255,255,.08); color: var(--dsw-alias-label-primary, #e8e8ea); }
.pxs-layer-rename {
  flex: 1 1 auto; min-width: 0; height: 20px; padding: 0 4px; font: inherit; color: inherit;
  border-radius: 4px; border: 1px solid var(--dsw-alias-brand-primary, #4c8dff);
  background: var(--dsw-alias-bg-base, #16181d);
}
.pxs-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #16181d); touch-action: none; }
.pxs-canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }
.pxs-canvas.is-panning { cursor: grabbing; }
.pxs-canvas.is-space { cursor: grab; }
.pxs-section { margin-bottom: 14px; }
.pxs-section:last-child { margin-bottom: 4px; }
.pxs-title {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 6px;
  color: var(--dsw-alias-label-secondary, #9aa1ad);
}
.pxs-row { display: flex; flex-wrap: wrap; gap: 4px; }
.pxs-btn {
  appearance: none; cursor: pointer; border-radius: 6px; padding: 0 8px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
  background: var(--dsw-alias-bg-layer-2, #232730); color: inherit; font: inherit;
}
.pxs-btn:hover { border-color: var(--dsw-alias-border-l2, rgba(255,255,255,.28)); }
.pxs-btn:disabled { opacity: .4; cursor: default; }
.pxs-btn[data-active="true"] {
  border-color: var(--dsw-alias-brand-primary, #4c8dff);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 18%, transparent);
}
.pxs-btn-icon { width: 26px; padding: 0; }
.pxs-input {
  min-width: 0; height: 26px; padding: 0 8px; border-radius: 6px; font: inherit; color: inherit;
  background: var(--dsw-alias-bg-layer-2, #232730);
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.12));
}
.pxs-input:focus { outline: 1px solid var(--dsw-alias-brand-primary, #4c8dff); outline-offset: 0; }
.pxs-spacer { flex: 1 1 auto; }
.pxs-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
.pxs-swatch {
  aspect-ratio: 1; border-radius: 4px; cursor: pointer; padding: 0; border: 1px solid rgba(0,0,0,.35);
  position: relative;
}
.pxs-swatch[data-selected="true"] { box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary, #4c8dff); z-index: 1; }
.pxs-swatch-add {
  aspect-ratio: 1; border-radius: 4px; cursor: pointer; border: 1px dashed var(--dsw-alias-border-l2, rgba(255,255,255,.3));
  background: transparent; color: var(--dsw-alias-label-secondary, #9aa1ad); font-size: 14px; line-height: 1;
}
.pxs-primary { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pxs-chip { width: 34px; height: 34px; border-radius: 8px; border: 1px solid rgba(0,0,0,.4); flex: 0 0 auto; }
.pxs-hex { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); }
.pxs-color-edit {
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16));
  border-radius: 8px; padding: 8px; display: grid; gap: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04));
}
.pxs-color-edit-head { display: flex; align-items: center; gap: 6px; }
.pxs-color-edit-head .pxs-chip { width: 26px; height: 26px; border-radius: 6px; }
.pxs-hex-input {
  flex: 1 1 auto; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; text-transform: uppercase;
}
.pxs-color-edit-sliders { display: grid; gap: 4px; }
.pxs-slider-row { display: grid; grid-template-columns: 10px 1fr 26px; align-items: center; gap: 6px; }
.pxs-slider-label { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #9aa1ad); }
.pxs-slider-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; text-align: right;
  color: var(--dsw-alias-label-secondary, #9aa1ad);
}
.pxs-range { width: 100%; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary, #4c8dff); }
.pxs-meta { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); }
.pxs-meta b { color: var(--dsw-alias-label-primary, #e8e8ea); font-weight: 500; }
.pxs-keys { font-size: 10.5px; color: var(--dsw-alias-label-secondary, #9aa1ad); display: grid; gap: 2px; }
.pxs-keys kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; padding: 0 4px; border-radius: 3px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14));
  background: var(--dsw-alias-bg-base, #16181d);
}
.pxs-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; text-align: center; padding: 24px;
}
.pxs-empty h3 { margin: 0; font-size: 15px; font-weight: 600; }
.pxs-empty p { margin: 0; color: var(--dsw-alias-label-secondary, #9aa1ad); max-width: 320px; }
.pxs-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); }
.pxs-fallback {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center;
}
.pxs-fallback h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-state-error-primary, #e0574f); }
.pxs-fallback p {
  margin: 0; max-width: 520px; font-size: 11px; word-break: break-word;
  color: var(--dsw-alias-label-secondary, #9aa1ad); font-family: ui-monospace, Menlo, monospace;
}
.pxs-status { font-size: 11px; color: var(--dsw-alias-label-secondary, #9aa1ad); min-width: 54px; text-align: right; }
.pxs-status[data-state="dirty"] { color: var(--dsw-alias-state-warn-primary, #e0a33a); }
.pxs-status[data-state="error"] { color: var(--dsw-alias-state-error-primary, #e0574f); }
.pxs-select-status {
  min-width: 0; text-align: left; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-brand-primary, #7aa2f7);
}
.pxs-selection-bar {
  position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 3;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 6px 8px; border-radius: 9px;
  background: var(--dsw-alias-bg-overlay, rgba(38, 42, 51, .9));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, .2));
  box-shadow: 0 6px 20px rgba(0, 0, 0, .28);
  backdrop-filter: blur(6px);
}
.pxs-selection-bar .pxs-btn { height: 24px; padding: 0 8px; font-size: 11px; }
.pxs-selection-label {
  font-size: 11px; margin-right: auto; color: var(--dsw-alias-label-secondary, #9aa1ad);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pxs-notice {
    font-size: 11px;
    color: var(--dsw-alias-state-success-primary, #3fa45b);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pxs-modal {
    position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, .45); padding: 24px;
}
.pxs-dialog {
    display: flex; flex-direction: column; gap: 10px; width: min(560px, 100%); max-height: 100%;
    padding: 14px; border-radius: 10px; box-sizing: border-box;
    background: var(--dsw-alias-bg-overlay, #262a33);
    border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, .2));
    box-shadow: 0 18px 48px rgba(0, 0, 0, .45);
    color: var(--dsw-alias-label-primary, #e8ebf2); font-size: 12px;
}
.pxs-dialog-head { display: flex; align-items: center; justify-content: space-between; }
.pxs-dialog-close {
    width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;
    background: transparent; color: var(--dsw-alias-label-secondary, #9aa3b2); font-size: 16px; line-height: 1;
}
.pxs-dialog-close:hover { background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .08)); color: var(--dsw-alias-label-primary, #e8ebf2); }
.pxs-dialog-row { display: flex; align-items: center; gap: 6px; }
.pxs-dialog-label { color: var(--dsw-alias-label-secondary, #9aa3b2); min-width: 42px; }
.pxs-dialog-list {
    display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 160px; max-height: 46vh;
    padding: 6px; border-radius: 8px; box-sizing: border-box;
    background: var(--dsw-alias-bg-layer-1, #1c1f26);
    border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
}
.pxs-dialog-item {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; text-align: left;
    border: 0; border-radius: 6px; cursor: pointer; font: inherit;
    background: transparent; color: var(--dsw-alias-label-primary, #e8ebf2);
}
.pxs-dialog-item::before { content: '📁'; font-size: 12px; }
.pxs-dialog-item:hover { background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .08)); }
.pxs-dialog-item[data-hidden="true"] { opacity: .6; }
.pxs-dialog-empty { padding: 12px 8px; color: var(--dsw-alias-label-secondary, #9aa3b2); text-align: center; }
.pxs-dialog-error { color: var(--dsw-alias-state-error-primary, #e0574f); word-break: break-all; }
.pxs-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.pxs-btn-primary {
    background: var(--dsw-alias-brand-primary, #4b7bec); border-color: transparent;
    color: #fff;
}
.pxs-native-color {
    width: 40px; height: 28px; padding: 0; border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, .18));
    border-radius: 6px; background: transparent; cursor: pointer; flex: none;
}
.pxs-native-color::-webkit-color-swatch-wrapper { padding: 2px; }
.pxs-native-color::-webkit-color-swatch { border: 0; border-radius: 4px; }
.pxs-native-color::-moz-color-swatch { border: 0; border-radius: 4px; }
.pxs-picker-btn { width: 100%; }
.pxs-hint { color: var(--dsw-alias-label-secondary, #9aa3b2); line-height: 1.5; margin: 0; }
.pxs-new-dialog { width: min(420px, calc(100vw - 40px)); }
.pxs-size-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
.pxs-size-chip {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 7px;
    border-radius: 7px; cursor: pointer; font: inherit; text-align: left;
    color: var(--dsw-alias-label-primary, #e8ebf2);
    background: var(--dsw-alias-bg-layer-1, #1c1f26);
    border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
}
.pxs-size-chip:hover { border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .2)); }
.pxs-size-chip[data-active="true"] {
    border-color: var(--dsw-alias-brand-primary, #4b7bec);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4b7bec) 16%, transparent);
}
.pxs-size-label { font-size: 12px; font-weight: 600; }
.pxs-size-hint { font-size: 10px; color: var(--dsw-alias-label-secondary, #9aa3b2); }
.pxs-import-dialog, .pxs-resize-dialog { width: min(460px, calc(100vw - 40px)); }
.pxs-scale-chip {
    flex-direction: row; align-items: center; gap: 0; padding: 3px 8px; border-radius: 999px;
    font-size: 11px; color: var(--dsw-alias-label-primary, #e8ebf2);
    background: var(--dsw-alias-bg-layer-1, #1c1f26);
    border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
}
.pxs-scale-chip:hover { border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .2)); }
.pxs-scale-chip[data-active="true"] {
    border-color: var(--dsw-alias-brand-primary, #4b7bec);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4b7bec) 18%, transparent);
}
.pxs-scale-chip:disabled { opacity: .45; cursor: not-allowed; }
.pxs-import-preview {
    display: flex; justify-content: center; padding: 8px; border-radius: 8px;
    background: var(--dsw-alias-bg-layer-1, #1c1f26);
    border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .08));
    max-height: 190px; overflow: auto;
}
.pxs-import-preview img {
    image-rendering: pixelated; max-width: 100%; max-height: 172px;
}
.pxs-anchor-grid {
    display: grid; grid-template-columns: repeat(3, 30px); gap: 3px;
}
.pxs-anchor-chip {
    width: 30px; height: 26px; border-radius: 6px; cursor: pointer; font: inherit;
    line-height: 1; color: var(--dsw-alias-label-primary, #e8ebf2);
    background: var(--dsw-alias-bg-layer-1, #1c1f26);
    border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
}
.pxs-anchor-chip:hover { border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .24)); }
.pxs-anchor-chip[data-active="true"] {
    border-color: var(--dsw-alias-brand-primary, #4b7bec);
    background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4b7bec) 18%, transparent);
}
.pxs-menu {
  position: fixed; z-index: 40; min-width: 132px; padding: 4px; border-radius: 8px;
  background: var(--dsw-alias-bg-overlay, #262a33); border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.2));
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
}
.pxs-menu button {
  display: block; width: 100%; text-align: left; padding: 5px 8px; border: 0; border-radius: 5px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.pxs-menu button:hover { background: var(--dsw-alias-bg-layer-2, #232730); }
.pxs-menu button[data-danger="true"] { color: var(--dsw-alias-state-error-primary, #e0574f); }
.pxs-error {
  flex: 0 0 auto; padding: 4px 10px; font-size: 11px;
  color: var(--dsw-alias-state-error-primary, #e0574f);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e0574f) 12%, transparent);
}
@media (max-width: 900px) {
  .pxs-main { grid-template-columns: 168px 5px minmax(0, 1fr) 5px 176px; }
}
@media (max-width: 700px) {
  .pxs-main { grid-template-columns: 56px 5px minmax(0, 1fr) 5px 132px; }
  .pxs-panel { padding: 6px; }
  .pxs-hide-narrow { display: none; }
}
`;

        /* ------------------------------------------------------------------ */
        /* editor                                                             */
        /* ------------------------------------------------------------------ */

        function PixelStudio(props) {
            const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : '';
            const [docs, setDocs] = useState([]);
            const [doc, setDoc] = useState(null);
            const [layerIndex, setLayerIndex] = useState(0);
            const [tool, setTool] = useState('pencil');
            const [colorIndex, setColorIndex] = useState(0);
            const [brush, setBrush] = useState(1);
            const [zoom, setZoom] = useState(8);
            const [status, setStatus] = useState('idle');
            const [notice, setNotice] = useState('');
            const [error, setError] = useState('');
            const [loading, setLoading] = useState(true);
            const [menu, setMenu] = useState(null);
            const [creating, setCreating] = useState(false);
            const [newDialog, setNewDialog] = useState(null);
            const [showGrid, setShowGrid] = useState(() => readStored('pxs:grid', '1') !== '0');
            const [leftWidth, setLeftWidth] = useState(() => clamp(readStoredNumber('pxs:left', 196), 132, 360));
            const [rightWidth, setRightWidth] = useState(() => clamp(readStoredNumber('pxs:right', 216), 152, 420));
            const [renaming, setRenaming] = useState(-1);
            const [renameValue, setRenameValue] = useState('');
            const [saveDialog, setSaveDialog] = useState(null);
            const [editing, setEditing] = useState(null);
            const [importDialog, setImportDialog] = useState(null);
            const [resizeDialog, setResizeDialog] = useState(null);
            const [selection, setSelection] = useState(null);
            const [grabMode, setGrabMode] = useState(false);
            const [allLayersMode, setAllLayersMode] = useState(false);

            const stageRef = useRef(null);
            const canvasRef = useRef(null);
            const offRef = useRef(null);
            const docRef = useRef(null);
            const scaleRef = useRef(8);
            const panRef = useRef({ x: 0, y: 0 });
            const toolRef = useRef('pencil');
            const colorRef = useRef(0);
            const brushRef = useRef(1);
            const layerRef = useRef(0);
            const strokeRef = useRef(null);
            const panDrawRef = useRef(null);
            const spaceRef = useRef(false);
            const historyRef = useRef({ undo: [], redo: [] });
            const saveTimerRef = useRef(0);
            /** Palette slot currently open in the built-in color editor. */
            const editingRef = useRef(null);
            /** Colour the edited slot had when the editor opened (before any edit). */
            const editSessionRef = useRef(null);
            const hexInputRef = useRef(null);
            const nativeColorRef = useRef(null);
            const frameRef = useRef(0);
            const mainRef = useRef(null);
            const gridRef = useRef(true);
            const splitRef = useRef(null);
            const sizeRef = useRef({ left: 196, right: 216 });
            // Indirection for the save-as action: the keyboard effect is registered
            // before the callback is created, so it must not close over the binding.
            const saveAsRef = useRef(null);
            const fileRef = useRef(null);
            /** Live rectangle, read by the pointer handlers and the paint loop. */
            const selectionRef = useRef(null);
            /** In-flight selection drag: { mode, pointerId, start, origin }. */
            const selectDragRef = useRef(null);
            /** Indirection for the keyboard effect, which is registered before these callbacks exist. */
            const selectApiRef = useRef({});
            const grabRef = useRef(false);
            const allLayersRef = useRef(false);

            if (gridRef.current !== showGrid) gridRef.current = showGrid;
            sizeRef.current = { left: leftWidth, right: rightWidth };
            if (editingRef.current !== editing) editingRef.current = editing;
            if (grabRef.current !== grabMode) grabRef.current = grabMode;
            if (allLayersRef.current !== allLayersMode) allLayersRef.current = allLayersMode;
            selectionRef.current = selection;

            docRef.current = doc;
            toolRef.current = tool;
            colorRef.current = colorIndex;
            brushRef.current = brush;
            layerRef.current = layerIndex;

            /* -------------------------------------------------------------- */
            /* painting                                                       */
            /* -------------------------------------------------------------- */

            const composeImage = useCallback(() => {
                const current = docRef.current;
                if (!current) return null;
                let off = offRef.current;
                if (!off) {
                    off = document.createElement('canvas');
                    offRef.current = off;
                }
                if (off.width !== current.w || off.height !== current.h) {
                    off.width = current.w;
                    off.height = current.h;
                }
                const context = off.getContext('2d');
                if (!context) return null;
                const image = context.createImageData(current.w, current.h);
                const rgb = current.palette.map(hexToRgb);
                const paletteRgb = rgb.map(([r, g, b]) => [r, g, b]);
                for (let y = 0; y < current.h; y += 1) {
                    for (let x = 0; x < current.w; x += 1) {
                        let color = null;
                        for (let l = current.layers.length - 1; l >= 0; l -= 1) {
                            const layer = current.layers[l];
                            if (layer.visible === false) continue;
                            const row = layer.rows[y];
                            const ch = row === undefined ? '.' : row[x];
                            const index = ch === undefined ? -1 : indexFor(ch);
                            if (index >= 0 && index < paletteRgb.length) {
                                color = paletteRgb[index];
                                break;
                            }
                        }
                        const offset = (y * current.w + x) * 4;
                        if (color === null) {
                            image.data[offset + 3] = 0;
                        } else {
                            image.data[offset] = color[0];
                            image.data[offset + 1] = color[1];
                            image.data[offset + 2] = color[2];
                            image.data[offset + 3] = 255;
                        }
                    }
                }
                context.putImageData(image, 0, 0);
                return off;
            }, []);

            const paint = useCallback(() => {
                frameRef.current = 0;
                const canvas = canvasRef.current;
                const stage = stageRef.current;
                const current = docRef.current;
                if (!canvas || !stage || !current) return;
                const context = canvas.getContext('2d');
                if (!context) return;
                const dpr = window.devicePixelRatio || 1;
                const width = Math.max(1, Math.round(stage.clientWidth));
                const height = Math.max(1, Math.round(stage.clientHeight));
                if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
                    canvas.width = Math.round(width * dpr);
                    canvas.height = Math.round(height * dpr);
                }
                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.clearRect(0, 0, width, height);

                const scale = scaleRef.current;
                const pan = panRef.current;
                const docWidth = current.w * scale;
                const docHeight = current.h * scale;

                // Checkerboard under the artwork so transparent pixels read as empty.
                context.save();
                context.beginPath();
                context.rect(pan.x, pan.y, docWidth, docHeight);
                context.clip();
                const cell = 8;
                const light = 'rgba(255,255,255,0.055)';
                const dark = 'rgba(255,255,255,0.015)';
                context.fillStyle = dark;
                context.fillRect(pan.x, pan.y, docWidth, docHeight);
                context.fillStyle = light;
                const startX = Math.floor(pan.x / cell) * cell;
                const startY = Math.floor(pan.y / cell) * cell;
                for (let y = startY; y < pan.y + docHeight; y += cell) {
                    for (let x = startX; x < pan.x + docWidth; x += cell) {
                        if (((x / cell) + (y / cell)) % 2 === 0) continue;
                        context.fillRect(x, y, cell, cell);
                    }
                }
                context.restore();

                const off = composeImage();
                if (off) {
                    context.save();
                    context.translate(pan.x, pan.y);
                    context.scale(scale, scale);
                    context.imageSmoothingEnabled = false;
                    context.drawImage(off, 0, 0);
                    context.restore();
                }

                if (gridRef.current && scale >= 4) {
                    context.save();
                    context.beginPath();
                    context.rect(pan.x, pan.y, docWidth, docHeight);
                    context.clip();
                    context.strokeStyle = 'rgba(255,255,255,0.09)';
                    context.lineWidth = 1;
                    context.beginPath();
                    for (let x = 1; x < current.w; x += 1) {
                        const px = Math.round(pan.x + x * scale) + 0.5;
                        context.moveTo(px, pan.y);
                        context.lineTo(px, pan.y + docHeight);
                    }
                    for (let y = 1; y < current.h; y += 1) {
                        const py = Math.round(pan.y + y * scale) + 0.5;
                        context.moveTo(pan.x, py);
                        context.lineTo(pan.x + docWidth, py);
                    }
                    context.stroke();
                    context.restore();
                }

                if (selection) {
                    const boxX = Math.round(pan.x + selection.x * scale);
                    const boxY = Math.round(pan.y + selection.y * scale);
                    const boxW = Math.max(1, Math.round(selection.w * scale));
                    const boxH = Math.max(1, Math.round(selection.h * scale));
                    const floating = selection.float;
                    if (floating && floating.region) {
                        // Floating content preview, drawn over the cells it was lifted from.
                        for (let row = 0; row < floating.region.length; row += 1) {
                            const line = floating.region[row];
                            for (let column = 0; column < line.length; column += 1) {
                                const ch = line[column];
                                if (!ch || ch === '.') continue;
                                const color = current.palette[indexFor(ch)];
                                if (!color) continue;
                                context.fillStyle = color;
                                context.fillRect(
                                    Math.round(pan.x + (selection.x + column) * scale),
                                    Math.round(pan.y + (selection.y + row) * scale),
                                    Math.ceil(scale),
                                    Math.ceil(scale),
                                );
                            }
                        }
                    }
                    // Marching ants: one dark and one offset light dashed border.
                    context.save();
                    context.lineWidth = 1;
                    context.setLineDash([4, 4]);
                    context.strokeStyle = 'rgba(0,0,0,0.8)';
                    context.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
                    context.lineDashOffset = 4;
                    context.strokeStyle = 'rgba(255,255,255,0.95)';
                    context.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
                    context.restore();
                }

                context.strokeStyle = 'rgba(255,255,255,0.22)';
                context.lineWidth = 1;
                context.strokeRect(Math.round(pan.x) + 0.5, Math.round(pan.y) + 0.5, Math.round(docWidth), Math.round(docHeight));
            }, [composeImage, selection]);

            const requestPaint = useCallback(() => {
                if (frameRef.current !== 0) return;
                frameRef.current = window.requestAnimationFrame(paint);
            }, [paint]);

            const fitToView = useCallback(() => {
                const stage = stageRef.current;
                const current = docRef.current;
                if (!stage || !current) return;
                const width = Math.max(1, stage.clientWidth);
                const height = Math.max(1, stage.clientHeight);
                const raw = Math.min((width - 48) / current.w, (height - 48) / current.h);
                let scale = 1;
                for (const candidate of ZOOMS) {
                    if (candidate <= raw) scale = candidate;
                }
                if (raw >= 1) {
                    let best = 1;
                    for (const candidate of ZOOMS) if (candidate <= raw) best = candidate;
                    scale = best;
                }
                scaleRef.current = scale;
                setZoom(scale);
                panRef.current = {
                    x: Math.round((width - current.w * scale) / 2),
                    y: Math.round((height - current.h * scale) / 2),
                };
                requestPaint();
            }, [requestPaint]);

            /* -------------------------------------------------------------- */
            /* documents                                                      */
            /* -------------------------------------------------------------- */

            const refreshDocs = useCallback(async () => {
                const data = await callApi({ op: 'list' });
                setDocs(Array.isArray(data.docs) ? data.docs : []);
                return data.docs || [];
            }, []);

            const openDoc = useCallback(async (id) => {
                const data = await callApi({ op: 'get', id });
                setDoc(data.doc);
                docRef.current = data.doc;
                setLayerIndex(0);
                setColorIndex(0);
                setEditing(null);
                editingRef.current = null;
                historyRef.current = { undo: [], redo: [] };
                setStatus('clean');
                window.requestAnimationFrame(() => fitToView());
            }, [fitToView]);

            useEffect(() => {
                let disposed = false;
                (async () => {
                    try {
                        const list = await refreshDocs();
                        if (disposed) return;
                        if (list.length > 0) {
                            await openDoc(list[0].id);
                        }
                    } catch (cause) {
                        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
                    } finally {
                        if (!disposed) setLoading(false);
                    }
                })();
                return () => {
                    disposed = true;
                };
            }, [openDoc, refreshDocs]);

            const saveNow = useCallback(async () => {
                const current = docRef.current;
                if (!current) return;
                setStatus('saving');
                try {
                    const data = await callApi({ op: 'save', doc: current });
                    const saved = data.doc;
                    docRef.current = saved;
                    setDoc(saved);
                    setStatus('clean');
                    setError('');
                    const list = await refreshDocs();
                    if (list.length === 0) setDocs([saved]);
                } catch (cause) {
                    setStatus('error');
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            }, [refreshDocs]);

            const scheduleSave = useCallback(() => {
                setStatus('dirty');
                if (saveTimerRef.current !== 0) window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = window.setTimeout(() => {
                    saveTimerRef.current = 0;
                    void saveNow();
                }, 700);
            }, [saveNow]);

            useEffect(() => () => {
                if (saveTimerRef.current !== 0) window.clearTimeout(saveTimerRef.current);
            }, []);

            const commitRows = useCallback((rows, options = {}) => {
                const current = docRef.current;
                if (!current) return;
                const history = historyRef.current;
                if (options.snapshot !== false) {
                    history.undo.push(snapshotOf(current));
                    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
                    history.redo = [];
                }
                const layers = current.layers.map((layer, index) => (
                    index === layerRef.current ? { ...layer, rows } : layer
                ));
                const next = { ...current, layers };
                docRef.current = next;
                setDoc(next);
                requestPaint();
                scheduleSave();
            }, [requestPaint, scheduleSave]);

            const applyHistory = useCallback((snapshot) => {
                const current = docRef.current;
                if (!current || !snapshot) return;
                const next = {
                    ...current,
                    palette: snapshot.palette.slice(),
                    layers: snapshot.layers.map((layer) => ({ ...layer, rows: layer.rows.slice() })),
                };
                if (typeof snapshot.w === 'number' && typeof snapshot.h === 'number') {
                    next.w = snapshot.w;
                    next.h = snapshot.h;
                }
                docRef.current = next;
                setDoc(next);
                if (!next.layers[layerRef.current]) {
                    const safe = Math.max(0, next.layers.length - 1);
                    layerRef.current = safe;
                    setLayerIndex(safe);
                }
                requestPaint();
                scheduleSave();
            }, [requestPaint, scheduleSave]);

            const undo = useCallback(() => {
                const history = historyRef.current;
                const snapshot = history.undo.pop();
                if (!snapshot) return;
                const current = docRef.current;
                history.redo.push(snapshotOf(current));
                applyHistory(snapshot);
            }, [applyHistory]);

            const redo = useCallback(() => {
                const history = historyRef.current;
                const snapshot = history.redo.pop();
                if (!snapshot) return;
                const current = docRef.current;
                history.undo.push(snapshotOf(current));
                applyHistory(snapshot);
            }, [applyHistory]);

            /* -------------------------------------------------------------- */
            /* pointer input                                                  */
            /* -------------------------------------------------------------- */

            const cellFromEvent = useCallback((event) => {
                const canvas = canvasRef.current;
                const current = docRef.current;
                if (!canvas || !current) return null;
                const rect = canvas.getBoundingClientRect();
                const scale = scaleRef.current;
                const pan = panRef.current;
                return {
                    x: Math.floor((event.clientX - rect.left - pan.x) / scale),
                    y: Math.floor((event.clientY - rect.top - pan.y) / scale),
                };
            }, []);

            const paintBrush = useCallback((rows, cx, cy, ch) => {
                const current = docRef.current;
                if (!current) return rows;
                const size = brushRef.current;
                const offset = Math.floor((size - 1) / 2);
                let next = rows;
                for (let dy = 0; dy < size; dy += 1) {
                    for (let dx = 0; dx < size; dx += 1) {
                        next = setPixel(next, cx + dx - offset, cy + dy - offset, ch);
                    }
                }
                return next;
            }, []);

            const strokeAt = useCallback((cell, previous) => {
                const current = docRef.current;
                if (!current) return;
                const layer = current.layers[layerRef.current];
                if (!layer) return;
                const ch = toolRef.current === 'eraser' ? '.' : charFor(colorRef.current);
                let rows = layer.rows;
                const cells = previous ? lineCells(previous.x, previous.y, cell.x, cell.y) : [[cell.x, cell.y]];
                for (const [x, y] of cells) rows = paintBrush(rows, x, y, ch);
                commitRows(rows, { snapshot: false });
            }, [commitRows, paintBrush]);

            const pickColorAt = useCallback((cell) => {
                const current = docRef.current;
                if (!current) return;
                for (let l = current.layers.length - 1; l >= 0; l -= 1) {
                    const layer = current.layers[l];
                    if (layer.visible === false) continue;
                    const row = layer.rows[cell.y];
                    const ch = row === undefined ? '.' : row[cell.x];
                    const index = ch === undefined ? -1 : indexFor(ch);
                    if (index >= 0) {
                        setColorIndex(index);
                        colorRef.current = index;
                        return;
                    }
                }
            }, []);

            const pushHistory = useCallback(() => {
                const current = docRef.current;
                if (!current) return;
                const history = historyRef.current;
                history.undo.push(snapshotOf(current));
                if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
                history.redo = [];
            }, []);

            const selectionTargets = useCallback((allLayers) => {
                const current = docRef.current;
                if (!current) return [];
                if (allLayers) {
                    return current.layers
                        .map((layer, index) => ({ layer, index }))
                        .filter((entry) => entry.layer && entry.layer.visible !== false);
                }
                const layer = current.layers[layerRef.current];
                return layer ? [{ layer, index: layerRef.current }] : [];
            }, []);

            const setSelectionRect = useCallback((rect) => {
                selectionRef.current = rect;
                setSelection(rect);
            }, []);

            const selectAll = useCallback(() => {
                const current = docRef.current;
                if (!current) return;
                setTool('select');
                setSelectionRect({ x: 0, y: 0, w: current.w, h: current.h, float: null });
                setStatus('select');
                requestPaint();
            }, [requestPaint, setSelectionRect]);

            const putBackLifted = useCallback((current, active) => {
                const float = active.float;
                if (!float) return current;
                const layers = current.layers.map((layer, index) => {
                    const item = float.targets.find((entry) => entry.index === index);
                    if (!item) return layer;
                    return {
                        ...layer,
                        rows: writeRegion(layer.rows, item.region, float.origin.x, float.origin.y),
                    };
                });
                return { ...current, layers };
            }, []);

            const cancelSelection = useCallback(() => {
                const current = docRef.current;
                const active = selectionRef.current;
                selectionRef.current = null;
                setSelection(null);
                if (current && active && active.float) {
                    const next = putBackLifted(current, active);
                    docRef.current = next;
                    setDoc(next);
                    scheduleSave();
                }
                requestPaint();
            }, [putBackLifted, requestPaint, scheduleSave]);

            /** Lifts the selected pixels out of their layers; false when nothing could be lifted. */
            const liftSelection = useCallback((allLayers) => {
                const current = docRef.current;
                const active = selectionRef.current;
                if (!current || !active || active.float) return false;
                const rect = clampRectangle(active, current.w, current.h);
                const targets = selectionTargets(allLayers);
                if (targets.length === 0) return false;
                pushHistory();
                const items = targets.map((entry) => ({ index: entry.index, region: readRegion(entry.layer.rows, rect) }));
                const layers = current.layers.map((layer, index) => {
                    const item = items.find((entry) => entry.index === index);
                    return item ? { ...layer, rows: emptyRows(layer.rows, rect) } : layer;
                });
                const next = { ...current, layers };
                docRef.current = next;
                setDoc(next);
                setSelectionRect({
                    ...rect,
                    float: {
                        region: mergedRegion(current.layers, rect),
                        origin: { x: rect.x, y: rect.y },
                        targets: items,
                    },
                });
                setStatus('dirty');
                return true;
            }, [pushHistory, selectionTargets, setSelectionRect]);

            /** Drops the lifted pixels at the rectangle's current position. */
            const dropSelection = useCallback(() => {
                const current = docRef.current;
                const active = selectionRef.current;
                if (!current || !active || !active.float) return;
                const rect = clampRectangle(active, current.w, current.h);
                const float = active.float;
                const layers = current.layers.map((layer, index) => {
                    const item = float.targets.find((entry) => entry.index === index);
                    return item ? { ...layer, rows: writeRegion(layer.rows, item.region, rect.x, rect.y) } : layer;
                });
                const next = { ...current, layers };
                docRef.current = next;
                setDoc(next);
                setSelectionRect({ ...rect, float: null });
                setStatus('dirty');
                scheduleSave();
            }, [scheduleSave, setSelectionRect]);

            const applySelectionEdit = useCallback((mode, allLayers) => {
                const current = docRef.current;
                const active = selectionRef.current;
                if (!current || !active) return;
                if (active.float) {
                    const restored = putBackLifted(current, active);
                    docRef.current = restored;
                    setDoc(restored);
                }
                const base = docRef.current;
                const rect = clampRectangle(active, base.w, base.h);
                const targets = selectionTargets(allLayers);
                if (targets.length === 0) return;
                pushHistory();
                const layers = base.layers.map((layer, index) => {
                    const target = targets.find((entry) => entry.index === index);
                    if (!target) return layer;
                    let rows = layer.rows;
                    if (mode === 'mirror-h') rows = mirrorRows(rows, rect, true);
                    else if (mode === 'mirror-v') rows = mirrorRows(rows, rect, false);
                    else if (mode === 'fill') rows = fillRows(rows, rect, charFor(colorRef.current));
                    else if (mode === 'delete') rows = emptyRows(rows, rect);
                    return { ...layer, rows };
                });
                const next = { ...base, layers };
                docRef.current = next;
                setDoc(next);
                setSelectionRect({ ...rect, float: null });
                setStatus('dirty');
                scheduleSave();
            }, [putBackLifted, pushHistory, scheduleSave, selectionTargets, setSelectionRect]);

            /** Arrow-key nudging: 1 cell, 10 with Shift; carries lifted pixels along. */
            const nudgeSelection = useCallback((dx, dy) => {
                const current = docRef.current;
                const active = selectionRef.current;
                if (!current || !active) return;
                const rect = moveRectangle(active, active.x + dx, active.y + dy, current.w, current.h);
                setSelectionRect({ ...rect, float: active.float });
                setStatus('select');
            }, [setSelectionRect]);

            // Exposed to the keyboard effect, which is registered before these callbacks exist.
            selectApiRef.current = {
                selectAll,
                cancel: cancelSelection,
                apply: applySelectionEdit,
                nudge: nudgeSelection,
                drop: dropSelection,
                lift: liftSelection,
                allLayers: allLayersRef.current,
            };

            const onPointerDown = useCallback((event) => {
                if (!docRef.current) return;
                const wantsPan = event.button === 1 || spaceRef.current || event.altKey;
                if (wantsPan) {
                    event.preventDefault();
                    panDrawRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        origin: { ...panRef.current },
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    requestPaint();
                    return;
                }
                if (event.button !== 0) return;
                const cell = cellFromEvent(event);
                if (!cell) return;
                const current = docRef.current;

                if (toolRef.current === 'select') {
                    event.preventDefault();
                    const anchor = {
                        x: clamp(cell.x, 0, Math.max(0, current.w - 1)),
                        y: clamp(cell.y, 0, Math.max(0, current.h - 1)),
                    };
                    const active = selectionRef.current;
                    const inside = active ? pointInRectangle(active, cell) : false;
                    const carry = event.shiftKey || grabRef.current;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (inside && carry && (active.float || liftSelection(event.altKey))) {
                        selectDragRef.current = {
                            mode: 'grab',
                            pointerId: event.pointerId,
                            start: anchor,
                            origin: { x: active.x, y: active.y },
                        };
                    } else if (inside) {
                        // Plain drag slides the frame; the pixels stay where they are.
                        selectDragRef.current = {
                            mode: 'move',
                            pointerId: event.pointerId,
                            start: anchor,
                            origin: { x: active.x, y: active.y },
                        };
                    } else {
                        setSelectionRect({
                            ...clampRectangle({ x: anchor.x, y: anchor.y, w: 1, h: 1 }, current.w, current.h),
                            float: null,
                        });
                        selectDragRef.current = {
                            mode: 'create',
                            pointerId: event.pointerId,
                            start: anchor,
                        };
                    }
                    setStatus('select');
                    requestPaint();
                    return;
                }

                if (toolRef.current === 'picker') {
                    pickColorAt(cell);
                    return;
                }
                if (cell.x < 0 || cell.y < 0 || cell.x >= current.w || cell.y >= current.h) return;

                if (toolRef.current === 'bucket') {
                    const rows = fillRegion(
                        current,
                        layerRef.current,
                        cell.x,
                        cell.y,
                        charFor(colorRef.current),
                    );
                    if (rows) commitRows(rows);
                    return;
                }

                // Real stroke: snapshot once, then paint continuously.
                const history = historyRef.current;
                history.undo.push(snapshotOf(current));
                if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
                history.redo = [];
                strokeRef.current = { pointerId: event.pointerId, last: cell };
                event.currentTarget.setPointerCapture(event.pointerId);
                strokeAt(cell, null);
            }, [cellFromEvent, commitRows, pickColorAt, requestPaint, strokeAt]);

            const onPointerMove = useCallback((event) => {
                const panDraw = panDrawRef.current;
                if (panDraw && panDraw.pointerId === event.pointerId) {
                    panRef.current = {
                        x: panDraw.origin.x + (event.clientX - panDraw.startX),
                        y: panDraw.origin.y + (event.clientY - panDraw.startY),
                    };
                    requestPaint();
                    return;
                }
                const selectDrag = selectDragRef.current;
                if (selectDrag && selectDrag.pointerId === event.pointerId) {
                    const current = docRef.current;
                    const cell = cellFromEvent(event);
                    if (!current || !cell) return;
                    const anchor = {
                        x: clamp(cell.x, 0, Math.max(0, current.w - 1)),
                        y: clamp(cell.y, 0, Math.max(0, current.h - 1)),
                    };
                    if (selectDrag.mode === 'create') {
                        setSelectionRect({
                            ...clampRectangle(selectionBetween(selectDrag.start, anchor), current.w, current.h),
                            float: null,
                        });
                    } else {
                        const active = selectionRef.current;
                        if (!active) return;
                        const rect = moveRectangle(
                            { x: 0, y: 0, w: active.w, h: active.h },
                            selectDrag.origin.x + (anchor.x - selectDrag.start.x),
                            selectDrag.origin.y + (anchor.y - selectDrag.start.y),
                            current.w,
                            current.h,
                        );
                        setSelectionRect({ ...rect, float: active.float });
                    }
                    requestPaint();
                    return;
                }
                const stroke = strokeRef.current;
                if (!stroke || stroke.pointerId !== event.pointerId) return;
                const cell = cellFromEvent(event);
                if (!cell) return;
                if (stroke.last && stroke.last.x === cell.x && stroke.last.y === cell.y) return;
                strokeAt(cell, stroke.last);
                stroke.last = cell;
            }, [cellFromEvent, requestPaint, strokeAt]);

            const onPointerUp = useCallback((event) => {
                const selectDrag = selectDragRef.current;
                if (selectDrag && selectDrag.pointerId === event.pointerId) {
                    selectDragRef.current = null;
                    if (selectDrag.mode === 'grab') dropSelection();
                    const active = selectionRef.current;
                    if (active && (active.w < 1 || active.h < 1)) {
                        selectionRef.current = null;
                        setSelection(null);
                    }
                    requestPaint();
                    return;
                }
                if (panDrawRef.current && panDrawRef.current.pointerId === event.pointerId) {
                    panDrawRef.current = null;
                    requestPaint();
                    return;
                }
                if (strokeRef.current && strokeRef.current.pointerId === event.pointerId) {
                    strokeRef.current = null;
                    const current = docRef.current;
                    if (current) setStatus('dirty');
                    scheduleSave();
                }
            }, [requestPaint, scheduleSave]);

            /* -------------------------------------------------------------- */
            /* wheel / keyboard / resize                                      */
            /* -------------------------------------------------------------- */

            useEffect(() => {
                const stage = stageRef.current;
                if (!stage) return undefined;
                const onWheel = (event) => {
                    if (!docRef.current) return;
                    event.preventDefault();
                    if (event.shiftKey) {
                        panRef.current = {
                            x: panRef.current.x - event.deltaY,
                            y: panRef.current.y - event.deltaX,
                        };
                        requestPaint();
                        return;
                    }
                    const rect = stage.getBoundingClientRect();
                    const mx = event.clientX - rect.left;
                    const my = event.clientY - rect.top;
                    const current = scaleRef.current;
                    const position = ZOOMS.indexOf(current);
                    const base = position === -1 ? 0 : position;
                    const step = event.deltaY > 0 ? -1 : 1;
                    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, base + step))];
                    if (next === current) return;
                    panRef.current = {
                        x: mx - ((mx - panRef.current.x) / current) * next,
                        y: my - ((my - panRef.current.y) / current) * next,
                    };
                    scaleRef.current = next;
                    setZoom(next);
                    requestPaint();
                };
                stage.addEventListener('wheel', onWheel, { passive: false });
                return () => stage.removeEventListener('wheel', onWheel);
            }, [requestPaint]);

            useEffect(() => {
                const observer = new ResizeObserver(() => requestPaint());
                if (stageRef.current) observer.observe(stageRef.current);
                return () => observer.disconnect();
            }, [requestPaint]);

            useEffect(() => {
                const onKeyDown = (event) => {
                    const target = event.target;
                    const typing = target instanceof HTMLElement && (
                        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
                    );
                    if (typing) return;
                    if (event.code === 'Space') {
                        spaceRef.current = true;
                        if (canvasRef.current) canvasRef.current.classList.add('is-space');
                        event.preventDefault();
                        return;
                    }
                    const meta = event.metaKey || event.ctrlKey;
                    if (meta && event.key.toLowerCase() === 'a') {
                        event.preventDefault();
                        selectApiRef.current.selectAll();
                        return;
                    }
                    if (meta && event.key.toLowerCase() === 'z') {
                        event.preventDefault();
                        if (event.shiftKey) redo();
                        else undo();
                        return;
                    }
                    if (meta && event.key.toLowerCase() === 'y') {
                        event.preventDefault();
                        redo();
                        return;
                    }
                    if (meta && event.shiftKey && event.key.toLowerCase() === 's') {
                        event.preventDefault();
                        if (typeof saveAsRef.current === 'function') saveAsRef.current();
                        return;
                    }
                    if (meta && event.key.toLowerCase() === 's') {
                        event.preventDefault();
                        void saveNow();
                        return;
                    }
                    if (meta) return;
                    const key = event.key.toLowerCase();
                    if (key === 'escape') {
                        selectApiRef.current.cancel();
                        return;
                    }
                    if (selectionRef.current) {
                        if (key === 'delete' || key === 'backspace') {
                            event.preventDefault();
                            selectApiRef.current.apply('delete', selectApiRef.current.allLayers);
                            return;
                        }
                        if (key.indexOf('arrow') === 0) {
                            event.preventDefault();
                            const step = event.shiftKey ? 10 : 1;
                            const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
                            const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
                            selectApiRef.current.nudge(dx, dy);
                            return;
                        }
                        if (event.shiftKey && key === 'h') {
                            event.preventDefault();
                            selectApiRef.current.apply('mirror-h', selectApiRef.current.allLayers);
                            return;
                        }
                        if (event.shiftKey && key === 'v') {
                            event.preventDefault();
                            selectApiRef.current.apply('mirror-v', selectApiRef.current.allLayers);
                            return;
                        }
                        if (event.shiftKey && key === 'f') {
                            event.preventDefault();
                            selectApiRef.current.apply('fill', selectApiRef.current.allLayers);
                            return;
                        }
                    }
                    if (key === 'b') setTool('pencil');
                    else if (key === 'e') setTool('eraser');
                    else if (key === 'g') setTool('bucket');
                    else if (key === 'i') setTool('picker');
                    else if (key === 'm') setTool('select');
                    else if (key === 'f') fitToView();
                    else if (key === 'h') {
                        const next = !gridRef.current;
                        gridRef.current = next;
                        setShowGrid(next);
                        storeValue('pxs:grid', next ? '1' : '0');
                        requestPaint();
                    }
                    else if (key === '[') setBrush((value) => Math.max(1, value - 1));
                    else if (key === ']') setBrush((value) => Math.min(8, value + 1));
                    else if (key === '+' || key === '=') {
                        const position = ZOOMS.indexOf(scaleRef.current);
                        const next = ZOOMS[Math.min(ZOOMS.length - 1, (position === -1 ? 0 : position) + 1)];
                        scaleRef.current = next;
                        setZoom(next);
                        requestPaint();
                    } else if (key === '-' || key === '_') {
                        const position = ZOOMS.indexOf(scaleRef.current);
                        const next = ZOOMS[Math.max(0, (position === -1 ? 0 : position) - 1)];
                        scaleRef.current = next;
                        setZoom(next);
                        requestPaint();
                    }
                };
                const onKeyUp = (event) => {
                    if (event.code === 'Space') {
                        spaceRef.current = false;
                        if (canvasRef.current) canvasRef.current.classList.remove('is-space');
                    }
                };
                window.addEventListener('keydown', onKeyDown);
                window.addEventListener('keyup', onKeyUp);
                return () => {
                    window.removeEventListener('keydown', onKeyDown);
                    window.removeEventListener('keyup', onKeyUp);
                };
            }, [fitToView, redo, requestPaint, saveNow, undo]);

            useEffect(() => {
                const close = () => setMenu(null);
                window.addEventListener('pointerdown', close);
                return () => window.removeEventListener('pointerdown', close);
            }, []);

            useEffect(() => {
                if (notice === '') return undefined;
                const timer = window.setTimeout(() => setNotice(''), 6000);
                return () => window.clearTimeout(timer);
            }, [notice]);

            useEffect(() => {
                if (doc) window.requestAnimationFrame(() => requestPaint());
            }, [doc, requestPaint]);

            useEffect(() => {
                setColorIndex((value) => {
                    const max = doc ? doc.palette.length - 1 : 0;
                    return value > max ? Math.max(0, max) : value;
                });
            }, [doc]);

            /* -------------------------------------------------------------- */
            /* document actions                                               */
            /* -------------------------------------------------------------- */

            const createDoc = useCallback(async (spec) => {
                const options = spec || {};
                const width = clamp(Math.round(Number(options.w) || 32), 1, MAX_SIDE);
                const height = clamp(Math.round(Number(options.h) || width), 1, MAX_SIDE);
                const name = String(options.name || '').trim().slice(0, 60) || `${width}×${height} 作品`;
                try {
                    setCreating(true);
                    const data = await callApi({
                        op: 'create',
                        name,
                        w: width,
                        h: height,
                        palette: PRESETS[0].colors.slice(0, 8),
                    });
                    setDoc(data.doc);
                    docRef.current = data.doc;
                    setLayerIndex(0);
                    setColorIndex(0);
                    editSessionRef.current = null;
                    setEditing(null);
                    historyRef.current = { undo: [], redo: [] };
                    await refreshDocs();
                    setStatus('clean');
                    setError('');
                    setNewDialog(null);
                    window.requestAnimationFrame(() => fitToView());
                } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                } finally {
                    setCreating(false);
                }
            }, [fitToView, refreshDocs]);

            /** New-work dialog: name + size, with presets one click away. */
            const openNewDialog = useCallback(() => {
                const base = docs.length + 1;
                setNewDialog({ name: `作品 ${base}`, w: 32, h: 32, error: '' });
            }, [docs.length]);

            const confirmNewDoc = useCallback(() => {
                const dialog = newDialog;
                if (!dialog) return;
                const width = Math.round(Number(dialog.w));
                const height = Math.round(Number(dialog.h));
                if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
                    setNewDialog({ ...dialog, error: '宽高要填 1 以上的整数' });
                    return;
                }
                if (width > MAX_SIDE || height > MAX_SIDE) {
                    setNewDialog({ ...dialog, error: `最大 ${MAX_SIDE}×${MAX_SIDE}` });
                    return;
                }
                void createDoc({ name: dialog.name, w: width, h: height });
            }, [createDoc, newDialog]);

            const deleteDoc = useCallback(async () => {
                const current = docRef.current;
                if (!current) return;
                if (!window.confirm(`删除「${current.name}」？此操作不可撤销。`)) return;
                try {
                    await callApi({ op: 'delete', id: current.id });
                    const list = await callApi({ op: 'list' });
                    setDocs(list.docs || []);
                    const next = (list.docs || [])[0];
                    if (next) await openDoc(next.id);
                    else {
                        setDoc(null);
                        docRef.current = null;
                    }
                } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            }, [openDoc]);

            const browseDir = useCallback(async (target) => {
                setSaveDialog((value) => (value ? { ...value, loading: true, error: '' } : value));
                try {
                    const data = await callApi({ op: 'browse', path: typeof target === 'string' ? target : '', sessionId });
                    const dirs = Array.isArray(data.dirs) ? data.dirs : [];
                    setSaveDialog((value) => (value ? {
                        ...value,
                        loading: false,
                        path: data.path,
                        parent: data.parent,
                        root: data.root,
                        pathInput: data.path,
                        dirs,
                    } : value));
                } catch (cause) {
                    const message = cause instanceof Error ? cause.message : String(cause);
                    setSaveDialog((value) => (value ? { ...value, loading: false, error: message } : value));
                }
            }, [sessionId]);

            const openSaveDialog = useCallback(async (mode) => {
                const current = docRef.current;
                if (!current) return;
                const filePath = typeof current.filePath === 'string' ? current.filePath : '';
                const startDir = mode === 'saveAs' ? dirNameOf(filePath) : '';
                const name = mode === 'saveAs' && filePath !== '' ? baseNameOf(filePath) : ensurePngName(current.name);
                setSaveDialog({
                    mode,
                    path: '',
                    pathInput: '',
                    parent: null,
                    root: '',
                    dirs: [],
                    name,
                    scale: clampExportScale(readStoredNumber('pxs:exportScale', 1), current.w, current.h),
                    loading: true,
                    busy: false,
                    error: '',
                });
                await browseDir(startDir);
            }, [browseDir]);

            const confirmSave = useCallback(async () => {
                const current = docRef.current;
                const dialog = saveDialog;
                if (!current || !dialog || dialog.busy) return;
                if (typeof dialog.path !== 'string' || dialog.path === '') return;
                const target = joinPath(dialog.path, ensurePngName(dialog.name));
                const scale = clampExportScale(dialog.scale, current.w, current.h);
                setSaveDialog((value) => (value ? { ...value, busy: true, error: '' } : value));
                try {
                    const saved = await callApi({ op: 'exportTo', doc: current, path: target, scale });
                    const next = { ...current, filePath: typeof saved.path === 'string' ? saved.path : target };
                    docRef.current = next;
                    setDoc(next);
                    setSaveDialog(null);
                    setError('');
                    storeValue('pxs:exportScale', String(scale));
                    setNotice(`已保存 ${next.filePath}${scale > 1 ? `（${scale}×）` : ''}`);
                    const stored = await callApi({ op: 'save', doc: next });
                    if (stored && stored.doc) {
                        docRef.current = stored.doc;
                        setDoc(stored.doc);
                    }
                    setStatus('clean');
                    void refreshDocs();
                } catch (cause) {
                    const message = cause instanceof Error ? cause.message : String(cause);
                    setSaveDialog((value) => (value ? { ...value, busy: false, error: message } : value));
                }
            }, [refreshDocs, saveDialog]);

            const exportPng = useCallback(async () => {
                const current = docRef.current;
                if (!current) return;
                const filePath = typeof current.filePath === 'string' ? current.filePath : '';
                if (filePath === '') {
                    // No file yet: the operator picks where this artwork lives, once.
                    await openSaveDialog('export');
                    return;
                }
                try {
                    const scale = clampExportScale(readStoredNumber('pxs:exportScale', 1), current.w, current.h);
                    const saved = await callApi({ op: 'exportTo', doc: current, path: filePath, scale });
                    const suffix = scale > 1 ? `（${scale}×）` : '';
                    setNotice(`${saved.overwritten ? `已覆盖 ${saved.path}` : `已保存 ${saved.path}`}${suffix}`);
                    setError('');
                } catch (cause) {
                    const message = cause instanceof Error ? cause.message : String(cause);
                    setError(message);
                    // The previous target vanished: let the operator pick a new one.
                    await openSaveDialog('saveAs');
                }
            }, [openSaveDialog]);

            const saveAsPng = useCallback(() => {
                void openSaveDialog('saveAs');
            }, [openSaveDialog]);
            saveAsRef.current = saveAsPng;

            /* -------------------------------------------------------------- */
            /* import a picture                                               */
            /* -------------------------------------------------------------- */

            const openImportDialog = useCallback((file) => {
                if (!file) return;
                void (async () => {
                    try {
                        const sample = await readImagePixels(file);
                        const current = docRef.current;
                        setError('');
                        setImportDialog(buildImportDocument({
                            sample,
                            name: importName(file),
                            mode: 'auto',
                            dither: false,
                            sourceW: sample.sourceW,
                            sourceH: sample.sourceH,
                            width: sample.width,
                            height: sample.height,
                            busy: false,
                        }, current ? current.palette : null));
                    } catch (cause) {
                        setError(cause instanceof Error ? cause.message : String(cause));
                    }
                })();
            }, []);

            const retuneImport = useCallback((patch) => {
                const current = docRef.current;
                setImportDialog((value) => (value
                    ? buildImportDocument({ ...value, ...patch }, current ? current.palette : null)
                    : value));
            }, []);

            const confirmImport = useCallback(() => {
                const dialog = importDialog;
                if (!dialog || dialog.busy || !Array.isArray(dialog.rows)) return;
                setImportDialog((value) => (value ? { ...value, busy: true, error: '' } : value));
                void (async () => {
                    try {
                        const width = dialog.width;
                        const height = dialog.height;
                        const name = String(dialog.name || '').trim().slice(0, 60) || `${width}×${height} 导入`;
                        const created = await callApi({ op: 'create', name, w: width, h: height, palette: dialog.palette });
                        // create ignores layers, so the pixel grid goes in through save.
                        const saved = await callApi({
                            op: 'save',
                            doc: {
                                ...created.doc,
                                layers: [{ name: '图层 1', visible: true, rows: dialog.rows }],
                            },
                        });
                        const next = saved && saved.doc ? saved.doc : created.doc;
                        docRef.current = next;
                        setDoc(next);
                        layerRef.current = 0;
                        setLayerIndex(0);
                        setColorIndex(0);
                        editSessionRef.current = null;
                        setEditing(null);
                        historyRef.current = { undo: [], redo: [] };
                        setImportDialog(null);
                        setStatus('clean');
                        setNotice(`已导入「${name}」${width}×${height}`);
                        await refreshDocs();
                        window.requestAnimationFrame(() => fitToView());
                    } catch (cause) {
                        const message = cause instanceof Error ? cause.message : String(cause);
                        setImportDialog((value) => (value ? { ...value, busy: false, error: message } : value));
                    }
                })();
            }, [fitToView, importDialog, refreshDocs]);

            /* -------------------------------------------------------------- */
            /* canvas size / crop                                             */
            /* -------------------------------------------------------------- */

            const openResizeDialog = useCallback(() => {
                const current = docRef.current;
                if (!current) return;
                setResizeDialog({ w: current.w, h: current.h, anchor: 'c', error: '' });
            }, []);

            const confirmResize = useCallback(() => {
                const current = docRef.current;
                const dialog = resizeDialog;
                if (!current || !dialog) return;
                const width = Math.round(Number(dialog.w));
                const height = Math.round(Number(dialog.h));
                if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
                    setResizeDialog({ ...dialog, error: '宽高要填 1 以上的整数' });
                    return;
                }
                if (width > MAX_SIDE || height > MAX_SIDE) {
                    setResizeDialog({ ...dialog, error: `最大 ${MAX_SIDE}×${MAX_SIDE}` });
                    return;
                }
                setResizeDialog(null);
                if (width === current.w && height === current.h) {
                    setNotice('画布尺寸没有变化');
                    return;
                }
                const history = historyRef.current;
                history.undo.push(snapshotOf(current));
                if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
                history.redo = [];
                const layers = current.layers.map((layer) => ({
                    ...layer,
                    rows: resizeRows(layer.rows, current.w, current.h, width, height, dialog.anchor),
                }));
                const next = { ...current, w: width, h: height, layers };
                docRef.current = next;
                setDoc(next);
                scheduleSave();
                setNotice(`画布已调整为 ${width}×${height}`);
                window.requestAnimationFrame(() => {
                    fitToView();
                    requestPaint();
                });
            }, [fitToView, requestPaint, resizeDialog, scheduleSave]);

            /* -------------------------------------------------------------- */
            /* palette actions                                                */
            /* -------------------------------------------------------------- */

            const updatePalette = useCallback((palette, options = {}) => {
                const current = docRef.current;
                if (!current) return;
                pushHistory();
                const next = { ...current, palette };
                docRef.current = next;
                setDoc(next);
                if (options.color !== undefined) {
                    setColorIndex(options.color);
                    colorRef.current = options.color;
                }
                requestPaint();
                scheduleSave();
            }, [pushHistory, requestPaint, scheduleSave]);

            const beginEdit = useCallback((index) => {
                const current = docRef.current;
                if (!current || index < 0 || index >= current.palette.length) return;
                pushHistory();
                setColorIndex(index);
                colorRef.current = index;
                editSessionRef.current = { index, color: current.palette[index], detached: false };
                setEditing(index);
            }, [pushHistory]);

            const endEdit = useCallback(() => {
                editSessionRef.current = null;
                setEditing(null);
            }, []);

            const editColor = useCallback((index) => {
                beginEdit(index);
            }, [beginEdit]);

            /**
             * Apply a colour to the slot the editor is showing. The first change
             * of a session first parks the artwork's pixels on their own slot, so
             * editing a palette colour never repaints the existing canvas.
             */
            const applyEditColor = useCallback((target, color) => {
                const current = docRef.current;
                if (!current) return;
                const index = typeof target === 'number' ? target : editingRef.current;
                if (index === null || index === undefined) return;
                if (index < 0 || index >= current.palette.length) return;
                const nextColor = String(color || '').toLowerCase();
                if (!/^#[0-9a-f]{6}$/.test(nextColor)) return;
                if (current.palette[index].toLowerCase() === nextColor) return;
                let base = current;
                const session = editSessionRef.current;
                if (session && session.index === index && !session.detached) {
                    const detached = detachSlot(base, index);
                    if (!detached) {
                        setNotice(`调色板已满（${CHARS.length} 色），先删掉一个用不到的颜色再改这个`);
                        return;
                    }
                    session.detached = true;
                    base = detached.doc;
                    if (detached.target >= 0) {
                        setNotice(`画布上的旧颜色已由色板 #${detached.target + 1} 接手，画布未改动`);
                    }
                }
                const palette = base.palette.slice();
                palette[index] = nextColor;
                const next = { ...base, palette };
                docRef.current = next;
                setDoc(next);
                requestPaint();
                scheduleSave();
            }, [requestPaint, scheduleSave]);

            const setEditChannel = useCallback((channel, value) => {
                const current = docRef.current;
                if (!current || editingRef.current === null) return;
                const index = editingRef.current;
                const color = current.palette[index];
                if (!color) return;
                const rgb = hexToRgb(color);
                rgb[channel] = clamp(Math.round(Number(value) || 0), 0, 255);
                const hex = `#${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
                applyEditColor(index, hex);
                if (hexInputRef.current) hexInputRef.current.value = hex.toUpperCase();
            }, [applyEditColor]);

            const setEditHex = useCallback((value) => {
                const index = editingRef.current;
                if (index === null) return;
                let text = String(value || '').trim().toLowerCase();
                if (text.charAt(0) !== '#') text = `#${text}`;
                if (/^#[0-9a-f]{3}$/.test(text)) {
                    text = `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
                }
                if (!/^#[0-9a-f]{6}$/.test(text)) {
                    setNotice('颜色要写成 #rrggbb 或 #rgb');
                    return;
                }
                applyEditColor(index, text);
            }, [applyEditColor]);

            /**
             * Open the system colour picker. Chrome keeps the input's current
             * value as the starting colour, so seed it from the slot first; the
             * in-app sliders/HEX box stay as the precise path.
             */
            const openNativePicker = useCallback(() => {
                const input = nativeColorRef.current;
                const current = docRef.current;
                const index = editingRef.current;
                if (!input || !current || index === null) return;
                input.value = /^#[0-9a-f]{6}$/i.test(current.palette[index] || '')
                    ? current.palette[index]
                    : '#000000';
                try {
                    if (typeof input.showPicker === 'function') {
                        input.showPicker();
                        return;
                    }
                } catch {
                    /* showPicker can throw without a user gesture — fall back */
                }
                input.click();
            }, []);

            const onNativeColor = useCallback((event) => {
                const index = editingRef.current;
                if (index === null) return;
                const value = String(event.target.value || '').toLowerCase();
                if (!/^#[0-9a-f]{6}$/.test(value)) return;
                applyEditColor(index, value);
                if (hexInputRef.current) hexInputRef.current.value = value.toUpperCase();
            }, [applyEditColor]);

            const addColor = useCallback(() => {
                const current = docRef.current;
                if (!current) return;
                if (current.palette.length >= CHARS.length) {
                    setNotice(`调色板最多 ${CHARS.length} 色，先删掉一个再加`);
                    return;
                }
                const palette = current.palette.concat(nextFreeColor(current.palette));
                updatePalette(palette, { color: palette.length - 1 });
                setEditing(palette.length - 1);
            }, [updatePalette]);

            const removeColor = useCallback((index) => {
                const current = docRef.current;
                if (!current || current.palette.length <= 1) return;
                const palette = current.palette.slice();
                palette.splice(index, 1);
                // Pixels that used the removed slot become transparent.
                const layers = current.layers.map((layer) => ({
                    ...layer,
                    rows: layer.rows.map((row) => row.split('').map((ch) => {
                        const value = indexFor(ch);
                        if (value < 0) return '.';
                        if (value === index) return '.';
                        return value > index ? charFor(value - 1) : ch;
                    }).join('')),
                }));
                const next = { ...current, palette, layers };
                docRef.current = next;
                setDoc(next);
                setColorIndex((value) => Math.max(0, Math.min(value, palette.length - 1)));
                // Keep the color editor pointing at a slot that still exists.
                setEditing((value) => {
                    if (value === null) return null;
                    if (value === index) return null;
                    return value > index ? value - 1 : value;
                });
                requestPaint();
                scheduleSave();
            }, [requestPaint, scheduleSave]);

            /**
             * Presets only ever *add* colors. Existing slots keep their index, so every
             * pixel already on the canvas keeps the exact color it was drawn with.
             */
            const applyPreset = useCallback((preset) => {
                const current = docRef.current;
                if (!current) return;
                const palette = current.palette.slice();
                let added = 0;
                preset.colors.slice().forEach((color) => {
                    if (palette.length >= CHARS.length) return;
                    if (palette.indexOf(color) !== -1) return;
                    palette.push(color);
                    added += 1;
                });
                if (added === 0) {
                    setNotice('预设颜色已全部在色板里，画布未改动');
                    return;
                }
                updatePalette(palette, {});
                setNotice(`加入 ${added} 个预设色（第 ${current.palette.length + 1} 号起，画布未改动）`);
            }, [updatePalette]);

            /* -------------------------------------------------------------- */
            /* layers                                                         */
            /* -------------------------------------------------------------- */

            const snapshotLayers = () => {
                const current = docRef.current;
                if (!current) return null;
                const history = historyRef.current;
                history.undo.push(snapshotOf(current));
                if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
                history.redo = [];
                return current;
            };

            const writeLayers = (base, layers) => {
                const next = { ...base, layers };
                docRef.current = next;
                setDoc(next);
                requestPaint();
                scheduleSave();
            };

            const selectLayer = (index) => {
                const current = docRef.current;
                if (!current || index < 0 || index >= current.layers.length) return;
                layerRef.current = index;
                setLayerIndex(index);
            };

            const addLayer = () => {
                const current = docRef.current;
                if (!current) return;
                if (current.layers.length >= MAX_LAYERS) {
                    setNotice(`最多 ${MAX_LAYERS} 个图层`);
                    return;
                }
                const at = Math.min(current.layers.length, Math.max(1, layerRef.current + 1));
                const base = snapshotLayers();
                const layers = base.layers.slice();
                layers.splice(at, 0, {
                    name: `图层 ${base.layers.length + 1}`.slice(0, 60),
                    visible: true,
                    rows: blankRows(base.w, base.h),
                });
                writeLayers(base, layers);
                selectLayer(at);
                setNotice(`已新建图层（第 ${at + 1} 层）`);
            };

            const deleteLayer = (index) => {
                const current = docRef.current;
                if (!current || !current.layers[index]) return;
                if (current.layers.length <= 1) {
                    setNotice('至少要保留一个图层');
                    return;
                }
                const base = snapshotLayers();
                const layers = base.layers.filter((_, position) => position !== index);
                writeLayers(base, layers);
                selectLayer(Math.max(0, Math.min(index - 1, layers.length - 1)));
                setNotice('已删除图层');
            };

            const toggleLayerVisible = (index) => {
                const current = docRef.current;
                if (!current || !current.layers[index]) return;
                const base = snapshotLayers();
                const layers = base.layers.map((layer, position) => (
                    position === index ? { ...layer, visible: layer.visible === false } : layer
                ));
                writeLayers(base, layers);
            };

            const moveLayer = (index, delta) => {
                const current = docRef.current;
                if (!current) return;
                const to = index + delta;
                if (to < 0 || to >= current.layers.length) return;
                const base = snapshotLayers();
                const layers = base.layers.slice();
                const moved = layers.splice(index, 1)[0];
                layers.splice(to, 0, moved);
                writeLayers(base, layers);
                selectLayer(to);
            };

            const duplicateLayer = (index) => {
                const current = docRef.current;
                if (!current || !current.layers[index]) return;
                if (current.layers.length >= MAX_LAYERS) {
                    setNotice(`最多 ${MAX_LAYERS} 个图层`);
                    return;
                }
                const base = snapshotLayers();
                const layers = base.layers.slice();
                const source = layers[index];
                layers.splice(index + 1, 0, {
                    name: `${source.name} 副本`.slice(0, 60),
                    visible: source.visible !== false,
                    rows: source.rows.slice(),
                });
                writeLayers(base, layers);
                selectLayer(index + 1);
                setNotice('已复制图层');
            };

            const mergeLayerDown = (index) => {
                const current = docRef.current;
                if (!current || index <= 0 || !current.layers[index]) return;
                const base = snapshotLayers();
                const layers = base.layers.slice();
                const upper = layers[index];
                const lower = layers[index - 1];
                const rows = lower.rows.map((row, y) => {
                    const over = upper.rows[y] || '.'.repeat(base.w);
                    const cells = row.split('');
                    for (let x = 0; x < base.w; x += 1) {
                        const ch = over[x];
                        if (ch !== undefined && indexFor(ch) >= 0) cells[x] = ch;
                    }
                    return cells.join('');
                });
                layers.splice(index - 1, 2, {
                    name: lower.name.slice(0, 60),
                    visible: lower.visible !== false || upper.visible !== false,
                    rows,
                });
                writeLayers(base, layers);
                selectLayer(index - 1);
                setNotice('已向下合并');
            };

            const startRename = (index) => {
                const current = docRef.current;
                if (!current || !current.layers[index]) return;
                setRenameValue(current.layers[index].name);
                setRenaming(index);
            };

            const commitRename = () => {
                const current = docRef.current;
                const index = renaming;
                setRenaming(-1);
                if (!current || index < 0 || !current.layers[index]) return;
                const name = renameValue.trim().slice(0, 60) || current.layers[index].name;
                if (name === current.layers[index].name) return;
                const base = snapshotLayers();
                const layers = base.layers.map((layer, position) => (
                    position === index ? { ...layer, name } : layer
                ));
                writeLayers(base, layers);
            };

            /* -------------------------------------------------------------- */
            /* panel resizing                                                 */
            /* -------------------------------------------------------------- */

            const applyWidth = (side, value) => {
                const main = mainRef.current;
                if (!main) return;
                main.style.setProperty(side === 'left' ? '--pxs-left' : '--pxs-right', `${value}px`);
                sizeRef.current = side === 'left'
                    ? { left: value, right: sizeRef.current.right }
                    : { left: sizeRef.current.left, right: value };
            };

            const beginResize = (side) => (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const main = mainRef.current;
                if (!main) return;
                const handle = event.currentTarget;
                if (handle) handle.setAttribute('data-dragging', 'true');
                const startX = event.clientX;
                const start = side === 'left' ? leftWidth : rightWidth;
                let latest = start;
                const move = (moveEvent) => {
                    const delta = moveEvent.clientX - startX;
                    latest = side === 'left'
                        ? clamp(start + delta, 132, 360)
                        : clamp(start - delta, 152, 420);
                    applyWidth(side, latest);
                    requestPaint();
                };
                const stop = () => {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', stop);
                    window.removeEventListener('pointercancel', stop);
                    if (handle) handle.removeAttribute('data-dragging');
                    if (side === 'left') setLeftWidth(latest);
                    else setRightWidth(latest);
                    sizeRef.current = side === 'left'
                        ? { left: latest, right: sizeRef.current.right }
                        : { left: sizeRef.current.left, right: latest };
                    storeValue(side === 'left' ? 'pxs:left' : 'pxs:right', Math.round(latest));
                    requestPaint();
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', stop);
                window.addEventListener('pointercancel', stop);
            };



            const statusText = status === 'saving' ? '保存中…'
                : status === 'dirty' ? '未保存'
                    : status === 'error' ? '保存失败'
                        : '已保存';

            const selectionText = selection
                ? `选区 ${selection.w}×${selection.h} @ (${selection.x},${selection.y})${selection.float ? ' · 浮动' : ''}${allLayersMode ? ' · 全部图层' : ''}`
                : '';

            const currentLayer = doc ? doc.layers[layerIndex] : null;

            const swatchNodes = doc ? doc.palette.map((color, index) => h('button', {
                key: `${color}-${index}`,
                className: 'pxs-swatch',
                title: `#${index}: ${color}`,
                'data-selected': index === colorIndex,
                style: { background: color },
                onPointerDown: (event) => event.stopPropagation(),
                onClick: () => {
                    setColorIndex(index);
                    colorRef.current = index;
                    if (tool === 'eraser') setTool('pencil');
                },
                onContextMenu: (event) => {
                    event.preventDefault();
                    setMenu({ index, x: event.clientX, y: event.clientY });
                },
                onDoubleClick: () => editColor(index),
            })) : [];

            const barNode = h('div', { className: 'pxs-bar' },
                h('select', {
                    className: 'pxs-input',
                    style: { maxWidth: 168 },
                    value: doc ? doc.id : '',
                    onChange: (event) => {
                        const id = event.target.value;
                        if (id) void openDoc(id).catch((cause) => setError(String(cause)));
                    },
                }, docs.length === 0
                    ? h('option', { value: '' }, '还没有作品')
                    : docs.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.name))),
                h('input', {
                    className: 'pxs-input',
                    style: { width: 148 },
                    value: doc ? doc.name : '',
                    disabled: !doc,
                    placeholder: '作品名',
                    onChange: (event) => {
                        const current = docRef.current;
                        if (!current) return;
                        const next = { ...current, name: event.target.value };
                        docRef.current = next;
                        setDoc(next);
                        scheduleSave();
                    },
                }),
                h('button', {
                    className: 'pxs-btn',
                    onClick: openNewDialog,
                    title: '新建作品（可选名字与尺寸）',
                }, '新建'),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => {
                        if (fileRef.current) fileRef.current.click();
                    },
                    title: '打开图片，转成像素画导入新作品',
                }, '打开图片'),
                h('input', {
                    ref: fileRef,
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
                    style: { display: 'none' },
                    onChange: (event) => {
                        const input = event.target;
                        const picked = input.files && input.files[0];
                        input.value = '';
                        if (picked) openImportDialog(picked);
                    },
                }),
                h('button', {
                    className: 'pxs-btn',
                    disabled: !doc,
                    onClick: openResizeDialog,
                    title: '调整画布尺寸 / 裁剪（可撤销）',
                }, '尺寸'),
                h('span', { className: 'pxs-spacer' }),
                h('button', {
                    className: 'pxs-btn pxs-btn-icon',
                    title: '撤销 (Ctrl+Z)',
                    disabled: historyRef.current.undo.length === 0,
                    onClick: undo,
                }, h(UndoIcon, null)),
                h('button', {
                    className: 'pxs-btn pxs-btn-icon',
                    title: '重做 (Ctrl+Shift+Z)',
                    disabled: historyRef.current.redo.length === 0,
                    onClick: redo,
                }, h(UndoIcon, { flipped: true })),
                h('button', {
                    className: 'pxs-btn',
                    title: '缩小 (-)',
                    onClick: () => {
                        const position = ZOOMS.indexOf(scaleRef.current);
                        const next = ZOOMS[Math.max(0, (position === -1 ? 0 : position) - 1)];
                        scaleRef.current = next;
                        setZoom(next);
                        requestPaint();
                    },
                }, '−'),
                h('span', { className: 'pxs-hex', style: { minWidth: 42, textAlign: 'center' } }, `${zoom}×`),
                h('button', {
                    className: 'pxs-btn',
                    title: '放大 (+)',
                    onClick: () => {
                        const position = ZOOMS.indexOf(scaleRef.current);
                        const next = ZOOMS[Math.min(ZOOMS.length - 1, (position === -1 ? 0 : position) + 1)];
                        scaleRef.current = next;
                        setZoom(next);
                        requestPaint();
                    },
                }, '+'),
                h('button', { className: 'pxs-btn', title: '适应窗口 (F)', onClick: fitToView }, '适应'),
                h('button', {
                    className: 'pxs-btn',
                    'data-active': showGrid,
                    title: '显示/隐藏格子边界 (H)',
                    onClick: () => {
                        const next = !gridRef.current;
                        gridRef.current = next;
                        setShowGrid(next);
                        storeValue('pxs:grid', next ? '1' : '0');
                        requestPaint();
                    },
                }, showGrid ? '格线开' : '格线关'),
                h('button', {
                    className: 'pxs-btn',
                    disabled: !doc,
                    onClick: () => void exportPng(),
                    title: doc && typeof doc.filePath === 'string' && doc.filePath !== ''
                        ? `覆盖保存到 ${doc.filePath}`
                        : '导出 PNG（首次导出会先选保存位置）',
                }, '导出'),
                h('button', {
                    className: 'pxs-btn',
                    disabled: !doc,
                    onClick: () => void saveAsPng(),
                    title: '另存为 PNG (Ctrl+Shift+S)',
                }, '另存为'),
                h('button', {
                    className: 'pxs-btn',
                    disabled: !doc,
                    onClick: () => void deleteDoc(),
                    title: '删除当前作品',
                }, '删除'),
                h('span', { className: 'pxs-status', 'data-state': status }, statusText),
                selection ? h('span', { className: 'pxs-status pxs-select-status', title: '选区：拖动移框，Shift+拖动带内容，方向键微调，Esc 取消' }, selectionText) : null,
                notice ? h('span', { className: 'pxs-notice', title: notice }, notice) : null);

            const errorNode = error ? h('div', { className: 'pxs-error' },
                `${error}`,
                h('button', {
                    className: 'pxs-btn',
                    style: { marginLeft: 8, height: 20 },
                    onClick: () => setError(''),
                }, '知道了')) : null;

            const toolsSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '工具'),
                h('div', { className: 'pxs-row' }, TOOLS.map((entry) => h('button', {
                    key: entry.id,
                    className: 'pxs-btn pxs-btn-icon',
                    title: `${entry.label} (${entry.key})`,
                    'data-active': tool === entry.id,
                    onClick: () => setTool(entry.id),
                }, h(ToolIcon, { name: entry.icon })))));

            const brushSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '笔刷'),
                h('div', { className: 'pxs-row' },
                    [1, 2, 3, 4].map((size) => h('button', {
                        key: size,
                        className: 'pxs-btn',
                        style: { width: 28, padding: 0 },
                        'data-active': brush === size,
                        title: `${size}×${size} 笔刷 ([ / ])`,
                        onClick: () => setBrush(size),
                    }, String(size)))));

            const layerButtons = h('div', { className: 'pxs-row', style: { gap: 4, marginBottom: 6, flexWrap: 'wrap' } },
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 8px', height: 24 },
                    title: '新建图层',
                    disabled: !doc || doc.layers.length >= MAX_LAYERS,
                    onClick: addLayer,
                }, '＋'),
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 8px', height: 24 },
                    title: '复制当前图层',
                    disabled: !doc,
                    onClick: () => duplicateLayer(layerIndex),
                }, '复制'),
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 8px', height: 24 },
                    title: '与下面一层合并',
                    disabled: !doc || layerIndex <= 0,
                    onClick: () => mergeLayerDown(layerIndex),
                }, '合并'),
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 6px', height: 24 },
                    title: '上移一层',
                    disabled: !doc || layerIndex >= doc.layers.length - 1,
                    onClick: () => moveLayer(layerIndex, 1),
                }, '↑'),
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 6px', height: 24 },
                    title: '下移一层',
                    disabled: !doc || layerIndex <= 0,
                    onClick: () => moveLayer(layerIndex, -1),
                }, '↓'),
                h('button', {
                    className: 'pxs-btn',
                    style: { padding: '0 8px', height: 24 },
                    title: '删除当前图层',
                    disabled: !doc || doc.layers.length <= 1,
                    onClick: () => deleteLayer(layerIndex),
                }, '删除'));

            const layerRows = doc ? doc.layers
                .map((_, index) => index)
                .reverse()
                .map((index) => {
                    const layer = doc.layers[index];
                    const hidden = layer.visible === false;
                    return h('div', {
                        key: index,
                        className: 'pxs-layer',
                        'data-active': index === layerIndex,
                        'data-hidden': hidden,
                        title: '单击选中，双击改名',
                        onClick: () => selectLayer(index),
                        onDoubleClick: () => startRename(index),
                    },
                    h('span', {
                        className: 'pxs-layer-eye',
                        title: hidden ? '显示图层' : '隐藏图层',
                        onClick: (event) => {
                            event.stopPropagation();
                            toggleLayerVisible(index);
                        },
                    }, hidden ? '○' : '●'),
                    renaming === index
                        ? h('input', {
                            className: 'pxs-input pxs-layer-rename',
                            value: renameValue,
                            autoFocus: true,
                            onChange: (event) => setRenameValue(event.target.value),
                            onClick: (event) => event.stopPropagation(),
                            onBlur: commitRename,
                            onKeyDown: (event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitRename();
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setRenaming(-1);
                                }
                            },
                        })
                        : h('span', { className: 'pxs-layer-name' }, layer.name));
                }) : null;

            const layerSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '图层'),
                layerButtons,
                h('div', { className: 'pxs-layers' }, layerRows),
                h('p', { className: 'pxs-hint', style: { marginTop: 6 } },
                    `最多 ${MAX_LAYERS} 层，双击名字可改名`));

            const canvasSection = h('div', { className: 'pxs-section pxs-hide-narrow' },
                h('p', { className: 'pxs-title' }, '画布'),
                h('div', { className: 'pxs-meta' },
                    h('span', null, '尺寸'), h('b', null, doc ? `${doc.w} × ${doc.h}` : '—'),
                    h('span', null, '颜色'), h('b', null, doc ? String(doc.palette.length) : '—'),
                    h('span', null, '缩放'), h('b', null, `${zoom}×`)));

            const keysSection = h('div', { className: 'pxs-section pxs-hide-narrow' },
                h('p', { className: 'pxs-title' }, '快捷键'),
                h('div', { className: 'pxs-keys' },
                    h('div', null, h('kbd', null, 'B'), '铅笔  ', h('kbd', null, 'E'), '橡皮'),
                    h('div', null, h('kbd', null, 'G'), '填充  ', h('kbd', null, 'I'), '吸管'),
                    h('div', null, h('kbd', null, '滚轮'), '缩放  ', h('kbd', null, '空格'), '+ 拖动'),
                    h('div', null, h('kbd', null, 'F'), '适应窗口  ', h('kbd', null, '[ ]'), '笔刷'),
                    h('div', null, h('kbd', null, 'H'), '格线开/关  ', h('kbd', null, 'Ctrl+S'), '保存'),
                    h('div', null, h('kbd', null, 'M'), '选区  ', h('kbd', null, 'Ctrl+A'), '全选'),
                    h('div', null, h('kbd', null, 'Shift'), '+ 拖动', ' 移内容'),
                    h('div', null, h('kbd', null, 'Del'), '删除  ', h('kbd', null, 'Esc'), '取消')));

            const leftPanel = h('div', { className: 'pxs-panel pxs-panel-left' },
                toolsSection, brushSection, layerSection, canvasSection, keysSection);

            const canvasNode = h('canvas', {
                className: 'pxs-canvas',
                ref: canvasRef,
                onPointerDown,
                onPointerMove,
                onPointerUp,
                onPointerCancel: onPointerUp,
                onContextMenu: (event) => {
                    event.preventDefault();
                    if (selectionRef.current) selectApiRef.current.cancel();
                },
                onDragStart: (event) => event.preventDefault(),
            });

            const emptyNode = !doc && !loading ? h('div', { className: 'pxs-empty' },
                h('h3', null, '画一张像素画'),
                h('p', null, '点「新建作品」填个名字、选个尺寸（也可以自己填宽高）。作品保存在本机，随时可以继续画或导出 PNG。'),
                h('button', {
                    className: 'pxs-btn pxs-btn-primary',
                    style: { height: 34, padding: '0 18px' },
                    disabled: creating,
                    onClick: openNewDialog,
                }, '新建作品')) : null;

            const loadingNode = loading ? h('div', { className: 'pxs-empty' }, h('p', null, '加载作品中…')) : null;

            const selectionBar = selection ? h('div', { className: 'pxs-selection-bar' },
                h('span', { className: 'pxs-selection-label' },
                    `${selection.w}×${selection.h} @ ${selection.x},${selection.y}`),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => selectApiRef.current.apply('mirror-h', allLayersRef.current),
                    title: '水平镜像 (Shift+H)',
                }, '⇆ 水平镜像'),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => selectApiRef.current.apply('mirror-v', allLayersRef.current),
                    title: '垂直镜像 (Shift+V)',
                }, '⇅ 垂直镜像'),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => selectApiRef.current.apply('fill', allLayersRef.current),
                    title: '用当前颜色填充 (Shift+F)',
                }, '▣ 填充'),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => selectApiRef.current.apply('delete', allLayersRef.current),
                    title: '删除选区内容 (Delete)',
                }, '⌫ 删除'),
                h('button', {
                    className: 'pxs-btn',
                    'data-active': grabMode,
                    title: '抓着像素拖动（也可以 Shift+拖动）',
                    onClick: () => setGrabMode((value) => !value),
                }, grabMode ? '✱ 抓着：开' : '✱ 抓着像素'),
                h('button', {
                    className: 'pxs-btn',
                    'data-active': allLayersMode,
                    title: '镜像 / 填充 / 删除作用于所有可见图层（也可以按住 Alt）',
                    onClick: () => setAllLayersMode((value) => !value),
                }, allLayersMode ? '多层：开' : '多层'),
                h('button', {
                    className: 'pxs-btn',
                    onClick: () => selectApiRef.current.cancel(),
                    title: '取消选区 (Esc)',
                }, '✕')) : null;

            const stageNode = h('div', { className: 'pxs-stage', ref: stageRef },
                canvasNode, emptyNode, loadingNode, selectionBar);

            const colorSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '当前颜色'),
                h('div', { className: 'pxs-primary' },
                    h('div', {
                        className: 'pxs-chip',
                        style: { background: doc && doc.palette[colorIndex] ? doc.palette[colorIndex] : '#000000' },
                    }),
                    h('div', null,
                        h('div', { className: 'pxs-hex', style: { fontSize: 12, color: 'inherit' } },
                            doc && doc.palette[colorIndex] ? doc.palette[colorIndex].toUpperCase() : '—'),
                        h('div', { className: 'pxs-hint' }, `色板 #${colorIndex}`))));

            const paletteSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '调色板'),
                h('div', { className: 'pxs-swatches' },
                    swatchNodes,
                    h('button', {
                        className: 'pxs-swatch-add',
                        title: '添加颜色',
                        disabled: !doc,
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: addColor,
                    }, '+')),
                h('p', { className: 'pxs-hint', style: { marginTop: 6 } }, '点选颜色 · 双击改色 · 右键更多'));

            const presetSection = h('div', { className: 'pxs-section' },
                h('p', { className: 'pxs-title' }, '预设色板'),
                h('div', { className: 'pxs-row' }, PRESETS.map((preset) => h('button', {
                    key: preset.id,
                    className: 'pxs-btn',
                    disabled: !doc,
                    title: preset.colors.join(' '),
                    onClick: () => applyPreset(preset),
                }, preset.name))));

            const editColorValue = doc && editing !== null && editing < doc.palette.length ? doc.palette[editing] : null;
            const editRgb = editColorValue ? hexToRgb(editColorValue) : [0, 0, 0];

            const colorEditNode = editColorValue === null ? null : h('div', { className: 'pxs-section pxs-color-edit' },
                h('p', { className: 'pxs-title' }, `改色 #${editing}`),
                h('div', { className: 'pxs-color-edit-head' },
                    h('input', {
                        key: `native-${editing}`,
                        ref: nativeColorRef,
                        type: 'color',
                        className: 'pxs-native-color',
                        defaultValue: editColorValue,
                        onChange: onNativeColor,
                        title: '点开系统取色器（可视化色域）',
                    }),
                    h('input', {
                        key: `hex-${editing}`,
                        ref: hexInputRef,
                        className: 'pxs-input pxs-hex-input',
                        defaultValue: String(editColorValue).toUpperCase(),
                        spellCheck: false,
                        title: 'Enter 应用 · Esc 关闭',
                        onKeyDown: (event) => {
                            if (event.key === 'Enter') setEditHex(event.currentTarget.value);
                            else if (event.key === 'Escape') endEdit();
                            event.stopPropagation();
                        },
                        onBlur: (event) => setEditHex(event.currentTarget.value),
                    }),
                    h('button', { className: 'pxs-btn', onClick: endEdit, title: '关闭改色面板' }, '完成')),
                h('button', {
                    className: 'pxs-btn pxs-picker-btn',
                    onClick: openNativePicker,
                    title: '打开系统取色器',
                }, '取色器…'),
                h('p', { className: 'pxs-hint' }, '改色只改这个色板槽位，画布上已有的像素颜色不变。'),
                h('div', { className: 'pxs-color-edit-sliders' },
                    ['R', 'G', 'B'].map((label, channel) => h('label', { key: label, className: 'pxs-slider-row' },
                        h('span', { className: 'pxs-slider-label' }, label),
                        h('input', {
                            className: 'pxs-range',
                            type: 'range',
                            min: 0,
                            max: 255,
                            step: 1,
                            value: editRgb[channel],
                            onChange: (event) => setEditChannel(channel, event.target.value),
                        }),
                        h('span', { className: 'pxs-slider-value' }, String(editRgb[channel]))))),
                h('div', { className: 'pxs-row' },
                    h('button', {
                        className: 'pxs-btn',
                        onClick: () => {
                            setColorIndex(editing);
                            colorRef.current = editing;
                        },
                        title: '把这个颜色设为当前画笔色',
                    }, '选为当前色'),
                    h('button', {
                        className: 'pxs-btn',
                        onClick: () => {
                            removeColor(editing);
                            endEdit();
                        },
                        disabled: !doc || doc.palette.length <= 1,
                    }, '删除该色')));

            const rightPanel = h('div', { className: 'pxs-panel pxs-panel-right' },
                colorSection, paletteSection, colorEditNode, presetSection);

            const menuNode = menu ? h('div', {
                className: 'pxs-menu',
                style: {
                    left: Math.min(menu.x, window.innerWidth - 150),
                    top: Math.min(menu.y, window.innerHeight - 110),
                },
                onPointerDown: (event) => event.stopPropagation(),
            },
            h('button', {
                onClick: () => {
                    setColorIndex(menu.index);
                    colorRef.current = menu.index;
                    setMenu(null);
                },
            }, '设为当前颜色'),
            h('button', {
                onClick: () => {
                    editColor(menu.index);
                    setMenu(null);
                },
            }, '编辑颜色'),
            h('button', {
                'data-danger': 'true',
                onClick: () => {
                    removeColor(menu.index);
                    setMenu(null);
                },
            }, '删除颜色')) : null;

            const dialogNode = saveDialog ? h('div', {
                className: 'pxs-modal',
                onPointerDown: (event) => {
                    if (event.target === event.currentTarget) setSaveDialog(null);
                },
            },
            h('div', { className: 'pxs-dialog', role: 'dialog', 'aria-label': '保存 PNG' },
                h('div', { className: 'pxs-dialog-head' },
                    h('strong', null, saveDialog.mode === 'saveAs' ? '另存为 PNG' : '选择保存位置'),
                    h('button', { className: 'pxs-dialog-close', onClick: () => setSaveDialog(null) }, '×')),
                h('div', { className: 'pxs-dialog-row' },
                    h('button', {
                        className: 'pxs-btn',
                        disabled: saveDialog.loading || !saveDialog.parent,
                        title: '上级目录',
                        onClick: () => void browseDir(saveDialog.parent),
                    }, '↑'),
                    h('input', {
                        className: 'pxs-input',
                        style: { flex: 1 },
                        spellCheck: false,
                        value: saveDialog.pathInput,
                        onChange: (event) => {
                            const value = event.target.value;
                            setSaveDialog((current) => (current ? { ...current, pathInput: value } : current));
                        },
                        onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void browseDir(saveDialog.pathInput);
                            }
                        },
                    }),
                    h('button', {
                        className: 'pxs-btn',
                        onClick: () => void browseDir(saveDialog.pathInput),
                    }, '前往')),
                h('div', { className: 'pxs-dialog-list' },
                    saveDialog.loading ? h('div', { className: 'pxs-dialog-empty' }, '读取目录…') : null,
                    !saveDialog.loading && saveDialog.dirs.length === 0
                        ? h('div', { className: 'pxs-dialog-empty' }, '这里没有子目录')
                        : null,
                    saveDialog.dirs.map((entry) => h('button', {
                        key: entry.path,
                        className: 'pxs-dialog-item',
                        'data-hidden': entry.hidden ? 'true' : 'false',
                        title: entry.path,
                        onClick: () => void browseDir(entry.path),
                    }, entry.name))),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '文件名'),
                    h('input', {
                        className: 'pxs-input',
                        style: { flex: 1 },
                        spellCheck: false,
                        value: saveDialog.name,
                        onChange: (event) => {
                            const value = event.target.value;
                            setSaveDialog((current) => (current ? { ...current, name: value } : current));
                        },
                        onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void confirmSave();
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                setSaveDialog(null);
                            }
                        },
                    })),
                h('div', { className: 'pxs-dialog-row', style: { flexWrap: 'wrap' } },
                    h('span', { className: 'pxs-dialog-label' }, '倍率'),
                    EXPORT_SCALES.map((value) => {
                        const ceiling = maxScaleFor(doc ? doc.w : 1, doc ? doc.h : 1);
                        const allowed = value <= ceiling;
                        return h('button', {
                            key: value,
                            className: 'pxs-scale-chip',
                            'data-active': Number(saveDialog.scale) === value ? 'true' : 'false',
                            disabled: !allowed,
                            title: allowed
                                ? `${value}× → ${(doc ? doc.w : 0) * value}×${(doc ? doc.h : 0) * value}`
                                : '超出单张 PNG 上限',
                            onClick: () => setSaveDialog((current) => (current ? { ...current, scale: value } : current)),
                        }, `${value}×`);
                    }),
                    h('span', { className: 'pxs-hint' }, doc
                        ? `${saveDialog.scale}× = ${doc.w * saveDialog.scale}×${doc.h * saveDialog.scale}`
                        : '')),
                saveDialog.error ? h('div', { className: 'pxs-dialog-error' }, saveDialog.error) : null,
                h('div', { className: 'pxs-dialog-actions' },
                    h('button', { className: 'pxs-btn', onClick: () => setSaveDialog(null) }, '取消'),
                    h('button', {
                        className: 'pxs-btn pxs-btn-primary',
                        disabled: saveDialog.busy || saveDialog.loading || saveDialog.path === '',
                        onClick: () => void confirmSave(),
                    }, saveDialog.busy ? '保存中…' : '保存')))) : null;

            const newDialogNode = newDialog ? h('div', {
                className: 'pxs-modal',
                onPointerDown: (event) => {
                    if (event.target === event.currentTarget && !creating) setNewDialog(null);
                },
            },
            h('div', { className: 'pxs-dialog pxs-new-dialog', role: 'dialog', 'aria-label': '新建作品' },
                h('div', { className: 'pxs-dialog-head' },
                    h('strong', null, '新建作品'),
                    h('button', {
                        className: 'pxs-dialog-close',
                        disabled: creating,
                        onClick: () => setNewDialog(null),
                    }, '×')),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '名字'),
                    h('input', {
                        className: 'pxs-input',
                        style: { flex: 1 },
                        spellCheck: false,
                        autoFocus: true,
                        value: newDialog.name,
                        onChange: (event) => {
                            const value = event.target.value;
                            setNewDialog((current) => (current ? { ...current, name: value } : current));
                        },
                        onKeyDown: (event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                confirmNewDoc();
                            }
                            if (event.key === 'Escape') setNewDialog(null);
                            event.stopPropagation();
                        },
                    })),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '宽'),
                    h('input', {
                        className: 'pxs-input',
                        style: { width: 72 },
                        type: 'number',
                        min: 1,
                        max: MAX_SIDE,
                        value: newDialog.w,
                        onChange: (event) => {
                            const value = event.target.value;
                            setNewDialog((current) => (current ? { ...current, w: value } : current));
                        },
                    }),
                    h('span', { className: 'pxs-dialog-label' }, '高'),
                    h('input', {
                        className: 'pxs-input',
                        style: { width: 72 },
                        type: 'number',
                        min: 1,
                        max: MAX_SIDE,
                        value: newDialog.h,
                        onChange: (event) => {
                            const value = event.target.value;
                            setNewDialog((current) => (current ? { ...current, h: value } : current));
                        },
                    }),
                    h('span', { className: 'pxs-hint' }, `最大 ${MAX_SIDE}`)),
                h('div', { className: 'pxs-size-grid' },
                    NEW_PRESETS.map((preset) => h('button', {
                        key: preset.label,
                        className: 'pxs-size-chip',
                        'data-active': String(newDialog.w) === String(preset.w) && String(newDialog.h) === String(preset.h) ? 'true' : 'false',
                        onClick: () => setNewDialog((current) => (current ? { ...current, w: preset.w, h: preset.h } : current)),
                    },
                    h('span', { className: 'pxs-size-label' }, preset.label),
                    h('span', { className: 'pxs-size-hint' }, preset.hint)))),
                newDialog.error ? h('div', { className: 'pxs-dialog-error' }, newDialog.error) : null,
                h('div', { className: 'pxs-dialog-actions' },
                    h('button', {
                        className: 'pxs-btn',
                        disabled: creating,
                        onClick: () => setNewDialog(null),
                    }, '取消'),
                    h('button', {
                        className: 'pxs-btn pxs-btn-primary',
                        disabled: creating,
                        onClick: confirmNewDoc,
                    }, creating ? '创建中…' : '创建')))) : null;

            const importDialogNode = importDialog ? h('div', {
                className: 'pxs-modal',
                onPointerDown: (event) => {
                    if (event.target === event.currentTarget && !importDialog.busy) setImportDialog(null);
                },
            },
            h('div', { className: 'pxs-dialog pxs-import-dialog', role: 'dialog', 'aria-label': '打开图片' },
                h('div', { className: 'pxs-dialog-head' },
                    h('strong', null, '打开图片'),
                    h('button', {
                        className: 'pxs-dialog-close',
                        disabled: importDialog.busy,
                        onClick: () => setImportDialog(null),
                    }, '×')),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '名字'),
                    h('input', {
                        className: 'pxs-input',
                        style: { flex: 1 },
                        maxLength: 60,
                        value: importDialog.name,
                        onChange: (event) => {
                            const value = event.target.value;
                            setImportDialog((current) => (current ? { ...current, name: value } : current));
                        },
                    })),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '原图'),
                    h('span', { className: 'pxs-hint' },
                        `${importDialog.sourceW}×${importDialog.sourceH} → ${importDialog.width}×${importDialog.height}`
                        + ` · ${importDialog.palette.length} 色`
                        + (importDialog.note ? ` · ${importDialog.note}` : ''))),
                h('div', { className: 'pxs-dialog-row', style: { flexWrap: 'wrap' } },
                    h('span', { className: 'pxs-dialog-label' }, '配色'),
                    [
                        { id: 'auto', label: '自动提取' },
                        { id: 'current', label: '当前调色板', disabled: !(doc && doc.palette.length > 0) },
                        { id: 'pico8', label: 'PICO-8' },
                    ].map((mode) => h('button', {
                        key: mode.id,
                        className: 'pxs-scale-chip',
                        'data-active': importDialog.mode === mode.id ? 'true' : 'false',
                        disabled: mode.disabled === true || importDialog.busy,
                        onClick: () => retuneImport({ mode: mode.id }),
                    }, mode.label)),
                    h('button', {
                        className: 'pxs-scale-chip',
                        'data-active': importDialog.dither ? 'true' : 'false',
                        disabled: importDialog.busy,
                        title: '误差扩散抖动，渐变更自然但像素更碎',
                        onClick: () => retuneImport({ dither: !importDialog.dither }),
                    }, '抖动')),
                importDialog.preview
                    ? h('div', { className: 'pxs-import-preview' },
                        h('img', { src: importDialog.preview, alt: '导入预览' }))
                    : null,
                importDialog.error ? h('div', { className: 'pxs-dialog-error' }, importDialog.error) : null,
                h('div', { className: 'pxs-dialog-actions' },
                    h('button', {
                        className: 'pxs-btn',
                        disabled: importDialog.busy,
                        onClick: () => setImportDialog(null),
                    }, '取消'),
                    h('button', {
                        className: 'pxs-btn pxs-btn-primary',
                        disabled: importDialog.busy || !Array.isArray(importDialog.rows),
                        onClick: confirmImport,
                    }, importDialog.busy ? '导入中…' : '导入')))) : null;

            const resizeDialogNode = resizeDialog ? h('div', {
                className: 'pxs-modal',
                onPointerDown: (event) => {
                    if (event.target === event.currentTarget) setResizeDialog(null);
                },
            },
            h('div', { className: 'pxs-dialog pxs-resize-dialog', role: 'dialog', 'aria-label': '画布尺寸' },
                h('div', { className: 'pxs-dialog-head' },
                    h('strong', null, '画布尺寸 / 裁剪'),
                    h('button', {
                        className: 'pxs-dialog-close',
                        onClick: () => setResizeDialog(null),
                    }, '×')),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '当前'),
                    h('span', { className: 'pxs-hint' },
                        doc ? `${doc.w}×${doc.h} · 目标 ${Math.round(Number(resizeDialog.w) || 0)}×${Math.round(Number(resizeDialog.h) || 0)}` : '')),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '宽'),
                    h('input', {
                        className: 'pxs-input',
                        style: { width: 84 },
                        type: 'number',
                        min: 1,
                        max: MAX_SIDE,
                        value: resizeDialog.w,
                        onChange: (event) => {
                            const value = event.target.value;
                            setResizeDialog((current) => (current ? { ...current, w: value } : current));
                        },
                    }),
                    h('span', { className: 'pxs-dialog-label' }, '高'),
                    h('input', {
                        className: 'pxs-input',
                        style: { width: 84 },
                        type: 'number',
                        min: 1,
                        max: MAX_SIDE,
                        value: resizeDialog.h,
                        onChange: (event) => {
                            const value = event.target.value;
                            setResizeDialog((current) => (current ? { ...current, h: value } : current));
                        },
                    }),
                    h('span', { className: 'pxs-hint' }, `最大 ${MAX_SIDE}`)),
                h('div', { className: 'pxs-dialog-row' },
                    h('span', { className: 'pxs-dialog-label' }, '锚点'),
                    h('div', { className: 'pxs-anchor-grid' },
                        ANCHORS.map((anchor) => h('button', {
                            key: anchor.id,
                            className: 'pxs-anchor-chip',
                            'data-active': resizeDialog.anchor === anchor.id ? 'true' : 'false',
                            title: `以${anchor.label}为基准保留画面`,
                            onClick: () => setResizeDialog((current) => (current ? { ...current, anchor: anchor.id } : current)),
                        }, anchor.label))),
                    h('span', { className: 'pxs-hint' }, '扩边补透明，裁掉的部分丢弃')),
                resizeDialog.error ? h('div', { className: 'pxs-dialog-error' }, resizeDialog.error) : null,
                h('div', { className: 'pxs-dialog-actions' },
                    h('button', { className: 'pxs-btn', onClick: () => setResizeDialog(null) }, '取消'),
                    h('button', {
                        className: 'pxs-btn pxs-btn-primary',
                        onClick: confirmResize,
                    }, '应用')))) : null;

            return h('div', { className: 'pxs-root' },
                h('style', null, CSS),
                barNode,
                errorNode,
                h('div', {
                    className: 'pxs-main',
                    ref: mainRef,
                    style: {
                        '--pxs-left': `${leftWidth}px`,
                        '--pxs-right': `${rightWidth}px`,
                    },
                },
                leftPanel,
                h('div', {
                    className: 'pxs-splitter',
                    title: '拖动调整左栏宽度',
                    onPointerDown: beginResize('left'),
                }),
                stageNode,
                h('div', {
                    className: 'pxs-splitter',
                    title: '拖动调整右栏宽度',
                    onPointerDown: beginResize('right'),
                }),
                rightPanel),
                menuNode,
                dialogNode,
                newDialogNode,
                importDialogNode,
                resizeDialogNode);
        }

        /**
         * Keeps a failure inside the Pixel Studio view: without this, a render error
         * takes down the whole conversation surface and the UI appears blank.
         */
        class PixelStudioBoundary extends React.Component {
            constructor(props) {
                super(props);
                this.state = { error: null };
                this.retry = () => this.setState({ error: null });
            }

            static getDerivedStateFromError(error) {
                return { error };
            }

            componentDidCatch(error) {
                console.error('[dsh-pixel-studio]', error);
            }

            render() {
                const error = this.state.error;
                if (!error) return h(PixelStudio, this.props);
                const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
                return h('div', { className: 'pxs-root' },
                    h('style', null, CSS),
                    h('div', {
                        className: 'pxs-fallback',
                        style: {
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '8px',
                            padding: '24px',
                            overflow: 'auto',
                        },
                    },
                    h('strong', { style: { fontSize: '13px' } }, '像素画工作区出错了'),
                    h('p', {
                        style: {
                            margin: 0,
                            fontSize: '12px',
                            color: 'var(--dsw-alias-label-secondary, #6b7280)',
                            whiteSpace: 'pre-wrap',
                        },
                    }, message),
                    h('div', { style: { display: 'flex', gap: '8px' } },
                        h('button', { className: 'pxs-btn', onClick: this.retry }, '重试'),
                        h('button', {
                            className: 'pxs-btn',
                            onClick: () => window.location.reload(),
                        }, '刷新页面'))));
            }
        }

        // Test hook: tools/select-test.cjs drives the pure selection helpers.
        if (window.__PXS_TEST__) {
            window.__PXS_TEST__.selection = {
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
            };
        }

        return {
            inject: ['slots'],
            apply(ctx) {
                ctx.slots.inject('conversation.view', () => ctx.slots.register({
                    name: 'conversation.view',
                    id: 'pixel-studio',
                    order: 20,
                    label: () => '像素画',
                }, PixelStudioBoundary));
            },
        };
    },
});
