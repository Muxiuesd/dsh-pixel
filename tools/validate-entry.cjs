#!/usr/bin/env node
'use strict';

/**
 * Validates the marketplace submission entry for @muxiuesd/dsh-pixel-studio
 * against dsh-m's own registry rules (lib/core/registry.js → validateRegistry),
 * so the PR cannot fail on a field we could have checked locally.
 *
 * Usage: node tools/validate-entry.cjs [path/to/registry.json]
 *   - no argument: validate the single candidate entry below
 *   - with a path: validate that whole registry file (used to check a fork)
 */

const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const profileDir = process.env.DSH_PROFILE_DIR
    || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const registryModule = path.join(profileDir, 'node_modules', 'dsh-m', 'lib', 'core', 'registry.js');

/** The entry to submit. Keep in sync with the PR in MARKET-SUBMISSION.md. */
const ENTRY = {
    id: 'dsh-pixel-studio',
    name: '像素画工作室',
    description:
        'DSH 会话页签里的手绘像素画编辑器：三栏布局（左工具 / 中画布 / 右调色板），滚轮按光标缩放，'
        + '支持图层增删合并、按合成色填充、内置调色板改色（不动画布已有像素），PNG 导出直接落到当前对话目录。',
    category: 'self-dev',
    tags: ['pixel-art', 'canvas', 'editor', 'image', 'export'],
    source: 'npm',
    npm: '@muxiuesd/dsh-pixel-studio',
    icon: 'https://unpkg.com/@muxiuesd/dsh-pixel-studio@0.1.1/icon.png',
    homepage: 'https://github.com/Muxiuesd/dsh-pixel',
    verified: ['0.1.1'],
};

async function main() {
    let mod;
    try {
        mod = await import(pathToFileURL(registryModule).href);
    } catch (cause) {
        console.error(`cannot load dsh-m validator from ${registryModule}`);
        console.error(cause && cause.message ? cause.message : cause);
        process.exit(2);
    }
    if (typeof mod.validateRegistry !== 'function') {
        console.error('dsh-m validator does not export validateRegistry');
        process.exit(2);
    }

    const target = process.argv[2];
    const registry = target
        ? JSON.parse(require('node:fs').readFileSync(target, 'utf8'))
        : { version: 1, plugins: [ENTRY] };

    const result = mod.validateRegistry(registry);
    const label = target || 'candidate entry';

    if (!result.ok) {
        console.error(`FAIL ${label}`);
        for (const error of result.errors) console.error(`  - ${error}`);
        process.exit(1);
    }

    console.log(`PASS ${label}`);
    console.log(`  entries: ${registry.plugins.length}`);
    console.log(`  id:      ${ENTRY.id}`);
    console.log(`  install: dsh plugin --profile web add ${ENTRY.npm}`);
    const summary = mod.registrySummary
        ? mod.registrySummary({ registry: result.registry, errors: [] })
        : null;
    if (summary) console.log(`  summary: ${JSON.stringify(summary)}`);
}

main();
