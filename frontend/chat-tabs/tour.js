import { element, button } from './api.js';
import { createWindowList } from './view-list.js';
import { createWindowForm } from './view-create.js';
import { createSyncPanel } from './sync.js';
export const tours = {
 basics:{name:'认识多开助手',steps:[['wand','点多开助手，打开窗口列表。',true],['main-window','主窗口是酒馆原本的聊天。'],['window','这里显示其他窗口的新回复。'],['switch','点切换，回到有新回复的窗口。',true],['pill','点小提示，查看正在回复的窗口。',true],['settings','点设置，找到新手引导。',true],['done','以后可以在设置里重新练习。']]},
 create:{name:'新建一个窗口',steps:[['new','点新窗口。',true],['character','选一个角色。',true],['history','选择聊天起点。',true],['copy','设置会从来源窗口复制，之后各改各的。'],['create','点创建并打开。',true],['done','新窗口已建好，原窗口聊天仍保留。']]},
 sync:{name:'同步设置',steps:[['more','点窗口的更多操作。',true],['sync-link','点同步设置。',true],['sync-target','勾选要同步到的窗口。',true],['sync-presets','勾选预设。',true],['sync-preset-choice','这里只同步你选的一个预设。'],['sync-submit','点同步设置。',true],['sync-result','所选预设已同步，目标聊天和人设保留。']]},
 tasks:{name:'处理后台回复',steps:[['stash','这里有一条后台回复待处理。'],['preview','点先看看。',true],['preview-text','先读回复，再决定是否写进聊天。'],['apply','点写进聊天，接回这条回复。',true],['done','回复已写进聊天，不再标记待处理。']]},
};
export function createTour({host,onExit}) {
 let session=null,scene,bubble,overlay,focusBefore,originalHidden=[];
 const progress=()=>{try{return JSON.parse(localStorage.getItem('chat-tabs-guide')||'{}');}catch{return {};}};
 const tag=(node,id)=>{node.dataset.tour=id;return node;};
 async function render() {
  if(!session)return;
  session.controller?.abort(); session.controller = new AbortController();
  const {key,index}=session,step=tours[key].steps[index]; scene.replaceChildren();
  const header=element('div','chat-tabs-actions');scene.append(header);
  const fixtureTabs=[{id:'practice-a',name:'小满',open:true,created:Date.now(),tasks:[]},{id:'practice-b',name:'林雾',open:false,preset:'日常聊天',created:Date.now(),tasks:[]}];
  const state=[{id:'main',current:true,phase:'idle',open:true},{id:'practice-a',name:'小满',phase:'ready',unread:true,ended:Date.now(),open:true}];
  const openList=()=>{
   const view=createWindowList({currentId:'main',navigation:{open(){next();},copy:async()=>{},close:async()=>{}},sync:()=>next(),refresh:async()=>{},report:()=>{},available:()=>true,api:async()=>({})});
   view.update(fixtureTabs,state);scene.append(view.node);
   if(key==='sync'){view.node.querySelector('[data-window-id="practice-a"]').remove();view.node.querySelector('[data-window-id="main"]').remove();if(index===1)view.node.querySelector('details').open=true;}
  };
  if(key==='basics'){
   if(index===0)header.append(tag(button('多开助手',next),'wand'));else openList();
   if(index>=4)header.append(tag(button('1 新回复 · 1 出字中',next),'pill'));
   if(index>=5)header.append(tag(button('设置',next),'settings'));
   if(index===6)scene.append(tag(element('p','','设置 → 新手引导 → 开始 / 重走'),'done'));
  }
  if(key==='create'){
   header.append(tag(button('＋ 新窗口',next),'new'));
   if(index>=1&&index<5){const form=createWindowForm({getCharacters:()=>[{name:'小满',avatar:'practice.png'}],getSourceName:()=> '主窗口',create:async()=>next()});form.populate(index>=2?'practice.png':'');scene.append(form.node);}
   if(index===5)scene.append(tag(element('p','','练习 · 已创建窗口「小满」'),'done'));
  }
  if(key==='sync'){
   if(index<2)openList();else {
    const api=async(path,method,data)=>{if(path.includes('catalog'))return {preset:'日常聊天',presets:['日常聊天','长篇故事'],connections:[]};if(path.endsWith('/plan'))return {revision:'practice'};return {synced:data?.categories||[]};};
    const panel=createSyncPanel({api,saveSettings:async()=>{},practice:true,onOpen:()=>{},closeWindow:async()=>{},report:()=>{}});scene.append(panel.node);await panel.show(fixtureTabs,index>=3?'practice-b':undefined);
    if(index>=4){const check=panel.node.querySelector('[data-tour="sync-presets"]');check.checked=true;check.dispatchEvent(new Event('change'));}
    if(index===6){const result=panel.node.querySelector('[data-tour="sync-result"]');result.textContent='练习 · 林雾：已更新预设「日常聊天」';}
   }
  }
  if(key==='tasks'){
   const task={id:'practice-task',status:'succeeded',created:Date.now(),completed:Date.now(),target:{name:'小满'}};
   const view=createWindowList({currentId:'practice-a',navigation:{},sync:()=>{},refresh:async()=>{},report:()=>{},available:()=>true,api:async()=>({}),taskController:{get:async()=>({result:{choices:[{message:{content:'练习 · 今晚的风很轻，我们沿河慢慢走吧。'}}]}}),action:async()=>next()}});
   view.update([{...fixtureTabs[0],tasks:index===4?[]:[task]}],[{id:'practice-a',current:true,phase:'ready',background:true}]);scene.append(view.node);
   if(index===2){const preview=tag(element('textarea','text_pole'),'preview-text');preview.readOnly=true;preview.value='练习 · 今晚的风很轻，我们沿河慢慢走吧。';scene.append(preview);}
   if(index===4)scene.append(tag(element('p','','练习 · 回复已写进聊天'),'done'));
  }
  const target=[...scene.querySelectorAll('[data-tour="'+step[0]+'"]')].find(n => !n.hidden && !n.disabled && n.getClientRects().length);
  if(!target){const checkpoint=session;setTimeout(()=>{if(session===checkpoint&&session.index===index)next();},1000);return;}
  target.classList.add('chat-tabs-tour-target');
  for(const control of scene.querySelectorAll('button,input,select,textarea,summary')) if(control!==target&&!target.contains(control)){control.setAttribute('tabindex','-1');if('disabled' in control)control.disabled=true;}
  bubble.replaceChildren(element('small','',tours[key].name+' · '+(index+1)+' / '+tours[key].steps.length),element('p','',step[1]));
  const actions=element('div','chat-tabs-actions');if(index)actions.append(button('上一步',()=>{session.index--;void render();}));
  if(!step[2])actions.append(button(index===tours[key].steps.length-1?'完成':'下一步',next));else bubble.append(element('small','','点亮起来的地方继续'));
  actions.append(button('跳过',()=>exit()));bubble.append(actions);target.scrollIntoView({block:'nearest'});
  scene.onclick=null;
  scene.addEventListener('click', e=>{if(!step[2]||!target.contains(e.target)&&target!==e.target){e.preventDefault();e.stopImmediatePropagation();}}, {capture:true, signal:session.controller.signal});
  for(const type of ['click','change'])target.addEventListener(type,()=>{
   if(!step[2])return;
   if(['more','preview'].includes(step[0])&&type==='click'){const checkpoint=session;setTimeout(()=>{if(session===checkpoint&&session.index===index)next();},100);}
   if(['character','history','sync-target','sync-presets'].includes(step[0])&&type==='change'){const checkpoint=session;setTimeout(()=>{if(session===checkpoint&&session.index===index)next();},0);}
   if(step[0]==='sync-submit'&&type==='click'){const checkpoint=session;const wait=setInterval(()=>{if(session!==checkpoint){clearInterval(wait);return;}if(scene.querySelector('.chat-tabs-sync-result button')){clearInterval(wait);next();}},50);}
  });
 }
 function next(){if(!session)return;if(session.index===tours[session.key].steps.length-1)exit(true);else{session.index++;void render();}}
 function exit(done=false){if(!session)return;if(done){const p=progress();p[session.key]=true;localStorage.setItem('chat-tabs-guide',JSON.stringify(p));}session.controller?.abort();session=null;overlay.remove();host.hidden=false;for(const [node,hidden]of originalHidden)node.hidden=hidden;onExit?.();focusBefore?.focus();}
 document.addEventListener('keydown',e=>{if(!session)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();exit();}if(e.target.matches('input,textarea,select'))return;if(e.key==='ArrowRight'&&!tours[session.key].steps[session.index][2])next();if(e.key==='ArrowLeft'&&session.index){session.index--;void render();}},true);
 return {start(key){if(session)exit();focusBefore=document.activeElement;host.hidden=true;originalHidden=[...host.parentNode.children].filter(n=>n!==host).map(n=>[n,n.hidden]);for(const [n]of originalHidden)n.hidden=true;overlay=element('section','chat-tabs-practice');overlay.append(element('p','chat-tabs-practice-bar','练习中 · 不会改动你的数据'),button('退出练习',()=>exit()));scene=element('div','chat-tabs-practice-scene');bubble=element('section','chat-tabs-tour-bubble');overlay.append(scene,bubble);host.parentNode.append(overlay);session={key,index:0};void render();},exit,progress,get active(){return !!session;}};
}
