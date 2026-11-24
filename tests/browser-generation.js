async page => {
    if (!page.url().startsWith('http://127.0.0.1:18122/')) throw Error('Use the isolated review fixture.');
    const tabs = await page.evaluate(async () => (await fetch('/api/plugins/chat-tabs/tabs')).json());
    const target = tabs.sort((a, b) => b.created - a.created).find(tab => tab.name === '夜航 · 主线');
    const host = 'http://127.0.0.1:18122';
    await page.goto(host + '/api/plugins/chat-tabs/tab/' + target.id);
    await page.setViewportSize({ width: 1360, height: 960 });
    await page.locator('#chat-tabs-wand-menu').waitFor({ state: 'attached' });
    await page.waitForFunction(() => window.SillyTavern.getContext().chat.length > 0);
    await page.locator('#extensionsMenuButton').click();
    await page.locator('#chat-tabs-wand-menu').click();
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('switch',{name:'关掉页面也继续生成',exact:true}).check();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.locator('#sys-settings-button .drawer-toggle').click();
    await page.locator('#api_button_openai').click();
    await page.waitForFunction(() => !document.querySelector('#API-status-top').classList.contains('fa-plug-circle-exclamation'));
    await page.locator('#sys-settings-button .drawer-toggle').click();
    const countBefore = await page.locator('#chat .mes').count();
    const requests = [];
    page.on('request', request => { if (request.url().endsWith('/tasks') && request.method() === 'POST') requests.push(request.url()); });
    await page.locator('#send_textarea').fill('NATIVE_BROWSER_REVIEW：我回来了，继续刚才的故事。');
    await page.locator('#send_but').click();
    await page.waitForFunction(() => document.title.startsWith('● 出字中'));
    await page.screenshot({ path: 'outputs/generating-desktop.png' });
    const other = await page.context().newPage();
    await other.goto(host + '/');
    await page.waitForFunction(() => document.title.startsWith('✓ 新回复'));
    await other.close(); await page.bringToFront();
    const result = await page.evaluate(async () => {
        const c = SillyTavern.getContext();
        const tasks = await (await fetch(location.pathname + '/tasks', { headers: { ...c.getRequestHeaders(), 'X-Chat-Tabs-Client': window.STChatTabs.clientId } })).json();
        return { messages: c.chat.filter(message => message.mes?.includes('review-model')), tasks, title: document.title };
    });
    await page.waitForFunction(async () => {
        const c = SillyTavern.getContext();
        const tasks = await (await fetch(location.pathname + '/tasks', { headers: { ...c.getRequestHeaders(), 'X-Chat-Tabs-Client': STChatTabs.clientId } })).json();
        return tasks[0]?.applied === true;
    });
    if (requests.length !== 1) throw Error('Native generation must submit exactly one background task: ' + requests.length);
    if ((await page.locator('#chat .mes').count()) !== countBefore + 2) throw Error('Native conversation should add one user and one assistant message.');
    if (!result.messages.at(-1)?.extra?.chat_tabs_task) throw Error('Native reply was not marked for duplicate recovery protection.');
    await page.screenshot({ path: 'outputs/completed-desktop.png' });
    if ((await page.title()).startsWith('✓ 新回复')) throw Error('Visible page must clear the ordinary unread marker.');
    return { nativeBackgroundRequests: requests.length, messageDelta: 2, title: await page.title(), applied: true };
}
