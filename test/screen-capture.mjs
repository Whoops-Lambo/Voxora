import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createScreenCaptureHandler}=createRequire(import.meta.url)('../desktop/screen-capture.cjs');
function setup({platform='win32',audioRequested=true,selection={response:0,checkboxChecked:false},beforeSelect}={}){
 let origin='https://voxora.example',calls=0,options;const frame={url:origin+'/app'},window={isDestroyed:()=>false,webContents:{mainFrame:frame}},source={id:'screen:1',name:'Main screen'};
 const handler=createScreenCaptureHandler({platform,getOrigin:()=>origin,getMainWindow:()=>window,desktopCapturer:{async getSources(){calls++;return[source];}},dialog:{async showMessageBox(_window,value){options=value;beforeSelect?.(()=>{origin='https://other.example';});return selection;}}});
 const request={frame,videoRequested:true,audioRequested};return{request,source,run:async r=>{let result;await handler(r||request,value=>{assert.equal(result,undefined,'Only one response is allowed');result=value;});return result;},getOptions:()=>options,calls:()=>calls};
}
test('Windows system audio requires a requested audio track and explicit unchecked-by-default consent',async()=>{
 let h=setup();assert.deepEqual(await h.run(),{video:h.source});assert.equal(h.getOptions().checkboxChecked,false);assert.equal(h.getOptions().checkboxLabel,'Share system audio');
 h=setup({selection:{response:0,checkboxChecked:true}});assert.deepEqual(await h.run(),{video:h.source,audio:'loopback'});
 for(const options of [{platform:'linux',selection:{response:0,checkboxChecked:true}},{audioRequested:false,selection:{response:0,checkboxChecked:true}}]){h=setup(options);assert.deepEqual(await h.run(),{video:h.source});assert.equal(h.getOptions().checkboxLabel,undefined);}
});
test('capture rejects embedded or off-origin frames, cancellation and navigation during the picker',async()=>{
 let h=setup();assert.deepEqual(await h.run({...h.request,frame:{url:'https://voxora.example/widgets/id'}}),{});assert.equal(h.calls(),0);
 h=setup();h.request.frame.url='https://evil.example/';assert.deepEqual(await h.run(),{});assert.equal(h.calls(),0);
 h=setup({selection:{response:1,checkboxChecked:true}});assert.deepEqual(await h.run(),{});
 h=setup({beforeSelect:change=>change(),selection:{response:0,checkboxChecked:true}});assert.deepEqual(await h.run(),{});
});
