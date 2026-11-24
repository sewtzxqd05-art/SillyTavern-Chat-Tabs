import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskStore } from '../server/chat-tabs/task-store.mjs';
test('200 processed tasks are indexed without reading bodies on subsequent overview; expiry retains request IDs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'chat-tabs-store-')); let reads = [], now = 1000000000;
    const store = createTaskStore({ readJson(file) { reads.push(path.basename(file)); return JSON.parse(fs.readFileSync(file)); }, writeJson(file,value) { fs.writeFileSync(file,JSON.stringify(value)); }, now:()=>now });
    try {
        for (let i=0;i<200;i++) store.write(root,{id:crypto.randomUUID(),status:'succeeded',created:now,applied:true,result:{content:'large reply'},baseline:'old'});
        reads=[]; const items=store.list(root); assert.equal(items.length,200); assert.deepEqual(reads,['index.json']); assert.equal(items.some(t=>t.result || t.baseline),false);
        const id=items[0].id; now+=8*86400000; store.list(root); assert.equal(fs.existsSync(path.join(root,'tasks',id+'.json')),false); assert.equal(store.read(root,id).applied,true);
    } finally { fs.rmSync(root,{recursive:true}); }
});
