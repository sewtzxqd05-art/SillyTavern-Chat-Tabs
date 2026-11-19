const SOURCES = ['custom', 'openai', 'openrouter', 'deepseek', 'xai'];
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

export function createTaskController(tabId, settings, notify) {
    const original = window.fetch.bind(window);
    let generationType = '', active = null, delivered = null;
    const context = () => SillyTavern.getContext();
    async function request(path, method = 'GET', data) {
        const response = await original('/api/plugins/chat-tabs/tab/' + tabId + '/tasks' + path, {
            method, headers: { ...context().getRequestHeaders(), 'X-Chat-Tabs-Client': window.STChatTabs.clientId },
            body: data === undefined ? undefined : JSON.stringify(data),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            throw new Error(detail?.error || '后台任务访问失败（' + response.status + '）');
        }
        return response.json();
    }
    context().eventSource.on(context().eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun) return;
        generationType = type || 'normal';
        if (settings.background && context().mainApi !== 'openai') window.toastr.info('本次使用普通前台生成：后台托管目前支持 Chat Completion 接口。', '本次未启用后台保护');
    });
    context().eventSource.on(context().eventTypes.MESSAGE_RECEIVED, messageId => {
        if (!delivered) return;
        const c = context(), message = c.chat[messageId];
        if (c.chatId === delivered.target.chat && c.characters[c.characterId]?.avatar === delivered.target.avatar && message && !message.is_user) {
            message.extra ||= {};
            message.extra.chat_tabs_task = delivered.id;
        }
    });
    context().eventSource.on(context().eventTypes.GENERATION_ENDED, () => {
        generationType = '';
        if (!delivered) return;
        const task = delivered;
        delivered = null;
        void (async () => { await context().saveChat(); await request('/' + task.id + '/ack', 'POST', {}); notify(); })().catch(() => notify());
    });
    context().eventSource.on(context().eventTypes.GENERATION_STOPPED, () => {
        if (active) void request('/' + active.id + '/cancel', 'POST', {}).catch(error => window.toastr.warning(error.message));
    });
    window.fetch = async function (input, options) {
        const url = new URL(input instanceof Request ? input.url : input, document.baseURI);
        if (url.origin !== location.origin || !url.pathname.endsWith('/api/backends/chat-completions/generate') || !settings.background) return original(input, options);
        const c = context();
        let generation;
        try { generation = JSON.parse(options?.body); } catch { return original(input, options); }
        if (generationType !== 'normal' || c.groupId || !c.characters[c.characterId]?.avatar || !SOURCES.includes(generation.chat_completion_source)
            || generation.tools?.length || (generation.n !== undefined && generation.n !== 1) || String(generation.custom_include_body || '').trim()) {
            window.toastr.info('本次使用普通前台生成：后台托管暂不支持该对话类型、API、工具调用或自定义请求体。', '本次未启用后台保护');
            return original(input, options);
        }
        const id = crypto.randomUUID();
        const payload = {
            id, generation,
            target: { avatar: c.characters[c.characterId].avatar, chat: c.chatId, name: c.name2 },
            chat: JSON.parse(JSON.stringify([{ chat_metadata: c.chatMetadata, user_name: 'unused', character_name: 'unused' }, ...c.chat])),
        };
        active = { id };
        let task;
        try {
            // A lost acknowledgement is not followed by an ordinary API request: that could bill twice.
            try { task = await request('', 'POST', payload); }
            catch (error) { window.toastr.warning('未确认任务是否创建，请在多开面板检查任务列表后再重试。' + error.message); throw error; }
            notify();
            while (task.status === 'running') {
                if (options?.signal?.aborted) throw new DOMException('Generation stopped', 'AbortError');
                await sleep(1200);
                try { task = await request('/' + id); }
                catch { await sleep(1800); } // Reconnect to the existing task; never submit the prompt again.
            }
            if (task.status !== 'succeeded') throw new Error(task.error || (task.status === 'cancelled' ? '后台任务已停止。' : '后台任务未完成。'));
            if (options?.signal?.aborted) throw new DOMException('Generation stopped', 'AbortError');
            delivered = task;
            const data = task.result;
            if (!generation.stream) return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            // The native UI expects SSE when streaming is selected. Return the completed text as one event.
            const result = { ...data, choices: data.choices.map(choice => {
                const content = choice.message?.content ?? choice.text ?? '';
                return { ...choice, delta: { ...choice.message, content: Array.isArray(content) ? content.map(part => part.text || '').join('') : content } };
            }) };
            return new Response('data: ' + JSON.stringify(result) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
        } finally { active = null; notify(); }
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) notify(); });
    return {
        list: () => request(''),
        get: id => request('/' + id),
        async action(task, action) {
            const result = await request('/' + task.id + '/' + action, 'POST', {});
            if (action === 'apply') {
                const c = context();
                if (c.chatId === task.target.chat && c.characters[c.characterId]?.avatar === task.target.avatar) await c.reloadCurrentChat();
            }
            notify();
            return result;
        },
    };
}
