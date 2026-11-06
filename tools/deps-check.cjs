#!/usr/bin/env node
/*
 * deps-check.cjs — catch the "TDZ in a hook dependency array" bug class.
 *
 * A hook's dependency array is evaluated during render, at the position where
 * the hook call appears. If the array names a `const`/`let` binding that is
 * initialized LATER in the same function body, the render throws
 *   ReferenceError: Cannot access 'x' before initialization
 * which unmounts the whole React tree (blank page) instead of failing softly.
 *
 * Usage: node deps-check.cjs <file.js> [...more files]
 */

const fs = require('node:fs');

function checkFile(file) {
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);

    // Collect declared bindings with their line number.
    const declared = new Map(); // name -> lineNo (1-based)
    lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const re = /\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
        let match;
        while ((match = re.exec(line)) !== null) {
            const name = match[2];
            if (!declared.has(name)) declared.set(name, index + 1);
        }
    });

    const problems = [];
    const depRe = /(\}|\])\s*,\s*\[([^\]]*)\]\s*\)\s*;/g;
    lines.forEach((line, index) => {
        let match;
        depRe.lastIndex = 0;
        while ((match = depRe.exec(line)) !== null) {
            const parts = match[2].split(',').map((part) => part.trim());
            // A dependency array holds identifiers only; anything else means we
            // matched some other `], [...]);` expression, so ignore it.
            if (!parts.every((part) => part === '' || /^[A-Za-z_$][\w$]*$/.test(part))) continue;
            if (!/\)\s*;\s*$/.test(line)) continue;
            const deps = parts.filter((part) => part !== '');
            for (const dep of deps) {
                const declaredAt = declared.get(dep);
                if (declaredAt !== undefined && declaredAt > index + 1) {
                    problems.push({
                        dep,
                        arrayLine: index + 1,
                        declaredLine: declaredAt,
                        text: line.trim(),
                    });
                }
            }
        }
    });

    if (problems.length === 0) {
        console.log(`OK   ${file} — no forward-referenced hook deps`);
        return 0;
    }
    console.log(`FAIL ${file}`);
    for (const problem of problems) {
        console.log(`  dep "${problem.dep}" used at line ${problem.arrayLine} but declared at line ${problem.declaredLine}`);
        console.log(`    ${problem.text}`);
    }
    return 1;
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('usage: node deps-check.cjs <file.js> [...]');
    process.exit(2);
}
let status = 0;
for (const file of files) status |= checkFile(file);
process.exit(status);
