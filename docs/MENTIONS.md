# Pings and mentions

Type `@` in the channel or DM composer to search members by username, display name or server nickname. Select a suggestion with a click, arrow keys plus Enter, or Tab. Enter inserts the mention; press Enter again to send. Escape dismisses the list. Role choices insert the readable syntax `@{Role Name}`; plain `@username` also works. Bots can send these formats or the user/role ID forms `<@user-id>` and `<@&role-id>`.

Personal and role pings highlight the recipient's message and increment mention badges and Inbox. Thread pings also appear in Inbox and open the correct thread. Reading a thread or Mark All Read clears its pings. Pings persist across restarts. Recipients are resolved when the message is sent, so later role membership or presence changes cannot redirect an old ping. Editing can remove a ping but does not generate new recipients.

Server Settings → Roles has **Allow anyone to mention this role**. Other role pings, `@everyone` and `@here` require **Mention Everyone & Roles**, which can be granted or denied in channel permissions. `@everyone` targets members who can read the channel; `@here` targets those currently connected and visible online. Do Not Disturb still suppresses sounds and desktop alerts. Muting and notification mode continue to apply; enable sound/desktop notifications in User Settings if desired. Blocked authors cannot populate your mention counts or alerts.

Code, escaped mentions, email addresses and links do not ping. Followed announcement copies do not ping members in the destination server. Names that do not resolve to a member or role remain plain text. If two roles share the same name, rename one before using the name-based role mention.

Desktop updates include this feature for the bundled local workspace. A separately hosted backend must also be updated and restarted with its existing data directory to serve the new composer and resolve pings.
