export function createActivityIndicator({ settings, element, getTitle, onUpdate = () => {}, onComplete = () => {} }) {
    const context = SillyTavern.getContext();
    const live = element('span', 'chat-tabs-sr-only'); live.setAttribute('role', 'status'); document.body.append(live);
    let state = { phase: 'idle', started: 0, ended: 0, speed: null }, timer, first = 0, chars = 0, received = false, stopped = false, announced = false, unread = false;
    let tasks = [];
    function update() {
        const pending = tasks.filter(t => !t.applied && !t.dismissed);
        const phase = state.phase === 'running' || pending.some(t => t.status === 'running') ? 'running'
            : unread || pending.some(t => t.status === 'succeeded') ? 'ready' : state.phase === 'failed' ? 'failed' : 'idle';
        const prefix = { running: '● 出字中 · ', ready: '✓ 新回复 · ', failed: '! 生成失败 · ' }[phase] || '';
        document.title = (settings.indicator !== false ? prefix : '') + getTitle();
        live.textContent = settings.indicator !== false ? prefix.replace(' · ', '') : '';
        const end = state.ended || Date.now();
        state.speed = first && end > first && chars ? chars / ((end - first) / 1000) : null;
        onUpdate({ ...state, unread });
        if (state.phase === 'running' && !timer) timer = setInterval(update, 1000);
        if (state.phase !== 'running' && timer) { clearInterval(timer); timer = null; }
    }
    function complete() {
        if (!received || stopped || !state.started || !state.ended) return;
        state.phase = 'ready'; unread = !!document.hidden;
        if (!announced) { announced = true; onComplete({ ...state, id: String(state.started) }); }
    }
    context.eventSource.on(context.eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => {
        if (dryRun) return;
        state = { phase: 'running', started: Date.now(), ended: 0, speed: null }; first = chars = 0; received = stopped = announced = unread = false; update();
    });
    context.eventSource.on(context.eventTypes.STREAM_TOKEN_RECEIVED, text => {
        if (state.phase !== 'running' || typeof text !== 'string' || !text.length) return;
        if (!first) first = Date.now(); chars = Array.from(text).length;
    });
    context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, id => {
        const message = SillyTavern.getContext().chat[id];
        if (state.started && !stopped && message?.mes?.trim() && !message.is_user) { received = true; complete(); update(); }
    });
    context.eventSource.on(context.eventTypes.GENERATION_ENDED, () => {
        if (!state.started || stopped) return;
        state.ended ||= Date.now(); state.phase = 'failed'; complete(); update();
    });
    context.eventSource.on(context.eventTypes.GENERATION_STOPPED, () => { stopped = true; unread = false; state.phase = 'stopped'; state.ended = Date.now(); update(); });
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        stopped = true; unread = false; first = chars = 0; state = { phase: 'idle', started: 0, ended: 0, speed: null }; update();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && unread) { unread = false; update(); } });
    return { update, updateTasks(value) { tasks = value; update(); }, hasRunningTask: () => tasks.some(t => t.status === 'running'), isGenerating: () => state.phase === 'running' };
}
