import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskNotifications, requestNotificationPermission } from '../frontend/chat-tabs/notifications.js';

function withWindow(value, run) {
    const previous = globalThis.window;
    globalThis.window = value;
    return Promise.resolve().then(run).finally(() => {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    });
}

test('notifies only on a running task transition and opens its story', async () => withWindow({ Notification: class {
    static permission = 'granted';
    static sent = [];
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; this.constructor.sent.push(this); }
    close() { this.closed = true; }
} }, () => {
    const opened = [];
    const manager = createTaskNotifications({ settings: { notifications: true }, openTask: task => opened.push(task.id) });
    const running = { id: 'task-1', status: 'running', target: { name: '角色A' } };
    manager.update([running]);
    assert.equal(window.Notification.sent.length, 0);
    manager.update([running]);
    assert.equal(window.Notification.sent.length, 0);
    manager.update([{ ...running, status: 'succeeded' }]);
    assert.equal(window.Notification.sent.length, 1);
    assert.equal(window.Notification.sent[0].options.tag, 'chat-tabs-task-1');
    window.Notification.sent[0].onclick();
    assert.deepEqual(opened, ['task-1']);
}));

test('does not notify when disabled or permission is not granted', async () => withWindow({ Notification: class {
    static permission = 'denied';
    static sent = [];
    constructor() { this.constructor.sent.push(this); }
} }, () => {
    const manager = createTaskNotifications({ settings: { notifications: false }, openTask() {} });
    manager.update([{ id: 'task-2', status: 'running' }]);
    manager.update([{ id: 'task-2', status: 'failed' }]);
    assert.equal(window.Notification.sent.length, 0);
}));

test('deduplicates one task notification across open pages', async () => withWindow({
    Notification: class {
        static permission = 'granted';
        static sent = [];
        constructor() { this.constructor.sent.push(this); }
    },
    localStorage: {
        values: new Map(),
        getItem(key) { return this.values.get(key) || null; },
        setItem(key, value) { this.values.set(key, value); },
    },
}, () => {
    const settings = { notifications: true };
    const first = createTaskNotifications({ settings, openTask() {} });
    const second = createTaskNotifications({ settings, openTask() {} });
    const running = { id: 'shared-task', status: 'running' };
    first.update([running]); second.update([running]);
    const done = { ...running, status: 'succeeded' };
    first.update([done]); second.update([done]);
    assert.equal(window.Notification.sent.length, 1);
}));

test('requests browser permission only when the user enables notifications', async () => withWindow({ Notification: {
    permission: 'default',
    requestPermission: async () => 'granted',
} }, async () => {
    const settings = { notifications: false };
    assert.deepEqual(await requestNotificationPermission(settings), { enabled: true, reason: 'granted' });
    assert.equal(settings.notifications, true);
}));

test('reports unsupported notification APIs', async () => withWindow({}, async () => {
    assert.deepEqual(await requestNotificationPermission({}), { enabled: false, reason: 'unsupported' });
}));

test('native completion notifies hidden pages and prunes expired notification records', async () => {
    const { notifyNative, claimNotification } = await import('../frontend/chat-tabs/notifications.js');
    const previousDocument = globalThis.document;
    const values = new Map([['chat-tabs-notified-old', String(Date.now()-2*86400000)], ['unrelated','keep']]);
    globalThis.document = {hidden:true};
    try { await withWindow({Notification:class {static permission='granted';static sent=[];constructor(title){this.constructor.sent.push(title);}},localStorage:{get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}},()=>{
        notifyNative({notifications:true},'小满','native-test');notifyNative({notifications:true},'小满','native-test');assert.equal(window.Notification.sent.length,1);assert.equal(values.has('chat-tabs-notified-old'),false);assert.equal(values.get('unrelated'),'keep');
        document.hidden=false;notifyNative({notifications:true},'小满','visible');assert.equal(window.Notification.sent.length,1);
    }); } finally {if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
