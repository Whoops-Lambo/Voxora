# Server and channel settings

Use the server name menu or a community's context menu to open **Server Settings**. The window shows its server name and a navigation sidebar so role and server configuration stay in one place.

## Roles

**Server Settings → Roles** creates roles, changes names/colors/permissions and display grouping, reorders the hierarchy and deletes roles. **Overview → Configure Roles** opens the same page. Creating a role now opens an inline editor without replacing Server Settings. Save with **Create Role** or **Save Role**. **Cancel Role Creation** returns to the role list.

Members still inherit @everyone and every assigned role. Managers can edit only roles below their highest role and can grant only permissions they hold. Higher roles remain read-only. Use **Server Settings → Members** to assign existing roles to members; member context-menu assignment shortcuts remain available.

## Channel and category settings

Right-click a channel and choose **Channel Settings**, or use its existing edit/gear shortcut. The Channels page in Server Settings also opens the same window. Its sidebar shows:

- **Overview:** channel name, category, topic, slowmode and announcement option where applicable. Category Settings contains its category name.
- **Permissions:** role/member overrides with Inherit, Allow and Deny, plus the category inheritance status. Editing channel overrides makes them independent. **Sync with Category** confirms replacement with the category's current overrides and follows future category changes. Category permission edits also affect synced channels.
- **Forum:** tags and the required-tag option for forum channels.
- **Following:** incoming announcement subscriptions for ordinary text and announcement channels, including Unfollow.

Saving keeps the settings window open. Save each page before switching tabs. **Back to Server Settings** returns to the server's Channels page, or an authorized server page when Channels is unavailable. Deletion controls remain permission protected and require confirmation.

Managers who can configure roles but cannot manage channels get the Permissions page without channel-detail, forum, following or deletion controls. Channel managers without Manage Roles get channel details without permission overrides. Losing management access removes or closes the relevant editor. Losing channel/server membership or signing out closes privileged settings and clears their visible forms. Backend permission checks remain authoritative for every save.

The Channel Permissions context-menu entry has moved into **Channel Settings → Permissions**. Permission buttons in the server channel manager are shortcuts into that same settings page. Forum Settings also opens the Forum tab inside Channel Settings. Category permission shortcuts open Category Settings.

These pages work with the existing navy/mint accents, light mode and mobile layout. Installed Local Workspaces receive them through the desktop update. Separately hosted backends must deploy the 2.17 source files because their backend serves the web interface.
