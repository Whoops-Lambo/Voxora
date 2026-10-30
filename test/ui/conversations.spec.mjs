import { test, expect } from "@playwright/test";
import { fixture } from "../support/server.mjs";
let app;
test.beforeAll(async()=>{app=await fixture();}); test.afterAll(async()=>{await app?.cleanup();});
async function register(page,name){await page.goto("/app");await page.getByRole("button",{name:"Register",exact:true}).click();await page.getByLabel("DISPLAY NAME").fill(name);await page.getByLabel("USERNAME").fill(name);await page.getByLabel("PASSWORD").fill("Fixture-password-476");await page.getByRole("button",{name:"Continue",exact:true}).click();await expect(page.locator("#message-input")).toBeVisible();}
async function select(page,s){await page.locator("#server-rail").getByRole("button",{name:s.name,exact:true}).click();}
async function send(page,text){await page.locator("#message-input").fill(text);await page.locator("#message-input").press("Enter");}
async function setup(browser,prefix){const a=await browser.newContext({baseURL:app.origin}),b=await browser.newContext({baseURL:app.origin}),owner=await a.newPage(),member=await b.newPage();await register(owner,prefix+"_owner");await register(member,prefix+"_member");const s=await(await owner.request.post("/api/servers",{data:{name:prefix+" Community"}})).json();await member.request.post("/api/invites/join",{data:{code:s.invite}});await owner.reload();await member.reload();await select(owner,s);await select(member,s);return{a,b,owner,member,s};}

test("threads show live replies beside the channel, support archives and locks, and revoke access immediately",async({browser})=>{
 const {a,b,owner,member,s}=await setup(browser,"threads_ui");const errors=[];owner.on("pageerror",e=>errors.push(e.message));member.on("pageerror",e=>errors.push(e.message));
 try{
  await send(owner,"Let us plan the launch");
  const parent=member.locator(".message-row").filter({hasText:"Let us plan the launch"});await parent.click({button:"right"});
  await member.getByRole("button",{name:"Create Thread",exact:true}).click();await member.getByLabel("THREAD NAME").fill("Launch Discussion");await member.locator("#modal").getByRole("button",{name:"Create Thread",exact:true}).click();
  await expect(member.locator("#detail-panel.thread-panel")).toContainText("Launch Discussion");
  await owner.getByRole("button",{name:"Launch Discussion · 0 replies",exact:true}).click();
  await member.getByLabel("Thread message",{exact:true}).fill("The first threaded reply");await member.getByLabel("Thread message",{exact:true}).press("Enter");
  await expect(owner.getByRole("log",{name:"Thread replies"})).toContainText("The first threaded reply");
  await owner.getByLabel("Thread message",{exact:true}).fill("I will prepare the release notes");await owner.getByLabel("Thread message",{exact:true}).press("Enter");
  await expect(member.getByRole("log",{name:"Thread replies"})).toContainText("prepare the release notes");
  await expect(owner.locator("#message-list")).not.toContainText("prepare the release notes");
  await member.getByRole("button",{name:"Archive Thread",exact:true}).click();await expect(owner.getByLabel("Thread message",{exact:true})).toBeDisabled();
  await owner.getByRole("button",{name:"Reopen Thread",exact:true}).click();await owner.getByRole("button",{name:"Lock Thread",exact:true}).click();await expect(member.getByLabel("Thread message",{exact:true})).toBeDisabled();
  await owner.getByRole("button",{name:"Unlock Thread",exact:true}).click();await expect(member.getByLabel("Thread message",{exact:true})).toBeEnabled();
  const ownReply=owner.locator(".thread-message").filter({hasText:"prepare the release notes"});
  await ownReply.getByRole("button",{name:"Edit Reply",exact:true}).click();await owner.getByLabel("REPLY TEXT",{exact:true}).fill("Release notes are ready");await owner.locator("#modal").getByRole("button",{name:"Save Reply",exact:true}).click();
  await expect(member.getByRole("log",{name:"Thread replies"})).toContainText("Release notes are ready");
  await member.getByLabel("Thread message",{exact:true}).fill("Temporary follow-up");await member.getByLabel("Thread message",{exact:true}).press("Enter");
  const temporary=owner.locator(".thread-message").filter({hasText:"Temporary follow-up"});await expect(temporary).toBeVisible();
  await member.locator(".thread-message").filter({hasText:"Temporary follow-up"}).getByRole("button",{name:"Delete Reply",exact:true}).click();await member.locator("#modal").getByRole("button",{name:"Confirm",exact:true}).click();
  await expect(temporary).toHaveCount(0);
  await owner.screenshot({path:"test-results/voxora-threads.png",fullPage:true});
  await owner.setViewportSize({width:390,height:844});await owner.screenshot({path:"test-results/voxora-threads-mobile.png",fullPage:true});expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await owner.evaluate(()=>document.querySelector("#topbar .header-name > strong").getBoundingClientRect().right<=document.querySelector("#topbar .header-actions").getBoundingClientRect().left)).toBe(true);
  const state=await(await member.request.get("/api/state")).json();
  await owner.request.patch("/api/channels/"+s.channels[0].id,{data:{overwrites:[{type:"member",id:state.me.id,deny:["viewChannel"],allow:[]}]}});
  await expect(member.getByRole("log",{name:"Thread replies"})).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await a.close();await b.close();}
});

test("save messages privately, search personal notes and hide saved content after permission loss",async({browser})=>{
 const {a,b,owner,member,s}=await setup(browser,"saves_ui");
 try{
  await send(owner,"The reference worth keeping");
  await member.locator(".message-row").filter({hasText:"reference worth keeping"}).click({button:"right"});await member.getByRole("button",{name:"Save Message",exact:true}).click();
  await expect(member.locator("#toast-stack")).toContainText("Message saved privately");
  await member.getByRole("button",{name:"Saved Messages",exact:true}).click();await expect(member.locator("#modal .saved-card")).toContainText("reference worth keeping");
  await member.getByRole("button",{name:"Add Note",exact:true}).click();await member.getByLabel("NOTE",{exact:true}).fill("My private launch checklist");await member.getByRole("button",{name:"Save Note",exact:true}).click();
  await member.getByLabel("SEARCH SAVED MESSAGES").fill("checklist");await expect(member.locator("#modal .saved-card")).toContainText("My private launch checklist");
  await expect(member.locator("#toast-stack .error")).toHaveCount(0);
  await member.screenshot({path:"test-results/voxora-saved-messages.png",fullPage:true});
  await owner.getByRole("button",{name:"Saved Messages",exact:true}).click();await expect(owner.locator("#modal")).not.toContainText("private launch checklist");await expect(owner.locator("#modal .saved-card")).toHaveCount(0);await owner.locator("#modal-close").click();
  await member.reload();await member.getByRole("button",{name:"Saved Messages",exact:true}).click();await expect(member.locator("#modal .saved-card")).toContainText("private launch checklist");
  const me=(await(await member.request.get("/api/state")).json()).me;
  await owner.request.patch("/api/channels/"+s.channels[0].id,{data:{overwrites:[{type:"member",id:me.id,deny:["viewChannel"],allow:[]}]}});
  await expect(member.locator("#modal")).toContainText("no longer accessible");await expect(member.locator("#modal")).not.toContainText("reference worth keeping");
  await member.getByRole("button",{name:"Remove Unavailable Saves",exact:true}).click();await expect(member.locator("#modal .saved-unavailable")).toHaveCount(0);
  await expect(member.locator("#toast-stack .error")).toHaveCount(0);
 }finally{await a.close();await b.close();}
});

test("upload a custom server emoji, use it in messages and reactions, then rename it",async({browser})=>{
 const {a,b,owner,member,s}=await setup(browser,"emoji_ui");const errors=[];owner.on("pageerror",e=>errors.push(e.message));member.on("pageerror",e=>errors.push(e.message));
 try{
  await owner.locator("#sidebar-top .server-heading").click();await owner.getByRole("button",{name:"Server Settings",exact:true}).click();await owner.locator("#modal").getByRole("button",{name:"Emoji",exact:true}).click();
  await owner.getByLabel("EMOJI NAME",{exact:true}).fill("wave");
  await owner.getByLabel("EMOJI IMAGE",{exact:true}).setInputFiles({name:"wave.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64")});
  await owner.getByRole("button",{name:"Upload Emoji",exact:true}).click();await expect(owner.locator(".emoji-manager-row")).toContainText(":wave:");
  await owner.screenshot({path:"test-results/voxora-custom-emoji.png",fullPage:true});await owner.locator("#modal-close").click();
  await member.reload();await select(member,s);await member.locator("#composer-emoji").click();await member.locator("#emoji-picker").getByRole("button",{name:":wave:",exact:true}).click();await member.locator("#message-input").pressSequentially(" Hello everyone");await member.locator("#message-input").press("Enter");
  const message=member.locator(".message-row").filter({hasText:"Hello everyone"});await expect(message.locator("img.server-emoji")).toBeVisible();
  expect(await message.locator("img.server-emoji").evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await message.click({button:"right"});await member.locator("#context-menu").getByRole("button",{name:"Add Reaction",exact:true}).click();await member.locator("#emoji-picker").getByRole("button",{name:":wave:",exact:true}).click();await expect(message.locator(".reaction img.server-emoji")).toBeVisible();
  await member.screenshot({path:"test-results/voxora-emoji-chat.png",fullPage:true});
  await owner.locator("#sidebar-top .server-heading").click();await owner.getByRole("button",{name:"Server Settings",exact:true}).click();await owner.locator("#modal").getByRole("button",{name:"Emoji",exact:true}).click();await owner.getByRole("button",{name:"Rename Emoji",exact:true}).click();await owner.getByLabel("EMOJI NAME",{exact:true}).fill("greeting");await owner.getByRole("button",{name:"Save Emoji Name",exact:true}).click();
  await expect(message.locator("img.server-emoji").first()).toHaveAttribute("alt",":greeting:");expect(errors).toEqual([]);
 }finally{await a.close();await b.close();}
});
