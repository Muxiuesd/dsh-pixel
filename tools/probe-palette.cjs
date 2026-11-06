/* Palette round-trip probe: palette slots must keep their index, even when two slots share a color. */
const API = 'http://127.0.0.1:56673/dsh-pixel-studio';

async function call(body) {
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pixel-studio': '1' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
        return { status: res.status, json: JSON.parse(text) };
    } catch {
        return { status: res.status, text };
    }
}

(async () => {
    const doc = {
        id: 'probe-palette',
        name: '调色板探针',
        w: 3,
        h: 1,
        palette: ['#ff0000', '#ff0000', '#00ff00'],
        layers: [{ name: '层1', visible: true, rows: ['012'] }],
    };
    const first = await call({ op: 'save', doc });
    const id = first.json && first.json.doc && first.json.doc.id;
    const second = await call({ op: 'save', doc: { ...doc, id } });
    const read = await call({ op: 'get', id });
    const back = read.json && read.json.doc;
    console.log('save#1', first.status, first.json && first.json.ok);
    console.log('save#2', second.status, second.json && second.json.ok);
    console.log('palette', JSON.stringify(back && back.palette));
    console.log('rows', JSON.stringify(back && back.layers[0].rows));
    const kept = back && back.palette.length === 3 && back.palette[0] === back.palette[1];
    console.log(kept && back.layers[0].rows[0] === '012'
        ? 'PASS: duplicate slots and their indices survive a round trip'
        : 'FAIL: palette slots were re-indexed');
    const del = await call({ op: 'delete', id });
    console.log('cleanup', del.json && del.json.ok);
})();
