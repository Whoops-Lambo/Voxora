# Forum channels

Choose **Forum** when creating a channel. Forums use the normal text-channel access, category inheritance, private-channel overrides and slowmode, with titled posts and one discussion per post. They cannot become announcement channels or receive followed announcements.

Open **Forum Settings** with Manage Channels to define up to 20 unique colored tags and optionally require a tag for new posts. A post can use up to five tags and an 80-character title. Content and attachment limits follow the author's current plan. A local draft retains the title, content and chosen tags for that account/channel until posting succeeds.

The board searches titles/content, combines selected tag filters, pages through results, and sorts by activity, creation time or reply count. Moderator-pinned posts appear first. Choose Active, Archived or All Posts, or filter unread discussions. **Mark New Posts as Read** clears new-parent-post markers; opening a discussion acknowledges its visible replies separately.

Posting requires Send Messages and Create Threads. The original author can edit their post content and tags; thread managers can rename posts and edit tags, while message moderators can edit tags and pin or delete posts. Moderators cannot rewrite another author's content. Original-post content can be edited independently of whether its discussion accepts replies. Thread permissions control archive/reopen and moderator-only locks. Locked/archived discussions reject replies. Delete the post to remove its complete discussion; deleting only its forum thread is rejected.

AutoMod inspects both the title and content, including edits through the generic message/thread routes. Slowmode and onboarding apply at posting time. Reads, searches, edits and delayed request bodies recheck current channel access. Optimistic revisions protect edits from overwriting newer post or tag-setting changes.

## API and bot SDK

- `GET /api/forums/:channel` returns current settings and management availability.
- `PATCH /api/forums/:channel` accepts `{version,tags:[{id?,name,color}],requireTag}`. Existing tags retain their IDs; omit id for new tags. Only human channel managers can configure forums.
- `GET /api/forums/:channel/posts` accepts `q`, `sort=active|newest|oldest|replies`, `archived=0|1|all`, repeated `tag` IDs, `unread=1` and `offset`. Pages contain 20 posts.
- `POST /api/forums/:channel/posts` accepts `{title,text,tagIds,files}` and returns the post's message and automatically created thread.
- `GET /api/forum-posts/:id` returns the post, permissions and current revision.
- `PATCH /api/forum-posts/:id` accepts `{revision,title?,text?,tagIds?,pinned?}`; stale changes return 409.
- Existing thread APIs provide replies, reactions, archive/lock and read positions. Existing message deletion removes the post and replies.

Bot equivalents use `/api/bot/...` and the existing `Authorization: Bot ...` header. They enforce the bot's installation channel allowlist and role permissions. Forum configuration and human private saves remain unavailable to bots.

```js
const posts = await bot.getForumPosts(channelId, { q: 'release', sort: 'active' });
const post = await bot.createForumPost(channelId, {
  title: 'Release discussion',
  text: 'What should we improve next?',
  tagIds: [], // Choose configured tag IDs when the forum requires a tag.
});
await bot.sendThreadMessage(post.thread.id, 'A follow-up in the discussion.');
const latest = await bot.getForumPost(post.message.id);
await bot.updateForumPost(post.message.id, {
  revision: latest.revision,
  title: 'Updated release discussion',
});
```

The gateway's message-create event includes `forumPost.title`, tag IDs and the thread summary. Existing thread-message events deliver replies. Template exports retain the forum layout and tag configuration without copying posts or discussions. The existing limit of 1,000 threads per server also covers forum posts.
