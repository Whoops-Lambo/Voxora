import {VoxoraBot} from '../sdk/voxora.mjs';
const bot=new VoxoraBot({url:process.env.VOXORA_URL,token:process.env.VOXORA_BOT_TOKEN});
const info=await bot.verifyServer();if(!info.capabilities?.communityStudio||!info.capabilities?.knowledgeBase)throw Error('Studio bot requires Voxora 3.2 or later. Update the desktop app or hosted backend.');
await bot.registerCommands([
 {name:'projects',description:'List project tasks in this channel',usage:'/projects'},
 {name:'knowledge',description:'Search published community guides',usage:'/knowledge [search]'},
 {name:'giveaways',description:'List open giveaways in this channel',usage:'/giveaways'},
]);
const safe=text=>String(text).replaceAll('@','＠');
bot.on('ready',({user})=>console.log(user.displayName+' connected. Studio commands: /projects, /giveaways and /knowledge.'));
bot.on('interaction',async interaction=>{
 try{
  const context=await interaction.context(),server=context.server.id,channel=context.channel.id;
  if(interaction.command==='projects'){
   const result=await bot.getProjectTasks(server,{channel});
   await interaction.respond({text:result.items.length?'Project board\n'+result.items.slice(0,8).map(t=>'• '+safe(t.title)+' — '+({todo:'To do',doing:'In progress',done:'Done'}[t.status])).join('\n'):'No tasks in this channel yet. Open Community Studio → Project Board.'});
  }else if(interaction.command==='knowledge'){
   const result=await bot.getKnowledgeArticles(server,{channel,q:String(interaction.arguments||'').slice(0,100)});
   await interaction.respond({text:result.items.length?'Community guides\n'+result.items.slice(0,6).map(a=>'• '+safe(a.title)+' — '+safe(a.summary)).join('\n'):'No matching published guides in this channel. Open Knowledge Base in Voxora.'});
  }else if(interaction.command==='giveaways'){
   const result=await bot.api('/servers/'+encodeURIComponent(server)+'/studio/giveaways?status=active&channel='+encodeURIComponent(channel));
   await interaction.respond({text:result.items.length?'Open giveaways\n'+result.items.slice(0,8).map(g=>'• '+safe(g.title)+' — '+g.entryCount+' entries').join('\n'):'No open giveaways here. Open Community Studio → Giveaways.'});
  }
 }catch(error){await interaction.respond({text:error.status&&error.status<500?error.message:'Could not load community tools. Check the bot console.'}).catch(()=>{});console.error('Studio command failed: '+error.message);}
});
bot.on('error',error=>console.error(error.message));process.once('SIGINT',()=>bot.close());process.once('SIGTERM',()=>bot.close());await bot.connect();
