export function createSyncPanel({ api, element, labelField, currentTab }) {
    const node = element('details', 'chat-tabs-sync');
    node.append(element('summary', '', '按项同步 · 保留目标窗口的聊天和人设'));
    const source = element('select', 'text_pole');
    const target = element('select', 'text_pole');
    const form = element('form', 'chat-tabs-sync-form');
    const choices = [];
    const labels = {
        appearance: '美化：原生主题、CSS、背景和布局',
        presets: '预设：当前选择、提示词和生成参数',
        api: 'API：供应商、模型、地址和对话密钥',
        characters: '角色卡更新：核对并刷新共用资料',
    };
    const status = element('p', 'chat-tabs-status');
    status.setAttribute('role', 'status');
    const submit = element('button', 'menu_button', '同步所选项目');
    submit.type = 'submit';
    const open = element('a', 'menu_button', '打开目标窗口');
    open.hidden = true; open.target = '_blank'; open.rel = 'noopener';
    let tabs = [], capabilities = null, running = false;
    form.append(labelField('同步来源', source), labelField('同步目标', target));
    const options = element('div', 'chat-tabs-sync-options');
    for (const [key, text] of Object.entries(labels)) {
        const input = element('input');
        input.type = 'checkbox'; input.value = key;
        const label = element('label', 'chat-tabs-toggle');
        label.append(input, element('span', '', text));
        choices.push(input); options.append(label);
        input.addEventListener('change', updateControls);
    }
    form.append(options, submit);
    node.append(element('p', 'chat-tabs-hint', '先结束生成并关闭目标窗口，在另一个页面操作。来源按已保存的设置读取；若来源就是本页，会先保存本页。同步后从下方重新打开目标窗口。'),
        form,
        element('p', 'chat-tabs-hint', '聊天记录、当前角色和 user 人设保留。美化仅同步原生设置，第三方美化插件的私有配置暂不复制。预设文件和角色卡本来就共用，角色卡更新无需另存副本。'),
        element('p', 'chat-tabs-hint', '只勾 API 时保留目标当前预设。同步预设或 API 后，API Hub 的切换预设联动默认关闭，可手动开启。对话密钥在本账号内部复制，页面不会显示密钥。'),
        status, open);
    function updateControls() {
        const enabled = !!capabilities?.selectiveSync;
        source.disabled = target.disabled = running || !enabled;
        choices.forEach(input => { input.disabled = running || !enabled; });
        submit.disabled = running || !enabled || !target.value || source.value === target.value || !choices.some(input => input.checked);
    }
    function populateTargets() {
        const previous = target.value;
        target.replaceChildren();
        for (const tab of tabs) {
            if (tab.archived || tab.id === currentTab || tab.id === source.value) continue;
            target.add(new Option(tab.name || '未命名独立窗口', tab.id));
        }
        if ([...target.options].some(option => option.value === previous)) target.value = previous;
        if (!target.options.length) target.add(new Option('暂无可选目标，请先创建并关闭一个独立窗口', ''));
        updateControls();
    }
    source.addEventListener('change', () => { populateTargets(); open.hidden = true; });
    target.addEventListener('change', () => { updateControls(); open.hidden = true; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        const selection = { source: source.value, target: target.value, categories: choices.filter(input => input.checked).map(input => input.value) };
        running = true; open.hidden = true; updateControls();
        status.textContent = '正在核对目标窗口与已保存设置…';
        try {
            if (selection.source === (currentTab || 'main')) {
                const core = await import('/script.js');
                let saved = false;
                const onSaved = () => { saved = true; };
                core.eventSource.on(core.event_types.SETTINGS_UPDATED, onSaved);
                try { await core.saveSettings(); }
                finally { core.eventSource.removeListener(core.event_types.SETTINGS_UPDATED, onSaved); }
                if (!saved) throw new Error('本页设置尚未保存成功，请等生成与保存结束后重新同步。');
            }
            const plan = await api('/tabs/sync/plan', 'POST', selection);
            const result = await api('/tabs/sync', 'POST', { ...selection, revision: plan.revision });
            const names = result.synced.map(key => ({ appearance: '美化', presets: '预设', api: 'API', characters: '角色卡资料' })[key]);
            status.textContent = '已同步：' + names.join('、') + '。目标聊天和 user 人设已保留。'
                + (result.synced.includes('characters') ? '已核对 ' + result.sharedCards + ' 张共用角色卡。' : '')
                + '重新打开目标窗口后生效。';
            open.href = '/api/plugins/chat-tabs/tab/' + selection.target;
            open.target = 'st-chat-tabs-' + selection.target;
            open.hidden = false;
        } catch (error) { status.textContent = error.message; }
        finally { running = false; updateControls(); }
    });
    return { node, update(windows, available) {
        tabs = windows; capabilities = available;
        const previous = source.value || currentTab || 'main';
        source.replaceChildren(new Option(currentTab ? '酒馆主页面' : '酒馆主页面（本页）', 'main'));
        for (const tab of tabs) if (!tab.archived) source.add(new Option((tab.name || '未命名独立窗口') + (tab.id === currentTab ? '（本页）' : ''), tab.id));
        if ([...source.options].some(option => option.value === previous)) source.value = previous;
        populateTargets();
        if (!capabilities?.selectiveSync) status.textContent = '按项同步需要配套组件 1.3.0 或更新版本，请更新后重启酒馆。';
        else if (status.textContent.startsWith('按项同步需要')) status.textContent = '';
    } };
}
