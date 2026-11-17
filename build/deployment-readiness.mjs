export const REQUIRED_COMMUNITY_CAPABILITIES=Object.freeze([
 'roleTemplates','temporaryRoles','forums','threads','stageChannels','rulesChannels','mediaChannels','serverOnboarding','announcements',
 'groupChats','serverManagementRecovery','serverShop','customThemes','accountSwitcher','richMessages','botComponents','botLimits',
 'liveWidgets','reactionRoles','leveling','threadTransfer','voxoraMax','roleRestrictedEmoji','roleIcons','gamePresence','customChannelLists','dmFolders','advancedSearch','rolePreview',
 'messageNotifications','mobileLayout','voiceMessages','messageForwarding','publicSafety','serverVerification','externalExpressions',
]);
export const PUBLIC_APP_ASSETS=Object.freeze(['app.js','platform-web.js','premium-ui.js','community-controls-ui.js','shop-ui.js','boost-levels.js','channel-ui.js','conversations-ui.js','voice.js','expressions-ui.js','bot-ui.js','style.css']);
export function assertDeployment(metadata,{version,commit,requireFeatures=true,requireSync=true}={}){
 if(metadata?.name!=='Voxora'||metadata.privateWorkspace!==false||typeof metadata.instanceId!=='string'||!metadata.instanceId)throw Error('The public service must be a shared Voxora installation.');
 if(version&&metadata.version!==version)throw Error('Public Voxora is still running '+String(metadata.version||'an unknown version')+'; expected '+version+'.');
 if(commit&&metadata.buildCommit!==commit)throw Error('Public Voxora has not deployed the tested source commit.');
 if(requireSync&&metadata.realtimeSync!==true)throw Error('Public Voxora has not deployed reliable chat synchronization.');
 if(requireFeatures){
  const missing=REQUIRED_COMMUNITY_CAPABILITIES.filter(k=>metadata.capabilities?.[k]!==true);
  if(missing.length)throw Error('Public Voxora is missing: '+missing.join(', ')+'.');
  if(metadata.maxBoostLevel!==5||!['free','plus','max'].every(p=>metadata.membershipPlans?.includes(p)))throw Error('Public Voxora has not deployed all membership plans and five boost levels.');
 }
 return metadata;
}
export function findPublicProof({version,artifactCommit,runtimeFiles,git}){
 const tagPrefix='refs/tags/deployment-verified/v'+version+'-',lines=git('ls-remote','--tags','origin',tagPrefix+'*').split('\n'),roots=new Set(runtimeFiles.filter(p=>!p.includes('*')));
 const runtime=path=>roots.has(path)||path==='package-lock.json'||path==='Dockerfile'||path==='public-server.js'||path==='desktop/platform.json'||path.startsWith('public/')&&path!=='public/bot-starter.zip';
 for(const line of lines){
  const [sha,ref]=line.split(/\s+/);if(!/^[a-f0-9]{40}$/.test(sha||'')||ref!==tagPrefix+sha)continue;
  try{git('merge-base','--is-ancestor',sha,artifactCommit);}catch{continue;}
  if(git('diff','--name-only',sha,artifactCommit).split('\n').filter(Boolean).some(runtime))continue;
  return{commit:sha,tag:ref};
 }
 throw Error('The matching public backend and interface have not passed deployment verification. Finish the Public Voxora service workflow before publishing the desktop update feed. The stable feed was not changed.');
}
