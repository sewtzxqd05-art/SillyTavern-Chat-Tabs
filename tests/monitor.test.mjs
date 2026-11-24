import test from 'node:test';
import assert from 'node:assert/strict';
import { windowStates, elapsedText, stateText, STALE_MS } from '../frontend/chat-tabs/monitor-state.js';
const now = 100000;
const tabs = [{ id: 'a', name: '夜航' }, { id: 'b', name: '旧信' }];
const own = { phase: 'idle', started: 0, seen: now };
const states = (peers, value = tabs, time = now) => windowStates({ tabs: value, own, peers: new Map(peers), currentId: 'a', now: time });
test('other window generation retains its completed duration and speed', () => {
    const peer = { phase: 'ready', started: 60000, ended: 82000, speed: 12.5, seen: now };
    const state = states([['b', peer]]).find(state => state.id === 'b');
    assert.equal(elapsedText(state, now + 9000), '0:22');
    assert.equal(state.speed, 12.5); assert.equal(stateText(state), '新回复');
});
test('paused mobile page is stale rather than completed; its displayed timer freezes', () => {
    const state = states([['b', { phase: 'running', started: 20000, seen: 70000 }]]).find(state => state.id === 'b');
    assert.equal(state.stale, true); assert.equal(stateText(state), '状态待更新');
    assert.equal(elapsedText(state, now + STALE_MS), '0:50');
});
test('new round resets elapsed state and missing peers do not imply completion', () => {
    const state = states([['b', { phase: 'running', started: now - 3000, seen: now, ended: 0 }]]).find(state => state.id === 'b');
    assert.equal(elapsedText(state, now), '0:03');
    assert.equal(stateText(states([]).find(state => state.id === 'b')), '未打开');
});
test('server background status survives closed peers and never invents live speed', () => {
    const task = { status: 'succeeded', created: 50000, completed: 58000 };
    const state = states([], [{ id: 'b', name: '旧信', archived: true, tasks: [task] }]).find(state => state.id === 'b');
    assert.equal(stateText(state), '后台回复待处理');
    assert.equal(elapsedText(state, now), '0:08'); assert.equal(state.speed, null);
});
test('new native round takes precedence over older saved task and excludes unknown windows', () => {
    const state = states([['b', { phase: 'running', started: 90000, seen: now }], ['foreign', own]],
        [{ id: 'b', name: '旧信', tasks: [{ status: 'succeeded', created: 50000, completed: 58000 }] }]);
    assert.equal(state.find(state => state.id === 'b').background, undefined);
    assert.equal(state.some(state => state.id === 'foreign'), false);
});
test('lost server connection marks cached background tasks stale and freezes their timer', () => {
    const state = windowStates({ tabs: [{ id: 'b', tasks: [{ status: 'running', created: 20000 }] }],
        peers: new Map(), own, currentId: 'main', now, overviewSeen: 70000 }).find(state => state.id === 'b');
    assert.equal(stateText(state), '状态待更新'); assert.equal(elapsedText(state, now), '0:50');
});
