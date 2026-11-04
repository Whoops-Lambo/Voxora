# Pictures, branding and custom invites

Voxora 3.1 adds free profile pictures, server icons, server banners and separate invite banners. Open **User Settings → Profiles** for your avatar, pronouns, up to three labeled website links and a live profile preview. Open **Server Settings → Overview** for community branding and custom invite links. Server branding requires **Manage Server**.

Choose PNG, JPEG, WebP or GIF files up to 10 MB. Adjust the crop, zoom and position, then save. The app saves a static PNG, with square avatars/icons and a 16:9 banner. Animated source images become a still picture. Removing a picture restores initials or the default banner. Changes sync to messages, member lists, profile cards, community navigation, Home and Discovery. Existing chat attachments are unaffected.

Profile links accept HTTP and HTTPS websites; embedded credentials and executable URL schemes are refused. Avatar and ordinary server image URLs require an authenticated account with access to the relevant person or community. Picture files live in the backend's persistent `profile-images` directory alongside its state; include both in backups. Changing the desktop installation folder does not move backend data.

## Level 3 custom links

Servers reach boost levels 1, 2 and 3 at **2, 7 and 14 active member boosts**. Emoji capacity is 100, 150 and 250 respectively (50 at level 0). Level 3 unlocks a custom invite name. A platform boost grant can also unlock the level.

In **Server Settings → Overview → Custom Invite Link**, enter 3–32 letters, numbers or hyphens. Names start and end with a letter or number and are stored in lowercase. Select **Save Custom Invite**, then **Copy Custom Invite**. The address uses the backend you are currently connected to, such as `http://192.168.1.20:3000/invite/mint-garden`. No voxora.com address is required. A localhost link works only on the same computer; other people need a reachable shared backend.

Names are unique across this backend and cannot reuse an existing regular invite code. Dropping below level 3 pauses the custom link and keeps its name reserved. The same link works again when level 3 returns. Managers can remove the custom invite to release its name. Regular invite codes keep their existing expiry/use limits and work independently of the custom link. All joins still check server bans.

The **Invite Banner** is separate from the ordinary server banner and works on regular and custom invite links at every level. Invite pages show the community name, description, member count, icon and invite banner before sign-in; they fall back to the server banner when no invite banner is set. Anyone holding a valid invite can view those branding images. Invalid, expired, removed and paused invite codes stop granting public image access. Messages, member identities and channels are excluded from the public preview. Signing in still requires selecting **Join Server**.

## Grant a level in Platform Admin

1. Open **Platform Admin → Server Boosts** as the first-account platform owner.
2. Search for the server and select **Grant Boost Level**.
3. Choose level 1, 2 or 3. Enter a duration in minutes, hours or days, or select **Unlimited time**. Enter an audit reason and save.
4. Use **Change Boost Grant** to replace its duration/level or **Revoke Boost Grant** to remove the grant.

The grant sets a minimum level. It does not add fake member boosts or issue Plus subscriptions, and member boosts can earn a higher level. Expiry or revocation restores the level earned from active members. Active grants and their expiry appear in server settings; internal reasons and staff identities stay in authorized admin/audit views. Grants persist across backend restarts; elapsed time continues while it is offline.

To delegate this tool, create or edit a role in **Platform Admin → Staff Roles**, enable **Manage Server Boosts**, and assign it from **Accounts**. Ordinary server owners and server roles cannot grant platform boosts. Concurrent changes require a refresh rather than silently replacing another administrator's grant.

## Update existing installations

Installed Windows apps discover 3.1 through the official update feed and offer **Restart and Install** after verification. A separately hosted backend must also pull the new source, run `npm ci`, and restart. Keep its existing persistent data directory. No domain is required for Local Workspace.
