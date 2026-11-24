async page => {
 if(!page.url().startsWith('http://127.0.0.1:18122/api/plugins/chat-tabs/tab/'))throw Error('Use isolated independent page');
 const focus=await page.context().newCDPSession(page);await focus.send('Emulation.setFocusEmulationEnabled',{enabled:false});
 const id=new URL(page.url()).pathname.split('/').pop();
 await page.locator('#extensionsMenuButton').click();await page.locator('#chat-tabs-wand-menu').click();await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('switch',{name:'关掉页面也继续生成',exact:true}).uncheck();await page.getByRole('switch',{name:'显示悬浮提示',exact:true}).check();await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.locator('#sys-settings-button .drawer-toggle').click();await page.locator('#api_button_openai').click();await page.waitForFunction(()=>!document.querySelector('#API-status-top').classList.contains('fa-plug-circle-exclamation'));await page.locator('#sys-settings-button .drawer-toggle').click();
 const observer=await page.context().newPage();await observer.goto('http://127.0.0.1:18122/');const peerFocus=await page.context().newCDPSession(observer);await peerFocus.send('Emulation.setFocusEmulationEnabled',{enabled:false});await observer.locator('#chat-tabs-wand-menu').waitFor({state:'attached'});
 await observer.locator('#extensionsMenuButton').click();await observer.locator('#chat-tabs-wand-menu').click();await observer.getByRole('button',{name:'设置',exact:true}).click();await observer.getByRole('switch',{name:'显示悬浮提示',exact:true}).check();await observer.getByRole('button',{name:'关闭',exact:true}).click();
 await page.bringToFront();await page.locator('#send_textarea').fill('STREAM_UI_REVIEW：慢慢说，我在听。');await page.locator('#send_but').click();
 await page.waitForFunction(()=>document.title.startsWith('● 出字中'));
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 await observer.bringToFront();await observer.locator('#extensionsMenuButton').click();await observer.locator('#chat-tabs-wand-menu').click();
 const row=observer.locator('[data-window-id="'+id+'"]');await row.getByText(/出字中.*字\/s/).waitFor({timeout:15000});
 await observer.setViewportSize({width:390,height:844});await observer.screenshot({path:'output/redesign-stream-mobile.png'});
 await observer.getByRole('button',{name:'关闭',exact:true}).click();await observer.locator('.chat-tabs-monitor-float').waitFor({state:'visible'});
 await observer.locator('.chat-tabs-monitor-float').click();await observer.getByRole('dialog',{name:'窗口状态',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 await observer.locator('#extensionsMenuButton').click();await observer.locator('#chat-tabs-wand-menu').click();await observer.getByRole('button',{name:'设置',exact:true}).click();
 await observer.getByRole('switch',{name:'显示悬浮提示',exact:true}).uncheck();await observer.getByRole('button',{name:'关闭',exact:true}).click();
 if(await observer.locator('.chat-tabs-monitor-float').isVisible())throw Error('Float must be hidden');
 await observer.locator('#extensionsMenuButton').click();await observer.locator('#chat-tabs-wand-menu').click();
 await row.getByText(/新回复/).waitFor({timeout:55000});await observer.screenshot({path:'output/redesign-complete-mobile.png'});
 await page.bringToFront();await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>!document.title.startsWith('✓ 新回复'));
 await observer.bringToFront();await row.getByText(/已打开 · 空闲/).waitFor();await observer.close();
 return {nativeStream:true,peerSpeed:true,floatOffListWorks:true,completionReadCleared:true,visibility:"simulated because automation keeps pages visible"};
}
