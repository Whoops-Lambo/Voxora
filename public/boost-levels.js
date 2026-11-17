const quotas=[
 [0,0,30,30,30,8,25,30,0],
 [1,2,125,25,35,20,60,30,0],
 [2,7,250,50,60,50,120,30,0],
 [3,14,500,100,90,100,150,30,0],
 [4,30,750,150,150,150,250,60,3],
 [5,50,1000,250,250,250,500,90,10],
];
export const BOOST_LEVELS=Object.freeze(quotas.map(([level,requiredBoosts,emojiSlots,stickerSlots,soundboardSlots,uploadMB,videoStageSeats,recoveryDays,featuredProducts])=>Object.freeze({level,requiredBoosts,features:Object.freeze({emojiSlots,stickerSlots,soundboardSlots,uploadBytes:uploadMB*1048576,videoStageSeats,animatedIcon:level>=1,inviteBackground:level>=1,animatedInviteBackground:level>=2,serverBanner:level>=2,animatedBanner:level>=3,roleIcons:level>=2,animatedRoleIcons:level>=3,serverTags:level>=2,customInviteSlots:level>=3?2:0,customInvites:level>=3,storefrontHighlights:level>=4,featuredProducts,recoveryDays})})));
export function boostDescriptions(level){
 const f=BOOST_LEVELS.find(x=>x.level===Number(level))?.features;if(!f)return[];
 return [f.emojiSlots+' emoji slots',f.stickerSlots+' sticker slots',f.soundboardSlots+' soundboard slots',(f.uploadBytes/1048576)+' MB uploads',f.videoStageSeats+' Stage video seats',...(f.animatedIcon?['Animated server icon']:[]),...(f.inviteBackground?[f.animatedInviteBackground?'Animated invite background':'Server invite background']:[]),...(f.serverBanner?[f.animatedBanner?'Animated server banner':'Static server banner']:[]),...(f.roleIcons?[f.animatedRoleIcons?'Animated role icons':'Custom role icons']:[]),...(f.customInvites?['Custom invite links']:[]),...(f.serverTags?['Server tags']:[]),...(f.featuredProducts?[f.featuredProducts+' featured store products']:[]),f.recoveryDays+'-day recovery'];
}
