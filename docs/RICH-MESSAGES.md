# Embeds, buttons and webhooks

With the current backend and SDK:

```js
const message = await bot.sendMessage(channelId, {
  embeds: [{
    title: 'Release ready', description: 'Pick an action below.',
    color: '#55e6bc', fields: [{name: 'Version', value: '4.0.0'}],
  }],
  components: [
    {label: 'Join event', customId: 'join-event', style: 'primary'},
    {label: 'Website', url: 'https://example.com'},
  ],
});

bot.on('interaction', async interaction => {
  if (interaction.type === 'component' && interaction.customId === 'join-event') {
    await bot.respond(interaction.id, 'Your event request was received.');
  }
});

await bot.editMessage(message.id, {
  embeds: [{title: 'Registration closed'}], components: [],
});
```

Use normal server/channel bot installation scopes. The clicking user needs channel access, Send Messages and Use Commands; the bot must remain installed and authorized. Link buttons require HTTPS without URL credentials. Action IDs are unique within a message and do not run client code. Ordinary users cannot spoof bot embeds/components. Embeds allow up to ten cards and 6,000 total text characters, and messages allow up to 25 buttons. Rich cards are supported on channel messages; thread replies retain the existing text/attachment API.

Create incoming webhook URLs in Server Settings → Webhooks & Widgets. POST JSON such as `{ "content": "Build passed", "embeds": [{ "title": "Production ready" }] }` to the returned URL. The URL includes a secret, is displayed only once and must stay out of public source. Revoke it in settings when no longer needed.

The built-in Economy, Music Queue, Games and Tasks templates remain available in Bots & Apps. Music Queue manages HTTPS track links with DJ controls; it does not stream protected music into voice calls.
