# Voxora 3.0: Community Studio and Notebook

Open **Studio** in the top navigation to choose a community, or **Community Studio** in a server sidebar/menu. Home shows your open assigned tasks and nearby giveaways across the communities you can access. Local Workspace works without a domain. Hosted backends must run the 3.0 source.

## Project boards

Create a task in a text channel with a title, description, priority, optional assignee and deadline, and up to five labels. Right-click a chat message and select **Create Project Task** to keep a live source reference. Deleted source messages lose their preview. Task visibility follows current channel permissions; private-channel tasks never appear in another member’s board or Home without access.

The board has **To do**, **In progress**, and **Done** columns. Drag a card or use its accessible status selector. Search titles, filter by channel/status, or select **Assigned to me**. The creator and users with **Manage Projects** may edit details, archive, restore or delete tasks. An assignee can update progress. Members who can send in the channel may add comments. Changes carry a revision: a stale edit fails instead of overwriting newer work. Task/comment mutations also require current Send Messages permission.

Open a task for its discussion, source message and actions. Archiving hides it from the active board; select Archived to restore it. Deleting removes its comments. Communities may retain 500 tasks, including archived ones, with up to 100 comments on each task. Delete old items to make room. Lists page in batches of 100.

## Community giveaways

The **Manage Giveaways** permission enables New Giveaway. Choose a text channel, title, description, an end time and 1–10 winners. An optional role controls eligibility. Members enter for free with **Enter Giveaway**, and may leave before it closes. Bot accounts cannot enter.

Eligible entrants must still be active human members, able to view and send in the selected channel, and hold the required role when the draw occurs. Repeated entry requests never create extra chances. The backend automatically draws after the deadline while it is running; overdue draws run when the backend starts again. Local Workspace therefore needs its app open. A hosted backend can draw while clients are closed.

Winners are selected using Node’s cryptographic random generator, without duplicates. The draw and its final state are saved together. It cannot be rerun through the API. If fewer eligible members remain than the requested count, it saves fewer winners; no eligible entries means no winner. Managers can draw early or cancel before the draw. Ended and Cancelled filters show history, and managers can delete closed history. Up to 500 giveaways are retained per community. Giveaway configuration cannot be edited after creation.

Prize delivery is handled by the organizer. Voxora has no paid entries, payment collection or automatic prize fulfillment. The entry list is not exposed through the public view; each member sees their own entry state, eligible-entry count and saved winners.

## Community insights

**Insights** requires **View Community Insights** or Manage Server. Choose 7 or 30 UTC calendar days. The page shows message totals, active human authors, member/bot totals, threads, completed tasks, a daily chart and the most active visible channels. Message totals include thread replies. Current message history is used, so deletion changes historical totals. The channel chart and activity counts exclude channels the viewer cannot read. Insights return aggregate totals rather than message text or a ranked list of people.

## Private notebook

Open the pen icon **Notebook**, or Home → Your private notebook. Create a titled page, choose Mint/Copper/Iris, and save up to 12,000 characters. Use **Insert Checklist**, or write `- [ ] Item` lines. Preview checkboxes toggle the matching lines; **Save Note** saves those changes. Pin pages, search title/content, export a saved note or download an unsaved draft as UTF-8 text.

Notes are private to the owning account through the app, including against platform staff. They sync between that account’s sessions on the same backend. Saving uses a revision check. If another device saved a newer version, your local draft remains in the editor with a conflict message; download it before reopening the newer note. Notes are manually saved, not autosaved. Closing an unsaved editor can discard its draft. Deletion also checks the current revision. Each account may keep 200 notes.

## Bots and API

The bot starter ZIP now contains **start-studio-bot.bat**, in addition to the unchanged community/economy/moderation starter. Create a separate bot application in Developer Portal for the Studio bot: registering its two commands replaces that application’s command list. Put its URL/token in `.env`, install it in the community, and launch start-studio-bot.bat. `/projects` lists tasks and `/giveaways` lists open giveaways in the invocation’s channel. Keep tokens private.

The SDK adds `getCommunityStudio`, `getProjectTasks`, `createProjectTask`, `updateProjectTask`, `getGiveaways`, `createGiveaway`, `endGiveaway` and `getCommunityInsights`. Bot installation scopes and current channel permissions still apply. Giveaway creation requires Manage Giveaways; bots cannot enter. A bot acting on a human command must also authorize the human caller; the shipped Studio bot exposes read-only commands in the invocation channel.

Human routes are under `/api/servers/:serverId/studio`, with `/tasks`, `/tasks/:id`, `/giveaways`, `/giveaways/:id`, and `/insights?days=7|30`. Bot routes use `/api/bot/servers/:serverId/studio`. List with `q`, `channel`, `status`, `offset`, and tasks optionally `assigned=me`. Create requests optionally include a UUID `nonce` for idempotent retry. Task patches require `revision`; comments are a separate patch `{revision, comment}`. Deletes require `?revision=<current>`.

Giveaway actions use POST `/giveaways/:id/enter|leave` with `{}`, or `/end|cancel` with `{revision}`. Private notes use human-only `/api/me/notes` and `/api/me/notes/:id`; edits/deletes require the current revision. Unknown write fields and cross-account notebook IDs are rejected.
