import { test, expect } from '@playwright/test';
import { fixture } from '../support/server.mjs';

async function register(page,name){await page.goto('/app');await page.getByRole('button',{name:'Register',exact:true}).click();await page.getByLabel('DISPLAY NAME').fill(name);await page.getByLabel('USERNAME').fill(name);await page.getByLabel('PASSWORD').fill('Sounds-fixture-password-552');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.locator('#message-input')).toBeVisible();}
async function recordAudio(context){await context.addInitScript(()=>{
  window.soundEvents=[];
  window.AudioContext=class{
    currentTime=0;destination={};
    async resume(){}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
    createOscillator(){const frequencies=[];return {frequency:{setValueAtTime(value){frequencies.push(value);}},connect(gain){return gain;},start(){window.soundEvents.push(frequencies);},stop(){}};}
  };
});}

for(const blocked of [false,true])test(`DM and every supported mention play sound with ${blocked?'HTTP fallback':'live events'}, without replaying old alerts`,async({browser})=>{
  const f=await fixture(),a=await browser.newContext({baseURL:f.origin}),b=await browser.newContext({baseURL:f.origin});await recordAudio(b);
  if(blocked)await b.route('**/api/events?*',route=>route.abort());
  const owner=await a.newPage(),member=await b.newPage();
  try{
    await register(owner,'sound_owner');await register(member,'sound_member');
    const id=(await(await member.request.get('/api/state')).json()).me.id;
    const role=await(await owner.request.post('/api/servers/community/roles',{data:{name:'Ping Crew',mentionable:true}})).json();
    await owner.request.patch('/api/servers/community/members/'+id,{data:{roles:[role.id]}});
    await member.locator('.app-home').click();
    await expect.poll(async()=>{const s=await(await owner.request.get('/api/state')).json();return s.users.find(u=>u.id===id)?.status;}).toBe('online');
    let expected=0;
    for(const text of ['Personal @sound_member','All @everyone','Online @here','Role @{Ping Crew}']){
      await new Promise(resolve=>setTimeout(resolve,400));
      expect((await owner.request.post('/api/messages',{data:{channel:'general',text}})).status()).toBe(201);
      await expect.poll(()=>member.evaluate(()=>window.soundEvents.length),{timeout:12000}).toBe(++expected);
    }
    const dm=await(await owner.request.post('/api/conversations',{data:{userId:id}})).json();
    await new Promise(resolve=>setTimeout(resolve,400));
    await owner.request.post('/api/messages',{data:{channel:dm.id,text:'First direct message should ping'}});
    await expect.poll(()=>member.evaluate(()=>window.soundEvents.length),{timeout:12000}).toBe(++expected);
    expect(await member.evaluate(()=>window.soundEvents.at(-1))).toEqual([660,990]);
    await member.getByRole('button',{name:'User Settings',exact:true}).click();await member.getByRole('button',{name:'Notifications',exact:true}).click();
    await expect(member.getByRole('checkbox',{name:'Message sounds',exact:true})).toBeChecked();
    await member.getByRole('checkbox',{name:'Message sounds',exact:true}).uncheck();await member.getByRole('button',{name:'Close',exact:true}).click();
    await owner.request.post('/api/messages',{data:{channel:dm.id,text:'Silent after opting out'}});
    await expect.poll(async()=>{const s=await(await member.request.get('/api/state')).json();return s.activity.channels[dm.id]?.unread;}).toBe(2);
    await new Promise(resolve=>setTimeout(resolve,5500));
    expect(await member.evaluate(()=>window.soundEvents.length)).toBe(expected);
    await member.reload();await expect(member.locator('#shell')).toBeVisible();
    await member.getByRole('button',{name:'User Settings',exact:true}).click();await member.getByRole('button',{name:'Notifications',exact:true}).click();await expect(member.getByRole('checkbox',{name:'Message sounds',exact:true})).not.toBeChecked();
    expect(await member.evaluate(()=>window.soundEvents.length)).toBe(0);
  }finally{await a.close();await b.close();await f.cleanup();}
});
