import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('frontend/chat-tabs/sound.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
test('only elected page rings; handled completions and disabled self sound are silent',async()=>{
 const storage=new Map(),claimed=new Set();let rings=0,serial=0;
 function make(settings={}){
  const events=new Map();
  class Audio {state='running';currentTime=0;destination={};resume(){return Promise.resolve();}createOscillator(){return {frequency:{},connect(){},start(){rings++;},stop(){}};}createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}};}}
  const box={pageId:()=>String(++serial),claimNotification:id=>{if(claimed.has(id))return false;claimed.add(id);return true;},Date,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{hidden:false,addEventListener:(k,fn)=>events.set(k,fn)},window:{AudioContext:Audio,addEventListener:(k,fn)=>events.set(k,fn)}};
  vm.runInNewContext(source+'\nthis.create=createSound;',box);const sound=box.create({settings});events.get('pointerdown')();return {sound,events};
 }
 const a=make(),b=make();a.sound.play('round');assert.equal(rings,0);b.sound.play('round',{handled:true});assert.equal(rings,0);b.sound.play('self',{self:true});assert.equal(rings,0);b.sound.play('round');assert.equal(rings,1);a.events.get('focus')();a.sound.play('round');assert.equal(rings,1);
});
