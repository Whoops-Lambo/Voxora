# Discovery, server templates, and events

Voxora 2.6 adds these features to each backend. Users and communities must connect to the same backend to find each other. They do not search or join separate desktop installations automatically. Upgrade a shared backend along with the desktop client.

## Server Discovery

Use the compass button in the server rail to browse **Discover Servers**, search by name/summary/tag, and filter by category. Join a listed community or open one you already joined. Results show 12 communities per page.

Existing and newly created servers are **unlisted by default**. A member with Manage Server can open **Server Settings → Discovery**, enter a public summary, category and up to five tags, enable **List this server in Discovery**, and save. Disabling that setting removes the listing and closes directory joining; existing members retain their memberships.

A listing intentionally lets signed-in users join without an invite. It publishes only the community's name, color, public summary, category, tags, human member count and the viewer's joined status. Internal server descriptions, channel names, messages, invites, role definitions and user IDs are excluded. Bans still prevent joining, and private-channel permissions still apply after a directory join. New members start with their normal default permissions, without assigned staff or moderator roles. Servers owned by suspended accounts are not promoted in Discovery.

Changes recheck the manager's current permissions after the complete request body arrives. A revoked manager cannot finish a delayed publication request. Discovery settings and membership changes persist across restarts and are audited.

## Server templates

Open **Add a Server → Use a Template** to start from Community, Gaming, Study Group, or Creator Community. Presets include rules, announcements, text and voice rooms, a private Staff category, and an unassigned Moderator role. The creator owns the new server. Ordinary members cannot post in preset rules/announcement channels or view the Staff category unless a role grants access.

The server owner can choose **Create Server Template** from the server menu to make a shareable layout snapshot. Give it a name and description and copy the resulting code. Anyone signed in on the same backend who knows the code can use **Use a Template Code**, preview its size, and create a new server they own. Keep the code private when the layout contains private names or topics. Each user may keep up to 20 shared templates.

The snapshot contains the server description/color, roles and role permissions, category layout, channel names/topics, text/voice types, announcement flags, slowmode, and role-based channel/category overrides. All role/category/channel IDs are remapped during import. Private role-based categories and permission sync remain intact. Member-specific overrides, membership, role assignments, messages, uploads, bot installations/tokens, bans, warnings, invites, announcement follows, discovery publication and scheduled events are excluded. New invitations are generated for the new server.

Snapshots do not follow later edits to the source server. **My Templates** lists codes you created; **Revoke** prevents future previews/imports without changing servers already created. A creator's suspension also disables their shared template codes. Template snapshots remain independent of the original server and are removed when their creator revokes them.

## Scheduled events

Choose **Events** in the server menu or the calendar button in a channel header. Events can use a voice channel or a free-text location/HTTPS link. A member with **Manage Events** can schedule, edit, start, cancel and complete them. This new permission is off for ordinary members; owners and administrators already have it. Existing roles do not gain it automatically unless they are administrators.

Schedule a start within the next year and an end after it, for a duration up to seven days. Forms and displayed times use the viewer's device time zone; timestamps are stored as instants and calendar exports use UTC. External links must use HTTPS without embedded credentials. External event metadata is visible to server members. Voice events require current visibility into their voice channel: Manage Events does not bypass private-channel permissions.

Members can mark **Interested** or **Not Interested**. Only the caller's RSVP changes; repeated/concurrent requests do not create duplicates. Counts exclude members who left, are suspended or lost event visibility. Timed-out members cannot change RSVPs. RSVP identities are not published in event responses.

Managers can edit scheduled events and start them up to 15 minutes early. Starting is explicit, not automatic. Active events can be completed; scheduled/active events can be cancelled. Events also close when their end time passes, and deleting a voice location cancels its events. Upcoming/active events and the latest 100 past events are shown separately. Status and RSVP changes update other open event lists through the existing live connection.

**Add to Calendar** downloads a permission-checked `.ics` file, including a cancelled status where applicable. It is a snapshot rather than a subscribed calendar feed; download an updated copy after changing event times or details. Calendar text is escaped and UTF-8 lines folded to prevent fields from becoming additional calendar records. Exports contain no attendee identities, cookies or bot tokens. This does not create entries in an external calendar automatically.

Preserve the whole backend data directory, including `state.serverTemplates`, `state.scheduledEvents`, per-server `discovery` settings and existing roles. Event lifecycle and creation actions appear in server audit logs. No hosted backend, external calendar service or new credentials are required for local development.

## API

These endpoints use the signed-in human account's existing session and current permissions:

| Method and route | Purpose |
| --- | --- |
| `GET /api/discovery?q=&category=&offset=` | Search public server metadata, 12 items per page. |
| `POST /api/discovery/:serverId/join` | Join a currently listed server, respecting bans. |
| `GET/PATCH /api/servers/:id/discovery` | Read/edit your server's listing with Manage Server. |
| `GET /api/server-templates` | Built-in presets plus templates created by the caller. |
| `POST /api/servers/:id/templates` | Owner-only layout snapshot with `{ name, description }`. |
| `GET/DELETE /api/server-templates/:code` | Preview or creator-only revoke a shared code. |
| `POST /api/server-templates/:code/create` | Create a new server from the template with `{ name }`. |
| `GET/POST /api/servers/:id/events` | List visible upcoming events or schedule one. `?history=1` lists past events. |
| `PATCH /api/servers/:id/events/:eventId` | Edit a scheduled event with Manage Events. |
| `POST .../:eventId/rsvp` | Set your RSVP with `{ interested: true|false }`. |
| `POST .../:eventId/start`, `/complete`, `/cancel` | Perform an authorized lifecycle transition. |
| `GET .../:eventId/calendar` | Download a current, permission-checked calendar snapshot. |
