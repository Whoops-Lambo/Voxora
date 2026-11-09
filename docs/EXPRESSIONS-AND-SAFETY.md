# Emoji, platform safety and verification

Voxora 3.3.1 adds these features to the shared backend. Deploy the current GitHub commit to Render, then reload the web/mobile clients. A desktop installer updates the desktop shell and its local workspace; it cannot deploy Render.

## Type an emoji name

Type `:rock` to see matching standard and custom emoji. Click an option, use Up/Down and Enter, or press Tab. Escape dismisses suggestions. Complete exact names such as `:rocket:` expand automatically. The catalog includes 1,870 Unicode emoji entries with shortcode aliases, plus server emoji from the servers you belong to. Chat and thread replies support completion; the emoji picker searches the same catalog. Code examples, escaped colons and URL separators do not trigger completion.

Custom emoji in their own server are available without Plus. External custom emoji, stickers and soundboard clips require **active Voxora Plus**, membership and permission in the source server, and the destination channel's Use External Emoji, Use External Stickers or Use External Soundboard permission. Ordinary emoji remain free everywhere. Direct messages count as external use for server assets. Plus does not bypass channel permissions or boost capacity limits.

When someone shares an external emoji or sticker, its message keeps a destination-scoped image copy. Recipients can view that message without joining the source server. This does not grant access to the source server's asset catalog. External sounds play to members connected to the destination voice channel, using a short-lived audience-scoped playback URL. Listeners do not need Plus. Deafen, blocks and volume controls still apply. Expired Plus prevents new external sends; existing message images remain visible to authorized readers.

## Website and anonymous reports

The homepage is `/`, Terms of Service `/terms`, Privacy Policy `/privacy`, and Safety Center `/safety`. The reporting form works without an account. It omits credentials and does not retain a reporter account, email, browser user agent or raw network address with a report. Temporary rate limits use a per-process hashed network key. Hosting providers may retain their own request logs. Reports themselves, evidence links and descriptions may identify people; the Privacy Policy explains these limits.

Save the report reference and private receipt key. The receipt checker returns only status and timestamps, never staff notes or report content. Staff with **Review Platform Reports** use Platform Admin → Reports → Anonymous website reports to review cases, claim them, resolve or dismiss them with a reason. The key is never exposed to staff. Closed cases are retained for up to 90 days; the bounded queue may remove older closed cases earlier when full. Pending cases remain until reviewed.

Reports are not monitored as an emergency service. The Safety Center directs immediate danger to local emergency services. Operators should review the public legal pages for their own organization and applicable obligations before relying on them as final legal advice.

Behind a reverse proxy, set `VOXORA_TRUST_PROXY_HOPS` only to the number of proxies that sanitize the incoming chain. The public launcher sets one hop for Render. Direct/local installs default to zero so an untrusted forwarded header cannot bypass a rate limit.

## Verify a server

The platform owner, or staff assigned **Verify Servers**, opens **Platform Admin → Server Verification**, reviews the current server name and owner, checks the acknowledgement and supplies a review reason. Verification appears in the app, Discovery and public invite previews. Review notes stay private to authorized platform staff. Verification grants no permissions or boosts and is not an endorsement of all server content. Changing the server name or owner invalidates verification until staff reviews it again.

## Manage Member

Manage Member now replaces the profile card with a dedicated management panel. Role changes, nickname controls and moderation actions open in the foreground. Available actions follow current server role hierarchy and permissions; changing permissions while the panel is open cannot authorize an old action.
