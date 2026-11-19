import { createKeepaliveController } from './keepalive.js';
import { createTaskController } from './tasks.js';
import { createSyncPanel } from './sync.js';

const BASE = '/api/plugins/chat-tabs';
const currentTab = /^\/api\/plugins\/chat-tabs\/tab\/([a-f0-9-]+)\/?$/.exec(location.pathname)?.[1];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

async function api(path, method = 'GET', data) {
    const response = await fetch(BASE + path, {
        method,
        headers: SillyTavern.getContext().getRequestHeaders(),
        body: data ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error || (response.status === 404 ? '多开服务未加载，或这个窗口已删除 / 归档。' : '操作失败，请刷新后重试。'));
    }
    return response.status === 204 ? null : response.json();
}

function labelField(text, field) {
    const label = element('label', 'chat-tabs-field');
    label.append(element('span', '', text), field);
    return label;
}

function mount() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('chat-tabs-wand-menu')) return;
    let currentTabName = '';
    let updateWindowTitle = () => {};
    const settings = SillyTavern.getContext().extensionSettings.chatTabs ||= {};
    let capabilities = null;

    const entry = element('div', 'list-group-item flex-container flexGap5 interactable');
    entry.id = 'chat-tabs-wand-menu';
    entry.setAttribute('role', 'button');
    entry.tabIndex = 0;
    entry.title = '同时聊多个角色，分别设置人设、预设和 API';
    entry.append(element('div', 'fa-regular fa-window-restore extensionsMenuExtensionButton'), element('span', '', '多开聊天'));
    entry.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            entry.click();
        }
    });
    menu.prepend(entry);

    const dialog = element('dialog', 'chat-tabs-dialog');
    dialog.id = 'chat-tabs-dialog';
    dialog.setAttribute('aria-labelledby', 'chat-tabs-heading');
    const header = element('div', 'chat-tabs-header');
    const title = element('h3', '', '多开聊天');
    title.id = 'chat-tabs-heading';
    const close = element('button', 'menu_button chat-tabs-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const navigation = element('div', 'chat-tabs-navigation');
    navigation.setAttribute('role', 'tablist');
    navigation.setAttribute('aria-label', '功能分类');
    const frontendPage = element('section', 'chat-tabs-page');
    const backendPage = element('section', 'chat-tabs-page');
    const pageButtons = [];
    function selectPage(index) {
        [frontendPage, backendPage].forEach((page, i) => {
            page.hidden = index !== i;
            pageButtons[i].classList.toggle('chat-tabs-page-active', index === i);
            pageButtons[i].setAttribute('aria-selected', String(index === i));
            pageButtons[i].tabIndex = index === i ? 0 : -1;
        });
    }
    for (const [i, text] of ['1 · 网页扩展功能', '2 · 多开与配套组件'].entries()) {
        const button = element('button', 'menu_button', text);
        button.type = 'button';
        button.id = 'chat-tabs-page-button-' + i;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', 'chat-tabs-page-' + i);
        button.addEventListener('click', () => selectPage(i));
        button.addEventListener('keydown', event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - i;
                selectPage(next); pageButtons[next].focus();
            }
        });
        pageButtons.push(button); navigation.append(button);
        const page = [frontendPage, backendPage][i];
        page.id = 'chat-tabs-page-' + i;
        page.setAttribute('role', 'tabpanel');
        page.setAttribute('aria-labelledby', button.id);
    }
    selectPage(0);

    frontendPage.append(element('h4', '', '页面保活 · 无需额外安装'), element('p', 'chat-tabs-hint', '只装网页扩展就能使用。每个页面分别设置；保活不能保证手机系统不回收浏览器或 Termux。'));
    const audio = element('input');
    audio.type = 'checkbox'; audio.checked = settings.audio === true;
    const audioLabel = element('label', 'chat-tabs-toggle');
    audioLabel.append(audio, element('span', '', '本插件静音音频（生成期间）'));
    const audioStatus = element('p', 'chat-tabs-hint');
    audioStatus.setAttribute('role', 'status');
    const authorizeAudio = element('button', 'menu_button', '授权 / 重试音频');
    authorizeAudio.type = 'button';
    const screen = element('input');
    screen.type = 'checkbox'; screen.checked = settings.screen === true;
    const screenLabel = element('label', 'chat-tabs-toggle');
    screenLabel.append(screen, element('span', '', '生成时保持屏幕常亮'));
    const screenStatus = element('p', 'chat-tabs-hint');
    screenStatus.setAttribute('role', 'status');
    const keepaliveStatus = element('p', 'chat-tabs-hint');
    const protection = createKeepaliveController(settings, () => SillyTavern.getContext().saveSettingsDebounced(), state => {
        audioStatus.textContent = '音频状态：' + state.audioText;
        screenStatus.textContent = '常亮状态：' + state.wakeText;
        authorizeAudio.disabled = !state.audioEnabled;
    });
    function updateProtection() {
        const state = protection.state();
        audioStatus.textContent = '音频状态：' + state.audioText;
        screenStatus.textContent = '常亮状态：' + state.wakeText;
        authorizeAudio.disabled = !state.audioEnabled;
    }
    audio.addEventListener('change', () => { void protection.enableAudio(audio.checked); });
    authorizeAudio.addEventListener('click', () => { void protection.enableAudio(true); });
    screen.addEventListener('change', () => { void protection.enableScreen(screen.checked); });
    frontendPage.append(audioLabel, audioStatus, authorizeAudio, keepaliveStatus, screenLabel, screenStatus,
        element('p', 'chat-tabs-hint', '常亮仅对当前可见页面生效，切换标签或 App 后会释放。音频与常亮默认关闭，已有柏宝箱等保活时可只使用其中一份。'),
        element('p', 'chat-tabs-hint', '独立多开需要额外安装配套组件。安卓需在 Termux 执行安装脚本，Windows 运行安装器；第二页提供说明。'));
    updateProtection();

    const backendStatus = element('p', 'chat-tabs-backend-status', '正在检查配套组件…');
    backendStatus.setAttribute('role', 'status');
    const retryBackend = element('button', 'menu_button', '重新检查配套组件');
    retryBackend.type = 'button';
    backendPage.append(backendStatus, retryBackend);

    const guide = element('section', 'chat-tabs-guide');
    guide.setAttribute('aria-label', '多开使用步骤');
    guide.append(element('h4', '', '第一次双开，照这三步'));
    const steps = element('ol', 'chat-tabs-steps');
    for (const step of [
        '选角色：同一角色也能开不同剧情，窗口名称可以不填。',
        '开窗口：点击「新开聊天窗口」，浏览器会打开一个新的标签页，当前聊天继续保留。',
        '独立设置：新页顶部的笑脸切 user 人设，最左侧滑杆选预设，插头切 API，然后开始聊天。',
    ]) steps.append(element('li', '', step));
    guide.append(steps, element('p', 'chat-tabs-hint', '每个窗口的记录、人设、预设选择和 API 独立保存。关闭后从列表重新打开，即可续聊。'));

    const form = element('form', 'chat-tabs-form');
    const name = element('input', 'text_pole');
    name.placeholder = '例如：角色 B · 日常聊天（选填）';
    name.maxLength = 60;
    const character = element('select', 'text_pole');
    const history = element('select', 'text_pole');
    history.id = 'chat-tabs-history';
    history.add(new Option('全新剧情（独立空白聊天）', 'new'));
    history.add(new Option('复制所选角色当前剧情，之后分开聊', 'branch'));
    const submit = element('button', 'menu_button', '新开聊天窗口');
    submit.type = 'submit';
    form.append(labelField('窗口名称', name), labelField('打开角色', character), labelField('剧情起点', history), submit);

    const compatibility = element('details', 'chat-tabs-compatibility');
    compatibility.append(element('summary', '', '手机保活与插件兼容'));
    compatibility.append(element('p', '', currentTab
        ? '此窗口已保护独立存储：柏宝库的后台接管、快速读取接口会退回原生接口。柏宝箱音频保活保留；其他第三方后台插件仍需逐项验证。'
        : '独立窗口会保护聊天存储，避免柏宝库的后台接管、快速读取绕过隔离。此主页面保持原有插件设置。'));

    const saved = element('div', 'chat-tabs-saved');
    const syncPanel = createSyncPanel({ api, element, labelField, currentTab });
    const status = element('p', 'chat-tabs-status');
    status.setAttribute('role', 'status');
    const cleanup = element('details', 'chat-tabs-cleanup');
    cleanup.append(element('summary', '', '删除所有窗口 · 卸载前清理'));
    const cleanupCount = element('p', 'chat-tabs-hint');
    const cleanupStatus = element('p', 'chat-tabs-status');
    cleanupStatus.setAttribute('role', 'status');
    const deleteAll = element('button', 'menu_button chat-tabs-danger', '删除所有窗口');
    deleteAll.type = 'button';
    const deleteForm = element('form', 'chat-tabs-delete-form');
    deleteForm.hidden = true;
    const deleteSummary = element('p');
    const deleteInput = element('input', 'text_pole');
    deleteInput.type = 'text';
    deleteInput.autocomplete = 'off';
    deleteInput.setAttribute('autocapitalize', 'off');
    deleteInput.spellcheck = false;
    const deleteConfirm = element('button', 'menu_button chat-tabs-danger', '确认永久删除');
    deleteConfirm.type = 'submit';
    const deleteCancel = element('button', 'menu_button', '取消');
    deleteCancel.type = 'button';
    const deleteActions = element('div', 'chat-tabs-actions');
    deleteActions.append(deleteCancel, deleteConfirm);
    deleteForm.append(deleteSummary, labelField('输入“删除所有窗口”确认', deleteInput), deleteActions);
    cleanup.append(cleanupCount,
        element('p', '', '永久删除本账号的全部独立窗口（含已归档），以及各自的聊天、设置、密钥副本、备份和后台暂存回复，无法撤销。主页面的聊天和共用角色卡、预设等资料保留。'),
        element('p', 'chat-tabs-hint', '请先结束生成并关闭所有独立窗口，再回到主页面清理。刚保存后需稍等片刻；异常关闭后可能需要等待 90 秒。需要保留的聊天请先在对应窗口导出。'),
        deleteAll, deleteForm, cleanupStatus);
    if (currentTab) {
        const mainLink = element('a', 'menu_button', '回到主页面管理');
        mainLink.href = '/';
        mainLink.target = '_blank';
        mainLink.rel = 'noopener';
        cleanup.append(element('p', 'chat-tabs-hint', '请在酒馆主页面执行清理；本窗口也会被删除。'), mainLink);
    }
    let savedWindowCount = 0;
    let deletionIds = null;
    let deleting = false;
    function resetDeletion() {
        deletionIds = null;
        deleteInput.value = '';
        deleteConfirm.disabled = true;
        deleteForm.hidden = true;
    }
    function updateCleanup() {
        cleanupCount.textContent = '列表中有 ' + savedWindowCount + ' 个已保存窗口（含已归档）。';
        deleteAll.disabled = deleting || !!currentTab || !capabilities?.deleteAllWindows;
        if (!capabilities?.deleteAllWindows) cleanupStatus.textContent = '此功能需要更新配套组件到 1.3.0 或更新版本，然后重启酒馆。';
    }
    deleteInput.addEventListener('input', () => { deleteConfirm.disabled = deleting || deleteInput.value !== '删除所有窗口'; });
    deleteCancel.addEventListener('click', () => { resetDeletion(); deleteAll.focus(); });
    dialog.addEventListener('close', () => { if (!deleting) resetDeletion(); });
    deleteAll.addEventListener('click', async () => {
        resetDeletion();
        deleteAll.disabled = true;
        cleanupStatus.textContent = '';
        try {
            const plan = await api('/tabs/delete-all');
            savedWindowCount = plan.ids.length;
            if (!plan.ids.length) { cleanupStatus.textContent = '没有需要删除的独立窗口。'; return; }
            if (plan.busy) {
                cleanupStatus.textContent = '有 ' + plan.busy + ' 个窗口仍在使用、保存尚未结束或有后台任务。请先结束生成并关闭这些窗口，稍等后重试。异常关闭后可能需要等待 90 秒。';
                return;
            }
            deletionIds = plan.ids;
            deleteSummary.textContent = '即将永久删除 ' + deletionIds.length + ' 个独立窗口（含已归档）及其全部存档。此操作无法撤销。';
            deleteForm.hidden = false;
            deleteInput.focus();
        } catch (error) { cleanupStatus.textContent = error.message; }
        finally { updateCleanup(); }
    });
    deleteForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (deleting || !deletionIds || deleteInput.value !== '删除所有窗口') return;
        deleting = true;
        deleteConfirm.disabled = deleteCancel.disabled = deleteInput.disabled = true;
        updateCleanup();
        cleanupStatus.textContent = '正在永久删除窗口数据…';
        try {
            const result = await api('/tabs/delete-all', 'POST', { confirmation: deleteInput.value, ids: deletionIds });
            cleanupStatus.textContent = '已永久删除 ' + result.deleted + ' 个独立窗口及其存档。';
        } catch (error) { cleanupStatus.textContent = error.message; }
        finally {
            deleting = false;
            deleteCancel.disabled = deleteInput.disabled = false;
            resetDeletion();
            try { await refresh(); } catch { /* Preserve the cleanup result when refreshing fails. */ }
            updateCleanup();
        }
    });
    const background = element('input');
    background.type = 'checkbox'; background.checked = settings.background === true;
    const backgroundLabel = element('label', 'chat-tabs-toggle');
    backgroundLabel.append(background, element('span', '', '后台生成与回复暂存（可选）'));
    background.addEventListener('change', () => { settings.background = background.checked; SillyTavern.getContext().saveSettingsDebounced(); });
    const taskList = element('div', 'chat-tabs-task-list');
    const taskController = currentTab ? createTaskController(currentTab, settings, () => { void refreshTasks(); }) : null;
    const install = element('details', 'chat-tabs-install');
    install.append(element('summary', '', '安装方法 · Windows / 安卓 Termux'),
        element('p', '', '后端安装在运行酒馆的电脑或手机上。沿用酒馆已有的 Node 环境，无需额外安装 Python、数据库或另开服务。'),
        element('p', '', 'Windows：解压完整安装包，运行「安装.cmd」，选择实际的酒馆目录。'),
        element('p', '', '安卓 Termux：解压完整安装包，在解压目录执行（按实际路径修改）：'),
        element('pre', '', 'sh ./install.sh "$HOME/SillyTavern"'),
        element('p', '', '两种方式都会安装前端与后端。config.yaml 需设置 enableServerPlugins: true。等当前生成和保存结束后，重启酒馆并刷新网页。'),
        element('p', 'chat-tabs-hint', '当前优先支持 Windows 与安卓 Termux。安卓安装脚本已检查，后台切换和锁屏仍需真机验证；云酒馆、iOS 和多设备接管暂未验证。'));
    backendPage.append(guide, form, backgroundLabel,
        element('p', 'chat-tabs-hint', currentTab ? '开启后，支持的请求交给酒馆后台；切走或关闭页面后仍可完成并暂存，回来从这里恢复。流式开关开启时也会等待完整回复后一次显示。' : '请先新建独立窗口，再到该窗口的本面板开启后台生成。'),
        element('p', 'chat-tabs-hint', '首版支持普通单角色文字对话：自定义兼容接口、OpenAI、OpenRouter、DeepSeek、xAI。群聊、重生成、续写、工具调用、多候选和自定义请求体走普通前台生成，并提示本次未托管。'),
        element('p', 'chat-tabs-hint', '只有显示任务已在后台运行后，才可依赖回复暂存。关闭页面不会停止后台任务；请使用「停止后台任务」。酒馆进程被终止或重启会中断未完成任务，不会自动重发。'),
        taskList, compatibility, install, status, saved, syncPanel.node, cleanup);
    dialog.append(header, navigation, frontendPage, backendPage);
    document.body.append(dialog);

    async function checkBackend() {
        capabilities = null;
        submit.disabled = background.disabled = true;
        syncPanel.update([], capabilities);
        updateCleanup();
        backendStatus.textContent = '正在检查配套组件…';
        try {
            capabilities = await api('/capabilities');
            cleanupStatus.textContent = '';
            updateCleanup();
            backendStatus.textContent = '配套组件已连接 · ' + capabilities.version + ' · 独立存储与后台任务可用';
            submit.disabled = !capabilities.independentWindows;
            background.disabled = !currentTab || !capabilities.backgroundGeneration;
            await refresh();
            await refreshTasks();
        } catch {
            backendStatus.textContent = '未连接到配套组件。第一页的页面保活可用；独立多开与后台生成需额外安装组件并重启酒馆，请展开安装方法。';
        }
    }
    retryBackend.addEventListener('click', () => { void checkBackend(); });

    let refreshingTasks = false;
    async function refreshTasks() {
        if (!taskController || refreshingTasks) return;
        refreshingTasks = true;
        try {
            const tasks = await taskController.list();
            const pending = tasks.filter(task => !task.applied && !task.dismissed);
            entry.querySelector('span').textContent = pending.length ? '多开聊天 · ' + pending.length + ' 个任务待查看' : '多开聊天';
            taskList.replaceChildren();
            taskList.append(element('h4', '', '本窗口的后台任务'));
            if (!pending.length) taskList.append(element('p', 'chat-tabs-hint', '暂无运行中任务或待恢复回复。'));
            const core = await import('/script.js');
            for (const task of pending) {
                const row = element('section', 'chat-tabs-task');
                const states = { running: '后台生成中', succeeded: '回复已暂存 · 待恢复', failed: '生成失败', cancelled: '已停止', interrupted: '后台中断' };
                row.append(element('p', '', (task.target.name || '角色') + ' · ' + states[task.status]), element('p', 'chat-tabs-hint', task.target.chat));
                if (task.error) row.append(element('p', 'chat-tabs-hint', task.error));
                const actions = element('div', 'chat-tabs-actions');
                const addAction = (text, action) => {
                    const button = element('button', 'menu_button', text);
                    button.type = 'button';
                    button.addEventListener('click', async () => {
                        button.disabled = true;
                        try { await taskController.action(task, action); await refreshTasks(); }
                        catch (error) { status.textContent = error.message; button.disabled = false; }
                    });
                    actions.append(button);
                    return button;
                };
                if (task.status === 'running') addAction('停止后台任务', 'cancel');
                else {
                    if (task.status === 'succeeded') {
                        addAction('恢复到原聊天', 'apply').disabled = core.isGenerating();
                        const preview = element('button', 'menu_button', '查看 / 复制回复');
                        preview.type = 'button';
                        preview.addEventListener('click', async () => {
                            try {
                                const data = await taskController.get(task.id);
                                const output = element('textarea', 'text_pole chat-tabs-task-preview');
                                output.readOnly = true;
                                output.setAttribute('aria-label', '暂存回复');
                                const content = data.result?.choices?.[0]?.message?.content ?? data.result?.choices?.[0]?.text;
                                output.value = typeof content === 'string' ? content : content?.map(part => part.text || '').join('') || '';
                                row.append(output); output.focus(); output.select(); preview.disabled = true;
                            } catch (error) { status.textContent = error.message; }
                        });
                        actions.append(preview);
                    }
                    addAction('忽略此任务', 'dismiss');
                }
                row.append(actions); taskList.append(row);
            }
        } catch { /* Backend status explains missing or outdated server plugins. */ }
        finally { refreshingTasks = false; }
    }
    setInterval(() => { if (dialog.open) void refreshTasks(); }, 3000);
    if (taskController) SillyTavern.getContext().eventSource.on(SillyTavern.getContext().eventTypes.APP_READY, () => { void refreshTasks(); });

    function populateCharacters() {
        const roles = SillyTavern.getContext().characters;
        character.replaceChildren(new Option('进入后再选', ''));
        const sorted = [...roles].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        for (const role of sorted) {
            if (role.avatar && role.avatar !== 'none') character.add(new Option(role.name, role.avatar));
        }
        const context = SillyTavern.getContext();
        character.value = context.characters[context.characterId]?.avatar || '';
    }

    function titleFor(tab) {
        const role = SillyTavern.getContext().characters.find(item => item.avatar === tab.avatar)?.name;
        return tab.name || role || '未命名标签页';
    }

    async function refresh() {
        const tabs = await api('/tabs?archived=1');
        if (currentTab) { currentTabName = tabs.find(tab => tab.id === currentTab)?.name || ''; updateWindowTitle(); }
        saved.replaceChildren();
        savedWindowCount = tabs.length;
        updateCleanup();
        syncPanel.update(tabs, capabilities);
        if (!tabs.length) return;

        saved.append(element('h4', '', '已保存的聊天窗口'));
        const archived = element('details', 'chat-tabs-archive');
        archived.append(element('summary', '', '已归档窗口（可恢复）'));
        for (const tab of tabs) {
            const row = element('div', 'chat-tabs-row');
            const label = titleFor(tab);
            row.append(element('span', 'chat-tabs-name', tab.id === currentTab ? label + '（当前）' : label));
            const actions = element('div', 'chat-tabs-actions');
            const rename = element('button', 'menu_button', '改名');
            rename.type = 'button';
            rename.setAttribute('aria-label', '改名 ' + label);
            rename.addEventListener('click', async () => {
                const value = window.prompt('窗口名称（只修改显示名称，不更改文件夹）', tab.name || '');
                if (value === null) return;
                try {
                    await api('/tabs/' + tab.id, 'PATCH', { name: value });
                    await refresh();
                } catch (error) { status.textContent = error.message; }
            });
            actions.append(rename);
            if (tab.archived) {
                const restore = element('button', 'menu_button', '恢复');
                restore.type = 'button';
                restore.setAttribute('aria-label', '恢复 ' + label);
                restore.addEventListener('click', async () => {
                    try { await api('/tabs/' + tab.id, 'PATCH', { archived: false }); await refresh(); }
                    catch (error) { status.textContent = error.message; }
                });
                actions.append(restore);
            } else if (tab.id !== currentTab) {
                const link = element('a', 'menu_button', '打开');
                link.setAttribute('aria-label', '打开 ' + label);
                link.href = BASE + '/tab/' + tab.id;
                link.target = 'st-chat-tabs-' + tab.id;
                link.rel = 'noopener';
                const remove = element('button', 'menu_button', '归档');
                remove.type = 'button';
                remove.setAttribute('aria-label', '归档 ' + label);
                remove.addEventListener('click', async () => {
                    if (!window.confirm('请先关闭这个窗口。归档「' + label + '」？聊天记录和设置会保留，可以恢复。')) return;
                    remove.disabled = true;
                    try {
                        await api('/tabs/' + tab.id, 'DELETE');
                        await refresh();
                    } catch (error) {
                        status.textContent = error.message;
                        remove.disabled = false;
                    }
                });
                actions.append(link, remove);
            }
            row.append(actions);
            (tab.archived ? archived : saved).append(row);
        }
        if (tabs.some(tab => tab.archived)) saved.append(archived);
    }

    function openDialog(event) {
        event.preventDefault();
        const options = document.getElementById('options');
        if (options) options.style.display = 'none';
        populateCharacters();
        const toolkit = SillyTavern.getContext().extensionSettings?.baiBaiToolkit;
        keepaliveStatus.textContent = (toolkit
            ? (toolkit.messageCompletionSoundEnabled && toolkit.messageCompletionSoundKeepAliveEnabled !== false
                ? '检测到柏宝箱已配置静音保活，建议只选一份。该配置不代表音频正在播放；本插件不会修改它的开关。'
                : '柏宝箱的静音保活需要同时开启提示音总开关；只勾保活可能不会启动。')
            : '未检测到已知的柏宝箱保活配置。其他插件请自行确认；本插件无法检测所有音频保活。');
        updateProtection();
        status.textContent = '';
        dialog.showModal();
        void checkBackend();
    }
    entry.addEventListener('click', openDialog);

    const chatMenu = document.querySelector('#options .options-content');
    if (chatMenu) {
        const legacyEntry = element('a', 'interactable');
        legacyEntry.id = 'chat-tabs-menu';
        legacyEntry.href = '#';
        legacyEntry.append(element('i', 'fa-lg fa-regular fa-window-restore'), element('span', '', '多开聊天'));
        legacyEntry.addEventListener('click', openDialog);
        chatMenu.prepend(legacyEntry);
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        // Reserve a browser tab within the click, before the asynchronous create request.
        const popup = window.open('about:blank', '_blank');
        if (popup) {
            popup.opener = null;
            popup.document.title = '正在打开酒馆…';
        }

        submit.disabled = true;
        status.textContent = '';
        try {
            const { saveSettings } = await import('/script.js');
            await saveSettings();
            const tab = await api('/tabs', 'POST', { name: name.value, avatar: character.value, history: history.value, source: currentTab });
            name.value = '';
            if (popup && !popup.closed) {
                popup.name = 'st-chat-tabs-' + tab.id;
                popup.location.replace(BASE + '/tab/' + tab.id);
                dialog.close();
            } else {
                status.textContent = '聊天窗口已创建。浏览器可能拦截了新标签页，请在下面点「打开」。';
                await refresh();
            }
        } catch (error) {
            popup?.close();
            status.textContent = error.message;
        } finally {
            submit.disabled = false;
        }
    });

    if (currentTab) {
        const context = SillyTavern.getContext();
        const rememberForm = () => window.STChatTabs?.rememberCharacterForm();
        context.eventSource.on(context.eventTypes.APP_READY, rememberForm);
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, rememberForm);
        context.eventSource.on(context.eventTypes.CHARACTER_EDITED, rememberForm);
        updateWindowTitle = () => {
            const active = SillyTavern.getContext();
            const role = active.characters[active.characterId]?.name;
            document.title = (currentTabName || role || '多开聊天') + ' · SillyTavern';
        };
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, updateWindowTitle);
        api('/tabs').then(tabs => {
            currentTabName = tabs.find(tab => tab.id === currentTab)?.name || '';
            updateWindowTitle();
        }).catch(() => updateWindowTitle());
    }
}

jQuery(mount);
