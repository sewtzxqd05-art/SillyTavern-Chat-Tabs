import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
const source = fs.readFileSync('frontend/chat-tabs/settings.js', 'utf8');
function fixture(save) {
    const eventSource = new EventEmitter();
    const core = { eventSource, event_types: { SETTINGS_UPDATED: 'saved' }, saveSettings: () => save(eventSource) };
    const box = { loadCore: async () => core };
    vm.runInNewContext(source.replace('export async function', 'async function').replace("await import('/script.js')", 'await loadCore()') + '\nthis.save = saveCurrentSettings;', box);
    return { save: box.save, eventSource };
}
test('confirmed settings save allows creation or synchronization', async () => {
    const app = fixture(async events => events.emit('saved'));
    await app.save(); assert.equal(app.eventSource.listenerCount('saved'), 0);
});
test('native save that silently fails must not copy stale settings', async () => {
    const app = fixture(async () => {});
    await assert.rejects(app.save(), /尚未保存成功/);
    assert.equal(app.eventSource.listenerCount('saved'), 0);
});
test('a thrown save error also removes the temporary listener', async () => {
    const app = fixture(async () => { throw Error('offline'); });
    await assert.rejects(app.save(), /offline/);
    assert.equal(app.eventSource.listenerCount('saved'), 0);
});
