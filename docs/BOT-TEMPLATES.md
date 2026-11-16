# Built-in bots and management — 3.9

Server Settings → Bots & Apps → Add a Bot now offers Economy, Music Queue,
Games and Tasks, alongside Voxora Helper and custom applications. These built-in
templates run in Voxora's backend, with no separate bot process or token. Select a
bot to see its description. Scope each installation to the channels it needs; disable
or remove it at any time. The bot inherits @everyone and any assigned roles.
The user's Use App Commands and Send Messages, the bot's posting permissions and
the installation's channel scope are all enforced for every invocation and reply.

Economy uses server-local play credits, with /daily, /balance, /pay, /leaderboard,
/shop, /buy and /inventory. Rewards have a 24-hour cooldown; transfers and purchases
validate balances. Concurrent commands are serialized. Credits and inventories
survive restarts and reinstalling the bot. Credits have no monetary value.

Music Queue uses /play HTTPS-link | Title, /queue, /nowplaying, /skip, /remove
track-id and /clearqueue. Each channel has its own queue of up to 50 links. Open
a link to listen; this template does not stream audio into a voice call or extract
audio from streaming services. Members can remove their own tracks. Manage Music
Queue permits managing other members' tracks and clearing the queue. Links are
stored, not fetched by the server. Only HTTPS URLs without embedded credentials
are accepted. Send Links is needed by both the invoker and bot for links.

Games offers /dice, /coinflip, /choose and /eightball. Tasks offers /todo, /tasks
and /done task-id. Tasks belong to the user in the current channel, but replies
are ordinary channel messages, not private notes. Lists show up to 10 entries;
complete tasks to free space (50 active tasks per user/channel).

New permissions:
- Manage Bots & Apps: install, configure, disable and remove lower-ranked bots.
- Manage Invites: list and revoke any server invite. Creating invites still needs
  Create Invite.
- Pin Messages: pin others' messages without permission to delete them.
- Bypass Slowmode: post without the channel cooldown.
- Archive Channels: archive/restore text channels without deleting history.
- Manage Music Queue: act as DJ in selected channels.

Existing Manage Server roles migrate to bot/invite management; Manage Messages
roles migrate to pin/slowmode privileges; Manage Channels roles gain archiving.
Permissions can be edited afterward and remain disabled when cloning current layouts.
Bot Manager, DJ and Archivist role presets are available.

Channel Settings → Archive Channel disables new posts, uploads, reactions, commands
and thread creation for everyone, including administrators and bots, while keeping
history readable according to existing visibility rules. Restore Channel enables
posting again. Permission and visibility overrides are retained; archiving does not
make a private channel public.

This desktop release includes the 3.8 role presets, custom role templates, expiring
role assignments, delegated role assignment, Bulletin channels and Links channels.
Hosted connections require the same backend update on their host; the installed
desktop update bundles the complete local workspace backend.
