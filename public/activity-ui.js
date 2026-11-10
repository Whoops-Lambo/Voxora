import {playToolSound} from './personal-tools-ui.js';
import { notificationPolicy, shouldNotify } from "./activity.js";

export function createActivityUI({
  api,
  node,
  button,
  ib,
  input,
  field,
  formDialog,
  getState,
  getRoute,
  channelName,
  storage,
  toast,
  onChange,
  onAckDone,
  onUnread,
  openMessage,
}) {
  let current = null,
    account = null,
    device = {},
    task = null,
    again = false,
    timer,
    inboxTab = "mentions",
    inboxGeneration = 0,
    audio,
    lastAck = 0,
    retryTimer,
    muteSignature = "",
    messageFloor = 0, threadFloor = 0, lastChime = -Infinity;
  const paused = new Set(),
    acknowledgements = new Set(),
    seen = new Map();
  const liveAlerts=new Set();let alertPolicy='';
  function rememberAlert(alert){liveAlerts.add(alert);if(liveAlerts.size>30){const oldest=liveAlerts.values().next().value;oldest.close();liveAlerts.delete(oldest);}}
  function clearNotifications(){for(const alert of liveAlerts)alert.close();liveAlerts.clear();window.voxoraDesktop?.clearNotifications?.().catch(()=>{});}
  window.voxoraDesktop?.onNotificationClick?.(payload=>{if(payload?.recipientId!==user()?.id||!entry(payload.channel))return;openMessage(payload).catch(error=>toast(error.message,true));});
  const pendingNotifications = new Map();
  const pendingDnd = new Set();
  const user = () => getState()?.me;
  const viewing = (channel) =>
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    !document.getElementById("modal").open &&
    getRoute().channel === channel &&
    ["channel", "dm"].includes(getRoute().kind);
  const entry = (id) => {
    const c = current?.channels[id];
    return c
      ? { ...c, ...notificationPolicy(current.settings, c.serverId, id) }
      : null;
  };
  function apply(snapshot) {
    if (!snapshot || !user() || user().id !== account) return false;
    if (
      current &&
      (snapshot.revision < current.revision ||
        snapshot.through < current.through || snapshot.threadThrough < current.threadThrough)
    ) {
      getState().activity = current;
      return false;
    }
    if (current)
      for (const [id, c] of Object.entries(snapshot.channels)) {
        const previous = current.channels[id];
        if (previous && c.version > previous.version && c.manualUnread) {
          paused.add(id);
          onUnread(id, c.cursor);
        } else if (previous && c.version > previous.version) {
          paused.delete(id);
          onAckDone();
        }
      }
    current = snapshot;
    muteSignature = Object.keys(current.channels)
      .filter((id) => entry(id).muted)
      .join(",");
    getState().activity = snapshot;
    const policy=JSON.stringify([account,snapshot.doNotDisturb,snapshot.settings,getState().blocked,Object.keys(snapshot.channels)]);
    if(alertPolicy!==policy){alertPolicy=policy;clearNotifications();}
    onChange();
    return true;
  }
  function reset() {
    clearNotifications();alertPolicy="";
    account = user()?.id;
    current = null;
    paused.clear();
    acknowledgements.clear();
    seen.clear();
    pendingNotifications.clear();
    pendingDnd.clear();
    clearTimeout(timer);
    clearTimeout(retryTimer);
    lastAck = 0;
    messageFloor = getState()?.activity?.through || 0;
    threadFloor = getState()?.activity?.threadThrough || 0;
    device = {desktop:false,sound:true,previews:false,inApp:true,...storage.get("alerts:" + account,{})};
    apply(getState()?.activity);
  }
  function refresh() {
    again = true;
    if (task) return task;
    const id = account;
    task = (async () => {
      try {
        do {
          again = false;
          const next = await api("/activity");
          if (id !== user()?.id || id !== account) return;
          apply(next);
        } while (again);
      } finally {
        task = null;
      }
    })();
    return task;
  }
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        refresh().catch((e) => {
          if (e.status !== 401) toast(e.message, true);
        }),
      90,
    );
  }
  async function setStatus(status) {
    const id = account, intent = Symbol();
    if (status === "dnd") pendingDnd.add(intent);
    try {
      const profile = await api("/profile", "PATCH", { status });
      if (id === account && id === user()?.id) {
        user().status = profile.status;
        await refresh();
      }
    } finally {
      pendingDnd.delete(intent);
      if (id === account && id === user()?.id) scheduleRefresh();
    }
  }
  async function mutate(route, data, method = "POST") {
    const id = account;
    const notificationKey = route === "/notification-settings" ? id + ":" + (data.serverId ? "server:" + data.serverId : "channel:" + data.channel) : null;
    if (notificationKey) pendingNotifications.set(notificationKey, (pendingNotifications.get(notificationKey) || 0) + 1);
    try {
      const result = await api(route, method, data);
      if (id === account && id === user()?.id) {
        if (!apply(result.activity)) {
          if (notificationKey) await refresh();
          else scheduleRefresh();
        }
      }
      return result;
    } catch (e) {
      if (e.status === 409) await refresh();
      throw e;
    } finally {
      if (notificationKey) {
        const remaining = (pendingNotifications.get(notificationKey) || 1) - 1;
        if (remaining) pendingNotifications.set(notificationKey, remaining);
        else pendingNotifications.delete(notificationKey);
      }
    }
  }
  async function acknowledge(channel, message) {
    const c = entry(channel);
    if (
      !c ||
      !message ||
      message.sequence <= c.cursor ||
      paused.has(channel) ||
      acknowledgements.has(channel) ||
      !viewing(channel)
    )
      return;
    if (Date.now() - lastAck < 1000) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(onAckDone, 1000 - (Date.now() - lastAck));
      return;
    }
    lastAck = Date.now();
    acknowledgements.add(channel);
    let success = false;
    try {
      await mutate("/read-state", {
        channel,
        messageId: message.id,
        version: c.version,
      });
      success = true;
    } catch (e) {
      if (![401, 403, 404, 409].includes(e.status)) toast(e.message, true);
    } finally {
      acknowledgements.delete(channel);
      if (success && !paused.has(channel)) onAckDone();
    }
  }
  async function markRead(channel) {
    const c = entry(channel);
    if (!c?.latestId) return;
    paused.delete(channel);
    await mutate("/read-state", {
      channel,
      messageId: c.latestId,
      version: c.version,
    });
  }
  async function markUnread(
    channel,
    messageId = entry(channel)?.latestOtherId,
  ) {
    const c = entry(channel);
    if (!c || !messageId) {
      toast("There are no messages from other people to mark unread.");
      return;
    }
    paused.add(channel);
    await mutate("/read-state", {
      channel,
      messageId,
      version: c.version,
      unread: true,
    });
    onUnread(channel, entry(channel)?.cursor);
  }
  async function markAll(serverId) {
    if (!current) return;
    const ids = Object.keys(current.channels).filter(
      (id) => !serverId || current.channels[id].serverId === serverId,
    );
    await mutate("/read-state", {
      ...(serverId ? { serverId } : { all: true }),
      through: current.through,
      ...(Number.isSafeInteger(current.threadThrough)?{threadThrough:current.threadThrough}:{}),
      revision: current.revision,
    });
    ids.forEach((id) => paused.delete(id));
  }
  const saveDevice = () => storage.set("alerts:" + account, device);
  setInterval(() => {
    if (!current || user()?.id !== account) return;
    const next = Object.keys(current.channels)
      .filter((id) => entry(id).muted)
      .join(",");
    if (next !== muteSignature) {
      muteSignature = next;
      onChange();
    }
  }, 15000);
  function unlockSound() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || device.sound === false) return;
    try { audio ||= new Audio(); audio.resume().catch(() => {}); } catch {}
  }
  window.addEventListener('pointerdown', unlockSound);
  window.addEventListener('keydown', unlockSound);
  function chime(kind = 'mention') {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || Date.now() - lastChime < 350) return;
    lastChime = Date.now();
    try { audio ||= new Audio(); } catch { return; }
    playToolSound(getState()?.tools?.sound||'classic',audio,kind);
  }
  function incoming(message,{threadVisible=false}={}) {
    scheduleRefresh();
    if(message.sequence <= (message.threadId ? threadFloor : messageFloor))return;
    if (seen.has(message.id)) return;
    const c = entry(message.channel);
    if(!c){const receivingAccount=account;refresh().then(()=>{if(receivingAccount===account&&user()?.id===account&&entry(message.channel))incoming(message,{threadVisible});}).catch(()=>{});return;}
    seen.set(message.id,{sequence:message.sequence,thread:!!message.threadId});
    if (
      pendingNotifications.has(account + ":channel:" + message.channel) ||
      pendingNotifications.has(account + ":server:" + c.serverId) ||
      !shouldNotify(message, user(), c, {
        dm: c.kind === "dm",
        blocked: getState().blocked,
        dnd: pendingDnd.size > 0 || current.doNotDisturb || user()?.status === "dnd",
        viewing: viewing(message.channel)&&(!message.threadId||threadVisible),
      })
    )
      return;
    const receivingAccount=account,title=device.previews?message.author+' · '+(c.kind==='dm'?'Direct message':'#'+channelName(message.channel)):'New message · Voxora',body=device.previews?message.text.slice(0,180)||'Sent an attachment':'You have a new message in Voxora.';
    const allowed=()=>user()?.id===receivingAccount&&!!entry(message.channel)&&!getState().blocked.includes(message.authorId);
    if(device.inApp&&document.visibilityState==='visible'&&document.hasFocus()){
      const panel=node('section','message-notification'),open=button('',()=>{alert.close();if(allowed())return openMessage(message);},'message-notification-open'),dismiss=button('×',()=>alert.close(),'message-notification-dismiss');
      open.setAttribute('aria-label','Open new message');open.append(node('strong','',title),node('span','',body));dismiss.setAttribute('aria-label','Dismiss message notification');panel.setAttribute('role','status');panel.append(open,dismiss);
      const alert={close:()=>{panel.remove();clearTimeout(alert.timer);liveAlerts.delete(alert);}};alert.timer=setTimeout(alert.close,9000);rememberAlert(alert);document.getElementById('toast-stack').append(panel);
      const banners=[...liveAlerts].filter(item=>item.timer);if(banners.length>3)banners[0].close();
    }
    const fallback=()=>{
      if(!allowed())return;if(device.sound)chime(c.kind==='dm'?'dm':'mention');
      if(!device.desktop||!('Notification'in window)||Notification.permission!=='granted')return;
      try{const alert=new Notification(title,{body,tag:'voxora:'+message.id,silent:true});rememberAlert(alert);alert.onclose=()=>liveAlerts.delete(alert);alert.onclick=()=>{alert.close();liveAlerts.delete(alert);if(allowed()){window.focus();openMessage(message).catch(e=>toast(e.message,true));}};}catch(error){toast('Desktop alerts are unavailable: '+error.message,true);}
    };
    if(device.desktop&&window.voxoraDesktop?.showNotification){
      const customSound=device.sound&&getState()?.tools?.sound&&getState().tools.sound!=='classic';
      window.voxoraDesktop.showNotification({id:message.id,channel:message.channel,threadId:message.threadId||null,recipientId:receivingAccount,title,body,silent:!device.sound||!!customSound}).then(result=>{if(result.shown&&customSound&&allowed())chime(c.kind==='dm'?'dm':'mention');else if(!result.shown&&!['duplicate','rate-limited'].includes(result.reason))fallback();}).catch(fallback);
    }else fallback();
  }

  function settingsDialog({ serverId, channel }) {
    const server = getState().servers.find((s) => s.id === serverId);
    const c = channel ? entry(channel) : null;
    const setting = serverId
      ? current.settings.servers[serverId]
      : current.settings.channels[channel];
    const mode = node("select"),
      mute = node("select");
    mode.setAttribute("aria-label", "NOTIFICATION MODE");
    mute.setAttribute("aria-label", "MUTE DURATION");
    if (channel)
      mode.append(
        new Option(
          c?.kind === "dm"
            ? "Default for direct messages"
            : "Use server setting",
          "inherit",
        ),
      );
    for (const [value, label] of [
      ["all", "All Messages"],
      ["mentions", "Only @mentions and replies"],
      ["nothing", "Nothing"],
    ])
      if (c?.kind !== "dm" || value !== "mentions")
        mode.append(new Option(label, value));
    mode.value = setting?.mode || (channel ? "inherit" : "mentions");
    for (const [value, label] of [
      ["keep", "Keep current mute"],
      ["0", "Unmuted"],
      ["900", "15 minutes"],
      ["3600", "1 hour"],
      ["28800", "8 hours"],
      ["86400", "24 hours"],
      ["-1", "Until I turn it back on"],
    ])
      mute.append(new Option(label, value));
    formDialog({
      title: "Notifications — " + (server?.name || channelName(channel)),
      description:
        "These settings follow your account. Muting hides unread badges and pauses alerts; unread items remain in Inbox. Notification mode controls sounds and desktop alerts.",
      fields: [field("NOTIFICATION MODE", mode), field("MUTE DURATION", mute)],
      submitLabel: "Save Notifications",
      submit: async () => {
        await mutate(
          "/notification-settings",
          {
            ...(serverId ? { serverId } : { channel }),
            mode: mode.value,
            ...(mute.value === "keep" ? {} : { muteFor: Number(mute.value) }),
          },
          "PATCH",
        );
        toast("Notification settings saved.");
      },
    });
  }
  function serverItems(s) {
    const policy = notificationPolicy(current?.settings, s.id, null);
    return [
      { label: "Mark Server as Read", icon: "check", run: () => markAll(s.id) },
      {
        label: "Notification Settings",
        icon: "bell",
        run: () => settingsDialog({ serverId: s.id }),
      },
      {
        label: policy.muted ? "Unmute Server" : "Mute Server",
        icon: "bell",
        run: () =>
          mutate(
            "/notification-settings",
            { serverId: s.id, muteFor: policy.muted ? 0 : -1 },
            "PATCH",
          ),
      },
    ];
  }
  function channelItems(id) {
    const c = entry(id);
    return [
      { label: "Mark as Read", icon: "check", run: () => markRead(id) },
      { label: "Mark Unread", icon: "inbox", run: () => markUnread(id) },
      {
        label: "Notification Settings",
        icon: "bell",
        run: () => settingsDialog({ channel: id }),
      },
      {
        label: c?.muted ? "Unmute Conversation" : "Mute Conversation",
        icon: "bell",
        run: () =>
          mutate(
            "/notification-settings",
            { channel: id, muteFor: c?.muted ? 0 : -1 },
            "PATCH",
          ),
      },
    ];
  }
  function renderSettings(content) {
    content.append(
      node(
        "p",
        "management-help",
        "Desktop alerts and sounds apply to this account on this device while Voxora is running. Server and channel notification settings sync across your devices.",
      ),
    );
    if (current?.doNotDisturb)
      content.append(
        node(
          "p",
          "notification-notice",
          "Do Not Disturb is on. Sounds and desktop alerts are paused.",
        ),
      );
    for (const [key, label, help] of [
      ["inApp","In-app message notifications","Show a clickable banner for new DMs and eligible messages in other conversations."],
      [
        "desktop",
        "Desktop notifications",
        "Allow alerts when you are away from a conversation.",
      ],
      [
        "sound",
        "Message sounds",
        "Play pings for DMs, personal mentions, @here, @everyone and role mentions that match your notification settings.",
      ],
      [
        "previews",
        "Show message previews",
        "Include the sender and message text in desktop alerts.",
      ],
    ]) {
      const control = input("", "", "checkbox");
      control.checked = !!device[key];
      control.setAttribute("aria-label", label);
      control.onchange = async () => {
        try {
          if (key === "desktop" && control.checked) {
            const native=window.voxoraDesktop?.getNotificationState&&await window.voxoraDesktop.getNotificationState();
            if (!native?.supported&&!("Notification" in window))
              throw Error(
                "Desktop notifications are not supported in this browser.",
              );
            const permission = native?.supported?"granted":
              Notification.permission === "granted"
                ? "granted"
                : await Notification.requestPermission();
            if (permission !== "granted")
              throw Error(
                "Notifications are blocked. Enable them in browser or system settings.",
              );
          }
          device[key] = control.checked;
          if(!control.checked&&["desktop","inApp","previews"].includes(key))clearNotifications();
          saveDevice();
          if (key === "sound" && control.checked) chime();
        } catch (e) {
          control.checked = false;
          device[key] = false;
          saveDevice();
          toast(e.message, true);
        }
      };
      content.append(
        node("label", "permission-row", [
          node("span", "", [
            node("strong", "", label),
            node("small", "", help),
          ]),
          control,
        ]),
      );
    }
    content.append(
      button('Send Test Desktop Notification',async()=>{
        if(window.voxoraDesktop?.testNotification){const result=await window.voxoraDesktop.testNotification();if(!result.shown)throw Error('System notifications are unavailable. Check your system notification and Focus settings.');}
        else{if(!('Notification'in window))throw Error('Desktop notifications are not supported in this browser.');const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();if(permission!=='granted')throw Error('Allow notifications in your browser or system settings.');const alert=new Notification('Voxora notifications are ready',{body:'Message and mention alerts can appear here.',silent:!device.sound});rememberAlert(alert);alert.onclick=()=>{alert.close();window.focus();};}
        toast('Test notification sent. Your system notification and Focus settings control its appearance.');
      },'secondary'),
      button("Play Test Sound", chime, "secondary"),
      node("h3", "notification-section", "SERVER NOTIFICATIONS"),
    );
    content.append(node('p','management-help','DMs notify by default. Choose All Messages below to receive ordinary server messages too. Channel overrides, mute, blocks and Do Not Disturb still apply.'));
    if(window.voxoraDesktop?.getNotificationState){
      const native=node('section','native-notification-settings');content.insertBefore(native,content.querySelector('.notification-section'));
      window.voxoraDesktop.getNotificationState().then(info=>{if(!native.isConnected)return;const keep=input('','','checkbox');keep.checked=info.keepRunning;keep.setAttribute('aria-label','Keep Voxora running when the window is closed');keep.onchange=async()=>{keep.disabled=true;try{const result=await window.voxoraDesktop.setNotificationSettings({keepRunning:keep.checked});keep.checked=result.keepRunning;}catch(error){keep.checked=!keep.checked;toast(error.message,true);}finally{keep.disabled=false;}};
        native.append(node('p','management-help',info.supported?'Native desktop notifications are available. Keep Voxora open or minimized to receive alerts.':'System notifications are unavailable in this desktop session.'),node('label','permission-row',[node('span','',[node('strong','','Keep Voxora running when the window is closed'),node('small','','Close to the system tray to keep receiving messages. Quit Voxora from its tray menu to stop it.')]),keep]),button('Open System Notification Settings',()=>window.voxoraDesktop.openNotificationSettings(),'secondary'));}).catch(error=>{if(native.isConnected)native.append(node('p','form-error',error.message));});
    }
    for (const s of getState().servers) {
      const p = notificationPolicy(current.settings, s.id, null);
      content.append(
        button(
          s.name +
            " — " +
            (p.muted
              ? "Muted"
              : {
                  all: "All Messages",
                  mentions: "Only @mentions and replies",
                  nothing: "Nothing",
                }[p.mode]),
          () => settingsDialog({ serverId: s.id }),
          "notification-server",
        ),
      );
    }
  }
  function renderInbox(target, resultCard) {
    const generation = ++inboxGeneration,
      id = account;
    const tabs = node("div", "inbox-tabs");
    for (const [value, label] of [
      ["mentions", "Mentions & DMs"],
      ["unread", "Unread"],
    ]) {
      const b = button(
        label,
        () => {
          inboxTab = value;
          renderInbox(target, resultCard);
        },
        inboxTab === value ? "active" : "",
      );
      b.setAttribute("aria-pressed", String(inboxTab === value));
      tabs.append(b);
    }
    const list = node("div", "inbox-items");
    target.replaceChildren(
      tabs,
      node("div", "inbox-tools", [
        button("Mark All Read", () => markAll(), "text-button"),
        button("Refresh", () => renderInbox(target, resultCard), "text-button"),
      ]),
      list,
    );
    list.append(node("p", "muted small", "Loading…"));
    const type = inboxTab;
    async function load(before) {
      const data = await api(
        "/inbox?type=" +
          type +
          (before ? "&before=" + encodeURIComponent(before) : ""),
      );
      if (
        !target.isConnected ||
        generation !== inboxGeneration ||
        id !== user()?.id
      )
        return;
      if (!before) list.replaceChildren();
      if (!data.items.length && !before)
        list.append(
          node(
            "p",
            "inbox-empty",
            "You’re all caught up. New mentions, replies, and direct messages will appear here.",
          ),
        );
      for (const item of data.items) {
        const channel = item.channel;
        const card = resultCard(type === "unread" ? item.message : item);
        if (type === "unread") {
          card.prepend(
            node(
              "div",
              "inbox-unread-count",
              item.unread + " unread" + (item.muted ? " · Muted" : ""),
            ),
          );
          card.onclick = () =>
            openMessage({ channel, id: item.firstUnreadId }).catch((e) =>
              toast(e.message, true),
            );
        }
        const read = button(
          "Mark channel read",
          (event) => {
            event.stopPropagation();
            return markRead(channel);
          },
          "inbox-read text-button",
        );
        card.append(read);
        list.append(card);
      }
      if (data.hasMore) {
        const more = button(
          "Load older mentions",
          async () => {
            more.disabled = true;
            await load(data.items.at(-1).id);
            more.remove();
          },
          "secondary",
        );
        list.append(more);
      }
    }
    load().catch((e) => {
      if (target.isConnected && generation === inboxGeneration)
        list.replaceChildren(node("p", "form-error", e.message));
    });
  }
  return {
    clearNotifications,
    notifyReminder:()=>{
      if(!user()||user().id!==account||pendingDnd.size||current?.doNotDisturb||user().status==='dnd')return;
      if(device.sound)chime();
      if(device.desktop&&'Notification'in window&&Notification.permission==='granted'&&!document.hasFocus()){
        try{const alert=new Notification('A reminder is due · Voxora',{body:'Open Home to review your reminder.',silent:true});alert.onclick=()=>{alert.close();window.focus();};}catch{}
      }
    },
    reset,
    apply,
    entry,
    refresh,
    scheduleRefresh,
    setStatus,
    acknowledge,
    incoming,
    advance:(through,threadThrough)=>{messageFloor=Math.max(messageFloor,through);threadFloor=Math.max(threadFloor,threadThrough);for(const [id,item] of seen)if(item.sequence<=(item.thread?threadFloor:messageFloor))seen.delete(id);},
    markRead,
    markUnread,
    markAll,
    settingsDialog,
    renderSettings,
    renderInbox,
    serverItems,
    channelItems,
    viewing,
    enter: (id) => paused.delete(id),
    isPaused: (id) => paused.has(id),
  };
}
