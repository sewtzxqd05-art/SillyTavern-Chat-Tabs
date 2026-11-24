export const STALE_MS = 16000;
export function elapsedText(state, now = Date.now()) {
    if (!state.started) return '—';
    const end = state.phase === 'running' ? state.stale ? state.seen : now : state.ended || state.seen;
    const seconds = Math.max(0, Math.floor((end - state.started) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
export function windowStates({ tabs, peers, own, currentId, now = Date.now(), overviewSeen = now }) {
    const windows = [{ id: 'main', name: '主窗口' }, ...tabs.filter(tab => !tab.archived || tab.tasks?.length)];
    return windows.map(tab => {
        const peer = tab.id === currentId ? own : peers.get(tab.id);
        let state = peer ? { ...peer, stale: now - peer.seen > STALE_MS } : { phase: 'unknown', started: 0 };
        const tasks = (tab.tasks || []).filter(task => !task.applied && !task.dismissed);
        const task = tasks.find(task => task.status === 'running') || tasks.find(task => task.status === 'succeeded') || tasks[0];
        if (task && (task.status === 'running' || !peer || task.created >= peer.started)) {
            state = { phase: { running: 'running', succeeded: 'ready', cancelled: 'stopped' }[task.status] || 'failed',
                started: task.created, ended: task.completed, seen: overviewSeen, stale: now - overviewSeen > STALE_MS, speed: null, background: true };
        }
        return { ...state, pending: tasks.some(t => t.status === 'succeeded'), open: tab.open ?? (!!peer && !state.stale), tasks, lastOpened: tab.lastOpened, id: tab.id, name: tab.name || '未命名窗口', current: tab.id === currentId };
    });
}
export function stateText(state) {
    if (state.stale) return '状态待更新';
    return { running: state.background ? '后台生成中' : '正在出字', ready: state.background ? '后台回复待处理' : state.unread === false ? '已打开 · 空闲' : '新回复',
        stopped: '已停止', failed: '生成未完成', idle: '已打开 · 空闲', unknown: state.open ? '状态待更新' : '未打开' }[state.phase] || '状态待更新';
}
