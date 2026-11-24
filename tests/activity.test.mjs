import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('frontend/chat-tabs/activity.js', 'utf8');
function fixture(settings = {}, options = {}) {
    const events = new Map(), nodes = [], timers = new Set();
    const context = { chat: [{ is_user: false, mes: 'Reply' }],
        eventTypes: { GENERATION_STARTED: 'start', MESSAGE_RECEIVED: 'message', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', CHAT_CHANGED: 'chat', STREAM_TOKEN_RECEIVED: 'stream' },
        eventSource: { on(name, fn) { events.set(name, fn); } },
    };
    const element = (_tag, className) => {
        const node = { className, textContent: '', hidden: false, dataset: {}, attributes: {}, handlers: {},
            append() {}, setAttribute(key, value) { this.attributes[key] = value; },
            addEventListener(key, fn) { this.handlers[key] = fn; },
        }; nodes.push(node); return node;
    };
    const document = { hidden: true, title: 'Story', body: { append() {} }, addEventListener(name, fn) { events.set(name, fn); } };
    let current = context;
    let now = Date.now();
    const box = { document, Date: { now: () => now }, SillyTavern: { getContext: () => current },
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
    };
    vm.runInNewContext(source.replace('export function', 'function') + '\nthis.create = createActivityIndicator;', box);
    let opened = 0;
    const activity = box.create({ settings, element, getTitle: () => 'Story', openTasks: () => { opened++; }, ...options });
    return { events, nodes, timers, document, activity, get opened() { return opened; }, button: nodes[0], now: () => now, tick: ms => { now += ms; }, replaceChat(chat) { current = { ...context, chat }; } };
}

test('dry run stays silent; native completion is announced once and read on visibility', () => {
    const completed = []; const app = fixture({}, { onComplete: state => completed.push(state) });
    app.events.get('start')('normal', {}, true); assert.equal(app.document.title, 'Story');
    app.events.get('start')('normal', {}, false); assert.equal(app.document.title, '● 出字中 · Story');
    app.events.get('message')(0); app.events.get('end')(); app.events.get('end')();
    assert.equal(completed.length, 1); assert.equal(app.document.title, '✓ 新回复 · Story');
    app.document.hidden = false; app.events.get('visibilitychange')(); assert.equal(app.document.title, 'Story');
    assert.equal(app.nodes.some(node => node.className === 'chat-tabs-activity'), false);
});
test('failed and cancelled generations never announce completion', () => {
    const completed = []; const app = fixture({}, { onComplete: s => completed.push(s) });
    app.events.get('start')('normal', {}, false); app.events.get('end')(); assert.equal(app.document.title, '! 生成失败 · Story');
    app.events.get('start')('normal', {}, false); app.events.get('stop')(); app.events.get('message')(0); app.events.get('end')();
    assert.equal(completed.length, 0); assert.equal(app.document.title, 'Story');
});
test('end before received message still completes using current native chat', () => {
    const app = fixture(); app.replaceChat([{ is_user: true, mes:'Q' }, { is_user:false, mes:'A' }]);
    app.events.get('start')('normal', {}, false); app.events.get('end')(); app.events.get('message')(1);
    assert.equal(app.document.title, '✓ 新回复 · Story');
});
test('first character starts speed clock; completion freezes metrics and next round resets', () => {
    const snapshots = []; const app = fixture({ indicator:false }, { onUpdate:s => snapshots.push(s) });
    app.events.get('start')('normal', {}, false); app.tick(5000); app.events.get('stream')('你');
    app.tick(1000); app.events.get('stream')('你好🌙'); app.activity.update();
    assert.equal(snapshots.at(-1).speed, 3); assert.equal(app.document.title, 'Story');
    app.events.get('message')(0); app.events.get('end')(); const done = snapshots.at(-1);
    app.tick(10000); app.activity.update(); assert.equal(snapshots.at(-1).speed, done.speed); assert.equal(snapshots.at(-1).ended, done.ended);
    app.events.get('start')('normal', {}, false); assert.equal(snapshots.at(-1).speed,null);
});
test('background replies stay pending after page becomes visible; native state remains independent', () => {
    const snapshots=[]; const app=fixture({}, {onUpdate:s=>snapshots.push(s)});
    app.activity.updateTasks([{status:'succeeded'}]); app.document.hidden=false; app.events.get('visibilitychange')();
    assert.equal(app.document.title,'✓ 新回复 · Story'); assert.equal(snapshots.at(-1).phase,'idle');
    app.activity.updateTasks([{status:'succeeded',applied:true}]); assert.equal(app.document.title,'Story');
});
