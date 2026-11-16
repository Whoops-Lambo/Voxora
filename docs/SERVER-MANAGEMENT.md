# Server management — 3.8

Server Settings → Roles offers six role presets: Moderator, Support Team, Event Host,
Publisher, Temporary Guest and Resource Curator. Apply a preset to review its
permissions before saving. Save as Template retains a server-specific preset; delete
saved presets without changing roles previously created from them. Built-in presets
cannot be deleted. Servers support 25 saved templates and 100 roles.

Manage Roles controls role creation, editing, ordering and permission overrides.
Assign Roles delegates membership assignment without permitting changes to role
definitions. Manage Role Templates controls saved presets. Every grant still requires
the actor's own permissions and a lower role/member in the hierarchy. Existing roles
with Manage Roles receive the two new management permissions during migration.

Member management → Manage Roles lets staff set an optional expiration for each role.
Deadlines use the browser's local time and can be up to 90 days away. Blank means
permanent. Expired roles stop granting permissions immediately, including administrator
and hierarchy privileges; the server sweeper then removes them, refreshes clients,
revalidates voice access and writes an audit entry. Expirations survive restarts.
Managed booster roles cannot be assigned manually or given an expiration.

Create Channel now offers Bulletin and Links:
- Bulletin requires Send Messages and Publish Bulletins to post.
- Links requires Send Messages, Send Links and Curate Links. Each post needs an HTTP(S)
  link; ordinary text channels keep their existing behavior.
Both channel types support categories, private visibility, inherited permissions,
overrides, topics and slowmode. Owners and administrators keep their usual bypass.

API additions:
- GET/POST /api/servers/:id/role-templates; DELETE .../role-templates/:templateId
- POST .../roles accepts templateId, with optional name/permissions overrides.
- PATCH .../members/:id accepts roles and an optional expiresAt object mapping role IDs
  to epoch milliseconds. Omitting expiresAt preserves deadlines for retained roles;
  an empty object makes editable assignments permanent.
- POST .../channels accepts type: bulletin or links. Internally these remain text
  channels with a mode flag so older clients can still render their messages.

Desktop automatic-update verification, signed download hashes and release-feed URLs
are unchanged. This source update does not advertise a new Windows executable:
build and verify the 3.8 Windows installer through the existing release process before
publishing its updater feed. Android's existing hosted /app connection continues
loading the deployed backend; GitHub source push alone does not deploy that backend.
