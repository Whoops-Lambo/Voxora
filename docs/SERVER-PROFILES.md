# Server nicknames

Open **Server menu → Edit Server Nickname**. A nickname contains up to 32 characters and applies only to that server. Leave it empty to reset to your global display name. Your stable username remains the address for mentions and account identity.

Nicknames appear in server member lists, messages and threaded replies. Member search accepts the server nickname, global display name and username. An open member list and existing message authors refresh when a nickname changes. Profile cards retain the global account name and show the server nickname separately.

**Change Nickname** allows members to edit their own nickname. It is enabled for @everyone when this feature is introduced; server owners can revoke it. **Manage Nicknames** permits moderators to rename or reset members below their highest role. It does not override hierarchy or grant platform administration. Timeouts and pending server rules restrict self-editing. Changes appear in the server audit log with optional moderation reasons.

`PATCH /api/servers/:server/nicknames/:member` accepts `{nickname,version,reason?}`. The current version is in `server.nicknameVersions[memberId]`. A stale version returns 409; reopen the editor before saving. Current membership, permissions and suspension are checked after reading the body. Control characters and bidirectional formatting controls are rejected. Leaving or being removed from a server clears the nickname and advances the revision; rejoining cannot restore an earlier pending edit.

`GET /api/servers/:server/members?q=...` includes `serverNickname` and `nicknameVersion` on each member. Server bootstrap data includes only current members’ nicknames and revisions. Global user profiles and identities on other servers remain separate. Nicknames are not copied into server templates.

## Profile pictures and community branding

Voxora 3.1 adds free avatars, pronouns and website links in User Settings → Profiles, plus server icons, server banners, invite banners and level 3 custom links in Server Settings → Overview. See [pictures, custom invites and boost grants](BRANDING-AND-INVITES.md).
