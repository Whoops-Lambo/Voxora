import test from 'node:test';
import assert from 'node:assert/strict';
import {Voice} from '../public/voice.js';
test('camera and screen video never replace the stream audio sender; stopping sharing removes both streams',async()=>{
 const v=Object.create(Voice.prototype),video={id:'camera',kind:'video'},audio={id:'screen-audio',kind:'audio'},screen={id:'screen',kind:'video'},videos=[],audios=[];
 v.cameraStream={getVideoTracks:()=>[video]};v.screenStream=null;const videoSender={track:video,async replaceTrack(t){videos.push(t);this.track=t;}},audioSender={track:null,async replaceTrack(t){audios.push(t);this.track=t;}};
 v.connections=new Map([['peer',{pc:{getSenders:()=>[videoSender,audioSender]},videoSender,screenAudioSender:audioSender}]]);
 await v.updateVideo();assert.equal(videos.at(-1),video);assert.equal(audios.at(-1),null);
 v.screenStream={getVideoTracks:()=>[screen],getAudioTracks:()=>[audio]};await v.updateVideo();assert.equal(videos.at(-1),screen);assert.equal(audios.at(-1),audio);
 v.screenStream=null;v.cameraStream=null;await v.updateVideo();assert.equal(videos.at(-1),null);assert.equal(audios.at(-1),null);
});
test('per-user stream and voice volumes are independent and server deafening mutes both',()=>{
 const v=Object.create(Voice.prototype),voice={},screenAudio={};v.getState=()=>({me:{id:'u'}});v.mixAccount='u';v.mix={peer:{voice:.25,stream:.75}};v.peers=new Map([['p',{userId:'peer'}]]);v.connections=new Map([['p',{peerId:'p',audio:voice,screenAudio}]]);v.preferences={volume:.8};v.serverSelf={};v.deafened=false;v.applyAudio();assert.equal(voice.volume,.2);assert.ok(Math.abs(screenAudio.volume-.6)<1e-9);v.serverSelf.serverDeafened=true;v.applyAudio();assert.equal(voice.muted,true);assert.equal(screenAudio.muted,true);
});
