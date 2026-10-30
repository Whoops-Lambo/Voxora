export function createPollUI({
  node,
  button,
  input,
  field,
  formDialog,
  api,
  getRoute,
  getMe,
  canVote,
  canEnd,
  person,
  onCreated,
  toast,
}) {
  function create() {
    const question = input("", "What should we play tonight?");
    question.required = true;
    question.maxLength = 300;
    const answers = node("div"),
      controls = [];
    function add() {
      if (controls.length >= 10) return;
      const control = input("", "Choice " + (controls.length + 1));
      control.maxLength = 80;
      control.required = true;
      controls.push(control);
      answers.append(field("ANSWER " + controls.length, control));
    }
    add();
    add();
    const multiple = input("", "", "checkbox");
    multiple.setAttribute("aria-label", "Allow multiple answers");
    const duration = node("select");
    duration.setAttribute("aria-label", "POLL DURATION");
    for (const hours of [1, 4, 8, 24, 72, 168])
      duration.append(
        new Option(
          hours < 24 ? hours + " hours" : hours / 24 + " days",
          String(hours),
        ),
      );
    duration.value = "24";
    formDialog({
      title: "Create a Poll",
      fields: [
        field("QUESTION", question),
        answers,
        button("Add Answer", add, "secondary"),
        node("label", "bot-scope-row", [
          multiple,
          node("span", "", "Allow multiple answers"),
        ]),
        field("POLL DURATION", duration),
      ],
      submitLabel: "Post Poll",
      submit: async () => {
        const result = await api("/messages", "POST", {
          channel: getRoute().channel,
          poll: {
            question: question.value,
            answers: controls.map((c) => c.value),
            multiple: multiple.checked,
            durationHours: Number(duration.value),
          },
        });
        onCreated(result);
      },
    });
  }
  function render(m) {
    const poll = m.poll,
      card = node("div", "poll-card");
    card.append(
      node("h3", "", poll.question),
      node(
        "p",
        "poll-description",
        poll.multiple ? "Select all that apply" : "Select one answer",
      ),
    );
    const participants = new Set(poll.answers.flatMap((a) => a.voters)),
      me = getMe().id;
    for (const answer of poll.answers) {
      const selected = answer.voters.includes(me);
      const b = button(
        "",
        async () => {
          const ids = poll.multiple
            ? poll.answers.filter((a) => a.voters.includes(me)).map((a) => a.id)
            : [];
          const answers = selected
            ? ids.filter((id) => id !== answer.id)
            : [...ids, answer.id];
          await api("/polls/" + m.id + "/vote", "POST", { answers });
        },
        "poll-answer" + (selected ? " selected" : ""),
      );
      b.setAttribute("aria-label", answer.text);
      b.setAttribute("aria-pressed", String(selected));
      b.disabled = poll.closed || !canVote();
      const fill = node("span", "poll-bar");
      fill.style.width =
        (participants.size
          ? (answer.voters.length / participants.size) * 100
          : 0) + "%";
      b.append(
        fill,
        node("span", "poll-answer-text", answer.text),
        node("span", "poll-count", String(answer.voters.length)),
      );
      b.title = answer.voters.length
        ? answer.voters.map((id) => person(id).displayName).join(", ")
        : "No votes yet";
      card.append(b);
    }
    const footer = node("div", "poll-footer", [
      node(
        "span",
        "",
        participants.size + " vote" + (participants.size === 1 ? "" : "s"),
      ),
      node(
        "span",
        "",
        poll.closed
          ? "Poll ended"
          : "Ends " +
              new Date(poll.closesAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
      ),
    ]);
    if (!poll.closed && canEnd(m))
      footer.append(
        button(
          "End Poll",
          () => api("/polls/" + m.id + "/close", "POST", {}),
          "text-button",
        ),
      );
    card.append(footer);
    return card;
  }
  return { create, render };
}
