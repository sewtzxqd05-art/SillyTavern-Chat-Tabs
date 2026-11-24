import { api, BASE, currentTab, element, button, labelField } from './api.js';
import { createKeepaliveController } from './keepalive.js';
import { createTaskController } from './tasks.js';
import { createSyncPanel } from './sync.js';
import { createActivityIndicator } from './activity.js';
import { createWindowMonitor } from './monitor.js';
import { createNavigation } from './navigation.js';
import { createWindowForm } from './view-create.js';
import { createWindowList } from './view-list.js';
import { createTour, tours } from './tour.js';
import { createSound } from './sound.js';
import { saveCurrentSettings } from './settings.js';
import { createTaskNotifications, requestNotificationPermission, notifyNative } from './notifications.js';

function mount() {
    const menu = document.getElementById('extensionsMenu'); if (!menu || document.getElementById('chat-tabs-wand-menu')) return;
    const context = () => SillyTavern.getContext(), settings = context().extensionSettings.chatTabs ||= {}, currentId = currentTab || 'main';
    const guideRows = new Map();
    let tabs = [], capabilities = null, page = 'list', refreshing = false, listView, activity, monitor, pendingApplying = false, attemptedPreset = '', appReady = false;
    const baseTitle = document.title.replace(/^(?:◌ 生成中|✓ 回复就绪|! 任务待查看|● 出字中|✓ 新回复|! 生成失败) · /,'');
    const nameFor = () => currentTab ? tabs.find(t => t.id === currentTab)?.name || context().characters[context().characterId]?.name || '窗口' : '主窗口';
    const dialog = element('dialog','chat-tabs-dialog'); dialog.id = 'chat-tabs-dialog'; dialog.setAttribute('aria-label','多开助手');
    const header = element('header','chat-tabs-header'), heading = element('h3','','多开助手'), count = element('span','chat-tabs-count');
    const back = button('‹',() => show('list')); back.setAttribute('aria-label','返回');
    const newWindow = button('＋ 新窗口',() => show('create'),'chat-tabs-primary'); newWindow.dataset.tour = 'new';
    const help = button('?',() => tour.start(({list:'basics',create:'create',sync:'sync',settings:'basics'})[page] || 'basics')); help.setAttribute('aria-label','这一页怎么用');
    const gear = button('⚙',() => show('settings')); gear.setAttribute('aria-label','设置');
    const close = button('×',() => { tour.exit(); dialog.close(); }); close.setAttribute('aria-label','关闭');
    header.append(back,heading,count,newWindow,help,gear,close);
    const host = element('div'), status = element('p','chat-tabs-status'); status.setAttribute('role','status');
    const banner = element('div','chat-tabs-banner'); banner.hidden = true;
    const report = message => { status.textContent = message; if (!dialog.open) window.toastr?.info(message); };
    const soundStatus = element('p','chat-tabs-hint'), sound = createSound({ settings, onStatus: message => { soundStatus.textContent = message; } });
    const navigation = createNavigation({ currentId, isBackgroundRunning:() => !!tasks?.isActive(), onFocus: task => { if (task) { open(); show('list'); void refresh(); } }, onError: report, isGenerating: () => activity?.isGenerating() });
    const tasks = currentTab ? createTaskController(currentTab, settings, () => { void refresh(); }) : null;
    const notifications = createTaskNotifications({ settings, openTask: t => navigation.open(t.tabId,t.id,tabs.find(x => x.id === t.tabId)?.open) });
    monitor = createWindowMonitor({ settings, element, currentId, getName: nameFor, switchWindow: id => navigation.open(id,'',monitor.states().find(s => s.id === id)?.open), onOpen: () => { void refresh(); }, openAll: () => open(),
        onChange: metrics => { listView?.update(tabs,metrics); }, onComplete: (id,state) => sound.play(id + '-' + state.started,{ handled:state.soundHandled }) });
    activity = createActivityIndicator({ settings, element, getTitle: () => currentTab ? nameFor() + ' · SillyTavern' : baseTitle,
        onUpdate: state => monitor.update(state), onComplete: state => { const id = currentId + '-' + state.started; notifyNative(settings,nameFor(),id); sound.play(id,{ self:true,handled:!!context().extensionSettings?.baiBaiToolkit?.messageCompletionSoundEnabled }); } });
    listView = createWindowList({ currentId,navigation,sync: id => { show('sync'); void syncPanel.show(tabs,id); },refresh,report,taskController:tasks,available:() => !!capabilities?.independentWindows });
    const pages = { list:listView.node, settings:element('section','chat-tabs-page'), create:element('section','chat-tabs-page'), install:element('section','chat-tabs-page') };
    const syncPanel = createSyncPanel({ onOpen:id => navigation.open(id),closeWindow:id => navigation.close(id),report }); pages.sync = syncPanel.node;
    for (const node of Object.values(pages)) host.append(node);
    dialog.append(header,banner,status,host); document.body.append(dialog);
    const tour = createTour({ host, onExit:() => { help.hidden = false; for (const [id,row] of guideRows) { const t = tours[id], done = tour.progress()[id]; row.querySelector('span').textContent = t.name + ' · ' + t.steps.length + ' 步' + (done ? ' · 已走完' : ''); row.querySelector('button').textContent = done ? '重走' : '开始'; } } });
    const offer = element('section','chat-tabs-offer');
    let offered = false; try { offered = localStorage.getItem('chat-tabs-guide-offered') === '1'; } catch {}
    if (!offered) {
        offer.append(element('p','','第一次用？跟着点一遍，大概一分钟。'), element('p','chat-tabs-hint','练习使用演示数据，不会改动你的窗口。'), button('开始',() => { localStorage.setItem('chat-tabs-guide-offered','1'); offer.remove(); tour.start('basics'); }), button('以后再说',() => { localStorage.setItem('chat-tabs-guide-offered','1'); offer.remove(); }));
        listView.node.prepend(offer);
    }
    const closeOthers = button('关闭其他页面', async () => {
        const candidates = monitor.states().filter(s => s.id !== currentId && s.open);
        const skipped = []; const failed = [];
        for (const state of candidates) {
            if (state.phase === 'running' || state.stale) { skipped.push(state.name); continue; }
            try { await navigation.close(state.id); } catch(e) { failed.push(state.name + '：' + e.message); }
        }
        await refresh(); report([skipped.length ? '已跳过正在生成或状态待更新的窗口：' + skipped.join('、') : '', ...failed].filter(Boolean).join('；') || '其他页面已关闭，内容保留。');
    }); listView.node.append(closeOthers);

    function show(value) { page = value; for (const [key,node] of Object.entries(pages)) node.hidden = key !== value; back.hidden = value === 'list'; newWindow.hidden = gear.hidden = value !== 'list'; count.hidden = value !== 'list'; heading.textContent = ({list:'多开助手',settings:'设置',create:'新建窗口',sync:'同步设置',install:'安装方法与配套组件'})[value]; status.textContent = ''; dialog.scrollTop = 0; if (value === 'create') populate(); }
    function toggle(key,text,defaultValue = false,change) {
        const input = element('input'); input.type = 'checkbox'; input.setAttribute('role','switch'); input.checked = settings[key] ?? defaultValue; input.dataset.setting = key;
        const label = element('label','chat-tabs-toggle'); label.append(element('span','',text),input);
        input.onchange = async () => { settings[key] = input.checked; try { if (change) await change(input); context().saveSettingsDebounced(); activity.update(); monitor.render(); } catch(e) { report(e.message); } }; return label;
    }
    const keepaliveStatus = element('p','chat-tabs-hint');
    const protection = createKeepaliveController(settings,() => context().saveSettingsDebounced(),state => { keepaliveStatus.textContent = [state.audioEnabled ? state.audioText : '',settings.screen ? state.wakeText : ''].filter(Boolean).join(' · '); });
    const settingsPage = pages.settings;
    settingsPage.append(element('h4','','悬浮提示'),toggle('monitorFloat','显示悬浮提示',true));
    const position = element('select','text_pole'); for (const [key,text] of [['br','右下'],['bl','左下'],['tr','右上'],['tl','左上']]) position.add(new Option(text,key)); position.value = settings.monitorPosition || 'br'; position.onchange = () => { settings.monitorPosition = position.value; context().saveSettingsDebounced(); monitor.render(); };
    settingsPage.append(labelField('放在',position),element('h4','','出完字提醒'),toggle('indicator','浏览器标签页标题',true),toggle('notifications','系统通知',false,async input => { if (input.checked) { const result = await requestNotificationPermission(settings); input.checked = result.enabled; if (!result.enabled) report('浏览器尚未允许通知。'); } }),toggle('soundOthers','别的窗口出完字时响一声',true),toggle('soundSelf','本窗口出完字时响一声'),soundStatus,
        element('h4','','防止手机断开'),toggle('audio','生成时播放静音音频',false,input => protection.enableAudio(input.checked)),toggle('screen','生成时保持屏幕常亮',false,input => protection.enableScreen(input.checked)),keepaliveStatus,
        element('h4','','后台生成'),toggle('background','关掉页面也继续生成'),element('p','chat-tabs-hint','独立窗口的普通单角色对话可用；支持 OpenAI、OpenRouter、DeepSeek、xAI 和自定义接口。'),element('h4','','新手引导'));
    for (const [id,t] of Object.entries(tours)) { const row = element('div','chat-tabs-guide-row'); row.append(element('span','',t.name + ' · ' + t.steps.length + ' 步' + (tour.progress()[id] ? ' · 已走完' : '')),button(tour.progress()[id] ? '重走' : '开始',() => { help.hidden = true; tour.start(id); })); settingsPage.append(row); guideRows.set(id,row); }
    const more = element('details'); more.append(element('summary','','更多'),button('同步设置…',() => { show('sync'); void syncPanel.show(tabs); }),button('安装方法与配套组件',() => show('install')));
    const cleanup = element('details'); cleanup.append(element('summary','','删除所有窗口…'));
    const confirmation = element('input','text_pole'); confirmation.placeholder = '输入“删除所有窗口”';
    const cleanupStatus = element('p','chat-tabs-status'); const remove = button('永久删除',async () => {
        if (confirmation.value !== '删除所有窗口' || currentTab) return;
        remove.disabled = true;
        try { const plan = await api('/tabs/delete-all'); if (plan.busy) throw new Error('请关闭其他窗口，等待保存和后台任务结束。'); const result = await api('/tabs/delete-all','POST',{confirmation:confirmation.value,ids:plan.ids}); confirmation.value = ''; cleanupStatus.textContent = '已删除 ' + result.deleted + ' 个窗口。'; await refresh(); } catch(e) { cleanupStatus.textContent = e.message; } finally { remove.disabled = confirmation.value !== '删除所有窗口' || !!currentTab; }
    },'chat-tabs-danger'); remove.disabled = true; confirmation.oninput = () => { remove.disabled = !!currentTab || confirmation.value !== '删除所有窗口'; };
    cleanup.append(element('p','chat-tabs-hint',currentTab ? '回到主窗口执行清理。' : '永久删除所有独立窗口的聊天、设置和密钥副本。主窗口不受影响。'),confirmation,remove,cleanupStatus); more.append(cleanup); settingsPage.append(more);
    const footer = element('p','chat-tabs-footer'); settingsPage.append(footer);
    pages.install.append(element('p','','Windows：运行安装包中的「安装.cmd」，选择酒馆目录。'),element('p','','安卓 Termux：在安装包目录运行：'),element('pre','','sh ./install.sh "$HOME/SillyTavern"'),element('p','','启用 enableServerPlugins: true，然后重启酒馆、刷新页面。'));
    const createForm = createWindowForm({ getCharacters:() => context().characters, getSourceName:nameFor, ready:() => !!capabilities?.independentWindows,
        async create(values) {
            const popup = window.open('about:blank','_blank');
            try { await saveCurrentSettings(); const tab = await api('/tabs','POST',{...values,source:currentTab});
                if (popup) { popup.name = 'st-chat-tabs-' + tab.id; popup.location.replace(BASE + '/tab/' + tab.id); dialog.close(); }
                else { await refresh(); show('list'); report('窗口已创建，请点打开。'); }
            } catch(e) { popup?.close(); report(e.message); }
        } });
    const submit = createForm.submit; pages.create.append(createForm.node);
    function populate() { createForm.populate(context().characters[context().characterId]?.avatar || ''); }
    const entry = element('div','list-group-item flex-container flexGap5 interactable'); entry.id = 'chat-tabs-wand-menu'; entry.dataset.tour = 'wand'; entry.tabIndex = 0; entry.setAttribute('role','button'); entry.append(element('i','fa-regular fa-window-restore'),element('span','','多开助手')); entry.onclick = open; entry.onkeydown = e => { if (['Enter',' '].includes(e.key)) { e.preventDefault(); open(); } }; menu.prepend(entry);
    function open(event) { event?.preventDefault(); document.getElementById('options')?.style.setProperty('display','none'); if (!dialog.open) dialog.showModal(); show('list'); monitor.setDialogOpen(true); monitor.request(); void check(); }
    dialog.addEventListener('close',() => { tour.exit(); monitor.setDialogOpen(false); });
    let taskBefore = new Map();
    async function refresh() {
        if (refreshing || !capabilities?.taskOverview) return; refreshing = true;
        try { const value = await api('/tabs/overview?archived=1'); tabs = value.map(t => { const role = context().characters.find(c => c.avatar === t.avatar)?.name; return {...t,role,name:t.name || role || '未命名窗口'}; });
            const all = tabs.flatMap(t => (t.tasks || []).map(task => ({...task,tabId:t.id,tabName:t.name})));
            for (const task of all) if (task.status === 'succeeded' && taskBefore.get(task.id) === 'running' && !tabs.find(t => t.id === task.tabId)?.open) sound.play('task-' + task.id);
            taskBefore = new Map(all.map(t => [t.id,t.status])); notifications.update(all); activity.updateTasks(all.filter(t => t.tabId === currentTab)); monitor.updateTabs(tabs); count.textContent = (tabs.filter(t => !t.archived).length + 1) + ' 个窗口';
            const otherCount = monitor.states().filter(s => !s.current && s.open).length; closeOthers.hidden = !otherCount; closeOthers.textContent = '关闭其他 ' + otherCount + ' 个页面';
            await applyPendingPreset();
        } catch(e) { if (dialog.open) report(e.message); } finally { refreshing = false; }
    }
    async function applyPendingPreset() {
        const preset = tabs.find(t => t.id === currentTab)?.pendingPreset; if (!appReady || !preset || pendingApplying || preset === attemptedPreset) return;
        const {getPresetManager} = await import('/scripts/preset-manager.js'); const manager = getPresetManager('openai'); if (!manager) return;
        pendingApplying = true; attemptedPreset = preset;
        try { const map = manager.getPresetList().preset_names; if (!(preset in map)) throw new Error('待应用的预设不存在：' + preset); await manager.selectPreset(String(map[preset])); await saveCurrentSettings(); await api('/tab/' + currentTab + '/preset-applied','POST',{preset}); }
        catch(e) { report(e.message); } finally { pendingApplying = false; }
    }
    async function check() {
        try { capabilities = await api('/capabilities'); const manifest = await fetch(new URL('./manifest.json',import.meta.url)).then(r => r.json());
            const matching = capabilities.version.split('.').slice(0,2).join('.') === manifest.version.split('.').slice(0,2).join('.');
            if (!capabilities.independentWindows) throw new Error('配套组件与此酒馆版本不兼容，请查看终端提示。');
            if (!matching) { capabilities = null; throw new Error('前端和配套组件版本不同，请一起更新。'); }
            banner.hidden = true; footer.textContent = '配套组件 ' + capabilities.version + ' · 已连接'; await refresh();
        } catch(e) { capabilities = null; banner.replaceChildren(element('span','',e.message || '配套组件未连接'),button('怎么装',() => show('install'))); banner.hidden = false; footer.textContent = '配套组件 · 未连接'; }
        newWindow.disabled = submit.disabled = !capabilities?.independentWindows; settingsPage.querySelector('[data-setting="background"]').disabled = !currentTab || !capabilities?.backgroundGeneration;
    }
    context().eventSource.on(context().eventTypes.APP_INITIALIZED, async () => { appReady = true; await check(); });
    if (currentTab) { const remember = () => window.STChatTabs?.rememberCharacterForm(); for (const event of ['APP_READY','CHAT_CHANGED','CHARACTER_EDITED']) context().eventSource.on(context().eventTypes[event],remember); }
    document.addEventListener('visibilitychange',() => { if (!document.hidden) { void refresh(); monitor.request(); } });
    setInterval(() => { if (!document.hidden && (dialog.open || settings.monitorFloat !== false || settings.notifications || settings.soundOthers !== false) || activity.hasRunningTask() || sound.isOwner() && (settings.notifications || settings.soundOthers !== false)) void refresh(); },4000);
    show('list');
    if (new URLSearchParams(location.search).has('task')) open();
}
jQuery(mount);
