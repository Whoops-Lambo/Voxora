import { randomInt } from "node:crypto";

const definitions = [
  ["bothelp", "utility", "Show commands by category.", "/bothelp [moderation|economy|utility]"],
  ["echo", "utility", "Repeat a message.", "/echo Your message"],
  ["roll", "utility", "Roll up to 20 dice.", "/roll 2d6"],
  ["choose", "utility", "Pick between your options.", "/choose Option one | Option two"],
  ["eightball", "utility", "Ask the magic eight ball.", "/eightball Will we win?"],
  ["serverinfo", "utility", "Show server information.", "/serverinfo"],
  ["userinfo", "utility", "Show a member's profile.", "/userinfo [@username]"],
  ["poll", "utility", "Create a poll with 2–10 choices.", "/poll Question | Choice one | Choice two"],
  ["warn", "moderation", "Record a warning for a lower-ranked member.", "/warn @username Reason"],
  ["warnings", "moderation", "Review a member's warnings.", "/warnings @username"],
  ["clearwarns", "moderation", "Clear a member's warnings.", "/clearwarns @username [reason]"],
  ["timeout", "moderation", "Timeout a lower-ranked member for up to 28 days.", "/timeout @username 10m [reason]"],
  ["untimeout", "moderation", "Remove a member's timeout.", "/untimeout @username [reason]"],
  ["kick", "moderation", "Kick a lower-ranked member.", "/kick @username [reason]"],
  ["ban", "moderation", "Ban a lower-ranked member.", "/ban @username [reason]"],
  ["unban", "moderation", "Revoke a ban by username or user ID.", "/unban @username-or-id [reason]"],
  ["purge", "moderation", "Delete 1–50 recent unpinned messages.", "/purge 10 [reason]"],
  ["balance", "economy", "Show a member's credits.", "/balance [@username]"],
  ["daily", "economy", "Claim 250 credits every 24 hours.", "/daily"],
  ["work", "economy", "Earn 25–100 credits every 15 minutes.", "/work"],
  ["pay", "economy", "Give credits to another member.", "/pay @username 100"],
  ["leaderboard", "economy", "Show the server's ten richest members.", "/leaderboard"],
  ["shop", "economy", "Browse collectible badges.", "/shop"],
  ["buy", "economy", "Buy a collectible.", "/buy bronze"],
  ["inventory", "economy", "Show collected badges.", "/inventory [@username]"],
];
export const commands = definitions.map(([name, , description, usage]) => ({ name, description, usage }));
export const shop = [
  { id: "bronze", name: "Bronze badge", price: 250 },
  { id: "silver", name: "Silver badge", price: 1000 },
  { id: "diamond", name: "Diamond badge", price: 5000 },
];
class CommandError extends Error {}
const need = (condition, message) => { if (!condition) throw new CommandError(message); };
function member(context, value, banned = false) {
  const text = (value || "").replace(/^<@!?([\w-]+)>$/, "$1").replace(/^@/, "").toLowerCase();
  const user = (banned ? context.bannedMembers : context.members).find((u) => u.id === text || u.username.toLowerCase() === text);
  need(user, "Member not found. Use @username or their user ID.");
  return user;
}
const account = (state, server, user) => {
  state.servers[server] ||= { accounts: {} };
  return state.servers[server].accounts[user] ||= { balance: 0, lastDaily: 0, lastWork: 0, inventory: [] };
};
const balance = (state, server, user) => state.servers[server]?.accounts[user]?.balance || 0;
const wait = (ms) => Math.max(1, Math.ceil(ms / 60000)) + " minute(s)";
const money = (value) => value.toLocaleString("en-US") + " credits";

export async function handleCommand(interaction, context, store, now = Date.now()) {
  const name = interaction.command, args = interaction.arguments.trim(), parts = args.split(/\s+/).filter(Boolean);
  const usage = commands.find((c) => c.name === name)?.usage;
  const sid = context.server.id, uid = interaction.user.id;
  try {
    if (name === "bothelp") {
      const category = args.toLowerCase();
      need(!category || ["moderation", "economy", "utility"].includes(category), "Choose moderation, economy, or utility.");
      return { text: "**Voxora Community Bot**\n" + (category
        ? definitions.filter(([, group]) => group === category).map(([, , description, usage]) => "`" + usage + "` — " + description).join("\n")
        : ["moderation", "economy", "utility"].map((group) => "**" + group + "**: " + definitions.filter(([, g]) => g === group).map(([n]) => "`/" + n + "`").join(", ")).join("\n") + "\nUse `/bothelp economy`, `/bothelp moderation`, or `/bothelp utility` for usage.") };
    }
    if (name === "echo") return { text: args || "Try /echo followed by a message." };
    if (name === "roll") {
      const match = /^(\d{1,2})d(\d{1,4})$/i.exec(args || "1d6");
      need(match && +match[1] >= 1 && +match[1] <= 20 && +match[2] >= 2 && +match[2] <= 1000, "Use /roll NdM with 1–20 dice and 2–1000 sides.");
      const rolls = Array.from({ length: +match[1] }, () => randomInt(1, +match[2] + 1));
      return { text: "🎲 " + rolls.join(" + ") + " = **" + rolls.reduce((sum, n) => sum + n, 0) + "**" };
    }
    if (name === "choose") {
      const choices = args.split("|").map((s) => s.trim());
      need(choices.length >= 2 && choices.length <= 20 && choices.every((s) => s && s.length <= 100), "Use /choose First option | Second option (2–20 options).");
      return { text: "I choose: **" + choices[randomInt(choices.length)] + "**" };
    }
    if (name === "eightball") {
      need(args, "Ask a question after /eightball.");
      const answers = ["Definitely.", "The outlook is good.", "Probably.", "Ask again later.", "Hard to say.", "Unlikely.", "Definitely not."];
      return { text: "🎱 " + answers[randomInt(answers.length)] };
    }
    if (name === "serverinfo") return { text: "**" + context.server.name + "**\n" + context.server.memberCount + " members\nServer ID: `" + sid + "`" };
    if (name === "userinfo") {
      const user = args ? member(context, args) : context.user;
      return { text: "**" + user.displayName + "** · @" + user.username + "\n" + (user.bot ? "Bot" : "Member") + " · " + user.status + "\nAccount created: " + new Date(user.createdAt).toISOString().slice(0, 10) + "\nUser ID: `" + user.id + "`" };
    }
    if (name === "poll") {
      const [question, ...answers] = args.split("|").map((s) => s.trim());
      need(question && answers.length >= 2 && answers.length <= 10 && answers.every(Boolean), "Use /poll Question | Choice one | Choice two (2–10 choices).");
      return { poll: { question, answers, durationHours: 24 } };
    }
    if (definitions.some(([n, group]) => n === name && group === "moderation")) {
      const request = { action: name };
      if (name === "purge") {
        need(/^[1-9]\d?$/.test(parts[0] || "") && +parts[0] <= 50, "Use /purge 1–50 [reason].");
        request.count = Number(parts.shift());
      } else {
        request.targetId = member(context, parts.shift(), name === "unban").id;
        if (name === "timeout") {
          const match = /^([1-9]\d{0,6})(s|m|h|d)$/i.exec(parts.shift() || "");
          need(match, "Use /timeout @username 10m [reason]. Durations accept s, m, h, or d.");
          request.durationSeconds = +match[1] * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()]);
          need(request.durationSeconds <= 28 * 86400, "Timeouts may last up to 28 days.");
        }
      }
      request.reason = parts.join(" ");
      need(request.reason.length <= 500, "Keep the reason to 500 characters or fewer.");
      if (name === "warn") need(request.reason, "Use /warn @username Reason.");
      const result = await interaction.moderate(request);
      if (name === "warnings") return { text: "**" + result.displayName + "** has " + result.count + " warning(s)." + (result.warnings.length ? "\n" + result.warnings.map((w) => "• " + new Date(w.createdAt).toISOString().slice(0, 10) + ": " + w.reason).join("\n").slice(0, 1700) : "") };
      if (name === "purge") return { text: "Removed " + result.count + " unpinned message(s)." };
      if (name === "warn") return { text: "Warned **" + result.displayName + "**. Total warnings: " + result.count + ".\nReason: " + request.reason };
      if (name === "clearwarns") return { text: "Cleared " + result.count + " warning(s) for **" + result.displayName + "**." };
      return { text: ({ timeout: "Timed out", untimeout: "Removed the timeout for", kick: "Kicked", ban: "Banned", unban: "Unbanned" }[name]) + " **" + result.displayName + "**." + (request.reason ? "\nReason: " + request.reason : "") };
    }
    if (name === "shop") return { text: "**Collectible shop**\n" + shop.map((item) => "`" + item.id + "` — " + item.name + " · " + money(item.price)).join("\n") + "\nUse `/buy item-id`. Collectibles are cosmetic items in this bot's inventory." };
    if (name === "balance" || name === "inventory") {
      const user = args ? member(context, args) : context.user;
      need(!user.bot, "Economy accounts are for people, not bots.");
      return store.read((state) => ({ text: name === "balance" ? "**" + user.displayName + "** has " + money(balance(state, sid, user.id)) + "." : "**" + user.displayName + "'s inventory**\n" + ((state.servers[sid]?.accounts[user.id]?.inventory || []).map((id) => shop.find((i) => i.id === id)?.name || id).join("\n") || "No collectibles yet. Try /shop.") }));
    }
    if (name === "leaderboard") return store.read((state) => ({ text: "**" + context.server.name + " · Credit leaderboard**\n" + context.members.filter((u) => !u.bot).map((u) => ({ user: u, balance: balance(state, sid, u.id) })).sort((a, b) => b.balance - a.balance || a.user.id.localeCompare(b.user.id)).slice(0, 10).map((entry, i) => (i + 1) + ". " + entry.user.displayName + " — " + money(entry.balance)).join("\n") }));
    if (["daily", "work", "pay", "buy"].includes(name)) {
      let target, amount, item;
      if (name === "pay") {
        need(parts.length === 2 && /^[1-9]\d{0,6}$/.test(parts[1]) && +parts[1] <= 1000000, "Use /pay @username amount, from 1 to 1,000,000 credits.");
        target = member(context, parts[0]); amount = Number(parts[1]);
        need(target.id !== uid && !target.bot, "Choose another human member to pay.");
      }
      if (name === "buy") { item = shop.find((i) => i.id === args.toLowerCase()); need(item, "Unknown item. Use /shop to see item IDs."); }
      return await store.transact(interaction.id, (state) => {
        const user = account(state, sid, uid);
        if (name === "daily" || name === "work") {
          const key = name === "daily" ? "lastDaily" : "lastWork", cooldown = name === "daily" ? 86400000 : 900000;
          if (user[key] && now < user[key] + cooldown) return { text: "You can use /" + name + " again in " + wait(user[key] + cooldown - now) + "." };
          const reward = name === "daily" ? 250 : randomInt(25, 101);
          need(user.balance + reward <= 1000000000, "Your balance is at the credit limit.");
          user.balance += reward; user[key] = now;
          return { text: "You earned **" + money(reward) + "**! Balance: " + money(user.balance) + "." };
        }
        if (name === "pay") {
          const recipient = account(state, sid, target.id);
          need(user.balance >= amount, "You do not have enough credits.");
          need(recipient.balance + amount <= 1000000000, "The recipient is at the credit limit.");
          user.balance -= amount; recipient.balance += amount;
          return { text: "Paid **" + target.displayName + "** " + money(amount) + ". Your balance: " + money(user.balance) + "." };
        }
        need(!user.inventory.includes(item.id), "You already own this collectible.");
        need(user.balance >= item.price, "You do not have enough credits for " + item.name + ".");
        user.balance -= item.price; user.inventory.push(item.id);
        return { text: "Bought **" + item.name + "** for " + money(item.price) + ". See /inventory." };
      });
    }
    return { text: "Unknown command. Use /bothelp." };
  } catch (error) {
    if (error instanceof CommandError) return { text: error.message + (usage ? "\nUsage: `" + usage + "`" : "") };
    throw error;
  }
}
