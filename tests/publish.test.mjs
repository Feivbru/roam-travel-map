import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import config from '../config.mjs';
test('公开站点从空白行程开始，配置只能使用公开Key',async()=>{
 assert.deepEqual(JSON.parse(await fs.readFile(new URL('../seed.json',import.meta.url),'utf8')),{schemaVersion:1,trips:[]});
 const ignored=await fs.readFile(new URL('../.gitignore',import.meta.url),'utf8');for(const value of ['.env','*.private.json','.local-data/','supabase/.temp/'])assert.ok(ignored.includes(value));
 assert.ok(!config.supabasePublishableKey.startsWith('sb_secret_'));
 if(config.supabasePublishableKey.startsWith('eyJ'))assert.equal(JSON.parse(Buffer.from(config.supabasePublishableKey.split('.')[1],'base64url')).role,'anon');
});
