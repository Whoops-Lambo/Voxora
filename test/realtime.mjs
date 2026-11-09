import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../presence.js';
import { fixture } from './support/server.mjs';

test('HTTP presence expires, never outlives authentication, and revokes individual sessions or all user sessions', () => {
  let time = 1000;
  const p = createPresence({ now: () => time });
  p.touch('one', { hash: 'a', expires: 100000 });
  p.touch('one', { hash: 'b', expires: 2000 });
  p.forgetSession('a'); assert.equal(p.online('one'), true);
  time = 2001; assert.equal(p.online('one'), false); assert.equal(p.sweep(), true);
  p.touch('two', { hash: 'c', expires: 100000 });
  time += 30001; assert.equal(p.online('two'), false);
  p.touch('one', { hash: 'a', expires: 100000 }); p.touch('one', { hash: 'b', expires: 100000 });
  p.forgetUser('one'); assert.equal(p.online('one'), false);
});

test('fallback clients appear online, qualify for @here, respect invisible status and leave on logout', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('http_owner'), member = await f.register('http_member');
    const state = () => f.call(owner, '/state');
    assert.equal((await state()).data.users.find(u => u.id === member.id).status, 'offline');
    assert.equal((await f.call(member, '/state?client=bad')).status, 400);
    await f.call(member, '/state?client=fallback_member_client');
    assert.equal((await state()).data.users.find(u => u.id === member.id).status, 'online');
    const ping = await f.call(owner, '/messages', 'POST', { channel: 'general', text: '@here HTTP presence ping' });
    assert.ok(ping.data.mentions.recipients.includes(member.id));
    await f.call(member, '/profile', 'PATCH', { status: 'invisible' });
    await f.call(member, '/state?client=fallback_member_client');
    assert.equal((await state()).data.users.find(u => u.id === member.id).status, 'offline');
    await f.call(member, '/profile', 'PATCH', { status: 'online' });
    await f.call(member, '/auth/logout', 'POST', {});
    assert.equal((await state()).data.users.find(u => u.id === member.id).status, 'offline');
    assert.equal((await f.call(member, '/state?client=fallback_member_client')).status, 401);
  } finally { await f.cleanup(); }
});

test('HTTP catch-up pages new messages and DMs without leaking private channels, blocked messages or anonymous state', async () => {
  const f = await fixture();
  try {
    const a = await f.register('sync_api_owner'), b = await f.register('sync_api_member');
    const baseline = (await f.call(b, '/state')).data.activity.through;
    const s = (await f.call(a, '/servers', 'POST', { name: 'Private sync' })).data;
    await f.call(a, '/messages', 'POST', { channel: s.channels[0].id, text: 'Private sync secret' });
    const dm = (await f.call(a, '/conversations', 'POST', { userId: b.id })).data;
    await f.call(a, '/messages', 'POST', { channel: dm.id, text: 'A new direct message' });
    for (let i = 0; i < 103; i++) await f.call(a, '/messages', 'POST', { channel: 'general', text: 'Catch up ' + i });
    const page = (await f.call(b, '/sync?after=' + baseline + '&threadAfter=0')).data;
    assert.equal(page.messages.length, 100); assert.equal(page.hasMore, true);
    assert.ok(page.messages.some(m => m.channel === dm.id));
    assert.ok(!JSON.stringify(page).includes('Private sync secret'));
    const next = (await f.call(b, '/sync?after=' + page.next + '&threadAfter=' + page.threadNext)).data;
    assert.equal(next.messages.length, 4); assert.equal(next.hasMore, false);
    assert.ok(!next.messages.some(m => page.messages.some(previous => previous.id === m.id)));
    await f.call(b, '/blocks/' + a.id, 'POST', {});
    assert.deepEqual((await f.call(b, '/sync?after=' + baseline)).data.messages, []);
    assert.equal((await f.call(null, '/sync?after=0')).status, 401);
    assert.equal((await f.call(b, '/sync?after=-1')).status, 400);
    assert.equal((await f.call(b, '/sync?after=9999999')).status, 409);
  } finally { await f.cleanup(); }
});

test('live streams flush proxy-safe headers and taking over HTTP presence does not leave a stale online lease', async () => {
  const f = await fixture(), stop = new AbortController();
  try {
    const a = await f.register('stream_owner'), b = await f.register('stream_member');
    await f.call(b, '/state?client=stream_client_member');
    const response = await fetch(f.origin + '/api/events?client=stream_client_member', { headers: { Cookie: b.cookie }, signal: stop.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(response.headers.get('cache-control'), /no-transform/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.match(new TextDecoder().decode((await response.body.getReader().read()).value), /retry: 1500/);
    stop.abort();
    for (let i = 0; i < 100; i++) {
      if ((await f.call(a, '/state')).data.users.find(u => u.id === b.id).status === 'offline') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Closing the live stream left stale HTTP presence.');
  } finally { stop.abort(); await f.cleanup(); }
});
