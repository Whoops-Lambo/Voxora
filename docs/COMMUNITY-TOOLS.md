# Community tools in 3.3

Server Settings groups roles, channel settings, onboarding, Banned Users and community assets. Channel Settings → Permissions supports role and member overrides, including category inheritance, for every channel kind. Role hierarchy still controls member moderation and role assignments.

## Assets and boosts

Emoji, stickers and soundboard clips have independent limits:

| Boost level | Emoji | Stickers | Sounds | Other benefits |
| --- | ---: | ---: | ---: | --- |
| 0 | 30 | 30 | 30 | |
| 1 | 60 | 60 | 60 | |
| 2 | 90 | 90 | 90 | Server tag |
| 3 | 200 | 200 | 200 | Two custom invite links |

Manage Emoji, Manage Stickers and Manage Soundboard control their respective catalogs. Stickers accept PNG, GIF or WebP up to 512 KB and 512×512 pixels. Soundboard uploads are converted in the app to 16-bit PCM WAV, up to five seconds. Playback requires a live voice connection, Use Soundboard and speaking access; audiences, server-muted members and unauthorized channels cannot broadcast clips. Deafen, blocks, local volume and playback rate limits apply.

After a downgrade, excess items remain stored and visible to managers as locked. They cannot be newly sent or played until capacity returns. Sticker messages contain independent attachment snapshots, preserving previously sent images after catalog deletion. Regular custom emoji history continues to render stored catalog images.

Level-2 servers can choose a 2–5 character alphanumeric tag under Server Tag. Members opt in through User Settings → Profiles. Losing eligibility or membership hides the tag. Level-3 servers configure two custom invites in Overview; each supports revision checks, name reservation, bans and grant expiry. Both use the same invite banner.

The automatically managed Server Booster role follows actual active Plus boosters. Platform boost grants set the level without pretending that members bought boosts. The managed role can be styled but cannot receive permissions, be manually assigned/deleted or elevate moderation rank. It is excluded from reusable server templates.

## Channels and voice

Stage channels start ordinary members in the audience without capturing their microphone. Members with Speak and Request to Speak can raise a hand. Manage Stage approves speakers. Returning a speaker to the audience follows role hierarchy. Server mute/deafen and loss of speaking permission disable capture transmission and suppress received tracks. Server mute/deafen survive reconnecting and moves within the server; moderator actions follow role hierarchy. Deafen also stops currently playing soundboard clips. Voice packets use WebRTC directly between peers; TURN configuration may still be needed on restrictive networks.

Media channels require an image, video, audio attachment or sticker for each new top-level post. Rules channels require Publish Rules or Manage Messages to publish. Threads can hold normal discussions. Announcement followers use ordinary text/announcement destinations, avoiding incompatible rules/media posting requirements.

Voice & Video provides noise suppression, echo cancellation, automatic gain control, microphone selection, volume and input mode. Browser/device support determines available audio processing. Push to talk holds V outside text fields and resets on focus loss. Disabling Use Voice Activity requires push to talk. Camera Video and Share Screen are independent permissions. Mute Members, Deafen Members and Move Members expose participant context-menu controls for lower-ranked members. Voice limits accept 0 (unlimited) through 99; Bypass Voice User Limit controls exceptions.

View Server as Role in the role editor previews saved permissions without changing the viewer’s assignments. The preview intersects the selected role’s visible channels with the viewer’s actual access, so it never grants access to hidden channels. Changes to roles/access close a stale preview.

## Platform reports

Platform Admin → Reports lists open/reviewing cases by default, with search, status filters, pagination and claiming. The owner has access; assignable staff roles need Review Platform Reports. Resolving or dismissing requires a reason and is recorded in the platform audit log. Revision checks prevent stale reviews overwriting another reviewer’s changes.

When reporting content, members can choose Also share with Voxora staff. Platform reviewers outside a channel see only that explicitly shared report’s saved evidence, reporter details and case status. They do not receive private channel history or internal server moderator notes. Older reports that were never shared remain visible to authorized channel reviewers. Existing server moderation review tools remain under Server Settings → Moderation.

Back up the complete persistent data directory, including state.json, uploads, profile-images, emojis, stickers and soundboard. The Android keystore and password require a separate secure backup outside the repository.

## External expressions and platform verification (3.3.1)

Type `:name:` for standard and custom emoji suggestions in chat or threads. Same-server custom emoji, stickers and soundboard stay free within the server's active slots. External emoji, stickers and soundboard require active Voxora Plus and the corresponding Use External permission in the destination channel. Source membership and asset-use permissions still apply. Sent emoji/sticker images are scoped to the destination message; sound playback is scoped to connected destination voice members.

The platform owner or staff with Verify Servers can review identities in Platform Admin → Server Verification. A name or owner change invalidates a verification decision. Review reasons stay private. The public `/safety` page accepts anonymous reports; the unified admin Reports queue has a source filter for those cases. See [Expression and safety guide](EXPRESSIONS-AND-SAFETY.md).
