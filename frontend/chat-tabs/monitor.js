import { pageId } from './api.js';
import { windowStates, elapsedText, stateText } from './monitor-state.js';
export function createWindowMonitor({ settings, element, currentId, getName, switchWindow, onOpen, onChange = () => {}, onComplete = () => {}, openAll = () => {} }) {
    const peers = new Map(); let tabs = [], overviewSeen = 0, own = { phase: 'idle', started: 0, ended: 0, seen: Date.now() }, dialogOpen = false;
    const instance = pageId(), channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('st-chat-tabs-monitor-v1') : null;
    const floating = element('button', 'chat-tabs-monitor-float'); floating.type = 'button'; floating.setAttribute('aria-label', '展开窗口状态');
    const panel = element('dialog', 'chat-tabs-dialog chat-tabs-monitor-popup'); panel.setAttribute('aria-label', '窗口状态');
    const list = element('div'); const all = element('button', 'menu_button', '全部窗口'); all.type = 'button';
    all.onclick = () => { panel.close(); openAll(); };
    const close = element('button', 'menu_button', '关闭'); close.onclick = () => panel.close(); panel.append(list, all, close);
    document.body.append(floating, panel);
    function publish() {
        own = { ...own, name: getName(), seen: Date.now(), soundHandled: !!SillyTavern.getContext().extensionSettings?.baiBaiToolkit?.messageCompletionSoundEnabled };
        channel?.postMessage({ type: 'state', id: currentId, instance, state: own });
    }
    function states() { return windowStates({ tabs, peers, own, currentId, overviewSeen }); }
    function render() {
        const values = states(), local = values.find(x => x.current) || own;
        const active = values.filter(x => !x.stale && (x.pending || x.phase === 'running' || x.phase === 'ready' && (x.unread !== false || x.background)));
        const ownPending = local.pending ? '后台回复待处理' : '';
        const recent = local.phase === 'ready' && Date.now() - local.ended < 8000;
        floating.hidden = dialogOpen || settings.monitorFloat === false || !(active.length || recent);
        floating.dataset.position = settings.monitorPosition || 'br';
        const others = active.filter(x => !x.current), ready = others.filter(x => x.pending || x.phase === 'ready').length, running = others.filter(x => x.phase === 'running').length;
        floating.textContent = [local.phase === 'running' ? '本轮 ' + elapsedText(local) + (local.speed ? ' · ' + local.speed.toFixed(0) + ' 字/s' : '') : recent ? '本轮已出完 · ' + elapsedText(local) : ownPending, ready ? ready + ' 新回复' : '', running ? running + ' 出字中' : ''].filter(Boolean).join(' · ');
        if (panel.open) {
            const wanted = new Set(active.map(x => x.id));
            for (const node of [...list.children]) if (!wanted.has(node.dataset.id)) node.remove();
            for (const state of active) {
                let row = [...list.children].find(n => n.dataset.id === state.id);
                if (!row) { row = element('button', 'menu_button chat-tabs-peek-row'); row.dataset.id = state.id; row.onclick = () => { panel.close(); switchWindow(state.id); }; list.append(row); }
                row.textContent = state.name + ' · ' + stateText(state) + (state.phase === 'running' ? ' ' + elapsedText(state) : '');
            }
        }
        onChange(values);
    }
    function request() { channel?.postMessage({ type: 'request' }); publish(); }
    channel?.addEventListener('message', ({ data }) => {
        if (data?.type === 'request') { publish(); return; }
        if (data?.type !== 'state' || data.instance === instance || typeof data.id !== 'string' || !data.state || !['running','ready','stopped','failed','idle'].includes(data.state.phase)) return;
        const previous = peers.get(data.id); peers.set(data.id, { ...data.state, seen: Date.now() });
        if (data.state.phase === 'ready' && previous && previous.phase !== 'ready' && previous.started === data.state.started && Date.now() - data.state.ended < 10000) onComplete(data.id, data.state);
        render();
    });
    floating.onclick = () => { request(); panel.showModal(); render(); onOpen(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) request(); });
    setInterval(() => { publish(); if (!document.hidden) render(); }, 5000);
    setInterval(() => { if (!document.hidden) render(); }, 1000);
    return { states, render, request, setDialogOpen(value) { dialogOpen = value; render(); }, update(state) { own = { ...state, seen: Date.now() }; publish(); render(); }, updateTabs(value) { tabs = value; overviewSeen = Date.now(); render(); } };
}
