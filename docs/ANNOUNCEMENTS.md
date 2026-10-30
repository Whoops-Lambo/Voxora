# Announcement channels

An announcement channel is a text channel with a Publish action. Select **Announcement** during channel creation, or enable **Announcement Channel** when editing an existing text channel. Creating or changing it requires Manage Channels. Normal roles, channel/category overrides, privacy, slowmode, message history, and attachments still apply.

## Follow into another server

Open the announcement channel and click **Follow**, then select another server and its destination text channel. You need access to the source plus Manage Channels and Send Messages in the destination. A channel may have up to 50 following destinations. Following starts with future publications; it does not import previous messages.

Each follow is authorized by the person who creates it. Before every delivery the backend rechecks that this person is not suspended, can still view the source, and can still manage and post to the destination. Losing any of these pauses future copies, including after role changes, channel/category privacy changes, ownership transfer or server removal. Follow again with a currently authorized account to reauthorize the subscription. Right-click the destination → **Following** to review status and **Unfollow**.

Both servers must use the same Voxora backend. Separate local desktop installations do not exchange announcements; connect them to the same hosted backend for shared servers and accounts.

## Publish a post

Post normally, then use the message's **Publish Announcement** action. Posting alone does not deliver to other servers. You may publish your own post with Send Messages; publishing someone else's also requires Manage Messages. The confirmation explains where the copies go and how snapshots behave.

Publication sends text and independent attachment records to active followers' chosen channels. Recipients can download copied attachments without accessing the source channel; source removal does not break their copies. Messages show the source server/channel label. This is an intentional publication of that content to those servers.

Each message publishes once, with a delivered-channel count. Concurrent attempts cannot produce duplicate copies. Published copies keep the version sent at publication: later source edits, deletion, or unfollowing do not alter existing copies. Destination moderators can delete those copies normally. Polls, command invocations and received announcements cannot be republished; copied posts never trigger recursive forwarding.

Follow records, publication receipts, copies and attachment records persist through restarts. Back up the whole backend data directory. Preserve `state.channelFollows`, channel `announcement` flags, message publication/source metadata, message sequences, and uploads on upgrades.

## HTTP API

These use the signed-in human account's session and current permissions:

| Method and route | Action |
| --- | --- |
| `POST /api/announcements/:channelId/follows` | Follow into `{ channelId: destinationChannelId }`; reauthorizes an existing follow. |
| `GET /api/announcements/:channelId/follows` | List that source's follows into destinations the current user can manage. |
| `GET /api/announcement-subscriptions?channel=destinationChannelId` | Review a destination's subscriptions and active/paused status. |
| `DELETE /api/announcement-follows/:id` | Stop future delivery into a destination you manage. |
| `POST /api/messages/:id/publish` | Publish an eligible announcement post once and return its delivered count. |
