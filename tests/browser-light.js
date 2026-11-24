async page => {
 if(!page.url().startsWith('http://127.0.0.1:18122/'))throw Error('Fixture only');
 await page.locator('#user-settings-button .drawer-toggle').click();await page.locator('#themes').selectOption('浅色验收');await page.locator('#user-settings-button .drawer-toggle').click();
 await page.locator('#extensionsMenuButton').click();await page.locator('#chat-tabs-wand-menu').click();
 const result=[];
 for(const width of [1360,390]){await page.setViewportSize({width,height:width===390?844:960});const box=await page.locator('#chat-tabs-dialog').evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth}));if(box.scroll>box.width)throw Error('Overflow');await page.screenshot({path:'output/redesign-light-'+width+'.png'});result.push(box);}
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.chat-tabs-guide-row').filter({hasText:'新建一个窗口'}).getByRole('button').click();await page.locator('.chat-tabs-practice [data-tour="new"]').click();await page.screenshot({path:'output/redesign-practice-mobile.png'});await page.getByRole('button',{name:'退出练习',exact:true}).click();return result;
}
