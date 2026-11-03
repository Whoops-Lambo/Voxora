import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/server.mjs';
test('notebooks are account-private, searchable, pinned, versioned and durable, including against platform owners',async()=>{
 const f=await fixture();try{const a=await f.register('notes_owner'),b=await f.register('notes_member'),A=(p,m,d)=>f.call(a,p,m,d),B=(p,m,d)=>f.call(b,p,m,d);let n=(await B('/me/notes','POST',{title:'Private launch idea',content:'- [ ] Draft a community plan',color:'iris'})).data;assert.ok(n.id);assert.equal((await A('/me/notes/'+n.id)).status,404);assert.equal((await A('/me/notes/'+n.id,'PATCH',{revision:0,title:'Not allowed'})).status,404);assert.ok(!JSON.stringify((await A('/state')).data).includes('Private launch idea'));
 assert.equal((await B('/me/notes?q=community')).data.total,1);n=(await B('/me/notes/'+n.id,'PATCH',{revision:0,pinned:true,content:'- [x] Draft a community plan'})).data;assert.equal(n.pinned,true);assert.equal((await B('/me/notes/'+n.id,'PATCH',{revision:0,title:'Stale'})).status,409);
 await f.stop();await f.start();assert.equal((await B('/me/notes/'+n.id)).data.content,'- [x] Draft a community plan');assert.equal((await B('/me/notes/'+n.id+'?revision=0','DELETE')).status,409);assert.equal((await B('/me/notes/'+n.id+'?revision=1','DELETE')).status,200);assert.equal((await B('/me/notes')).data.total,0);
 }finally{await f.cleanup();}
});
test('notebook rejects malformed edits without corrupting saved text',async()=>{
 const f=await fixture();try{const a=await f.register('notes_validation'),A=(p,m,d)=>f.call(a,p,m,d);const n=(await A('/me/notes','POST',{title:'Safe note',content:'Keep this text'})).data;for(const d of[{title:''},{content:'x'.repeat(12001)},{color:'red'},{pinned:'yes'},{ownerId:'someone'}])assert.equal((await A('/me/notes/'+n.id,'PATCH',{revision:0,...d})).status,400);assert.equal((await A('/me/notes/'+n.id)).data.content,'Keep this text');
 }finally{await f.cleanup();}
});
