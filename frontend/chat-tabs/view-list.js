import { element, button, api as requestApi } from './api.js';
import { stateText, elapsedText } from './monitor-state.js';
export function createWindowList({ currentId, navigation, sync, refresh, report, taskController, available, api = requestApi }) {
    const node = element('section', 'chat-tabs-window-list'), active = element('div'), archive = element('details');
    archive.append(element('summary')); const archived = element('div'); archive.append(archived); node.append(active, archive);
    const rows = new Map(); let tabs = [], states = [];
    const ago = time => { const min = Math.max(0, Math.floor((Date.now() - time) / 60000)); return min < 1 ? '刚刚' : min < 60 ? min + ' 分钟前' : min < 1440 ? Math.floor(min / 60) + ' 小时前' : Math.floor(min / 1440) + ' 天前'; };
    async function act(action) { try { await action(); await refresh(); } catch(e) { report(e.message); } }
    function render() {
        const values = [{ id:'main', name:'主窗口', open: states.find(s => s.id === 'main')?.open }, ...tabs];
        const rank = tab => tab.id === 'main' ? -1 : tab.tasks?.some(t => t.status === 'succeeded') || states.find(s => s.id === tab.id)?.unread ? 0 : states.find(s => s.id === tab.id)?.phase === 'running' ? 1 : tab.open ? 2 : 3;
        values.sort((a,b) => rank(a) - rank(b) || (b.lastOpened || b.created || 0) - (a.lastOpened || a.created || 0));
        const ids = new Set(values.map(t => t.id));
        for (const [id,row] of rows) if (!ids.has(id)) { row.node.remove(); rows.delete(id); }
        for (const tab of values) {
            let row = rows.get(tab.id);
            if (!row) {
                const root = element('section', 'chat-tabs-window-row'); root.dataset.windowId = tab.id; root.dataset.tour = tab.id === 'main' ? 'main-window' : 'window';
                const dot = element('span','chat-tabs-dot'), info = element('div','chat-tabs-window-info'), title = element('div','chat-tabs-window-title'), name = element('span','chat-tabs-name'), badge = element('span','chat-tabs-badge'), state = element('div','chat-tabs-window-state');
                title.append(name, badge); info.append(title,state);
                const primary = button('打开', () => { const latest = rows.get(tab.id).tab; if (latest.archived) void act(() => api('/tabs/' + tab.id,'PATCH',{ archived:false })); else navigation.open(tab.id,'',latest.open); });
                const menu = element('details','chat-tabs-row-menu'); const summary = element('summary','','⋯'); summary.setAttribute('aria-label','更多操作'); menu.append(summary);
                const actions = element('div','chat-tabs-menu-actions'); menu.append(actions);
                const inline = element('div','chat-tabs-inline'); inline.hidden = true;
                root.append(dot,info,primary,menu,inline); row = { node:root,dot,name,badge,state,primary,menu,actions,inline,tab, taskSignature:'' }; rows.set(tab.id,row);
                const close = button('关闭页面 · 内容保留', () => {
                    const st = states.find(s => s.id === tab.id);
                    if (st?.phase === 'running' && !st.background) confirm(row,'正在出字，现在关闭会停止这次普通回复。','仍然关闭',() => navigation.close(tab.id,true));
                    else void act(() => navigation.close(tab.id));
                }); row.close = close; actions.append(close);
                if (tab.id !== 'main') actions.append(button('改名', () => {
                    menu.open = false; const input = element('input','text_pole'); input.value = row.tab.name; input.maxLength = 60; name.replaceChildren(input); input.focus(); input.select(); row.editing = true;
                    input.onkeydown = e => { if (e.key === 'Escape') { row.editing = false; render(); } if (e.key === 'Enter') { e.preventDefault(); void act(async () => { await api('/tabs/' + tab.id,'PATCH',{ name:input.value }); row.editing = false; }); } };
                }));
                actions.append(button('复制链接', () => void navigation.copy(tab.id).then(() => report('链接已复制。')).catch(e => report(e.message))));
                if (tab.id !== 'main') {
                    const syncButton = button('把设置同步到这个窗口…', () => { menu.open = false; sync(tab.id); }); syncButton.dataset.tour = 'sync-link'; row.sync = syncButton; actions.append(syncButton);
                    const remove = button('归档', () => { menu.open = false; const latest = row.tab;
                        if (latest.archived) confirm(row,'永久删除「' + latest.name + '」？聊天、设置和密钥副本都会删除，不能恢复。','永久删除',() => api('/tabs/' + tab.id + '/delete','POST',{ confirmation:'delete-archived' }));
                        else if (latest.open) confirm(row,'先关闭「' + latest.name + '」，再归档。','关闭并归档',async () => { await navigation.close(tab.id); await api('/tabs/' + tab.id,'DELETE'); });
                        else void act(() => api('/tabs/' + tab.id,'DELETE'));
                    },'chat-tabs-danger'); row.remove = remove; actions.append(remove);
                } else actions.append(element('small','','主窗口不能改名、归档或删除。'));
                const tasks = element('div','chat-tabs-row-tasks'); root.append(tasks); row.tasks = tasks;
            }
            row.tab = tab; const state = states.find(s => s.id === tab.id); const current = tab.id === currentId;
            row.node.classList.toggle('chat-tabs-main-row',tab.id === 'main'); row.dot.className = tab.id === 'main' ? 'fa-solid fa-house' : 'chat-tabs-dot'; row.dot.dataset.state = state?.stale ? 'stale' : state?.phase || 'unknown';
            if (!row.editing && row.name.textContent !== tab.name) row.name.textContent = tab.name;
            row.badge.textContent = [tab.id === 'main' ? '默认' : '', current ? '你在这里' : ''].filter(Boolean).join(' · '); row.badge.hidden = !row.badge.textContent;
            row.state.textContent = tab.id === 'main' && (!state || state.phase === 'idle' || state.phase === 'unknown') ? '酒馆原本的聊天'
                : state?.stale ? '状态待更新'
                : state?.phase === 'running' ? (current ? '本轮 ' : '出字中 ') + elapsedText(state) + (state.speed ? ' · ' + state.speed.toFixed(0) + ' 字/s' : '')
                : state?.phase === 'ready' && (state.unread !== false || state.background) ? stateText(state) + ' · ' + ago(state.ended || Date.now())
                : state?.stale ? '状态待更新' : state?.phase === 'failed' ? '生成失败 · 点开查看'
                : tab.open || current ? '已打开 · 空闲' : tab.imported ? '刚导入 · 还没打开过' : '未打开 · 上次 ' + ago(tab.lastOpened || tab.created || Date.now());
            if (tab.role && tab.role !== tab.name) row.state.textContent += ' · ' + tab.role;
            row.primary.dataset.tour = 'switch'; row.menu.firstChild.dataset.tour = 'more'; row.primary.hidden = current; row.primary.textContent = tab.archived ? '恢复' : tab.open ? '切换' : '打开'; row.primary.disabled = !available() && !tab.open;
            row.close.hidden = !(tab.open || current); if (row.sync) row.sync.disabled = current || !available(); if (row.remove) { row.remove.textContent = tab.archived ? '删除' : '归档'; row.remove.disabled = current || !available(); }
            const tasks = tab.tasks || [], signature = JSON.stringify(tasks);
            if (row.taskSignature !== signature) {
                row.taskSignature = signature; row.tasks.replaceChildren();
                for (const task of tasks) {
                    const section = element('div','chat-tabs-task'); section.dataset.taskId = task.id; section.dataset.tour = 'stash';
                    section.append(element('p','',task.status === 'succeeded' ? '这条回复已在后台生成好，还没写进聊天。' : task.error || '后台生成中'));
                    if (current && taskController) {
                        const operation = (text, action) => { const b = button(text, () => void act(() => taskController.action(task,action))); b.dataset.tour = action; return b; };
                        if (task.status === 'running') section.append(operation('停止','cancel'));
                        else {
                            if (task.status === 'succeeded') { section.append(operation('写进聊天','apply')); section.append(button('先看看', async () => { try { const data = await taskController.get(task.id); const preview = element('textarea','text_pole'); preview.readOnly = true; preview.value = data.result?.choices?.[0]?.message?.content || data.result?.choices?.[0]?.text || ''; preview.dataset.tour = 'preview-text'; section.append(preview); } catch(e) { report(e.message); } })); }
                            section.append(operation('不要了','dismiss'));
                        }
                    } else {
                        section.append(button(task.status === 'succeeded' ? '写进聊天' : '点开查看', () => navigation.open(tab.id,task.id,tab.open)));
                        if (task.status === 'succeeded') section.append(button('不要了', () => { if (tab.open) navigation.open(tab.id,task.id,true); else void act(() => api('/tabs/' + tab.id + '/tasks/' + task.id + '/dismiss','POST',{})); }));
                        if (task.status === 'succeeded') section.append(button('先看看', async event => {
                            try { const data = await api('/tabs/' + tab.id + '/tasks/' + task.id + '/preview'); const preview = element('textarea','text_pole'); preview.readOnly = true; preview.value = data.text; preview.dataset.tour = 'preview-text'; section.append(preview); event.currentTarget.disabled = true; }
                            catch(e) { report(e.message); }
                        }));
                    }
                    for (const b of section.querySelectorAll('button')) if (b.textContent === '先看看') b.dataset.tour = 'preview';
                    const actions = element('div','chat-tabs-task-actions');
                    actions.append(...section.querySelectorAll('button')); section.append(actions);
                    row.tasks.append(section);
                }
            }
            const parent = tab.archived ? archived : active;
            // Move only when order actually changed; keep focused inputs and selections intact.
            const desired = values.filter(v => !!v.archived === !!tab.archived).findIndex(v => v.id === tab.id);
            if (parent.children[desired] !== row.node) parent.insertBefore(row.node,parent.children[desired] || null);
        }
        const count = tabs.filter(t => t.archived).length; archive.hidden = !count; archive.firstChild.textContent = '已归档 ' + count;
    }
    function confirm(row,text,label,action) { row.inline.replaceChildren(element('p','',text),button(label,() => void act(async () => { await action(); row.inline.hidden = true; }),'chat-tabs-danger'),button('取消',() => { row.inline.hidden = true; })); row.inline.hidden = false; }
    return { node, update(value, metrics) { tabs = value; states = metrics; render(); } };
}
