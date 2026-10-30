# Website and platform administration

The backend serves the public homepage at `/`, the chat app at `/app`, the developer portal at `/developers`, bot documentation at `/developers/docs`, and platform administration at `/admin`. These pages share the backend's account sessions. An instance must be deployed behind HTTPS to become a public website; this repository does not deploy or register a domain automatically.

The **first registered human account** owns the platform. Existing installations migrate the earliest human account into that role. Built-in and custom bot accounts are excluded. Ownership is independent of server ownership and does not change when a server is transferred. Each separate backend has its own owner, accounts, staff roles and applications.

The platform owner can create, edit, delete and assign Voxora staff roles. Open `/admin` → **Staff Roles** to choose a name, color and permissions, then **Accounts** → **Assign Staff Roles**. Users can hold several roles; their permissions combine. Official staff badges appear on profiles, member rows and messages.

Available permissions:

| Permission              | Tools                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Manage Accounts         | Search human accounts, suspend them for an hour/day/week or indefinitely, and restore access. |
| Manage Servers          | Review server metadata and remove a server after entering its name and a moderation reason.   |
| Manage Bot Applications | Disable or restore applications across the installation.                                      |
| View Platform Audit Log | Review and search staff actions, targets, actors, timestamps and reasons.                     |

Only the owner assigns staff roles. Regular staff cannot suspend the owner, themselves or other staff. The owner cannot suspend itself. Bots cannot receive platform staff roles. Every administrative API rechecks current permissions after receiving its request body, so an in-flight request cannot retain a revoked staff permission.

Suspension ends active human sessions and voice connections, blocks new login, and pauses the user's bot credentials and gateways. Restoration allows a fresh login and resumes non-disabled applications. Disabling a bot application stops its API, gateway and commands without deleting its messages or installations. Only the owner can disable the built-in helper.

Platform permissions grant moderation capabilities, not access to private messages or server channels. Admin server listings expose metadata and counts; they do not expose channel/message content. Bot tokens and token hashes are excluded from admin responses. Application tokens are shown once in the developer portal and are stored hashed by the backend.

Administrative actions are logged in the most recent 500 platform audit entries. Server integration changes also appear in the server audit log. Preserve the complete persistent data directory when deploying or updating. The owner ID, roles, assignments and moderation state persist in `state.json`.
