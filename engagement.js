import {randomUUID,createHash} from 'node:crypto';
import {safeRole} from './onboarding.js';
import {roleRank,channelPermissions} from './public/permissions.js';
const level=xp=>Math.floor(Math.sqrt(xp/100));
const emojiKey=value=>String(value).replace(/<:[^:]+:([\w-]+)>/g,'$1');
export function initializeEngagement(s){s.engagement||={rules:[],leveling:{enabled:false,rewards:[]}};s.engagementMembers||={};s.roleAutomationAssignments||={};s.automaticRoleIds||={};}
function grant(s,userId,roleId,source,on){
 initializeEngagement(s);const roles=s.memberRoles[userId]||=[],assignments=s.roleAutomationAssignments[userId]||={};
 let entry=assignments[roleId];if(!entry){entry={explicit:roles.includes(roleId),sources:[]};assignments[roleId]=entry;}
 if(on&&!entry.sources.includes(source))entry.sources.push(source);if(!on)entry.sources=entry.sources.filter(id=>id!==source);
 s.memberRoles[userId]||=[];
 if(entry.sources.length){if(!s.memberRoles[userId].includes(roleId))s.memberRoles[userId].push(roleId);if(!entry.explicit){s.automaticRoleIds[userId]||=[];if(!s.automaticRoleIds[userId].includes(roleId))s.automaticRoleIds[userId].push(roleId);}}
 else{if(!entry.explicit)s.memberRoles[userId]=s.memberRoles[userId].filter(id=>id!==roleId);delete assignments[roleId];s.automaticRoleIds[userId]=(s.automaticRoleIds[userId]||[]).filter(id=>id!==roleId);}
}
export function sanitizeEngagement(s){
 initializeEngagement(s);const safe=id=>safeRole(s,s.roles.find(r=>r.id===id));let changed=false;
 const invalid=s.engagement.rules.filter(r=>!safe(r.roleId)||!s.channels.some(c=>c.id===r.channelId));
 s.engagement.rules=s.engagement.rules.filter(r=>!invalid.includes(r));s.engagement.leveling.rewards=s.engagement.leveling.rewards.filter(r=>safe(r.roleId));
 for(const [uid,roles] of Object.entries(s.roleAutomationAssignments))for(const [rid,entry] of Object.entries(roles)){
  if(!s.members.includes(uid)||!safe(rid)){if(!entry.explicit)s.memberRoles[uid]=(s.memberRoles[uid]||[]).filter(id=>id!==rid);delete roles[rid];s.automaticRoleIds[uid]=(s.automaticRoleIds[uid]||[]).filter(id=>id!==rid);changed=true;continue;}
  const validSources=new Set([...s.engagement.rules.filter(r=>r.roleId===rid).map(r=>'reaction:'+r.id),...s.engagement.leveling.rewards.filter(r=>r.roleId===rid).map(r=>'level:'+r.level)]);
  for(const source of [...entry.sources])if(!validSources.has(source))grant(s,uid,rid,source,false);
 }
 return changed||!!invalid.length;
}
export function engagementService({state,body,json,fail,save,refresh,management,userById,expressions}){
 const authorize=(s,me)=>management.requirePermission(s,me,'manageEngagement');
 const candidate=(s,me,id)=>{const r=s.roles.find(r=>r.id===id);if(!safeRole(s,r)||me.id!==s.ownerId&&r.position>=roleRank(s,me.id))fail(403,'Choose a safe optional role below your own.');return r;};
 function reaction(me,message,emoji,selected){
  const s=state.servers.find(s=>s.channels.some(c=>c.id===message.channel));if(!s||me.bot)return;initializeEngagement(s);
  for(const rule of s.engagement.rules.filter(r=>r.messageId===message.id&&r.channelId===message.channel&&emojiKey(r.emoji)===emojiKey(emoji))){
   if(!safeRole(s,s.roles.find(r=>r.id===rule.roleId)))continue;
   grant(s,me.id,rule.roleId,'reaction:'+rule.id,selected);management.log(s,me,selected?'Reaction role granted':'Reaction role removed',rule.roleId);
  }
 }
 function message(me,message){
  const s=state.servers.find(s=>s.channels.some(c=>c.id===message.channel));if(!s||me.bot)return;initializeEngagement(s);if(!s.engagement.leveling.enabled||message.text.length<5)return;
  const member=s.engagementMembers[me.id]||={xp:0,lastAwardAt:0,lastText:null},digest=createHash('sha256').update(message.text.trim().toLowerCase()).digest('hex');
  if(Date.now()-member.lastAwardAt<60000||member.lastText===digest)return;
  const previous=level(member.xp);member.xp+=20;member.lastAwardAt=Date.now();member.lastText=digest;
  for(const reward of s.engagement.leveling.rewards)if(level(member.xp)>=reward.level&&safeRole(s,s.roles.find(r=>r.id===reward.roleId)))grant(s,me.id,reward.roleId,'level:'+reward.level,true);
  if(level(member.xp)>previous)management.log(s,{id:null,displayName:'Voxora Leveling'},'Member leveled up',me.id+' · Level '+level(member.xp));
 }
 async function handle(req,res,url,me){
  const m=url.pathname.match(/^\/api\/servers\/([\w-]+)\/engagement(?:\/(rules|leveling|leaderboard)(?:\/([\w-]+))?)?$/);if(!m)return false;
  const d=['POST','PUT','PATCH'].includes(req.method)?await body(req):{},s=state.servers.find(s=>s.id===m[1]&&s.members.includes(me.id));if(!s)fail(404,'Server not found.');initializeEngagement(s);
  if(m[2]==='leaderboard'&&req.method==='GET'){json(res,200,{items:s.members.map(id=>({id,name:userById(id)?.displayName||'Member',xp:s.engagementMembers[id]?.xp||0,level:level(s.engagementMembers[id]?.xp||0)})).sort((a,b)=>b.xp-a.xp).slice(0,100)});return true;}
  authorize(s,me);
  if(req.method==='GET'){json(res,200,{...s.engagement,candidates:s.roles.filter(r=>safeRole(s,r)&&(me.id===s.ownerId||r.position<roleRank(s,me.id))).map(r=>({id:r.id,name:r.name}))});return true;}
  if(m[2]==='rules'&&req.method==='POST'&&!m[3]){
   const message=state.messages.find(m=>m.id===d.messageId&&s.channels.some(c=>c.id===m.channel));if(!message||!channelPermissions(s,me.id,message.channel).includes('viewChannel'))fail(404,'Choose a message in a channel you can view.');candidate(s,me,d.roleId);
   const emoji=expressions.validateReaction(d.emoji,message.channel,me);if(s.engagement.rules.length>=50)fail(400,'Use up to 50 reaction-role mappings.');
   if(s.engagement.rules.some(r=>r.messageId===message.id&&r.channelId===message.channel&&emojiKey(r.emoji)===emojiKey(emoji)))fail(409,'This reaction already has a role mapping.');
   s.engagement.rules.push({id:randomUUID(),messageId:message.id,channelId:message.channel,emoji,roleId:d.roleId,createdBy:me.id});management.log(s,me,'Reaction role configured',d.roleId);
  }else if(m[2]==='rules'&&req.method==='DELETE'){const rule=s.engagement.rules.find(r=>r.id===m[3]);if(!rule)fail(404,'Mapping not found.');s.engagement.rules=s.engagement.rules.filter(r=>r!==rule);for(const uid of s.members)grant(s,uid,rule.roleId,'reaction:'+rule.id,false);management.log(s,me,'Reaction role removed',rule.roleId);}
  else if(m[2]==='leveling'&&req.method==='PUT'){
   if(typeof d.enabled!=='boolean'||!Array.isArray(d.rewards)||d.rewards.length>20||new Set(d.rewards.map(r=>r.level)).size!==d.rewards.length)fail(400,'Choose up to 20 distinct level rewards.');
   for(const r of d.rewards){if(!Number.isSafeInteger(r.level)||r.level<1||r.level>100)fail(400,'Reward levels range from 1 to 100.');candidate(s,me,r.roleId);}
   s.engagement.leveling={enabled:d.enabled,rewards:d.rewards.map(({level,roleId})=>({level,roleId}))};management.log(s,me,'Leveling settings changed',s.name);
  }else fail(405,'Method not allowed.');
  sanitizeEngagement(s);await management.commit(s);json(res,200,s.engagement);return true;
 }
 return {handle,reaction,message};
}
