import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const host = process.env.REVIEW_URL || 'http://127.0.0.1:18122';
if (!['http://127.0.0.1:18122', 'http://127.0.0.1:18120'].includes(host)) throw new Error('Use the isolated review fixture.');
const base = '/api/plugins/chat-tabs';
const user = path.resolve('work/st-review/data/default-user');
const before = ['settings.json', 'secrets.json'].map(file => fs.readFileSync(path.join(user, file), 'utf8'));
const cookies = new Map(), clients = new Map();
function keep(response) {
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1)); }
}
const csrf = await fetch(host + '/csrf-token'); keep(csrf);
const { token } = await csrf.json();
async function call(route, data, method = data === undefined ? 'GET' : 'POST') {
    const id = route.split('/')[2];
    if (!clients.has(id)) clients.set(id, randomUUID());
    const response = await fetch(host + base + route, { method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Cookie: [...cookies].map(([k,v]) => k + '=' + v).join('; '), 'X-Chat-Tabs-Client': clients.get(id) },
        body: data === undefined ? undefined : JSON.stringify(data),
    });
    keep(response); return response;
}
async function json(route, data, method) {
    const response = await call(route, data, method);
    const value = response.status === 204 ? null : await response.json();
    assert.ok(response.ok, route + ': ' + JSON.stringify(value)); return value;
}
const received = async () => (await (await fetch('http://127.0.0.1:18121/received')).json()).length;
const start = await received();
const avatar = 'default_Seraphina.png';
const a = await json('/tabs', { name: '夜航 · 主线', avatar });
const b = await json('/tabs', { name: '旧信 · 平行剧情', avatar });
const route = tab => '/tab/' + tab.id;
assert.deepEqual(await json('/tabs/' + a.id + '/presence'), { open: false });
assert.deepEqual(await json('/tabs/' + a.id + '/presence'), { open: false });
await json(route(a) + '/lease');
assert.deepEqual(await json('/tabs/' + a.id + '/presence'), { open: true });
await json(route(a) + '/lease/release', {});
clients.set(a.id, randomUUID());
assert.deepEqual(await json('/tabs/' + a.id + '/presence'), { open: false });
const startupPage = await (await call(route(a))).text();
assert.ok(startupPage.indexOf('rel="modulepreload"') < startupPage.indexOf('</head>'));
assert.ok(startupPage.includes('/scripts/extensions/third-party/chat-tabs/index.js'));
console.log('PASS: read-only window presence, release detection and early extension preparation.');
async function payload(tab, model) {
    const card = await json(route(tab) + '/scope/api/characters/get', { avatar_url: avatar });
    const chat = await json(route(tab) + '/scope/api/chats/get', { avatar_url: avatar, file_name: card.chat });
    return { id: randomUUID(), target: { avatar, chat: card.chat, name: card.name },
        chat: [...(chat.length ? chat : [{ chat_metadata: { integrity: randomUUID() }, user_name: 'unused', character_name: 'unused' }]), { is_user: true, name: '旅人', mes: '继续这一段故事。' }],
        generation: { chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:18121/v1', model, messages: [{ role: 'user', content: 'Continue the story.' }], stream: true, max_tokens: 100 },
    };
}
async function complete(tab, id) {
    for (let i = 0; i < 100; i++) {
        const task = await json(route(tab) + '/tasks/' + id);
        if (task.status !== 'running') return task;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Task timed out');
}
const pa = await payload(a, 'review-model-A'), pb = await payload(b, 'review-model-B');
await Promise.all([json(route(a) + '/tasks', pa), json(route(b) + '/tasks', pb)]);
const overview = await json('/tabs/overview?archived=1');
assert.equal(overview.find(tab => tab.id === a.id).tasks.find(task => task.id === pa.id).status, 'running');
assert.equal(overview.find(tab => tab.id === b.id).tasks.find(task => task.id === pb.id).status, 'running');
await json(route(a) + '/tasks', pa);
assert.equal((await call(route(a) + '/tasks', { ...pa, id: randomUUID() })).status, 409);
assert.equal((await call(route(b) + '/tasks/' + pa.id)).status, 404);
assert.equal((await call(route(a) + '/scope/api/chats/save', { avatar_url: avatar, file_name: pa.target.chat, chat: [...pa.chat, { mes: 'unsafe edit' }] })).status, 409);
await json(route(a) + '/lease/release', {}); clients.set(a.id, randomUUID());
const done = await Promise.all([complete(a, pa.id), complete(b, pb.id)]);
assert.deepEqual(done.map(task => task.status), ['succeeded', 'succeeded']);
assert.equal(await received() - start, 2);
console.log('PASS: concurrent detached jobs, one charge per task, isolated results and write protection.');

const file = path.join(user, 'chat-tabs', a.id, 'chats', 'default_Seraphina', pa.target.chat + '.jsonl');
const saved = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, 'invalid chat file');
assert.equal((await call(route(a) + '/tasks/' + pa.id + '/apply', {})).status, 409);
assert.equal((await json(route(a) + '/tasks/' + pa.id)).applied, false);
fs.writeFileSync(file, saved);
await json(route(a) + '/tasks/' + pa.id + '/apply', {});
await json(route(a) + '/tasks/' + pa.id + '/apply', {});
const chat = await json(route(a) + '/scope/api/chats/get', { avatar_url: avatar, file_name: pa.target.chat });
assert.equal(chat.filter(message => message.extra?.chat_tabs_task === pa.id).length, 1);
assert.ok(!chat.at(-1).mes.includes('model-B'));
console.log('PASS: corrupted chat recovery reports an error, keeps the reply, and retry applies exactly once.');

const cancelled = await payload(a, 'cancel-model');
await json(route(a) + '/tasks', cancelled);
await json(route(a) + '/tasks/' + cancelled.id + '/cancel', {});
assert.equal((await complete(a, cancelled.id)).status, 'cancelled');
await json(route(a) + '/tasks/' + cancelled.id + '/dismiss', {});
console.log('PASS: explicit cancellation reaches the native adapter.');

const scope = tab => route(tab) + '/scope/api/settings/';
const source = JSON.parse((await json(scope(a) + 'get', {})).settings);
const target = JSON.parse((await json(scope(b) + 'get', {})).settings);
source.power_user.custom_css = '/* review appearance */'; source.power_user.persona_description = 'source persona';
target.power_user.persona_description = 'TARGET_PERSONA_KEEP'; target.username = '目标旅人';
await json(scope(a) + 'save', source); await json(scope(b) + 'save', target);
await json(route(b) + '/lease/release', {});
const selection = { source: a.id, target: b.id, categories: ['appearance'] };
let plan;
for (let i = 0; i < 150; i++) {
    const response = await call('/tabs/sync/plan', selection);
    if (response.ok) { plan = await response.json(); break; }
    await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(plan, 'target must become idle after backups finish');
source.power_user.custom_css = '/* revised appearance */'; await json(scope(a) + 'save', source);
assert.equal((await call('/tabs/sync', { ...selection, revision: plan.revision })).status, 409);
plan = await json('/tabs/sync/plan', selection);
await json('/tabs/sync', { ...selection, revision: plan.revision });
clients.set(b.id, randomUUID());
const synced = JSON.parse((await json(scope(b) + 'get', {})).settings);
assert.equal(synced.power_user.custom_css, source.power_user.custom_css);
assert.equal(synced.power_user.persona_description, 'TARGET_PERSONA_KEEP');
assert.equal(synced.username, '目标旅人');
assert.equal(synced.oai_settings.custom_model, target.oai_settings.custom_model);
assert.deepEqual(['settings.json', 'secrets.json'].map(name => fs.readFileSync(path.join(user, name), 'utf8')), before);
console.log('PASS: stale sync rejected; appearance sync preserves target persona, API and main data.');
await json(route(a) + '/lease/release', {}); await json(route(b) + '/lease/release', {});
fs.writeFileSync('work/review-state.json', JSON.stringify({ host, a, b, pending: pb.id, story: pb.target.chat }, null, 2));
