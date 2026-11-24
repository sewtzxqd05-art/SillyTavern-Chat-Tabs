async page => {
    if (!page.url().startsWith('http://127.0.0.1:18122/')) throw Error('Use the isolated fixture.');
    await page.goto('http://127.0.0.1:18122/');
    await page.locator('#chat-tabs-wand-menu').waitFor({state:'attached'});
    await page.locator('#extensionsMenuButton').click(); await page.locator('#chat-tabs-wand-menu').click();
    const dialog=page.locator('#chat-tabs-dialog'),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const report=[];
    for(const size of [{width:1360,height:960},{width:390,height:844}]){
        await page.setViewportSize(size);
        const box=await dialog.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right}));
        if(box.scroll>box.width+1||box.left<0||box.right>size.width+1)throw Error('Overflow '+JSON.stringify(box));
        const ids=await dialog.locator('[data-window-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.windowId));
        if(new Set(ids).size!==ids.length||ids[0]!=='main')throw Error('Window rows duplicated or main misplaced');
        report.push({size,box});await page.screenshot({path:'output/redesign-'+size.width+'.png'});
    }
    await page.getByRole('button',{name:'设置',exact:true}).click();
    for(const label of ['认识多开助手','新建一个窗口','同步设置','处理后台回复']){
        const before=await page.evaluate(async()=>JSON.stringify(await(await fetch('/api/plugins/chat-tabs/tabs/overview?archived=1')).json()));
        let writes=0;const observe=req=>{if(req.method()!=='GET'&&req.url().includes('/api/plugins/chat-tabs/'))writes++;};page.on('request',observe);
        await page.locator('.chat-tabs-guide-row').filter({hasText:label}).getByRole('button').click();
        for(let i=0;i<12&&await page.locator('.chat-tabs-practice').count();i++){
            const next=page.locator('.chat-tabs-tour-bubble').getByRole('button',{name:/^(下一步|完成)$/});
            if(await next.count()){await next.click();continue;}
            const target=page.locator('.chat-tabs-practice .chat-tabs-tour-target');await target.waitFor();
            const kind=await target.evaluate(n=>({tag:n.tagName,type:n.type,id:n.dataset.tour}));
            if(kind.id==='history')await target.locator('[data-history=branch]').click();
            else if(kind.tag==='SELECT')await target.selectOption(kind.id==='character'?'practice.png':'branch');
            else await target.click();
            await page.waitForTimeout(180);
        }
        page.off('request',observe);if(await page.locator('.chat-tabs-practice').count())throw Error('Practice did not finish: '+label);
        if(writes)throw Error('Practice made a production write');
        const after=await page.evaluate(async()=>JSON.stringify(await(await fetch('/api/plugins/chat-tabs/tabs/overview?archived=1')).json()));
        if(before!==after)throw Error('Practice changed saved windows');
    }
    if(errors.length)throw Error(errors.join('\n'));return report;
}
