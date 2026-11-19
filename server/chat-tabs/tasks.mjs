import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { router as completions } from '../../src/endpoints/backends/chat-completions.js';
import { trySaveChat } from '../../src/endpoints/chats.js';

export const TASK_SOURCES = ['custom', 'openai', 'openrouter', 'deepseek', 'xai'];
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const active = new Map();
class TaskSocket extends EventEmitter {
    closed = false;
    on(event, handler) {
        super.on(event, handler);
        if (event === 'close' && this.closed) queueMicrotask(handler);
        return this;
    }
    close() { this.closed = true; this.emit('close'); }
}
const digest = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const messages = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
const textOf = data => {
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
    return typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text || '').join('') : '';
};

// The native adapter gets an independent socket. Only explicit cancellation closes it.
function runNative(user, body, socket) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (status, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ status, value });
        };
        const response = {
            statusCode: 200, headersSent: false, writableEnded: false,
            status(code) { this.statusCode = code; return this; },
            send(value) { this.headersSent = this.writableEnded = true; finish(this.statusCode, value); return this; },
            json(value) { return this.send(value); },
            sendStatus(code) { return this.status(code).send({ error: 'Native endpoint returned ' + code }); },
            end(value) { return this.send(value); },
        };
        const timeout = setTimeout(() => {
            socket.close();
            finish(504, { error: { message: '后台请求超过 30 分钟，已停止等待；不会自动重发。' } });
        }, 30 * 60_000);
        timeout.unref();
        const request = {
            method: 'POST', url: '/generate', originalUrl: '/generate', baseUrl: '',
            body: { ...body, stream: false }, user, socket, headers: {}, query: {},
        };
        try {
            completions(request, response, error => {
                if (error) { clearTimeout(timeout); reject(error); }
                else finish(404, { error: { message: '酒馆原生生成接口未找到。' } });
            });
        } catch (error) { clearTimeout(timeout); reject(error); }
    });
}

export function setupTasks(router, helpers) {
    const { getTabRoot, ensureStorage, readJson, writeJson, claim, chatFile, validAvatar, validFile, readMeta } = helpers;
    const fileFor = (root, id) => path.join(root, 'tasks', id + '.json');
    function load(root, id) {
        if (!ID.test(id || '') || !fs.existsSync(fileFor(root, id))) return null;
        const task = readJson(fileFor(root, id));
        if (task.status === 'running' && active.get(root)?.task.id !== id) {
            task.status = 'interrupted';
            task.completed = Date.now();
            task.error = '酒馆后台曾重启或被终止，此请求未完成；不会自动重发。';
            writeJson(fileFor(root, id), task);
        }
        return task;
    }
    function list(root) {
        const directory = path.join(root, 'tasks');
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory).flatMap(file => {
            try { const task = load(root, file.replace(/\.json$/, '')); return task ? [task] : []; }
            catch { return []; }
        }).sort((a, b) => b.created - a.created);
    }
    function summary(task) {
        const { result, baseline, ...safe } = task;
        return safe;
    }
    function context(req, res) {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) { res.sendStatus(404); return null; }
        if (!claim(root, req, res, true)) return null;
        return { root, dirs: ensureStorage(req.user, root) };
    }
    async function execute(root, user, job, body) {
        const task = job.task;
        try {
            const { status, value } = await runNative(user, body, job.socket);
            const result = typeof value === 'string' ? JSON.parse(value) : value;
            if (job.cancelled) task.status = 'cancelled';
            else if (status >= 400 || result?.error || !textOf(result) || result?.choices?.[0]?.message?.tool_calls?.length) {
                task.status = 'failed';
                task.error = typeof result?.error?.message === 'string' ? result.error.message : 'API 未返回可恢复的文字回复。';
            } else {
                task.status = 'succeeded';
                task.result = result;
            }
        } catch {
            task.status = job.cancelled ? 'cancelled' : 'failed';
            task.error = '后台生成未完成，请检查酒馆终端日志。不会自动重发。';
        } finally {
            task.completed = Date.now();
            try { writeJson(fileFor(root, task.id), task); }
            catch (error) { console.error('[Chat Tabs] Failed to persist task result:', error.code || error.name); }
            if (active.get(root) === job) active.delete(root);
            job.socket.removeAllListeners();
        }
    }

    router.get('/tab/:id/tasks', (req, res) => {
        const ctx = context(req, res);
        if (ctx) res.json(list(ctx.root).map(summary));
    });
    router.get('/tab/:id/tasks/:task', (req, res) => {
        const ctx = context(req, res);
        if (!ctx) return;
        const task = load(ctx.root, req.params.task);
        if (!task) return res.sendStatus(404);
        const { baseline, ...safe } = task;
        res.json(safe);
    });
    router.post('/tab/:id/tasks', async (req, res) => {
        const ctx = context(req, res);
        if (!ctx) return;
        const { root, dirs } = ctx;
        const { id, target, chat, generation } = req.body || {};
        if (!ID.test(id || '') || !validAvatar(target?.avatar) || !validFile(target?.chat)
            || !Array.isArray(chat) || chat.length < 2 || !chat[0]?.chat_metadata
            || !chat.slice(1).every(message => message && typeof message.mes === 'string')
            || !Array.isArray(generation?.messages) || !TASK_SOURCES.includes(generation.chat_completion_source)
            || (generation.n !== undefined && generation.n !== 1) || generation.tools?.length
            || String(generation.custom_include_body || '').trim()) {
            return res.status(400).json({ error: '后台托管目前支持普通单角色文字对话、单个候选回复，不支持工具调用和自定义请求体。' });
        }
        if (!fs.existsSync(path.join(dirs.characters, target.avatar)) || readMeta(root).characterChats?.[target.avatar] !== target.chat) return res.sendStatus(400);
        const existing = load(root, id);
        if (existing) return res.json(summary(existing)); // Retrying an ID never starts a second paid request.
        if (active.has(root)) return res.status(409).json({ error: '这个窗口已有后台任务进行中，请先等待或停止任务。' });
        if (list(root).some(task => task.status === 'succeeded' && !task.applied && !task.dismissed && task.target.avatar === target.avatar && task.target.chat === target.chat)) {
            return res.status(409).json({ error: '这段聊天有一条待恢复回复。请先在多开面板中恢复或忽略。' });
        }
        const task = { id, created: Date.now(), status: 'running', target: { avatar: target.avatar, chat: target.chat, name: String(target.name || '').slice(0, 120) }, source: generation.chat_completion_source, model: String(generation.model || ''), applied: false, dismissed: false };
        const job = { task, socket: new TaskSocket(), cancelled: false };
        active.set(root, job);
        try {
            const file = chatFile(dirs, target.avatar, target.chat);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            await trySaveChat(chat, file, false, req.user.profile.handle + '--chat-tabs-' + req.params.id, target.avatar.replace('.png', ''), dirs.backups);
            task.baseline = digest(file);
            fs.mkdirSync(path.join(root, 'tasks'), { recursive: true, mode: 0o700 });
            writeJson(fileFor(root, id), task);
            const user = { ...req.user, directories: { ...dirs }, profile: { ...req.user.profile } };
            res.status(202).json(summary(task));
            void execute(root, user, job, generation);
        } catch {
            active.delete(root);
            res.status(409).json({ error: '聊天快照或任务未能保存，生成没有启动。请刷新后检查聊天记录。' });
        }
    });
    router.post('/tab/:id/tasks/:task/:action', async (req, res) => {
        const ctx = context(req, res);
        if (!ctx) return;
        const { root, dirs } = ctx;
        const task = load(root, req.params.task);
        if (!task) return res.sendStatus(404);
        const action = req.params.action;
        if (action === 'cancel') {
            const job = active.get(root);
            if (job?.task.id === task.id) { job.cancelled = true; job.socket.close(); }
            return res.json({ ok: true });
        }
        if (action === 'dismiss') {
            if (task.status === 'running') return res.status(409).json({ error: '请先停止后台任务。' });
            task.dismissed = true;
        } else if (action === 'apply' || action === 'ack') {
            if (action === 'apply' && active.has(root)) return res.status(409).json({ error: '请先等待或停止这个窗口的后台任务。' });
            if (task.status !== 'succeeded') return res.status(409).json({ error: '任务尚未成功完成。' });
            const file = chatFile(dirs, task.target.avatar, task.target.chat);
            const data = messages(file);
            if (!data.some(message => message.extra?.chat_tabs_task === task.id)) {
                if (action === 'ack') return res.status(409).json({ error: '回复尚未保存，暂存结果继续保留。' });
                if (digest(file) !== task.baseline) return res.status(409).json({ error: '这段聊天已经修改，未自动写入。请查看暂存回复后手动复制，避免覆盖新剧情。' });
                data.push({ name: task.target.name, is_user: false, is_system: false, mes: textOf(task.result), send_date: new Date(task.completed).toISOString(), gen_started: new Date(task.created).toISOString(), gen_finished: new Date(task.completed).toISOString(), extra: { api: 'openai', model: task.model, chat_tabs_task: task.id, reasoning: task.result.choices?.[0]?.message?.reasoning_content || '' } });
                await trySaveChat(data, file, false, req.user.profile.handle + '--chat-tabs-' + req.params.id, task.target.avatar.replace('.png', ''), dirs.backups);
            }
            task.applied = true;
        } else return res.sendStatus(404);
        writeJson(fileFor(root, task.id), task);
        res.json(summary(task));
    });
    return {
        busy: root => active.has(root),
        blocksWrite(root, route, body) {
            const job = active.get(root);
            if (!job || !route.startsWith('/api/chats/')) return false;
            if (['/api/chats/get', '/api/chats/search', '/api/chats/export'].includes(route)) return false;
            if (route === '/api/chats/save' && body?.avatar_url === job.task.target.avatar && body?.file_name === job.task.target.chat) {
                const serialized = body.chat?.map(message => JSON.stringify(message)).join('\n');
                if (serialized && createHash('sha256').update(serialized).digest('hex') === job.task.baseline) return false;
            }
            return true;
        },
    };
}
