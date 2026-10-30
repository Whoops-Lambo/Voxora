# Welcome guides, server rules, and optional roles

These features require **Voxora 2.9 or later on the backend**. Upgrade a shared backend as well as desktop clients. Existing servers start with onboarding disabled; accounts, role assignments, messages, and channel permissions are preserved.

## Set up the welcome guide

Open **Server Settings → Onboarding**. **Manage Server** controls the welcome title (80 characters), introduction (1,000 characters), up to ten rules (400 characters each), and up to five recommended channels. Enable **Show welcome guide to new members** to open it after joining. Existing members can use **Server Guide** in the server menu or channel welcome area.

Recommended channels are filtered against each viewer's current channel permissions. Private rooms remain hidden until the member has access; names/topics do not leak through the guide. Removing a channel makes its recommendation unavailable. Guide changes and role options refresh in an open member guide without discarding their current choices unnecessarily. Long text and the guide layout support narrow screens.

**Require new members to accept rules** is separate from showing a welcome screen. It requires at least one rule and applies to future joins through invites, Discovery, and registration into the default community. Existing members are grandfathered. Already accepted members do not lose access when rules change; members still pending must accept the current rules version. Owners/administrators are exempt, and installed bot accounts do not undergo screening.

Pending members can read channels they are entitled to view, but cannot post/edit messages, react/vote, upload, create/reply to threads, create invites, perform staff actions, or join calls in that server. Channel overrides cannot bypass screening. DMs and other servers are unaffected. Closing the guide does not bypass the requirement; **Accept Server Rules** remains available above the channel history. Disabling the requirement releases pending members. Leaving and rejoining starts a fresh onboarding record.

Discovery users can open the guide even if no channels are visible yet. Accepting the rules and choosing an offered channel-access role can unlock the first room. After completion, the app opens an accessible channel when needed. This is self-service acceptance, not an approval queue, identity verification, or CAPTCHA.

## Offer roles safely

The **Roles Members Can Choose** section requires **Manage Roles**. Choose up to twelve existing roles below your highest staff role. Owners can choose any eligible custom role. Roles must grant only channel viewing, messages, files, reactions, thread creation, or voice/video access. Administrator, staff/management permissions, audit access, moderation, and invite creation are excluded, including management permissions granted through channel or category overrides. Create an interest/color role with no permissions in **Server Settings → Roles**, then add appropriate channel access if desired.

Members choose multiple roles in Server Guide and can change them later. Roles they already received from staff are marked **Assigned by staff**, cannot be removed through self-service, and are not converted into self-grants. Timeouts prevent optional-role changes, while still allowing rules acceptance without changing roles.

**Self-selected roles never increase moderation rank**, even if their display position is high. This prevents a junior moderator from selecting an interest role to outrank senior members. They still affect role colors, member grouping, and permitted channel access. The client receives the same effective rank used by backend moderation checks, without seeing private onboarding records.

Publishing a role is server policy and survives the publishing manager leaving. Removing an option or changing a role/override to include disallowed permissions withdraws self-granted assignments before management changes are saved and broadcast. Explicit staff assignments remain. A role manager who explicitly assigns a previously self-selected role must be allowed to manage that role and grant its permissions; unchanged assignment payloads cannot bypass this check. Such an explicit grant becomes a normal staff assignment.

Server audit logs record configuration changes and automatic withdrawal of unsafe assignments. Server Guide is human-only; bot tokens cannot manage onboarding or choose member roles. Bot moderation continues to use the effective human and bot role hierarchy.

## Privacy and persistence

The backend stores configuration in `server.onboarding` and per-member state in `server.onboardingMembers`, including acceptance version/time, guide completion, and self-grant provenance. Bootstrap and server views expose only the caller's guide status and public effective role ranks. Other members' acceptance timestamps and progress are not returned, including to ordinary server managers. Back up the full data directory; do not include it in source archives.

Templates currently copy channel/category/role layouts, not welcome text, rules, optional-role menus, or member progress. New template servers start with onboarding disabled. There is no default automatic role assignment: roles are opt-in and must be offered explicitly.

## Human REST API

Use an authenticated human session. Paths below begin with `/api`.

| Method and path | Behavior |
| --- | --- |
| `GET /servers/:id/onboarding` | Member guide, readable recommended channels, safe optional roles, and the caller's progress. |
| `GET /servers/:id/onboarding/settings` | Configuration and eligible choices with Manage Server or Manage Roles. |
| `PATCH /servers/:id/onboarding/settings` | Guide fields `{enabled?, title?, description?, rules?, requireRules?, channels?}` require Manage Server; `{roleIds?}` requires Manage Roles. Rules versions are server-controlled. |
| `POST /servers/:id/onboarding/complete` | Validate and save `{acceptRules?, rulesVersion?, roleIds?}` for the caller. A pending member must accept the latest version. Invalid roles do not partially record acceptance. |
| `POST /servers/:id/onboarding/dismiss` | Dismiss an optional welcome; pending rules acceptance cannot be dismissed. |

Requests recheck current membership, suspension, timeout, permissions, and offered roles after reading the complete body. Stale pending rules return 409; unauthorized roles return 403. Complete responses contain the member's current guide state. New roles/progress remain durable across restarts.
