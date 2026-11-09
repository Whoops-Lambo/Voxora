import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './support/server.mjs';
import {publicSafetyService,safetyClientAddress} from '../public-safety.js';

const report={subject:'@reported_member',category:'harassment',context:'Community general',details:'Repeated targeted harassment in the community over several days.',links:['https://example.com/evidence'],confirm:true,website:''};
async function send(f,path,data,headers={}){const r=await fetch(f.origin+'/api/safety/'+path,{method:data===undefined?'GET':'POST',headers:{...headers,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),headers:r.headers};}
async function submit(f,data=report,headers={}){const form=await send(f,'form',undefined,headers);assert.equal(form.status,200);return send(f,'reports',{...data,formToken:form.data.formToken},headers);}

test('website pages and safety forms work without signing in and isolate anonymous reporter identity and receipt secrets',async()=>{
  const f=await fixture();try{
    const owner=await f.register('safety_owner'),target=await f.register('reported_member'),reporter=await f.register('private_reporter'),staff=await f.register('review_staff');
    for(const page of ['/','/terms','/privacy','/safety']){const r=await fetch(f.origin+page);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/html/);assert.match(await r.text(),/Safety Center/);}
    const headers={Cookie:reporter.cookie,'User-Agent':'Private-reporter-device-marker'},saved=await submit(f,report,headers);assert.equal(saved.status,201,JSON.stringify(saved.data));assert.match(saved.data.reference,/^VSR-[A-F0-9]{12}$/);assert.equal(saved.data.receiptKey.length,43);assert.equal(saved.headers.get('cache-control'),'no-store');
    const O=(p,m,d)=>f.call(owner,p,m,d),queue=await O('/platform/reports?source=safety');assert.equal(queue.data.total,1);const c=queue.data.items[0];assert.equal(c.anonymous,true);assert.equal(c.evidence.authorId,target.id);assert.equal(c.reporters[0].name,'Anonymous reporter');assert.ok(!JSON.stringify(c).includes(reporter.id));assert.ok(!Object.hasOwn(c,'receiptHash'));assert.ok(!JSON.stringify(c).includes(saved.data.receiptKey));
    const stored=JSON.parse(await readFile(f.dir+'/state.json','utf8')).safetyReports[0],serialized=JSON.stringify(stored);for(const secret of [reporter.id,reporter.cookie,'private_reporter','Private-reporter-device-marker',saved.data.receiptKey,headers.Cookie])assert.ok(!serialized.includes(secret));assert.equal(stored.receiptHash.length,64);
    assert.equal((await f.call(reporter,'/platform/reports')).status,403);assert.equal((await f.call(null,'/platform/reports')).status,401);assert.equal((await O('/platform/reports?source=server')).data.total,0);
    let receipt=await send(f,'receipt',{reference:saved.data.reference,receiptKey:saved.data.receiptKey});assert.equal(receipt.status,200);assert.deepEqual(Object.keys(receipt.data).sort(),['createdAt','reference','status','updatedAt']);assert.equal(receipt.data.status,'open');
    assert.equal((await send(f,'receipt',{reference:saved.data.reference,receiptKey:'x'.repeat(43)})).status,404);
    const role=(await O('/platform/staff-roles','POST',{name:'Anonymous Report Review',permissions:['reviewReports']})).data;await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]});
    assert.equal((await f.call(staff,'/platform/reports/'+c.id,'PATCH',{version:c.version,claim:true})).status,200);const current=(await O('/platform/reports/'+c.id)).data;
    assert.equal((await f.call(staff,'/platform/reports/'+c.id,'PATCH',{version:current.version,status:'resolved',resolution:'Internal review marker stays private'})).status,200);
    receipt=await send(f,'receipt',{reference:saved.data.reference,receiptKey:saved.data.receiptKey});assert.equal(receipt.data.status,'resolved');assert.ok(!JSON.stringify(receipt.data).includes('Internal review marker'));
    await f.stop();await f.start();assert.equal((await send(f,'receipt',{reference:saved.data.reference,receiptKey:saved.data.receiptKey})).data.status,'resolved');
    await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[]});assert.equal((await f.call(staff,'/platform/reports')).status,403);
  }finally{await f.cleanup();}
});
test('report validation, neutral target responses, idempotent retries, form binding and abuse limits are enforced',async()=>{
  const f=await fixture();try{
    const form=(await send(f,'form')).data;
    for(const patch of [{category:'__proto__'},{category:['harassment']},{confirm:false},{details:'short'},{links:['javascript:alert(1)']},{links:['https://name:secret@example.com']},{subject:'x'.repeat(101)},{website:'spam'}])assert.equal((await send(f,'reports',{...report,...patch,formToken:form.formToken})).status,400);
    assert.equal((await send(f,'reports',{...report,formToken:'invalid'})).status,400);
    const [first,retry]=await Promise.all([send(f,'reports',{...report,formToken:form.formToken}),send(f,'reports',{...report,formToken:form.formToken})]);assert.equal(first.status,201);assert.deepEqual(retry.data,first.data);
    assert.equal((await send(f,'reports',{...report,details:report.details+' changed',formToken:form.formToken})).status,409);
    const unknown=await submit(f,{...report,subject:'a_member_that_does_not_exist'});assert.equal(unknown.status,201);assert.deepEqual(Object.keys(first.data).sort(),Object.keys(unknown.data).sort());
    assert.equal((await send(f,'reports',{...report,formToken:form.formToken},{Origin:'https://attacker.example'})).status,403);
    assert.equal((await send(f,'form',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
    for(let i=0;i<3;i++)assert.equal((await submit(f,{...report,subject:'subject_'+i},{'X-Forwarded-For':'198.51.100.'+(i+1)})).status,201);
    const capped=await submit(f,report,{'X-Forwarded-For':'203.0.113.100'});assert.equal(capped.status,429,'untrusted forwarded headers cannot bypass the IP limit');assert.ok(Number(capped.headers.get('retry-after'))>0);
    assert.equal(JSON.parse(await readFile(f.dir+'/state.json','utf8')).safetyReports.length,5);
  }finally{await f.cleanup();}
});
test('trusted proxy parsing, expired forms, closed-report retention and receipt authorization have bounded lifetimes',async()=>{
  assert.equal(safetyClientAddress({socket:{remoteAddress:'10.0.0.1'},headers:{'x-forwarded-for':'203.0.113.2, 198.51.100.4'}},1),'198.51.100.4');
  assert.equal(safetyClientAddress({socket:{remoteAddress:'10.0.0.1'},headers:{'x-forwarded-for':'spoofed'}},1),'10.0.0.1');
  assert.equal(safetyClientAddress({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'203.0.113.2'}},0),'127.0.0.1');
  let time=Date.now(),saves=0;const state={users:[],safetyReports:[]},fail=(status,message,details)=>{throw Object.assign(Error(message),{status,details});};
  const service=publicSafetyService({state,body:async req=>req.data,json:(res,status,data)=>Object.assign(res,{status,data}),fail,save:async()=>{saves++;},notifyStaff:()=>{},trustProxyHops:1,now:()=>time});
  async function call(path,data,ip='198.51.100.4'){const res={setHeader(){}};await service.handlePublic({method:data===undefined?'GET':'POST',headers:{'x-forwarded-for':ip},socket:{remoteAddress:'10.0.0.1'},data},res,new URL('http://local/api/safety/'+path));return res;}
  let form=(await call('form')).data;await assert.rejects(call('reports',{...report,formToken:form.formToken},'198.51.100.5'),{status:400});time+=30*60000+1;await assert.rejects(call('reports',{...report,formToken:form.formToken}),{status:400});
  form=(await call('form')).data;const saved=(await call('reports',{...report,formToken:form.formToken})).data;state.safetyReports[0].status='resolved';state.safetyReports[0].updatedAt=time;time+=90*86400000+1;await service.sweep();assert.equal(state.safetyReports.length,0);await assert.rejects(call('receipt',{reference:saved.reference,receiptKey:saved.receiptKey}),{status:404});assert.ok(saves>=2);
});
