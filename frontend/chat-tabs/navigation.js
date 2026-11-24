import { pageId } from './api.js';
import { api, BASE } from './api.js';
import { saveCurrentSettings } from './settings.js';
export function createNavigation({ currentId, onFocus, onError, isGenerating, isBackgroundRunning = () => false }) {
    window.name = 'st-chat-tabs-' + currentId;
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('st-chat-tabs-focus') : null, waiters = new Map();
    const url = id => id === 'main' ? '/' : BASE + '/tab/' + id;
    async function closeSelf(force) {
        const core = await import('/script.js');
        const background = isBackgroundRunning();
        if (isGenerating() && !background) {
            if (!force) throw new Error('正在出字，出完后再关闭。');
            core.stopGeneration();
            for (let i = 0; core.isGenerating() && i < 100; i++) await new Promise(r => setTimeout(r, 100));
            if (core.isGenerating()) throw new Error('生成尚未停止，请稍后关闭。');
        }
        await saveCurrentSettings();
        const context = SillyTavern.getContext();
        if (!background && context.chatId && context.chat.length) {
            // Native save swallows errors. Observe the actual response rather than
            // treating a fulfilled save promise as successful persistence.
            const original = window.fetch; let saved = false, failed = false;
            window.fetch = async function(input, options) {
                const response = await original.call(this, input, options);
                const pathname = new URL(input instanceof Request ? input.url : input, location.href).pathname;
                if (/\/api\/chats\/(?:group\/)?save$/.test(pathname)) { saved ||= response.ok; failed ||= !response.ok; }
                return response;
            };
            try { await core.saveChatConditional(); } finally { window.fetch = original; }
            if (!saved || failed) throw new Error('聊天未确认保存成功，页面已保留。');
        }
        if (currentId !== 'main') await api('/tab/' + currentId + '/lease/release', 'POST', {});
        return () => { window.close(); location.replace(BASE + '/closed?id=' + encodeURIComponent(currentId)); };
    }
    channel?.addEventListener('message', async ({ data }) => {
        if (!data) return;
        if (data.type === 'reply') { waiters.get(data.requestId)?.(data); return; }
        if (data.tabId !== currentId) return;
        if (data.type === 'focus-story') { window.focus(); onFocus(data.taskId); channel.postMessage({ type: 'reply', requestId: data.requestId, ok: true }); }
        if (data.type === 'close-request') {
            try { const finish = await closeSelf(data.force); channel.postMessage({ type: 'reply', requestId: data.requestId, ok: true }); setTimeout(finish, 50); }
            catch (error) { channel.postMessage({ type: 'reply', requestId: data.requestId, error: error.message }); }
        }
    });
    async function request(type, id, extra = {}, timeout = 1800) {
        if (!channel) throw new Error('此浏览器不支持跨页面操作，请手动切换或关闭标签页。');
        const requestId = pageId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { waiters.delete(requestId); reject(new Error('页面没有响应，请在浏览器中手动操作。')); }, timeout);
            waiters.set(requestId, data => { clearTimeout(timer); waiters.delete(requestId); data.error ? reject(new Error(data.error)) : resolve(data); });
            channel.postMessage({ type, tabId: id, requestId, ...extra });
        });
    }
    return { url,
        open(id, taskId = '', alreadyOpen = false) {
            if (id === currentId) { onFocus(taskId); return; }
            if (alreadyOpen) { void request('focus-story', id, { taskId }).then(() => { if (!document.hidden) onError('已通知对应窗口；浏览器未自动切换时，请点它的标签页。'); }).catch(e => onError(e.message)); return; }
            const page = window.open(url(id) + (taskId ? '?task=' + encodeURIComponent(taskId) : ''), 'st-chat-tabs-' + id); if (page) page.focus(); else location.assign(url(id));
        },
        async close(id, force = false) {
            if (id === currentId) { const finish = await closeSelf(force); if (currentId !== 'main') { location.assign('/'); } else finish(); }
            else await request('close-request', id, { force }, 20000);
        },
        async copy(id) { await navigator.clipboard.writeText(location.origin + url(id)); },
    };
}
