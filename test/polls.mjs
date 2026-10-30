import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./support/server.mjs";

test(
  "native polls support voting, changing choices, withdrawal, moderation and durable helper commands",
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    try {
      const owner = await f.register("poll_owner"),
        member = await f.register("poll_member"),
        outsider = await f.register("poll_outsider");
      const O = (p, m, d) => f.call(owner, p, m, d),
        U = (p, m, d) => f.call(member, p, m, d);
      const s = (await O("/servers", "POST", { name: "Poll Lab" })).data,
        channel = s.channels[0].id;
      await U("/invites/join", "POST", { code: s.invite });
      assert.equal(
        (
          await O("/messages", "POST", {
            channel,
            poll: { question: "Bad", answers: ["same", "SAME"] },
          })
        ).status,
        400,
      );
      const created = await U("/messages", "POST", {
        channel,
        poll: {
          question: "What should we play?",
          answers: ["Adventure", "Party"],
          durationHours: 24,
          creatorId: owner.id,
        },
      });
      assert.equal(created.status, 201);
      const m = created.data;
      assert.equal(m.poll.creatorId, member.id);
      assert.equal(m.text, m.poll.question);
      assert.equal(
        (
          await f.call(outsider, "/polls/" + m.id + "/vote", "POST", {
            answers: [m.poll.answers[0].id],
          })
        ).status,
        404,
      );
      const first = m.poll.answers[0].id,
        second = m.poll.answers[1].id;
      assert.equal(
        (
          await U("/polls/" + m.id + "/vote", "POST", {
            answers: [first, second],
          })
        ).status,
        400,
      );
      await U("/polls/" + m.id + "/vote", "POST", { answers: [first] });
      let changed = await U("/polls/" + m.id + "/vote", "POST", {
        answers: [second],
      });
      assert.deepEqual(changed.data.poll.answers[0].voters, []);
      assert.deepEqual(changed.data.poll.answers[1].voters, [member.id]);
      changed = await U("/polls/" + m.id + "/vote", "POST", { answers: [] });
      assert.deepEqual(changed.data.poll.answers[1].voters, []);
      assert.equal(
        (await U("/messages/" + m.id, "PATCH", { text: "Changed question" }))
          .status,
        400,
      );
      const multi = (
        await O("/messages", "POST", {
          channel,
          poll: {
            question: "Pick several",
            answers: ["A", "B", "C"],
            multiple: true,
          },
        })
      ).data;
      assert.equal(
        (
          await U("/polls/" + multi.id + "/vote", "POST", {
            answers: multi.poll.answers.slice(0, 2).map((a) => a.id),
          })
        ).status,
        200,
      );
      await O("/channels/" + channel, "PATCH", {
        overwrites: [
          { type: "member", id: member.id, allow: [], deny: ["addReactions"] },
        ],
      });
      assert.equal(
        (await U("/polls/" + multi.id + "/vote", "POST", { answers: [] }))
          .status,
        403,
      );
      await O("/channels/" + channel, "PATCH", { overwrites: [] });
      assert.equal(
        (await U("/polls/" + multi.id + "/close", "POST", {})).status,
        403,
      );
      await U("/polls/" + m.id + "/close", "POST", {});
      assert.equal(
        (await U("/polls/" + m.id + "/vote", "POST", { answers: [first] }))
          .status,
        409,
      );
      await O("/servers/" + s.id + "/bots", "POST", {
        applicationId: "voxora-helper",
      });
      const commands = (await U("/commands?channel=" + channel)).data;
      assert.deepEqual(commands.map((c) => c.name).sort(), [
        "help",
        "ping",
        "poll",
        "roll",
        "server",
      ]);
      assert.equal(
        (
          await U("/commands", "POST", {
            channel,
            name: "roll",
            arguments: "100d6",
          })
        ).status,
        400,
      );
      const roll = await U("/commands", "POST", {
        channel,
        name: "roll",
        arguments: "2d6",
      });
      assert.equal(roll.status, 201);
      assert.match(roll.data.response.text, /Rolled \*\*2d6\*\*/);
      assert.equal(roll.data.response.bot, true);
      const poll = await U("/commands", "POST", {
        channel,
        name: "poll",
        arguments: "Next game? | Racing | Co-op",
      });
      assert.equal(poll.status, 201);
      assert.equal(poll.data.response.poll.creatorId, member.id);
      assert.equal(
        (await U("/polls/" + poll.data.response.id + "/close", "POST", {}))
          .status,
        200,
        "the person who invoked /poll can end it",
      );
      const helper = (await O("/servers/" + s.id + "/bots")).data[0].application
        .userId;
      await O("/channels/" + channel, "PATCH", {
        overwrites: [
          { type: "member", id: helper, allow: [], deny: ["sendMessages"] },
        ],
      });
      assert.equal((await U("/commands?channel=" + channel)).data.length, 0);
      assert.equal(
        (await U("/commands", "POST", { channel, name: "ping" })).status,
        403,
      );
      await O("/channels/" + channel, "PATCH", { overwrites: [] });
      await f.stop();
      await f.start();
      const restored = (await U("/messages?channel=" + channel)).data;
      assert.deepEqual(
        restored.find((v) => v.id === multi.id).poll.answers[0].voters,
        [member.id],
      );
      assert.equal(restored.find((v) => v.id === m.id).poll.closed, true);
      assert.equal(
        (await U("/commands", "POST", { channel, name: "ping" })).status,
        201,
      );
    } finally {
      await f.cleanup();
    }
  },
);
