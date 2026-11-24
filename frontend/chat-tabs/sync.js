import { api as requestApi, element, button, labelField, currentTab } from './api.js';
import { saveCurrentSettings } from './settings.js';
export function createSyncPanel({ onOpen, closeWindow, report, api = requestApi, saveSettings = saveCurrentSettings, practice = false }) {
    const node = element('section', 'chat-tabs-page'); node.dataset.tour = 'sync';
    const source = element('select', 'text_pole'), targets = element('div'), preset = element('select', 'text_pole'), connections = element('div');
    const status = element('p', 'chat-tabs-status'), result = element('div'); result.dataset.tour = 'sync-result';
    const categories = {}, fields = {}, selected = new Set(); let tabs = [], catalog = null, busy = false, loading = false, targetCatalogs = new Map();
    preset.dataset.tour = 'sync-preset-choice';
    const save = element('input'); save.type = 'checkbox'; const saveLabel = element('label', 'chat-tabs-toggle'); saveLabel.append(save, element('span', '', '顺便存进共用预设文件')); saveLabel.hidden = true;
    const useActive = element('input'); useActive.type = 'checkbox'; const activeLabel = element('label', 'chat-tabs-toggle'); activeLabel.append(useActive, element('span', '', '目标改用来源正在使用的连接'));
    const preview = element('p','chat-tabs-hint');
    const submit = button('同步设置', run, 'chat-tabs-primary'); submit.dataset.tour = 'sync-submit';
    node.append(labelField('从', source), element('h4', '', '同步到'), targets);
    for (const [key, name] of [['appearance','美化'],['presets','预设'],['api','API 连接']]) {
        const input = element('input'); input.type = 'checkbox'; input.dataset.tour = 'sync-' + key;
        categories[key] = input; const label = element('label', 'chat-tabs-toggle'); label.append(input, element('span', '', name));
        const field = element('div', 'chat-tabs-sync-detail'); field.hidden = true; fields[key] = field;
        input.onchange = () => { field.hidden = !input.checked; if (key === 'api' && input.checked) { connections.dataset.initialized = 'false'; renderConnections(); } controls(); }; node.append(label, field);
    }
    fields.appearance.append(element('p', 'chat-tabs-hint', '主题、CSS、背景和布局一起同步。'));
    const presetWarning = element('p', 'chat-tabs-hint', '勾选后会更新共用预设文件，其他窗口重新选择它时也会使用新版。');
    const addSame = button('加入使用此预设的未打开窗口', () => { for (const tab of tabs) if (tab.preset === preset.value && !tab.open && tab.id !== source.value && tab.id !== currentTab) selected.add(tab.id); renderTargets(); });
    fields.presets.append(labelField('用哪个预设', preset), saveLabel, presetWarning, addSame);
    fields.api.append(button('只勾有差别的', () => { connections.dataset.initialized = 'false'; renderConnections(); }), connections, activeLabel);
    node.append(element('p', 'chat-tabs-hint', '不会动：目标的聊天记录、user 人设、当前角色、窗口名字、后台待处理回复。'), preview, submit, status, result);
    function controls() {
        saveLabel.hidden = practice || source.value !== (currentTab || 'main') || preset.value !== catalog?.preset;
        presetWarning.hidden = saveLabel.hidden;
        if (saveLabel.hidden) save.checked = false;
        submit.disabled = loading || busy || !selected.size || !Object.values(categories).some(x => x.checked);
        preview.textContent = '会这样改：' + [categories.appearance?.checked ? '替换美化' : '',categories.presets?.checked ? '改用预设「' + preset.value + '」' : '',categories.api?.checked ? '更新所选连接' + (useActive.checked ? '并切换使用' : '') : ''].filter(Boolean).join('；');
        preview.hidden = !Object.values(categories).some(x => x.checked);
        submit.textContent = selected.size === 1 ? '同步到「' + (tabs.find(t => selected.has(t.id))?.name || '窗口') + '」' : '同步到 ' + selected.size + ' 个窗口';
    }
    function renderTargets() {
        targets.replaceChildren();
        for (const tab of tabs.filter(t => !t.archived && t.id !== source.value && t.id !== currentTab)) {
            const row = element('div', 'chat-tabs-sync-target'), input = element('input'); input.type = 'checkbox'; input.dataset.tour = 'sync-target'; input.checked = selected.has(tab.id) && !tab.open; input.disabled = busy || tab.open;
            if (tab.open) selected.delete(tab.id);
            input.onchange = () => { input.checked ? selected.add(tab.id) : selected.delete(tab.id); connections.dataset.initialized = 'false'; controls(); renderConnections(); };
            const label = element('label'); label.append(input, element('span', '', tab.name)); row.append(label, element('small', '', tab.open ? '开着，关掉页面才能同步' : [tab.preset, tab.activeConnection].filter(Boolean).join(' · ') || '未选择预设或连接'));
            if (tab.open && !tab.tasks?.some(t => t.status === 'running')) row.append(button('关闭页面', async () => { try { await closeWindow(tab.id); tab.open = false; selected.add(tab.id); renderTargets(); } catch(e) { report(e.message); } }));
            targets.append(row);
        }
        controls(); renderConnections();
    }
    function renderConnections() {
        const previous = new Set([...connections.querySelectorAll('input:checked')].map(x => x.value)); const initialized = connections.dataset.initialized === 'true'; connections.replaceChildren();
        for (const c of catalog?.connections || []) {
            const input = element('input'); input.type = 'checkbox'; input.value = c.key;
            const differences = [...selected].map(id => { const other = targetCatalogs.get(id)?.connections.find(x => x.key === c.key); const name = tabs.find(t => t.id === id)?.name || '目标'; return !other ? name + '没有' : ['model','endpoint','format','hasSecret'].some(k => other[k] !== c[k]) ? name + '不同' : ''; }).filter(Boolean);
            input.checked = initialized ? previous.has(c.key) : differences.length > 0; const label = element('label', 'chat-tabs-toggle'); label.append(input, element('span', '', c.name + ' · ' + c.model + (differences.length ? ' · ' + differences.join('、') : selected.size ? ' · 目标都一样' : ''))); connections.append(label);
        }
        connections.dataset.initialized = 'true';
    }
    async function load() {
        loading = true; controls(); status.textContent = '正在读取…';
        try {
            if (source.value === (currentTab || 'main')) await saveSettings();
            catalog = await api('/tabs/sync/catalog?source=' + encodeURIComponent(source.value));
            if (catalog.preset && !catalog.presets.includes(catalog.preset)) catalog.presets.unshift(catalog.preset);
            preset.replaceChildren(...catalog.presets.map(n => new Option(n, n))); preset.value = catalog.preset;
            targetCatalogs = new Map(await Promise.all(tabs.filter(t => !t.archived).map(async t => [t.id, await api('/tabs/sync/catalog?source=' + t.id)])));
            connections.dataset.initialized = 'false'; renderTargets(); status.textContent = '';
        } catch(e) { status.textContent = e.message; } finally { loading = false; controls(); }
    }
    source.onchange = () => { selected.clear(); void load(); }; preset.onchange = controls; useActive.onchange = controls;
    async function run() {
        if (submit.disabled) return; busy = true; controls(); result.replaceChildren(); for (const control of node.querySelectorAll('input,select')) control.disabled = true;
        try {
            if (source.value === (currentTab || 'main')) await saveSettings();
            if (!practice && categories.presets.checked && save.checked && !saveLabel.hidden) {
                const { getPresetManager } = await import('/scripts/preset-manager.js'); await getPresetManager('openai').savePreset(preset.value);
            }
            for (const target of selected) {
                const selection = { selectionVersion: 2, source: source.value, target, categories: Object.keys(categories).filter(k => categories[k].checked), preset: preset.value, connections: [...connections.querySelectorAll('input:checked')].map(n => n.value), useActiveConnection: useActive.checked };
                const line = element('section', 'chat-tabs-sync-result'); result.append(line);
                try { const plan = await api('/tabs/sync/plan', 'POST', selection); await api('/tabs/sync', 'POST', { ...selection, revision: plan.revision }); line.append(element('p', '', (tabs.find(t => t.id === target)?.name || target) + '：已更新 ' + selection.categories.map(k => ({ appearance:'美化',presets:'预设「' + preset.value + '」',api:'所选连接' })[k]).join('、')), button('打开窗口', () => onOpen(target))); }
                catch(e) { line.append(element('p', '', (tabs.find(t => t.id === target)?.name || target) + '：' + e.message)); }
            }
            status.textContent = categories.presets.checked && save.checked ? '处理完成，共用预设文件也已更新。' : '处理完成。';
        } catch(e) { status.textContent = e.message; }
        finally { busy = false; for (const control of node.querySelectorAll('input,select')) control.disabled = false; renderTargets(); controls(); }
    }
    return { node, async show(windows, target) { tabs = windows; source.replaceChildren(new Option('主窗口', 'main'), ...tabs.filter(t => !t.archived).map(t => new Option(t.name, t.id))); source.value = currentTab || 'main'; selected.clear(); if (target) selected.add(target); await load(); } };
}
