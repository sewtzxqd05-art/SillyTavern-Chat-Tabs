import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('server/chat-tabs/sync.mjs','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const box={randomBytes:()=>'',structuredClone}; vm.runInNewContext(source+'\nthis.mergeSelection=mergeSelection;',box);
test('selected connections merge only referenced keys and preserve target activation, unique connections and persona',()=>{
 const from={oai_settings:{preset_settings_openai:'A',temp_openai:.5,custom_model:'new'},extension_settings:{apiHub:{activeConnectionId:'a',connections:[{id:'a',name:'A',model:'new',secretId:'k1'},{id:'b',name:'B',secretId:'k2'}]}}};
 const to={power_user:{persona_description:'keep'},oai_settings:{preset_settings_openai:'B',temp_openai:.9,custom_model:'old'},extension_settings:{apiHub:{activeConnectionId:'own',connections:[{id:'own',name:'Own'}]}}};
 const result=box.mergeSelection(from,to,{api_key_custom:[{id:'k1',value:'fixture1',active:true},{id:'k2',value:'fixture2'}]}, {api_key_custom:[{id:'ownkey',value:'keep',active:true}]}, ['api'],{connections:['hub:a'],useActiveConnection:false});
 assert.equal(result.settings.extension_settings.apiHub.activeConnectionId,'own'); assert.equal(result.settings.extension_settings.apiHub.connections.length,2);
 assert.equal(result.settings.oai_settings.custom_model,'old'); assert.equal(result.settings.power_user.persona_description,'keep');
 assert.deepEqual(result.secrets.api_key_custom.map(k=>k.id),['ownkey','k1']); assert.equal(result.secrets.api_key_custom[0].active,true); assert.equal(result.secrets.api_key_custom[1].active,false);
});
test('single preset copies only OpenAI working settings without changing other preset families or APIs',()=>{
 const from={oai_settings:{preset_settings_openai:'A',temp_openai:.5,custom_model:'new'},textgenerationwebui_settings:{temp:.1}};
 const to={oai_settings:{preset_settings_openai:'B',temp_openai:.9,custom_model:'keep'},textgenerationwebui_settings:{temp:.8}};
 const result=box.mergeSelection(from,to,{}, {}, ['presets'],{preset:'A'}).settings;
 assert.equal(result.oai_settings.temp_openai,.5);assert.equal(result.oai_settings.custom_model,'keep');assert.equal(result.textgenerationwebui_settings.temp,.8);
 const pending=box.mergeSelection(from,to,{}, {}, ['presets'],{preset:'C'}).settings;
 assert.equal(pending.oai_settings.preset_settings_openai,'C');assert.equal(pending.oai_settings.temp_openai,.9);
});
