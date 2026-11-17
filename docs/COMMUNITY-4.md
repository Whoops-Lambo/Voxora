# Voxora 4.0: community management

See [where to find every control](COMMUNITY-FEATURE-LOCATIONS.md).

Server Settings now includes **Server Management**, **Webhooks & Widgets**, **Reaction Roles & Leveling**, and **Server Store**. Existing role templates, temporary roles, channel overrides, role previews, announcement following/publishing, forum tags, threads and Stage moderation remain available.

## Memberships

Voxora Max costs **US$24.99/month or US$149.99/year**. Plus pricing is unchanged. Platform owners can grant either membership in **Admin → Voxora Max** (Max) or **Admin → Plus** (Plus), with an expiry and audit reason. Grants never charge the recipient.

| Capability | Free | Plus | Max |
| --- | ---: | ---: | ---: |
| Owned bot applications | 20 | 100 | 250 |
| Commands per bot | 200 | 400 | 1,000 |
| Group chat members | 20 | 40 | 80 |
| Custom app themes | 0 | 2 | 10 |
| Personal upload limit | 8 MB | 25 MB | 100 MB |
| Message/reply length | 2,000 | 4,000 | 8,000 |
| Included boost slots | 0 | 2 | 6 |
| Voice message duration | 2 min | 5 min | 15 min |
| Workspace Scenes | 0 | 0 | 20 |
| Recovery for owned servers | 30 days | 30 days | 90 days |

Group capacity follows its owner's current plan. Downgrades retain saved content and applications; creating new content and using excess command/theme/boost slots follows the current entitlement. Existing channel permissions still apply.

**Workspace Scenes** save a member's current custom theme, personal channel list and DM folders together. Apply a scene to switch layouts quickly. Restored layouts discard channels and conversations the member can no longer access. Shared theme codes import a color snapshot; revoking a code prevents future imports, while previously imported snapshots remain usable. Delete a custom theme to free a creation slot.

## Channels and discussions

- **Stage:** speakers and audience, requests to speak, promotion/demotion, moderator mute/deafen/move, and Stage text chat. Camera and screen sharing require speaker status and their respective permissions.
- **Forum:** titled posts, configurable/required tags, sorting and filtering, threaded replies, archives/locks and moderation.
- **Rules & Onboarding:** publisher-only rules alongside the Server Guide, rules screening and optional roles. Configure the guide in Server Settings → Onboarding.
- **Media / Showcase:** media-required posting with gallery presentation. Images, video, audio and stickers qualify.
- **Threads:** move a discussion to another channel or merge it into another thread/forum discussion from its controls. Requires Manage Threads and visibility in both channels. Expanding its audience requires explicit administrator confirmation. Attachments receive new destination-scoped copies; mentions are not repeated.
- **Announcements:** use Follow to select an eligible destination server/channel, then Publish individual source messages. Existing follow permissions and publication receipts remain enforced.

These are Voxora implementations of familiar community workflows, not a promise of complete Discord parity. The voice transport remains peer-to-peer. Stage seat numbers are enforced entitlement caps, not a claim that 500 simultaneous video participants have been load-tested; large broadcasts need an SFU deployment.

## Boosts

Levels unlock at **2, 7, 14, 30 and 50 active boosts**, or an authorized platform boost grant. Higher levels include earlier branding benefits.

| Benefit | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Emoji slots | 125 | 250 | 500 | 750 | 1,000 |
| Sticker slots | 25 | 50 | 100 | 150 | 250 |
| Soundboard slots | 35 | 60 | 90 | 150 | 250 |
| Server upload limit | 20 MB | 50 MB | 100 MB | 150 MB | 250 MB |
| Stage video seats | 60 | 120 | 150 | 250 | 500 |
| Recovery retention | 30 days | 30 days | 30 days | 60 days | 90 days |
| Featured store products | 0 | 0 | 0 | 3 | 10 |

Level 1 adds animated server icons and an invite background. Level 2 adds animated invite backgrounds, a static server banner, custom role icons and server tags. Level 3 adds animated banners, animated role icons and custom invite links. Levels 4 and 5 add the larger limits, longer recovery and storefront highlights above. Upload allowance uses the larger of the member's personal plan and server allowance.

Uploaded GIF/WebP animation is normalized and requires the corresponding current boost entitlement. Unsupported branding/icons become unavailable after downgrade, retaining their saved bytes for reactivation or replacement. Static avatars remain normalized PNGs. The unboosted sticker quota remains 30; level 1's requested quota is 25. Existing over-quota assets are retained but excess slots become inactive.

## Recovery, roles and audit

Only owners and administrators can read or restore the recycle bin. Channel deletion captures its effective permissions, messages, threads and attachments. A restored channel does not silently inherit a category's newer permissions. Restore a parent channel/thread before its separately deleted replies. Expired or permanently deleted records cannot be restored. This recovery window is not an external backup.

Role-restricted custom emojis validate the sender's current roles for both messages and reactions. Manage Roles and normal hierarchy checks govern role icon changes; level 2 permits static icons and level 3 permits animation. Removed boost benefits do not prevent deleting a saved icon.

Reaction-role mappings and level rewards accept only optional roles without staff/channel-management powers. Automated assignments do not raise moderation rank. Removing a mapping preserves a separately assigned role. XP awards 20 points for eligible non-repeated human messages, at most once per minute. Server members can open **Level Leaderboard**; staff configure rewards in Server Settings.

Audit logs retain the latest 5,000 actions, including join/leave and management/recovery actions. Search or export matching entries from **Audit Log**. **View Server as Role** tests channel visibility and effective permissions without changing your membership.

## Integrations and message tools

Incoming webhooks use an assigned channel and a secret URL returned once at creation. Revoke them in Server Settings. Treat the URL like a password. Bots support safe HTTPS links, structured embeds and up to 25 link/action buttons. Action buttons produce component interactions on the normal bot gateway; they cannot execute arbitrary code in the client. See [bot integration examples](RICH-MESSAGES.md).

A live chat widget intentionally publishes the latest 50 plain-text messages from an explicitly confirmed public channel. Administrators configure allowed website origins, then copy the generated embed script. Private channels cannot be embedded. Making the channel private or revoking the integration removes widget access. Visitor tickets expire after an hour; messages use a Website Visitor identity, rate limits and server AutoMod. Account credentials are not used by widget guests.

Search accepts phrases and `from:`, `in:`, `before:`, `after:`, `mentions:`, `has:` and `is:` filters, with `OR`, `NOT` and `-term` exclusions. Dates use UTC calendar days. Example: `has:embed OR in:general release NOT draft`. Results always follow current visibility and block rules.

Personal channel lists and DM folders organize your view without changing server order or anybody else's folders. Account Switcher in User Settings remembers successfully signed-in accounts on the same device/backend, using HttpOnly tokens tied to live sessions. Revoking a session removes its switch proof. No passwords are stored by the switcher.

## Desktop and mobile

**Ctrl+Shift+O** opens the desktop Game Chat window over windowed/borderless games. Change the shortcut in User Settings → My Account. Game detection is opt-in per account and reports only recognized Windows game names. Manual Playing status is also available. Exclusive-fullscreen injection is not implemented.

Voice participant cards provide independent voice and stream-audio sliders, saved per account. Pop-out Audio Controls uses browser picture-in-picture when available and an in-app panel otherwise. Voice settings include join/leave sound controls. Screen audio depends on the source and operating system exposing an audio track.

Server settings, webhooks, channel controls, storefronts and theme controls use the responsive mobile layout. The signed Android 4.0 Play bundle consumes existing digital memberships; in-app Stripe digital purchase/portal links are disabled until Play Billing or an applicable external-payment program is integrated. Physical products retain Stripe checkout. Google developer verification and store review are separate from building/signing the AAB.

## Deployment

Run `npm ci`, `npm run check`, and `npm test`. Sharp supplies native image normalization on Linux and Windows and is included in the desktop payload. The exact-installer Windows workflow also exercises a normalized role icon through the installed backend.

Deploy the current backend and frontend together, retaining `VOXORA_DATA_DIR`. A desktop installer update alone cannot update the remotely hosted public service. The existing hash-checked automatic desktop update mechanism is preserved; stable is advanced only after Windows verifies the exact candidate binary. See [shop setup](SERVER-SHOPS.md) for credentials that enable payments.
