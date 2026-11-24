import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(process.env.TASK_SOURCE || 'frontend/chat-tabs/tasks.js', 'utf8');
const endpoint = 'http://localhost/api/backends/chat-completions/generate';
function setup(handler, overrides = {}) {
    const events = new Map(), calls = [], warnings = [];
    const context = {
        eventSource: { on(name, fn) { events.set(name, fn); } },
        eventTypes: { GENERATION_STARTED: 'start', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', MESSAGE_RECEIVED: 'message' },
        mainApi: 'openai', groupId: null, characterId: 0, characters: [{ avatar: 'role.png' }],
        name2: 'Role', chatId: 'story', chatMetadata: {}, chat: [{ is_user: true, mes: 'Hello' }],
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        saveChat: async () => {},
        ...overrides,
    };
    const window = { STChatTabs: { clientId: 'client' }, toastr: { info() {}, warning: text => warnings.push(text) } };
    window.fetch = async (url, options) => { calls.push({ url, options }); return handler(url, options); };
    const sandbox = { window, SillyTavern: { getContext: () => context }, Request, Response, DOMException, URL,
        crypto, document: { baseURI: 'http://localhost/', addEventListener() {} }, location: { origin: 'http://localhost' },
        setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout,
    };
    vm.runInNewContext(source.replace('export function createTaskController', 'function createTaskController') + '\nthis.create = createTaskController;', sandbox);
    sandbox.create('tab', { background: true }, () => {});
    events.get('start')('normal', {}, false);
    const generate = (generation = {}, signal) => window.fetch(endpoint, {
        method: 'POST', signal, body: JSON.stringify({ chat_completion_source: 'custom', messages: [], stream: false, ...generation }),
    });
    return { calls, warnings, events, context, generate };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const done = { id: 'task', status: 'succeeded', target: { chat: 'story', avatar: 'role.png' }, result: { choices: [{ message: { content: 'A reply' } }] } };

test('one paid submission; transient polling failure reconnects to the same task', async () => {
    let polls = 0;
    const app = setup((_url, options) => {
        if (options.method === 'POST') return json({ status: 'running' }, 202);
        if (++polls === 1) throw new TypeError('offline');
        return json(done);
    });
    const response = await app.generate();
    assert.equal((await response.json()).choices[0].message.content, 'A reply');
    assert.equal(app.calls.filter(c => c.options.method === 'POST').length, 1);
    assert.equal(polls, 2);
});

test('lost creation acknowledgement never falls back to a second paid request', async () => {
    const app = setup(() => { throw new TypeError('offline'); });
    await assert.rejects(app.generate(), /offline/);
    assert.equal(app.calls.length, 1);
    assert.equal(app.warnings.length, 1);
});

for (const status of [404, 409, 403]) {
    test('terminal polling error ' + status + ' ends waiting', async () => {
        let polls = 0;
        const app = setup((_url, options) => options.method === 'POST' ? json({ status: 'running' }, 202)
            : (++polls === 1 ? json({ error: 'window unavailable' }, status) : json(done)));
        await assert.rejects(app.generate(), /window unavailable/);
        assert.equal(polls, 1);
    });
}

test('stop during task creation cancels after acknowledgement', async () => {
    const abort = new AbortController();
    const app = setup((url) => {
        if (url.endsWith('/cancel')) return json({ ok: true });
        abort.abort();
        return json({ status: 'running' }, 202);
    });
    await assert.rejects(app.generate({}, abort.signal), { name: 'AbortError' });
    assert.equal(app.calls.filter(c => c.url.endsWith('/cancel')).length, 1);
});

test('abort while polling sends cancellation and stops waiting', async () => {
    const abort = new AbortController();
    const app = setup(url => json(url.endsWith('/cancel') ? { ok: true } : { status: 'running' }, 202));
    const result = app.generate({}, abort.signal);
    setTimeout(() => abort.abort(), 1);
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(app.calls.filter(c => c.url.endsWith('/cancel')).length, 1);
});

test('unsupported tool call keeps the native streaming request', async () => {
    const app = setup(() => json({ native: true }));
    assert.equal((await (await app.generate({ tools: [{}], stream: true })).json()).native, true);
    assert.equal(app.calls[0].url, endpoint);
});

test('abort also interrupts an in-flight status fetch', async () => {
    const abort = new AbortController();
    const app = setup((url, options) => {
        if (url.endsWith('/cancel')) return json({ ok: true });
        if (options.method === 'POST') return json({ status: 'running' }, 202);
        if (!options.signal) return json(done);
        return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
            abort.abort();
        });
    });
    await assert.rejects(app.generate({}, abort.signal), { name: 'AbortError' });
    assert.equal(app.calls.filter(call => call.url.endsWith('/cancel')).length, 1);
});

test('streaming completion remains valid SSE and marks the saved reply', async () => {
    const app = setup(() => json(done));
    const response = await app.generate({ stream: true });
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
    assert.match(await response.text(), /"delta":\{"content":"A reply"\}/);
    app.context.chat.push({ is_user: false, mes: 'A reply' });
    app.events.get('message')(1);
    assert.equal(app.context.chat[1].extra.chat_tabs_task, 'task');
});

test('acknowledgement waits for the reply marker when streaming ends before MESSAGE_RECEIVED', async () => {
    const app = setup(url => json(url.endsWith('/ack') ? { ok: true } : done));
    await app.generate({ stream: true });
    app.events.get('end')();
    assert.equal(app.calls.filter(call => call.url.endsWith('/ack')).length, 0);
    app.context.chat.push({ is_user: false, mes: 'A reply' });
    app.events.get('message')(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.context.chat[1].extra.chat_tabs_task, 'task');
    assert.equal(app.calls.filter(call => call.url.endsWith('/ack')).length, 1);
});
