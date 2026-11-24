import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePendingTasks } from '../server/chat-tabs/task-overview.mjs';

test('overview keeps only actionable task metadata', () => {
    const result = summarizePendingTasks([
        { id: 'running', status: 'running', created: 1, target: { name: '主线', chat: 'story' }, baseline: 'secret' },
        { id: 'applied', status: 'succeeded', applied: true, target: { name: '已写入' } },
        { id: 'dismissed', status: 'failed', dismissed: true, target: { name: '已忽略' } },
        { id: 'failed', status: 'failed', error: 'x'.repeat(600), target: { chat: 'fallback' } },
    ]);
    assert.deepEqual(result.map(task => task.id), ['running', 'failed']);
    assert.equal(result[0].baseline, undefined);
    assert.equal(result[1].error.length, 500);
    assert.deepEqual(result[1].target, { name: '', chat: 'fallback' });
});
