import {randomInt,randomUUID} from 'node:crypto';
const commands = rows => rows.map(([name,description,usage])=>({name,description,usage}));
export const BOT_TEMPLATES = [
  {id:'economy',name:'Voxora Economy',description:'Server credits, daily rewards, transfers and a collectible shop. Play money only.',commands:commands([
    ['balance','Show your credits.','/balance'],['daily','Claim 250 credits every 24 hours.','/daily'],
    ['pay','Transfer credits to another member.','/pay @username 100'],['leaderboard','Show the ten richest current members.','/leaderboard'],
    ['shop','Browse collectible badges.','/shop'],['buy','Buy a badge with credits.','/buy bronze'],['inventory','Show your badges.','/inventory']])},
  {id:'music',name:'Voxora Music Queue',description:'A shared music-link queue in each channel. Does not stream audio into voice calls.',commands:commands([
    ['play','Queue an HTTPS music link.','/play https://example.com/track | Track title'],['queue','Show the channel queue.','/queue'],
    ['nowplaying','Show the current music link.','/nowplaying'],['skip','Skip your track; DJs can skip any track.','/skip'],
    ['remove','Remove your queued track by ID.','/remove track-id'],['clearqueue','DJs can clear the channel queue.','/clearqueue']])},
  {id:'games',name:'Voxora Games',description:'Dice, coin flips, choices and a magic eight ball. No setup or external service required.',commands:commands([
    ['dice','Roll up to twenty dice.','/dice 2d6'],['coinflip','Flip a coin.','/coinflip'],
    ['choose','Pick one of your options.','/choose Tea | Coffee'],['eightball','Ask a question.','/eightball Will we win?']])},
  {id:'tasks',name:'Voxora Tasks',description:'Personal task lists scoped to the current channel; command replies are visible to channel members.',commands:commands([
    ['todo','Add a task to your channel list.','/todo Prepare the event'],['tasks','Show your tasks in this channel.','/tasks'],
    ['done','Complete one of your tasks by ID.','/done task-id']])},
];
const badges=[{id:'bronze',price:250},{id:'silver',price:1000},{id:'diamond',price:5000}];
// Plan against an isolated copy. The service applies this only with the authorized
// reply, under a per-server command lock, so failures cannot mint or transfer credits.
export function planTemplate({template,data={},server,user,channel,command,args,canDJ=false,now=Date.now(),fail}){
  const next=structuredClone(data);
  const need=(ok,message)=>{if(!ok)fail(400,message);};
  const text=value=>({text:value,next});
  if(template==='economy'){
    next.accounts||={};
    const account=id=>next.accounts[id]||=( {balance:0,lastDaily:0,inventory:[]} );
    const own=account(user.id);
    if(command==='balance')return text('Your balance: **'+own.balance+' credits**.');
    if(command==='daily'){
      need(now-own.lastDaily>=86400000,'Daily reward is available once every 24 hours.');
      own.balance+=250;own.lastDaily=now;return text('Claimed **250 credits**. Balance: '+own.balance+'.');
    }
    if(command==='shop')return text('**Collectible shop**\n'+badges.map(b=>b.id+' — '+b.price+' credits').join('\n'));
    if(command==='inventory')return text('Your badges: '+(own.inventory.join(', ')||'none'));
    if(command==='buy'){
      const badge=badges.find(b=>b.id===args.toLowerCase());need(badge,'Choose bronze, silver or diamond.');
      need(!own.inventory.includes(badge.id),'You already own that badge.');need(own.balance>=badge.price,'Not enough credits.');
      own.balance-=badge.price;own.inventory.push(badge.id);return text('Purchased the **'+badge.id+'** badge.');
    }
    if(command==='pay'){
      const match=/^@?([\w-]+)\s+([1-9]\d{0,6})$/.exec(args);need(match,'Use /pay @username 100 (1–1000000 credits).');
      const recipient=server.people.find(u=>u.username===match[1]||u.id===match[1]);
      need(recipient&&!recipient.bot&&recipient.id!==user.id,'Choose another current human member.');
      const amount=Number(match[2]);need(amount<=1000000&&own.balance>=amount,'Invalid amount or insufficient credits.');
      const target=account(recipient.id);need(target.balance+amount<=Number.MAX_SAFE_INTEGER,'Recipient balance limit reached.');
      own.balance-=amount;target.balance+=amount;return text('Transferred **'+amount+' credits** to '+recipient.displayName+'.');
    }
    if(command==='leaderboard'){
      const people=server.people.filter(u=>!u.bot).sort((a,b)=>(next.accounts[b.id]?.balance||0)-(next.accounts[a.id]?.balance||0)).slice(0,10);
      return text('**Server credit leaderboard**\n'+people.map((u,i)=>(i+1)+'. '+u.displayName+': '+(next.accounts[u.id]?.balance||0)).join('\n'));
    }
  }
  if(template==='music'){
    next.queues||={};const queue=next.queues[channel]||=[];
    const track=t=>t.id+' · '+t.title+'\n'+t.url;
    if(command==='play'){
      need(queue.length<50,'This channel queue is full (50 tracks).');
      const [raw,...title]=args.split('|');let url;try{url=new URL(raw.trim());}catch{need(false,'Enter an HTTPS music link.');}
      need(url.href.length<=500&&url.protocol==='https:'&&!url.username&&!url.password,'Use an HTTPS link without embedded credentials.');
      const label=title.join('|').trim()||url.hostname;need(label.length<=100,'Keep the track title under 100 characters.');
      const t={id:randomUUID(),url:url.href,title:label,userId:user.id};queue.push(t);
      return text('Queued **'+t.title+'**\n'+t.url+'\nTrack ID: '+t.id);
    }
    if(command==='queue')return text('**Music links** (open a link to listen; no voice streaming)\n'+(queue.slice(0,5).map(track).join('\n')||'Queue is empty.'));
    if(command==='nowplaying')return text(queue.length?'**First in queue**\n'+track(queue[0]):'Queue is empty.');
    if(command==='clearqueue'){if(!canDJ)fail(403,'Manage Music Queue is required.');queue.length=0;return text('Music queue cleared.');}
    if(command==='skip'||command==='remove'){
      const index=command==='skip'?0:queue.findIndex(t=>t.id===args);need(index>=0&&queue[index],'Track not found.');
      if(queue[index].userId!==user.id&&!canDJ)fail(403,'You can only remove your own tracks. DJs can manage any track.');
      queue.splice(index,1);return text('Track removed. '+queue.length+' remaining.');
    }
  }
  if(template==='games'){
    if(command==='coinflip')return text(randomInt(2)?'Heads!':'Tails!');
    if(command==='dice'){
      const m=/^(\d{1,2})d(\d{1,4})$/i.exec(args||'1d6');
      need(m&&+m[1]>=1&&+m[1]<=20&&+m[2]>=2&&+m[2]<=1000,'Use /dice NdM (1–20 dice, 2–1000 sides).');
      const rolls=Array.from({length:+m[1]},()=>randomInt(1,+m[2]+1));return text('🎲 '+rolls.join(' + ')+' = **'+rolls.reduce((a,b)=>a+b,0)+'**');
    }
    if(command==='choose'){const choices=args.split('|').map(s=>s.trim());need(choices.length>=2&&choices.length<=20&&choices.every(s=>s&&s.length<=100),'Provide 2–20 choices separated by |.');return text('I choose: '+choices[randomInt(choices.length)]);}
    if(command==='eightball'){need(args.length>0,'Ask a question.');return text(['Yes.','Probably.','Ask again later.','Unlikely.','No.'][randomInt(5)]);}
  }
  if(template==='tasks'){
    next.channels||={};const users=next.channels[channel]||={},tasks=users[user.id]||=[];
    if(command==='todo'){need(args.length>0&&args.length<=200,'Enter a task of 1–200 characters.');need(tasks.length<50,'Complete a task first (50 active tasks per channel).');const task={id:randomUUID(),text:args};tasks.push(task);return text('Task added: '+task.text+'\nID: '+task.id);}
    if(command==='tasks')return text('**Your tasks in this channel**\n'+(tasks.slice(0,10).map(t=>t.id+' · '+t.text).join('\n')||'No active tasks.')+'\n'+tasks.length+' active task(s); showing up to 10.');
    if(command==='done'){const i=tasks.findIndex(t=>t.id===args);need(i>=0,'Task not found in your channel list.');tasks.splice(i,1);return text('Task completed.');}
  }
  fail(400,'Unknown template command.');
}
