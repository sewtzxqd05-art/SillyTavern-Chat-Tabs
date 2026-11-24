import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {removeWindowDirectory} from '../server/chat-tabs/remove-window.mjs';
test('deletes complete nested window at a non-ASCII workspace path and preserves its neighbour',()=>{
 const parent=fs.mkdtempSync(path.resolve('work/redesign/删除测试-'));
 const root=path.join(parent,'window'),outside=path.join(parent,'keep.txt');
 fs.mkdirSync(path.join(root,'chats'),{recursive:true});fs.writeFileSync(path.join(root,'chats','故事.jsonl'),'fixture');fs.writeFileSync(outside,'keep');
 removeWindowDirectory(root);assert.equal(fs.existsSync(root),false);assert.equal(fs.readFileSync(outside,'utf8'),'keep');fs.unlinkSync(outside);fs.rmdirSync(parent);
});
