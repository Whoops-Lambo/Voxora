# Threads, saved messages, and custom emoji

These features require **Voxora 2.7 or later** on the backend. Upgrade the shared server as well as desktop clients. Existing accounts, messages, roles, and channels are preserved.

## Threads

Right-click a message in a server text channel and choose **Create Thread**. Click its thread summary to open replies beside the channel, or use **Channel Threads** in the header to browse active and archived discussions. Mobile shows the discussion in a panel with a Close Thread button.

Threads inherit the parent channel's access rules. Everyone who can view that channel can read its threads; private threads and DM threads are not implemented. Losing channel access, being removed from the server, or being suspended removes access to replies, search results, saved content, and attachments. Bot installations must also permit the parent channel.

- **Create Threads** and **Send Messages** are required to start a discussion. New servers include Create Threads in their default member permissions. Existing roles keep their permissions; grant Create Threads explicitly when upgrading. Owners and administrators have access through their existing privileges.
- **Send Messages**, **Attach Files**, and **Add Reactions** govern replies, attachments, and reactions. Replies share the channel's slowmode cooldown with main-channel posts. Bots and existing moderation exemptions still bypass slowmode.
- The creator can rename, archive, and reopen an unlocked thread while retaining Send Messages. **Manage Threads** permits those actions plus locking, unlocking, and deleting. A manager can reopen a locked thread, but it remains read-only until unlocked.
- Archived and locked threads cannot receive replies, edits, or reactions. Authors can delete their own replies; channel message moderators can delete others' replies. Deleting the parent message or channel deletes its threads and replies. Deleting a thread keeps the parent message.
- Threads archive automatically after 24 hours without a new reply, checked periodically. Reopening restarts that timer. One thread per parent message and up to 1,000 threads per server are supported; channel lists show the 100 most recently active discussions in the selected archive state.
- Replies support up to 2,000 characters and five existing channel uploads, each subject to the usual 8 MB limit. Thread replies do not support polls, announcement publishing, or slash command invocation.

Read positions are private to your account and persist across devices. Channel Threads shows per-thread unread reply counts. A focused, visible thread acknowledges replies visible in its panel, while saved-message jumps into older history wait until you return to the latest replies. Thread activity currently has no separate Inbox cards, server badges, or desktop alerts.

The panel opens the latest 100 replies, supports loading earlier replies, and jumps to saved or searched replies outside that range. Deleting replies updates open panels immediately. Draft text stays on the current device until sent.

## Saved Messages

Right-click a message → **Save Message**, or select **Save Reply** in a thread. The bookmark button in the header opens **Saved Messages**, including from Friends. Search message text, author names, and your personal notes; **Open Message** returns to the source. Notes allow up to 500 characters, with up to 1,000 saves per account and 20 results per page.

Saves store references to messages, not frozen copies of their content. Edits appear in saved results. Deleted messages, blocked DMs, and channels you can no longer view show only an unavailable count; their text and notes are hidden from results. **Remove Unavailable Saves** clears those references. Restoring access makes a retained reference visible again. Your saves and notes are never sent to other accounts or bots. The backend operator can access its data files, so these notes are not end-to-end encrypted.

## Custom server emoji

Open **Server Settings → Emoji**. Members with **Manage Emoji** can upload, rename, and delete emoji. Other server members can use them through the picker without management permissions.

- PNG, GIF, and WebP images, up to **256 KB** and **256 × 256 pixels**. SVG is rejected. Use an image that renders correctly in a browser; the server checks file headers and dimensions rather than transcoding images.
- Up to **50 emoji per server**. Names use 2–32 letters, numbers, or underscores, normalized to lowercase, and must be unique in that server.
- Emoji work in that server's messages, thread replies, and reactions. Cross-server emoji use and custom emoji in DMs are not supported.
- Image downloads require authentication and current server membership. Bot image downloads additionally require an enabled installation with access to a channel in that server. Emoji images are server-wide assets, so they are not private to the channel where someone uses them.
- Renaming updates historical displays by ID. Deleting an emoji removes its asset and makes historical uses fall back to text aliases. Existing reaction records remain; new uses of a deleted emoji are rejected.
- Publishing an announcement copies its emoji images into the destination channel with normal attachment authorization. Followers do not need membership in the source server. Source renames, emoji deletion, or source-post deletion do not alter the published snapshot.

Back up the entire backend data directory, including **state.json**, **uploads/**, and **emojis/**. Thread replies, read positions, and saved references live in state.json; announcement snapshots use uploads/. These files contain private account data and should not be committed or included in source downloads.

## Human REST API

Use an authenticated human session. All paths below begin with `/api`; body examples are JSON except emoji uploads.

| Method and path | Behavior |
| --- | --- |
| `GET /threads?channel=:id&archived=0` | Accessible active threads; use `archived=1` for archived threads. |
| `POST /threads` | Create with `{messageId, name}`. Returns the existing thread if one already exists for that parent. |
| `GET /threads/:id` | Metadata, permission flags, and the caller's unread count/read sequence. |
| `PATCH /threads/:id` | Update `{name?, archived?, locked?}` with current permissions. |
| `DELETE /threads/:id` | Delete the thread and replies with Manage Threads. |
| `GET /threads/:id/messages` | Latest 100 replies and `hasOlder`/`hasNewer`. Use `before=:replyId` for an earlier page or `around=:replyId` to locate a reply. |
| `POST /threads/:id/messages` | Send `{text, files?, replyTo?}`; replies must target the same thread. |
| `POST /threads/:id/read` | Advance the caller's cursor with `{through: sequence}`; cursors cannot move backward. |
| `PATCH /thread-messages/:id` | Edit an own reply using `{text}`. |
| `DELETE /thread-messages/:id` | Delete an own reply, or another reply with Manage Messages. |
| `POST /thread-messages/:id/reactions` | Toggle `{emoji}` with Add Reactions. |
| `GET /saved-messages?q=&offset=0` | Private results, pagination, and unavailable-reference IDs without content. |
| `POST /saved-messages` | Save `{messageId, threadId?, note?}`; repeated saves reuse the existing record. |
| `PATCH /saved-messages/:id` | Replace the caller's `{note}`. |
| `DELETE /saved-messages/:id` | Remove the caller's save. |
| `DELETE /saved-messages/unavailable` | Remove the caller's inaccessible references. |
| `GET /servers/:id/emojis` | List server emoji metadata and insertion codes. |
| `POST /servers/:id/emojis?name=wave` | Upload raw image bytes with Manage Emoji; do not wrap in multipart or JSON. |
| `PATCH /servers/:id/emojis/:emojiId` | Rename with `{name}`. |
| `DELETE /servers/:id/emojis/:emojiId` | Delete the asset with Manage Emoji. |
| `GET /emojis/:id` | Authenticated image response with its canonical image MIME type. |

Custom emoji use the code `<:name:emoji-uuid>`. Message responses include `customEmojis` metadata for rendering authorized image URLs. Treat metadata as belonging to that response; published messages can reference copied attachment URLs rather than the original server asset. Thread search results include `threadId` so clients can open the reply panel.

Bots use the corresponding `/api/bot/threads` and `/api/bot/thread-messages` paths with Bot authorization. Personal saves and emoji management remain human-only. See [the bot guide](BOTS.md) for SDK methods, event types, and authenticated bot emoji downloads.
