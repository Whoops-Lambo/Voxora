function createScreenCaptureHandler({getOrigin,getMainWindow,desktopCapturer,dialog,platform=process.platform}){
 return async(request,callback)=>{
  let finished=false;const finish=value=>{if(!finished){finished=true;callback(value);}};
  try{
   const window=getMainWindow(),origin=getOrigin(),frame=request.frame;
   const trusted=()=>window&&!window.isDestroyed()&&getMainWindow()===window&&frame===window.webContents.mainFrame&&getOrigin()===origin&&new URL(frame.url).origin===origin;
   if(!trusted()||request.videoRequested===false)return finish({});
   const sources=await desktopCapturer.getSources({types:['screen','window']});if(!trusted()||!sources.length)return finish({});
   const audioAvailable=platform==='win32'&&request.audioRequested===true;
   const selection=await dialog.showMessageBox(window,{type:'question',title:'Share your screen',message:'Choose what to share',detail:audioAvailable?'System audio includes sounds from other apps. Enable it only when you want listeners to hear those sounds.':'Share the selected screen or window.',buttons:[...sources.map(s=>s.name),'Cancel'],cancelId:sources.length,...(audioAvailable?{checkboxLabel:'Share system audio',checkboxChecked:false}:{})});
   if(!trusted()||!Number.isInteger(selection.response)||selection.response<0||selection.response>=sources.length)return finish({});
   finish({video:sources[selection.response],...(audioAvailable&&selection.checkboxChecked===true?{audio:'loopback'}:{})});
  }catch{finish({});}
 };
}
module.exports={createScreenCaptureHandler};
