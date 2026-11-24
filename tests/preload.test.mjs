import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extensionPreloads } from '../server/chat-tabs/preload.mjs';

test('prepares native extension URLs without activating disabled extensions or exposing settings', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-tabs-preload-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const publicDirectory = path.join(root, 'public');
    const userDirectory = path.join(root, 'user');
    const manifest = (directory, value) => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(value));
    };
    manifest(path.join(publicDirectory, 'builtin'), { js: 'index.js' });
    manifest(path.join(publicDirectory, 'third-party/helper'), { js: 'dist/index.js', css: 'dist/index.css' });
    manifest(path.join(userDirectory, 'helper'), { js: 'user.js' });
    manifest(path.join(userDirectory, 'template'), { js: '模板.js' });
    manifest(path.join(userDirectory, 'disabled'), { js: 'index.js' });
    manifest(path.join(userDirectory, 'unsafe'), { js: '../../settings.json', css: 'https://example.com/theme.css' });
    const html = extensionPreloads(publicDirectory, userDirectory, {
        secret: 'DO_NOT_EXPORT', extension_settings: { disabledExtensions: ['third-party/disabled'] },
    });
    assert.ok(html.includes('rel="modulepreload" href="/scripts/extensions/builtin/index.js"'));
    assert.ok(html.includes('rel="modulepreload" href="/scripts/extensions/third-party/helper/dist/index.js"'));
    assert.ok(html.includes('rel="preload" as="style" href="/scripts/extensions/third-party/helper/dist/index.css"'));
    assert.ok(html.includes(encodeURIComponent('模板.js')));
    assert.doesNotMatch(html, /<script|user.js|disabled|unsafe|DO_NOT_EXPORT|https:/);
});
