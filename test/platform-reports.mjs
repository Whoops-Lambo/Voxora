import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './support/server.mjs';
test('platform reports show accessible open reports and explicitly shared evidence without private history or staff notes',async()=>{
 const f=await fixture();try{
  const owner=await f.register('report_platform_owner'),author=await f.register('report_author'),reporter=await f.register('report_reporter'),staff=await f.register('report_staff');
  const A=(p,m,d)=>f.call(author,p,m,d),O=(p,m,d)=>f.call(owner,p,m,d),R=(p,m,d)=>f.call(reporter,p,m,d),S=(p,m,d)=>f.call(staff,p,m,d);
  const server=(await A('/servers','POST',{name:'Private reports community'})).data;
  await R('/invites/join','POST',{code:server.invite});
  const first=(await A('/messages','POST',{channel:server.channels[0].id,text:'Evidence kept with server reviewers'})).data;
  const second=(await A('/messages','POST',{channel:server.channels[0].id,text:'Evidence shared with Voxora staff'})).data;
  const report1=(await R('/servers/'+server.id+'/reports','POST',{messageId:first.id,reason:'Spam',details:'Private report'})).data;
  const report2=(await R('/servers/'+server.id+'/reports','POST',{messageId:second.id,reason:'Harassment',details:'Please review',sendToPlatform:true})).data;
  const caseView=(await A('/servers/'+server.id+'/moderation/cases/'+report2.id)).data;
  await A('/servers/'+server.id+'/moderation/cases/'+report2.id,'PATCH',{version:caseView.version,note:'Private internal moderator note'});
  const list=(await O('/platform/reports')).data;assert.equal(list.counts.open,1);assert.equal(list.items[0].id,report2.id);assert.ok(!JSON.stringify(list).includes('Private internal moderator note'));assert.ok(!list.items.some(item=>item.reporters.some(r=>r.details==='Private report')));
  assert.equal((await O('/platform/reports/'+report1.id)).status,404);assert.equal((await R('/platform/reports')).status,403);
  const role=(await O('/platform/staff-roles','POST',{name:'Report Reviewers',color:'#55e6bc',permissions:['reviewReports']})).data;
  await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[role.id]});
  assert.equal((await S('/platform/reports')).data.total,1);
  let item=(await S('/platform/reports/'+report2.id)).data;
  assert.equal((await S('/platform/reports/'+item.id,'PATCH',{version:item.version,claim:true})).status,200);
  assert.equal((await S('/platform/reports/'+item.id,'PATCH',{version:item.version,status:'dismissed',resolution:'Stale update'})).status,409);
  item=(await S('/platform/reports/'+item.id)).data;
  assert.equal((await S('/platform/reports/'+item.id,'PATCH',{version:item.version,status:'resolved',resolution:'Reviewed reported evidence'})).status,200);
  assert.equal((await O('/platform/reports')).data.counts.open,0);
  assert.equal((await O('/platform/reports?status=resolved')).data.items.length,1);
  assert.ok((await O('/platform/audit')).data.items.some(x=>JSON.stringify(x).includes('Report reviewed')));
  await O('/platform/users/'+staff.id,'PATCH',{staffRoleIds:[]});assert.equal((await S('/platform/reports')).status,403);
 }finally{await f.cleanup();}
});
