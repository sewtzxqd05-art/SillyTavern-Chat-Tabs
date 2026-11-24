import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { sync as writeAtomic } from 'write-file-atomic';
import * as nativeConstants from '../../src/constants.js';
const { SETTINGS_FILE } = nativeConstants;
import * as nativeSecrets from '../../src/endpoints/secrets.js';
const { SECRETS_FILE } = nativeSecrets;
import * as nativeCards from '../../src/character-card-parser.js';
const readCard = nativeCards.read;
import * as nativeStartup from '../../src/server-startup.js';
const { setupPrivateEndpoints } = nativeStartup;
import * as nativeUtil from '../../src/util.js';
const getConfigValue = nativeUtil.getConfigValue;
import { removeWindowDirectory } from './remove-window.mjs';
import { VERSION } from './version.mjs';
import { extensionPreloads } from './preload.mjs';
import { setupTasks, TASK_SOURCES, taskCompatibility } from './tasks.mjs';
import { recoverSync, setupSync } from './sync.mjs';

export const info = {
    id: 'chat-tabs', name: '酒馆多开',
    description: 'Independent chat histories, settings and API connections in native SillyTavern tabs.',
};
const BASE = '/api/plugins/chat-tabs';
const TAB_DIR = 'chat-tabs';
const META_FILE = 'tab.json';
const TAB_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SCOPED_APIS = [
    'settings', 'secrets', 'chats', 'characters', 'groups',
    'backends', 'openai', 'openrouter', 'anthropic', 'google',
    'horde', 'novelai', 'nanogpt', 'minimax', 'tokenizers', 'azure', 'volcengine',
    'speech', 'sd', 'vector', 'translate', 'search', 'extra',
];
const PRIVATE_DIRS = { chats: 'chats', groupChats: 'group chats', groups: 'groups', backups: 'backups', vectors: 'vectors' };
const APP_SCRIPT = /<script\s+type="module"\s+src="(?:\.\/)?script\.js"><\/script>/;
const LOCALE_SCRIPT = /<script\s+type="module"\s+src="(?:\.\/)?scripts\/i18n\.js"><\/script>/;
const BOOTSTRAP = fileURLToPath(new URL('bootstrap.js', import.meta.url));
const NATIVE_PAGE = fileURLToPath(new URL('../../public/index.html', import.meta.url));
const leases = new Map();
const releasedClients = new Map();
const DELETE_CONFIRMATION = '删除所有窗口';
const cleanupAfter = new Map();
const backupDelay = Number(getConfigValue?.('backups.chat.throttleInterval', 10_000, 'number'));
const cleanupDelay = getConfigValue?.('backups.chat.enabled', true, 'boolean')
    ? Math.max(1000, (Number.isFinite(backupDelay) ? backupDelay : 10_000) + 1000) : 1000;

function isDirectory(file) {
    return fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;
}
function writeJson(file, value) {
    writeAtomic(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readMeta(root) { return readJson(path.join(root, META_FILE)); }
function writeMeta(root, meta) { writeJson(path.join(root, META_FILE), meta); }
function getTabRoot(user, id, includeArchived = false) {
    if (typeof id !== 'string' || !TAB_ID.test(id)) return null;
    const parent = path.resolve(user.directories.root, TAB_DIR);
    const root = path.join(parent, id);
    if (!isDirectory(parent) || !isDirectory(root) || !fs.existsSync(path.join(root, META_FILE))) return null;
    if (path.relative(path.join(fs.realpathSync(user.directories.root), TAB_DIR), fs.realpathSync(parent))
        || path.relative(fs.realpathSync(parent), fs.realpathSync(root)) !== id) return null;
    recoverSync(root);
    return includeArchived || !readMeta(root).archived ? root : null;
}
function deletionRoots(user) {
    const parent = path.resolve(user.directories.root, TAB_DIR);
    if (!fs.existsSync(parent)) return [];
    // Only direct UUID directories inside this account's actual storage may be removed.
    const expected = path.join(fs.realpathSync(user.directories.root), TAB_DIR);
    if (!isDirectory(parent) || path.relative(expected, fs.realpathSync(parent))) {
        throw new Error('Window storage is not a direct account directory.');
    }
    return fs.readdirSync(parent).filter(id => TAB_ID.test(id)).sort().map(id => {
        const root = path.resolve(parent, id);
        if (path.dirname(root) !== parent || !isDirectory(root)
            || path.relative(fs.realpathSync(parent), fs.realpathSync(root)) !== id) {
            throw new Error('Window storage contains an unsafe entry.');
        }
        return { id, root };
    });
}
function tabDetails(root, id) {
    const meta = readMeta(root);
    const settings = readJson(path.join(root, SETTINGS_FILE));
    const lease = leases.get(root);
    return { id, name: meta.name, created: meta.created, lastOpened: meta.lastOpened || meta.created, imported: !!meta.imported,
        open: !!(lease && (lease.active > 0 || (!lease.released && Date.now() - lease.seen < 90_000))),
        preset: settings.oai_settings?.preset_settings_openai || '',
        activeConnection: settings.extension_settings?.apiHub?.connections?.find(c => c.id === settings.extension_settings.apiHub.activeConnectionId)?.name || '',
        pendingPreset: meta.pendingPreset || null, archived: meta.archived || null, avatar: settings.active_character || null };
}
function validFile(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= 240
        && name !== '.' && name !== '..' && !/[\/\\<>:"|?*\x00-\x1f]/.test(name);
}
function validAvatar(name) { return validFile(name) && name.endsWith('.png'); }
function chatFile(dirs, avatar, name) {
    if (!validAvatar(avatar) || !validFile(name)) return null;
    return path.join(dirs.chats, avatar.replace('.png', ''), name + '.jsonl');
}
function privateDirectories(user, root) {
    return { ...user.directories, root, ...Object.fromEntries(
        Object.entries(PRIVATE_DIRS).map(([key, folder]) => [key, path.join(root, folder)]),
    ) };
}
function newChatName() { return '新剧情 - ' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6); }
function copyChat(source, destination) {
    if (!source || !destination || !fs.statSync(source, { throwIfNoEntry: false })?.isFile() || fs.existsSync(destination)) return false;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return true;
}

// Upgrade old 1.0.x windows without moving or removing the shared history.
function ensureStorage(user, root) {
    const dirs = privateDirectories(user, root);
    for (const key of Object.keys(PRIVATE_DIRS)) fs.mkdirSync(dirs[key], { recursive: true });
    const meta = readMeta(root);
    if (meta.schema === 2) return dirs;
    const settings = readJson(path.join(root, SETTINGS_FILE));
    const legacy = !meta.schema;
    meta.characterChats = {};
    if (legacy && validAvatar(settings.active_character)) {
        const avatar = settings.active_character;
        const cardPath = path.join(user.directories.characters, avatar);
        if (fs.existsSync(cardPath)) {
            const card = JSON.parse(readCard(fs.readFileSync(cardPath)));
            const chat = validFile(card.chat) ? card.chat : newChatName();
            copyChat(chatFile(user.directories, avatar, chat), chatFile(dirs, avatar, chat));
            meta.characterChats[avatar] = chat;
        }
    }
    if (isDirectory(user.directories.groups)) {
        for (const file of fs.readdirSync(user.directories.groups)) {
            if (!validFile(file) || !file.endsWith('.json') || fs.existsSync(path.join(dirs.groups, file))) continue;
            const group = readJson(path.join(user.directories.groups, file));
            const retain = legacy && String(group.id) === String(settings.active_group) && validFile(group.chat_id);
            const chat = retain ? group.chat_id : 'ct-' + randomUUID();
            if (retain) copyChat(path.join(user.directories.groupChats, chat + '.jsonl'), path.join(dirs.groupChats, chat + '.jsonl'));
            group.chat_id = chat;
            group.chats = [chat];
            writeJson(path.join(dirs.groups, file), group);
        }
    }
    meta.schema = 2;
    if (legacy) meta.migrated = Date.now();
    writeMeta(root, meta);
    return dirs;
}
function guardSettings(settings) {
    const toolkit = settings?.extension_settings?.baiBaiToolkit;
    if (toolkit && typeof toolkit === 'object') {
        // Backend APIs without a window ID are incompatible. Keep audio and UI features.
        toolkit.saveGenerateEnabled = false;
        toolkit.saveGenerateDefaultEnabledMigrated = true;
        toolkit.fastCharacterListEnabled = false;
        toolkit.fastChatListEnabled = false;
        toolkit.progressiveChatLoadingEnabled = false;
    }
    return settings;
}
function overlayCharacters(root, characters) {
    const meta = readMeta(root);
    let changed = false;
    const results = characters.map(character => {
        if (!validAvatar(character?.avatar)) return character;
        if (!Object.hasOwn(meta.characterChats, character.avatar)) {
            meta.characterChats[character.avatar] = newChatName();
            changed = true;
        }
        const result = { ...character, chat: meta.characterChats[character.avatar] };
        if (typeof result.json_data === 'string') {
            const card = JSON.parse(result.json_data);
            card.chat = result.chat;
            result.json_data = JSON.stringify(card);
        }
        return result;
    });
    if (changed) writeMeta(root, meta);
    return results;
}
function claim(root, req, res, track = false) {
    const client = req.get('X-Chat-Tabs-Client');
    if (!TAB_ID.test(client || '')) { res.status(400).json({ error: '请刷新多开窗口以加载新版隔离保护。' }); return false; }
    const released = releasedClients.get(root);
    if (released) {
        for (const [id, until] of released) if (Date.now() >= until) released.delete(id);
        if (!released.size) releasedClients.delete(root);
        if (released.has(client)) {
            res.status(409).json({ code: 'WINDOW_RELEASED', error: '这个页面已经关闭，请重新打开独立窗口。' });
            return false;
        }
    }
    let lease = leases.get(root);
    if (lease && lease.client !== client && (lease.active > 0 || Date.now() - lease.seen < 90_000)) {
        res.status(409).json({ code: 'WINDOW_IN_USE', error: '这个已保存窗口正在另一页使用。请从魔棒新建独立窗口；若旧页已关闭，稍等后刷新。' });
        return false;
    }
    if (!lease || lease.client !== client) {
        leases.set(root, lease = { client, seen: Date.now(), active: 0 });
        const meta = readMeta(root); meta.lastOpened = Date.now(); delete meta.imported; writeMeta(root, meta);
    }
    lease.seen = Date.now();
    if (track) {
        lease.active++;
        res.once('close', () => {
            lease.active--;
            // Native chat backups can be throttled after the response has already finished.
            if (req.method !== 'GET' && req.method !== 'HEAD') cleanupAfter.set(root, Date.now() + cleanupDelay);
            if (lease.released && !lease.active && leases.get(root) === lease) leases.delete(root);
        });
    }
    return true;
}
function nativePage(user, root) {
    const html = fs.readFileSync(NATIVE_PAGE, 'utf8');
    if (!APP_SCRIPT.test(html) || !LOCALE_SCRIPT.test(html)) throw new Error('Cannot find SillyTavern startup scripts.');
    const preloads = getConfigValue('extensions.enabled', true, 'boolean')
        ? extensionPreloads(path.join(path.dirname(NATIVE_PAGE), 'scripts/extensions'), user.directories.extensions, readJson(path.join(root, SETTINGS_FILE))) : '';
    return html.replace('</head>', preloads + '</head>').replace(LOCALE_SCRIPT, script => '<meta name="st-chat-tabs-apis" content="' + SCOPED_APIS.join(',')
        + '"><script src="' + BASE + '/bootstrap.js"></script>' + script);
}

export function init(router) {
    const requirements = { SETTINGS_FILE: [SETTINGS_FILE, 'string'], SECRETS_FILE: [SECRETS_FILE, 'string'], readCard: [readCard, 'function'], setupPrivateEndpoints: [setupPrivateEndpoints, 'function'], getConfigValue: [getConfigValue, 'function'] };
    const missing = Object.entries(requirements).filter(([, [value, type]]) => typeof value !== type).map(([name]) => name);
    if (missing.length) {
        console.error('[Chat Tabs] 酒馆内部接口不兼容：' + missing.join('、'));
        router.get('/capabilities', (_req, res) => res.json({ version: VERSION, independentWindows: false, backgroundGeneration: false, errors: missing }));
        return;
    }

    const nativeRoutes = express.Router();
    setupPrivateEndpoints(nativeRoutes);
    router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Chat-Tabs-Version': VERSION }); next(); });
    if (taskCompatibility.length) console.error('[Chat Tabs] 后台生成不可用：' + taskCompatibility.join('、'));
    const tasks = setupTasks(router, { getTabRoot, ensureStorage, readJson, writeJson, claim, chatFile, validAvatar, validFile, readMeta, windowBusy: root => windowBusy(root) });
    function windowBusy(root) {
        const lease = leases.get(root);
        return tasks.busy(root) || Date.now() < (cleanupAfter.get(root) || 0)
            || !!(lease && (lease.active > 0 || (!lease.released && Date.now() - lease.seen < 90_000)));
    }
    setupSync(router, { getTabRoot, busy: windowBusy, guardSettings });
    router.get('/capabilities', (_req, res) => res.json({ version: VERSION, independentWindows: true, backgroundGeneration: taskCompatibility.length === 0, compatibilityErrors: taskCompatibility, deleteAllWindows: true, selectiveSync: true, taskOverview: true, windowPresence: true, deleteArchivedWindow: true, taskSources: TASK_SOURCES }));
    router.get('/bootstrap.js', (_req, res) => res.sendFile(BOOTSTRAP));
    function deletionPlan(user) {
        return deletionRoots(user).map(({ id, root }) => {
            return { id, root, busy: windowBusy(root) };
        });
    }
    router.get('/tabs/delete-all', (req, res) => {
        try {
            const windows = deletionPlan(req.user);
            res.json({ ids: windows.map(tab => tab.id), busy: windows.filter(tab => tab.busy).length });
        } catch {
            res.status(409).json({ error: '窗口数据目录异常，未允许清理。请检查目录是否被替换成链接。' });
        }
    });
    router.post('/tabs/delete-all', async (req, res) => {
        const { confirmation, ids } = req.body || {};
        if (confirmation !== DELETE_CONFIRMATION || !Array.isArray(ids)
            || !ids.every(id => typeof id === 'string' && TAB_ID.test(id)) || new Set(ids).size !== ids.length) {
            return res.status(400).json({ error: '请输入“删除所有窗口”确认，并重新核对窗口列表。' });
        }
        // Let already-due native backup timers run before the final synchronous checks.
        await new Promise(resolve => setTimeout(resolve, 0));
        let windows;
        try { windows = deletionPlan(req.user); }
        catch { return res.status(409).json({ error: '窗口数据目录异常，未删除任何窗口。请检查目录是否被替换成链接。' }); }
        if (JSON.stringify([...ids].sort()) !== JSON.stringify(windows.map(tab => tab.id))) {
            return res.status(409).json({ error: '窗口列表已经变化，未删除任何窗口。请重新点击“删除所有窗口”核对数量。' });
        }
        if (windows.some(tab => tab.busy)) {
            return res.status(409).json({ error: '仍有独立窗口打开、保存未结束或后台任务进行中，未删除任何窗口。请先结束生成并关闭独立窗口，再稍等后重试；异常关闭后可能需要等待 90 秒。' });
        }
        let deleted = 0;
        // Validation and deletion are synchronous: no new window/request can slip between them.
        for (const { root } of windows) {
            try {
                removeWindowDirectory(root);
                leases.delete(root);
                releasedClients.delete(root);
                cleanupAfter.delete(root);
                deleted++;
            } catch (error) { console.warn('[Chat Tabs] Failed to delete a window:', error.code || error.name); }
        }
        if (deleted !== windows.length) {
            return res.status(500).json({ error: '已删除 ' + deleted + ' 个窗口，另有 ' + (windows.length - deleted) + ' 个未能删除。请解除文件占用或检查权限后重试。', deleted });
        }
        res.json({ deleted });
    });
    router.get('/tabs', (req, res) => {
        const parent = path.join(req.user.directories.root, TAB_DIR);
        const tabs = (isDirectory(parent) ? fs.readdirSync(parent) : []).flatMap(id => {
            try {
                const root = getTabRoot(req.user, id, req.query.archived === '1');
                return root ? [tabDetails(root, id)] : [];
            } catch (error) { console.warn('[Chat Tabs] Failed to list', id, error.code || error.name); return []; }
        });
        res.json(tabs.sort((a, b) => b.created - a.created));
    });
    router.get('/tabs/overview', (req, res) => {
        const parent = path.join(req.user.directories.root, TAB_DIR);
        const includeArchived = req.query.archived === '1';
        const tabs = (isDirectory(parent) ? fs.readdirSync(parent) : []).flatMap(id => {
            try {
                const root = getTabRoot(req.user, id, includeArchived);
                return root ? [{ ...tabDetails(root, id), tasks: tasks.overview(root) }] : [];
            } catch (error) { console.warn('[Chat Tabs] Failed to summarize', id, error.code || error.name); return []; }
        });
        res.json(tabs.sort((a, b) => b.created - a.created));
    });
    router.post('/tabs', (req, res) => {
        const user = req.user;
        const parent = path.join(user.directories.root, TAB_DIR);
        fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
        if (!isDirectory(parent)) return res.sendStatus(500);
        const source = req.body?.source ? getTabRoot(user, req.body.source) : user.directories.root;
        if (!source) return res.sendStatus(404);
        const settings = guardSettings(readJson(path.join(source, SETTINGS_FILE)));
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return res.sendStatus(500);
        const avatar = req.body?.avatar || null;
        if (avatar && (!validAvatar(avatar) || !fs.existsSync(path.join(user.directories.characters, avatar)))) return res.sendStatus(400);
        if (req.body?.history && !['new', 'branch'].includes(req.body.history)) return res.sendStatus(400);
        settings.active_character = avatar;
        settings.active_group = null;
        settings.firstRun = false;
        settings.power_user = { ...settings.power_user, auto_load_chat: true };
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';
        const id = randomUUID();
        const root = path.join(parent, id);
        fs.mkdirSync(root, { mode: 0o700 });
        try {
            const secrets = path.join(source, SECRETS_FILE);
            if (fs.existsSync(secrets)) fs.copyFileSync(secrets, path.join(root, SECRETS_FILE), fs.constants.COPYFILE_EXCL);
            writeJson(path.join(root, SETTINGS_FILE), settings);
            writeMeta(root, { name, created: Date.now(), schema: 1 });
            const dirs = ensureStorage(user, root);
            if (req.body?.history === 'branch' && avatar) {
                const sourceDirs = req.body.source ? ensureStorage(user, source) : user.directories;
                const card = JSON.parse(readCard(fs.readFileSync(path.join(user.directories.characters, avatar))));
                const sourceChat = req.body.source ? readMeta(source).characterChats[avatar] : card.chat;
                const targetChat = newChatName();
                copyChat(chatFile(sourceDirs, avatar, sourceChat), chatFile(dirs, avatar, targetChat));
                const meta = readMeta(root); meta.characterChats[avatar] = targetChat; writeMeta(root, meta);
            }
            res.status(201).json(tabDetails(root, id));
        } catch (error) {
            // Only this newly created UUID directory can be removed on failed creation.
            if (path.dirname(root) === parent && TAB_ID.test(path.basename(root))) removeWindowDirectory(root);
            throw error;
        }
    });
    router.patch('/tabs/:id', (req, res) => {
        const root = getTabRoot(req.user, req.params.id, true);
        if (!root) return res.sendStatus(404);
        const meta = readMeta(root);
        if (typeof req.body?.name === 'string') meta.name = req.body.name.trim().slice(0, 60);
        if (req.body?.archived === false) meta.archived = null;
        writeMeta(root, meta);
        res.json(tabDetails(root, req.params.id));
    });
    router.get('/tabs/:id/presence', (req, res) => {
        const root = getTabRoot(req.user, req.params.id, true);
        if (!root) return res.sendStatus(404);
        const lease = leases.get(root);
        // Reading presence must not claim or extend a window's write lease.
        res.json({ open: !!(lease && (lease.active > 0 || (!lease.released && Date.now() - lease.seen < 90_000))) });
    });
    router.delete('/tabs/:id', (req, res) => {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) return res.sendStatus(404);
        if (windowBusy(root)) return res.status(409).json({ error: '窗口仍在使用或保存中，请关闭页面并等待保存结束后再归档。' });
        const meta = readMeta(root); meta.archived = Date.now(); writeMeta(root, meta);
        leases.delete(root);
        res.sendStatus(204);
    });
    router.post('/tabs/:id/delete', (req, res) => {
        if (req.body?.confirmation !== 'delete-archived') return res.sendStatus(400);
        let entry;
        try { entry = deletionRoots(req.user).find(item => item.id === req.params.id); }
        catch { return res.status(409).json({ error: '窗口目录异常，未删除。' }); }
        if (!entry) return res.sendStatus(404);
        if (!readMeta(entry.root).archived || windowBusy(entry.root)) return res.status(409).json({ error: '请先关闭并归档窗口，等待保存结束后再删除。' });
        removeWindowDirectory(entry.root);
        leases.delete(entry.root); releasedClients.delete(entry.root); cleanupAfter.delete(entry.root);
        res.sendStatus(204);
    });
    router.post('/tab/:id/preset-applied', (req, res) => {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) return res.sendStatus(404);
        if (!claim(root, req, res, true)) return;
        const meta = readMeta(root);
        if (meta.pendingPreset !== req.body?.preset) return res.sendStatus(409);
        delete meta.pendingPreset; writeMeta(root, meta); res.sendStatus(204);
    });
    router.get('/closed', (_req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>窗口已关闭</title><style>body{font:16px system-ui;max-width:28rem;margin:20vh auto;padding:24px}a{display:inline-block;margin-top:20px}</style><h2>窗口已关闭</h2><p>内容都已保存。</p><a id="open" href="/">重新打开</a><script>const id=new URLSearchParams(location.search).get("id");if(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))document.getElementById("open").href="/api/plugins/chat-tabs/tab/"+id;</script>'));
    router.get('/tab/:id', (req, res) => {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) return res.status(404).type('text').send('这个窗口不存在、已删除或已归档。已归档窗口可从主窗口的魔棒 → 多开助手 → 已归档窗口恢复；永久删除的窗口无法恢复。');
        res.type('html').send(nativePage(req.user, root));
    });
    router.get('/tab/:id/lease', (req, res) => {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) return res.sendStatus(404);
        if (claim(root, req, res)) res.json({ ok: true });
    });
    router.post('/tab/:id/lease/release', (req, res) => {
        const root = getTabRoot(req.user, req.params.id, true);
        const lease = root && leases.get(root);
        if (lease && lease.client === req.get('X-Chat-Tabs-Client')) {
            // A polling request can arrive after pagehide's keepalive release. Do not let
            // that late request reclaim the lease and block the replacement page for 90s.
            const released = releasedClients.get(root) || new Map();
            for (const [id, until] of released) if (Date.now() >= until) released.delete(id);
            released.set(lease.client, Date.now() + 90_000);
            while (released.size > 64) released.delete(released.keys().next().value);
            releasedClients.set(root, released);
            lease.released = true;
            if (!lease.active) leases.delete(root);
        }
        res.sendStatus(204);
    });
    router.use('/tab/:id/scope', (req, res, next) => {
        const root = getTabRoot(req.user, req.params.id);
        if (!root) return res.status(404).json({ error: '这个多开窗口不存在、已删除或已归档。' });
        const route = req.path.toLowerCase();
        // BaiBaoKu APIs lack a window namespace. 404 explicitly triggers its native fallback.
        if (/^\/api\/plugins\/baibaoku(?:\/|$)/.test(route)) {
            return res.status(404).set('X-Chat-Tabs-Guard', 'native-fallback').json({ error: '多开窗口已阻止柏宝库访问共用后台。音频保活不受影响。' });
        }
        const [, api, section] = route.split('/');
        if (api !== 'api' || !SCOPED_APIS.includes(section)) return res.sendStatus(404);
        if (!claim(root, req, res, true)) return;
        if (tasks.blocksWrite(root, route, req.body)) return res.status(409).json({ error: '后台任务进行中，请先等待或停止任务，再修改聊天。' });
        const dirs = ensureStorage(req.user, root);
        if (req.method === 'POST' && route === '/api/settings/save') {
            if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.sendStatus(400);
            writeJson(path.join(root, SETTINGS_FILE), guardSettings(req.body));
            return res.json({ result: 'ok' });
        }
        if (section === 'settings' && route !== '/api/settings/get') return res.status(409).json({ error: '设置快照请在主窗口使用。' });
        if (route === '/api/characters/edit' && req.get('X-Chat-Tabs-Refresh') === '1'
            && validAvatar(req.body?.avatar_url) && validFile(req.body?.chat)) {
            if (!fs.existsSync(path.join(dirs.characters, req.body.avatar_url))) return res.sendStatus(404);
            const meta = readMeta(root); meta.characterChats[req.body.avatar_url] = req.body.chat; writeMeta(root, meta);
            return res.sendStatus(200);
        }
        if (section === 'characters' && route === '/api/characters/merge-attributes') {
            if (!validAvatar(req.body?.avatar) || !validFile(req.body?.chat)) return res.status(409).json({ error: '角色卡编辑请在主窗口使用。此处仅保存本窗口的聊天选择。' });
            if (Object.keys(req.body).some(key => !['avatar', 'chat'].includes(key))) return res.status(409).json({ error: '角色卡编辑请在主窗口使用。' });
            if (!fs.existsSync(path.join(dirs.characters, req.body.avatar))) return res.sendStatus(404);
            const meta = readMeta(root); meta.characterChats[req.body.avatar] = req.body.chat; writeMeta(root, meta);
            return res.sendStatus(200);
        }
        if (section === 'characters' && !['/api/characters/all', '/api/characters/get', '/api/characters/chats', '/api/characters/export'].includes(route)) {
            return res.status(409).json({ error: '角色卡为共用资料，请在主窗口编辑、导入或删除。聊天记录仍可在本窗口管理。' });
        }
        const send = res.send;
        res.send = function (body) {
            if (res.statusCode === 200 && body && typeof body === 'object') {
                if (route === '/api/characters/all' && Array.isArray(body)) body = overlayCharacters(root, body);
                if (route === '/api/characters/get') body = overlayCharacters(root, [body])[0];
                if (route === '/api/settings/get' && typeof body.settings === 'string') body.settings = JSON.stringify(guardSettings(JSON.parse(body.settings)));
            }
            return send.call(this, body);
        };
        const owner = req.user;
        // Never change cached user directories. Give the native backup throttle a window-specific key.
        req.user = { ...owner, directories: dirs, profile: section === 'chats'
            ? { ...owner.profile, handle: owner.profile.handle + '--chat-tabs-' + req.params.id } : owner.profile };
        nativeRoutes(req, res, error => {
            req.user = owner;
            if (error) return next(error);
            return res.sendStatus(404);
        });
    });
}
