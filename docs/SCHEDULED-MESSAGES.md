# Scheduled messages and device drafts

Select the clock beside the message composer to schedule a text message or reply. **Home → Send it later → Schedule Message** can also choose a destination. Enter a local date and time, or use the one-minute, one-hour and tomorrow presets. Times are stored as absolute timestamps and displayed in the device's current timezone.

**Outbox** in the top bar and **Scheduled Messages** in the Home sidebar show your private queue. Edit the text/time, choose **Send Now**, or cancel before delivery starts. The status selector shows Queued, Needs attention, Sent, Cancelled and All. Sent items link back to the posted message. Removing history never deletes a posted message. Each account can keep 50 queued messages and 200 total outbox records.

Only the author can see or change queued text, including when another account has platform administration. Outbox updates sync across the author's signed-in sessions on the same backend. Private change events contain no message text. Destination names disappear when channel access is lost or a DM is blocked.

Delivery uses the normal message pipeline. Current membership, channel permissions, onboarding rules, timeouts, account suspension, DM blocks, message length/Plus access, reply targets, custom emoji, slowmode and AutoMod still apply. A failure moves the item to Needs attention with a reason; it never silently retries after access returns. Review and explicitly reschedule it or choose Send Now. A message already being delivered cannot be edited or cancelled.

The backend must be running to send queued messages. A shared backend can send while your client is closed. A Local Workspace sends while its app/backend is running; overdue queued messages are processed when it starts again. The posted message and its sent receipt are saved together, preventing restart delivery from creating a second copy. Scheduling is checked about once per second in bounded batches, rather than guaranteeing exact-second delivery.

This release schedules plain text and replies in ordinary text/announcement channels and direct messages. Attachments, polls, bot commands, forums and threaded replies are not scheduled. Scheduled announcement messages use the normal post behavior; publishing to followers remains a separate action.

**Home → Drafts on this device** collects unsent composer text from this browser or desktop profile. Continue writing, schedule a draft, or clear it. Drafts survive reloads, stay separated by account and hide destinations you can no longer read. Drafts do not sync to other devices and do not retain attachments. Signing out clears the visible composer while retaining that account's saved drafts. Portable appearance exports contain no drafts or queued text.

Hosted backends need the 2.16 source update for the scheduling API. Installed Local Workspaces include it with the desktop update. No domain is required.

## API

Human sessions can use `GET/POST /api/me/scheduled-messages` and `GET/PATCH/DELETE /api/me/scheduled-messages/:id`. Bot tokens cannot use private outboxes. List with `?status=queued|failed|sent|cancelled|all&offset=0`, 50 records per page. List responses also include a private summary.

Create with `{channel, text, sendAt, replyTo?, nonce}`. Generate a unique nonce (for example `crypto.randomUUID()`) and keep it when retrying the same request; reusing it with changed content returns 409. Send times must be at least one second ahead and within a year.

Patch with the current `revision` and either `{text?, sendAt?}` or `{action: "cancel" | "send-now"}`. Stale revisions return 409. Delivery also increments revisions. Failed messages require a future time when edited, or the explicit send-now action. Delete only non-queued, non-delivering history. Unknown fields and cross-account IDs are rejected.
