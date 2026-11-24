import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(process.env.BOOTSTRAP_SOURCE || 'server/chat-tabs/bootstrap.js', 'utf8');
const pathname = '/api/plugins/chat-tabs/tab/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture(responses) {
    const calls = [], panels = [];
    const window = { fetch: async (url, options) => { calls.push({ url, options }); return responses[Math.min(calls.length - 1, responses.length - 1)].clone(); }, addEventListener() {} };
    const node = () => ({ style: {}, setAttribute() {}, append() {} });
    const document = { baseURI: 'http://fixture/',
        querySelector: () => ({ content: 'settings,backends' }), querySelectorAll: () => [], addEventListener() {},
        getElementById: () => null, createElement: node, body: { append(value) { panels.push(value); } },
    };
    const sandbox = { window, document, location: { pathname, origin: 'http://fixture' },
        jQuery: { ajaxPrefilter() {} }, crypto, Headers, Request, URL, File, FormData, Element: class {},
        XMLHttpRequest: class { open() {} }, setInterval() {}, setTimeout: fn => setTimeout(fn, 1),
    };
    vm.runInNewContext(source, sandbox);
    return { calls, panels, fetch: () => window.fetch('/api/backends/chat-completions/generate', { method: 'POST', body: '{}' }) };
}
const response = (status, body) => new Response(JSON.stringify(body), { status });
const conflict = () => response(409, { code: 'WINDOW_IN_USE' });
test('a native 409 after lease acquisition is returned without replaying a paid request', async () => {
    const app = fixture([conflict(), response(409, { error: 'native conflict' }), response(200, { reply: 'unexpected retry' })]);
    assert.equal((await app.fetch()).status, 409);
    assert.equal(app.calls.length, 2); assert.equal(app.panels.length, 0);
});
test('refresh grace period retries a lease conflict and succeeds once released', async () => {
    const app = fixture([conflict(), response(200, { reply: 'ok' })]);
    assert.equal((await app.fetch()).status, 200);
    assert.equal(app.calls.length, 2); assert.equal(app.panels.length, 0);
});
test('a genuinely occupied window shows the lease warning after the grace period', async () => {
    const app = fixture([conflict()]);
    assert.equal((await app.fetch()).status, 409);
    assert.equal(app.calls.length, 16); assert.equal(app.panels.length, 1);
});
test('ordinary native errors are never retried', async () => {
    const app = fixture([response(409, { error: 'native error' })]);
    assert.equal((await app.fetch()).status, 409); assert.equal(app.calls.length, 1);
});
