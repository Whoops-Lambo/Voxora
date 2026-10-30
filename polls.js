import { randomUUID } from "node:crypto";

export function normalizePoll(value, creatorId, fail) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.question !== "string" ||
    !value.question.trim() ||
    value.question.length > 300
  )
    fail(400, "Enter a poll question of 300 characters or fewer.");
  if (
    !Array.isArray(value.answers) ||
    value.answers.length < 2 ||
    value.answers.length > 10 ||
    value.answers.some(
      (a) => typeof a !== "string" || !a.trim() || a.length > 80,
    )
  )
    fail(400, "A poll needs 2–10 answers, each 80 characters or fewer.");
  const answers = value.answers.map((a) => a.trim());
  if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length)
    fail(400, "Poll answers must be different.");
  if (value.multiple !== undefined && typeof value.multiple !== "boolean")
    fail(400, "Invalid poll choice setting.");
  const hours = value.durationHours ?? 24;
  if (![1, 4, 8, 24, 72, 168].includes(hours))
    fail(400, "Choose a poll duration from 1 hour to 7 days.");
  return {
    question: value.question.trim(),
    answers: answers.map((text) => ({ id: randomUUID(), text, voters: [] })),
    multiple: !!value.multiple,
    closesAt: Date.now() + hours * 3600000,
    closed: false,
    creatorId,
  };
}
export const pollClosed = (poll) => poll.closed || poll.closesAt <= Date.now();
export function pollService({
  state,
  body,
  fail,
  json,
  canRead,
  canChannel,
  save,
  channelEvent,
  messageView,
}) {
  async function handle(req, res, url, me) {
    const match = url.pathname.match(/^\/api\/polls\/([\w-]+)\/(vote|close)$/);
    if (!match) return false;
    if (req.method !== "POST") fail(405, "Method not allowed.");
    const data = await body(req);
    const m = state.messages.find((m) => m.id === match[1]);
    if (!m?.poll || !canRead(me, m.channel)) fail(404, "Poll not found.");
    if (match[2] === "vote") {
      if (!canChannel(me, m.channel, "addReactions"))
        fail(403, "You cannot vote in this channel.");
      if (pollClosed(m.poll)) fail(409, "This poll has ended.");
      if (
        !Array.isArray(data.answers) ||
        new Set(data.answers).size !== data.answers.length ||
        data.answers.length > (m.poll.multiple ? m.poll.answers.length : 1) ||
        data.answers.some((id) => !m.poll.answers.some((a) => a.id === id))
      )
        fail(400, "Invalid poll choices.");
      for (const answer of m.poll.answers) {
        answer.voters = answer.voters.filter((id) => id !== me.id);
        if (data.answers.includes(answer.id)) answer.voters.push(me.id);
      }
    } else {
      if (
        !canChannel(me, m.channel, "manageMessages") &&
        !(
          [m.authorId, m.poll.creatorId].includes(me.id) &&
          canChannel(me, m.channel, "sendMessages")
        )
      )
        fail(
          403,
          "Only the poll creator or a message moderator can end this poll.",
        );
      m.poll.closed = true;
    }
    await save();
    channelEvent(m.channel, {
      type: "message-update",
      message: messageView(m),
    });
    json(res, 200, messageView(m));
    return true;
  }
  async function sweep() {
    const ended = state.messages.filter(
      (m) => m.poll && !m.poll.closed && pollClosed(m.poll),
    );
    if (!ended.length) return;
    for (const m of ended) m.poll.closed = true;
    await save();
    for (const m of ended)
      channelEvent(m.channel, {
        type: "message-update",
        message: messageView(m),
      });
  }
  return { handle, sweep };
}
