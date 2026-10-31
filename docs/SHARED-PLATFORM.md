# Shared accounts, members and platform ownership

Voxora needs one shared backend and persistent data directory for people to share accounts, server memberships, messages and staff roles. A domain name must point to that running backend. The planned desktop default is **https://www.voxora.com**; this release does not register the domain, change DNS, or provision a public host.

Earlier installers started an independent localhost backend on every computer and silently fell back to it when a saved shared address failed. Each independent backend had its own first-account owner and member list. Those local owners were never staff on another backend, but the startup behavior made that distinction unclear.

## Desktop connections

New installations open **Connect to Voxora**. Connect to the same hosted address as everyone else. A failed shared connection stays on that screen with Retry/Connect available. It never creates a replacement local server. The native **Voxora → Server Connection** menu is available even when a shared backend cannot be reached.

**Private workspace on this computer** is an explicit alternative. It retains earlier local accounts, messages and servers under `%APPDATA%\Voxora\chat-data`; its first account is labeled **Workspace Owner**, and its administration link is **Workspace Admin**. It is separate from the public Voxora platform. Selecting a shared address does not upload, merge or delete those private accounts.

Connections record the backend's persistent installation ID. A saved address unexpectedly serving a different installation stops automatic connection and asks you to reconnect explicitly. User Settings → Server Connection shows the address, installation ID and whether the workspace is private.

## Members and staff

The first human account owns a shared installation. Later registrations get no platform staff permissions. Server ownership and the Administrator server permission do not grant platform administration. Only the platform owner can assign staff roles. Ownership initialization is recorded permanently; a missing owner reference never grants ownership to a new signup.

Accounts on the same backend join the default Community server on registration. Private/custom servers require an invite. Open **Server menu → Members** for a searchable directory, including offline members, on desktop or narrow screens. The right member panel has the same search and counts. Members from other private servers are not added automatically.

`GET /api/servers/:id/members?q=...&offset=0` returns up to 50 public member profiles plus total/hasMore. Only members of that server can query it. It exposes no password hashes, salts, private account data or platform assignment controls.

## Host the shared platform at www.voxora.com

The repository includes a Node 22 Docker image, Compose stack and Caddy HTTPS configuration. All backend data lives in the persistent `voxora-data` volume; it must survive upgrades. Node is exposed only on the host's loopback address. Caddy exposes HTTPS publicly and streams live events without buffering.

1. Use a server with Docker Engine and Docker Compose. Copy/clone the source and configure the `www.voxora.com` DNS record to point to that host. Allow inbound TCP 80/443 and optional UDP 443. If using another address temporarily, set `VOXORA_DOMAIN` in a private `.env` file on the host.
2. Start the backend privately with `docker compose up -d --build voxora`.
3. From your own computer, open an SSH tunnel with `ssh -L 3000:127.0.0.1:3000 user@YOUR_HOST`, visit `http://localhost:3000/app`, and register your owner account before opening public registration. The first account owns this shared installation. Close the SSH tunnel after setup.
4. Start HTTPS with `docker compose up -d caddy`. Caddy obtains a certificate for the configured domain. Confirm `https://www.voxora.com/api/info` returns Voxora metadata, then connect all desktop clients to that same origin.
5. Invite members to custom servers as needed. Verify an ordinary second account has no Platform Admin entry and sees the owner in the default Community member list.

Before upgrading, back up the persistent data volume. Update the source and run `docker compose up -d --build voxora`; retain the volume and the same data directory. Configure Stripe separately using docs/PLUS.md; keys belong in the hosted environment, never in the desktop installer or source archive. Existing externally running bots must use the same shared backend address.

To migrate an existing private workspace, stop its backend and back up the complete chat-data directory, including state.json and uploads, before transferring that one directory into the server's data volume. Its existing owner and accounts remain authoritative. Separate private databases are not automatically merged; do not concatenate their state files. Members whose accounts exist only in another private database need an account on the shared installation.
