export function claimNotification(id) {
    try {
        const storage = window.localStorage, now = Date.now();
        for (let i = storage.length - 1; i >= 0; i--) {
            const key = storage.key(i);
            if (key?.startsWith('chat-tabs-notified-') && now - Number(storage.getItem(key)) > 86400000) storage.removeItem(key);
        }
        const key = 'chat-tabs-notified-' + id;
        if (now - Number(storage.getItem(key) || 0) < 86400000) return false;
        storage.setItem(key, String(now));
    } catch { /* Storage can be unavailable in private browsing. */ }
    return true;
}
export function notifyNative(settings, name, id) {
    if (!document.hidden || !settings.notifications || window.Notification?.permission !== 'granted' || !claimNotification('native-' + id)) return;
    try {
        const notification = new window.Notification('「' + name + '」出完字了', { tag: 'chat-tabs-' + id });
        notification.onclick = () => { notification.close(); window.focus(); };
    } catch { /* Keep the in-page unread indicator available. */ }
}
export async function requestNotificationPermission(settings) {
    if (!('Notification' in window)) return { enabled: false, reason: 'unsupported' };
    const permission = window.Notification.permission === 'default'
        ? await window.Notification.requestPermission()
        : window.Notification.permission;
    settings.notifications = permission === 'granted';
    return { enabled: settings.notifications, reason: permission };
}

export function createTaskNotifications({ settings, openTask }) {
    let previous = new Map();
    let initialized = false;


    function update(items = []) {
        const current = new Map(items
            .filter(task => task?.id && !task.applied && !task.dismissed)
            .map(task => [task.id, task]));
        if (!initialized) {
            previous = current;
            initialized = true;
            return;
        }
        if (settings.notifications === true && window.Notification?.permission === 'granted') {
            for (const [id, task] of current) {
                const before = previous.get(id);
                if (before?.status === task.status) continue;
                const terminal = ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(task.status);
                const fresh = task.completed && Date.now() - task.completed < 5_000;
                if ((!before || before.status !== 'running') && !fresh) continue;
                if (!terminal || !claimNotification(id)) continue;
                const ready = task.status === 'succeeded';
                const name = task.tabName || task.target?.name || '这段聊天';
                try {
                    const notification = new window.Notification(
                        ready ? '新回复 · ' + name : '任务需要查看 · ' + name,
                        { body: ready ? '点此查看后台回复。' : '请打开多开助手查看任务状态。', tag: 'chat-tabs-' + id },
                    );
                    notification.onclick = () => { notification.close(); openTask(task); };
                } catch { /* Some browsers expose permission but reject page notifications. Keep in-page status working. */ }
            }
        }
        previous = current;
    }

    return { update, reset() { previous = new Map(); initialized = false; } };
}
