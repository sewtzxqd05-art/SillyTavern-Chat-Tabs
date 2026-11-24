import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VERSION } from '../server/chat-tabs/version.mjs';
test('frontend, companion and installer versions match package version', () => {
    const version=JSON.parse(fs.readFileSync('package.json')).version;
    assert.equal(VERSION,version);
    for(const file of ['manifest.json','frontend/chat-tabs/manifest.json']) assert.equal(JSON.parse(fs.readFileSync(file)).version,version);
    for(const file of ['install.ps1','install.sh']) assert.ok(fs.readFileSync(file,'utf8').includes('Chat Tabs '+version));
});
