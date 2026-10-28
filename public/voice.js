import { channelPermissions } from "./permissions.js";
export class Voice {
  constructor({ api, clientId, getState, preferences, onChange, toast }) {
    Object.assign(this, {
      api,
      clientId,
      getState,
      preferences,
      onChange,
      toast,
    });
    this.channelId = null;
    this.stream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.connections = new Map();
    this.peers = new Map();
    this.muted = false;
    this.deafened = false;
  }
  allowed(permission, channel = this.channelId) {
    const state = this.getState();
    const server = state.servers.find((s) =>
      s.channels.some((c) => c.id === channel),
    );
    return server
      ? channelPermissions(server, state.me.id, channel).includes(permission)
      : false;
  }
  get videoStream() {
    return this.screenStream || this.cameraStream;
  }
  async join(channel) {
    if (this.channelId === channel) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone access needs HTTPS or localhost.");
    await this.leave();
    let stream;
    try {
      stream = this.allowed("speak", channel)
        ? await navigator.mediaDevices.getUserMedia({
            audio: this.preferences.inputDevice
              ? {
                  deviceId: { exact: this.preferences.inputDevice },
                  echoCancellation: true,
                  noiseSuppression: true,
                }
              : { echoCancellation: true, noiseSuppression: true },
          })
        : new MediaStream();
      this.stream = stream;
      this.channelId = channel;
      this.applyAudio();
      const result = await this.api("/voice/join", "POST", {
        channel,
        clientId: this.clientId,
      });
      await this.syncPeers(result.peers);
      this.onChange();
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      this.channelId = null;
      this.stream = null;
      this.onChange();
      throw new Error(
        error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser or system settings."
          : error.message,
      );
    }
  }
  async leave(notify = true) {
    const was = this.channelId;
    this.channelId = null;
    for (const connection of this.connections.values()) {
      connection.pc.close();
      connection.audio.remove();
    }
    this.connections.clear();
    this.peers.clear();
    for (const stream of [this.stream, this.cameraStream, this.screenStream])
      stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.onChange();
    if (was && notify)
      await this.api("/voice/leave", "POST", { clientId: this.clientId });
  }
  toggleMute() {
    this.muted = !this.muted;
    if (!this.muted) this.deafened = false;
    this.applyAudio();
    this.onChange();
  }
  toggleDeafen() {
    this.deafened = !this.deafened;
    this.applyAudio();
    this.onChange();
  }
  applyAudio() {
    this.stream
      ?.getAudioTracks()
      .forEach(
        (t) =>
          (t.enabled = !this.muted && !this.deafened && this.allowed("speak")),
      );
    for (const c of this.connections.values()) {
      c.audio.muted = this.deafened;
      c.audio.volume = this.preferences.volume ?? 1;
    }
  }
  async changeMicrophone() {
    if (!this.channelId) return;
    if (!this.allowed("speak"))
      throw new Error("Your roles do not allow you to speak in this channel.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: this.preferences.inputDevice
        ? { deviceId: { exact: this.preferences.inputDevice } }
        : true,
    });
    const track = stream.getAudioTracks()[0];
    track.enabled = !this.muted && !this.deafened;
    for (const connection of this.connections.values()) {
      const sender = connection.pc
        .getSenders()
        .find((s) => s.track?.kind === "audio");
      if (sender) await sender.replaceTrack(track);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.onChange();
  }
  async toggleCamera() {
    if (!this.channelId) throw new Error("Join a voice channel first.");
    if (!this.allowed("video"))
      throw new Error(
        "Your roles do not allow camera or screen sharing in this channel.",
      );
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    } else
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    await this.updateVideo();
    this.onChange();
  }
  async toggleScreen() {
    if (!this.channelId) throw new Error("Join a voice channel first.");
    if (!this.allowed("video"))
      throw new Error(
        "Your roles do not allow camera or screen sharing in this channel.",
      );
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    } else {
      if (!navigator.mediaDevices.getDisplayMedia)
        throw new Error("Screen sharing is unavailable in this browser.");
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.screenStream = null;
        this.updateVideo()
          .then(() => this.onChange())
          .catch((error) => this.toast(error.message, true));
      };
    }
    await this.updateVideo();
    this.onChange();
  }
  async updateVideo() {
    const track = this.videoStream?.getVideoTracks()[0] || null;
    for (const c of this.connections.values()) {
      let sender =
        c.pc.getSenders().find((s) => s.track?.kind === "video") ||
        c.videoSender;
      if (sender) await sender.replaceTrack(track);
      else if (track) {
        sender = c.pc.addTrack(track, this.stream);
        c.videoSender = sender;
      }
    }
  }
  async signal(to, data) {
    if (!this.channelId) return;
    await this.api("/voice/signal", "POST", {
      clientId: this.clientId,
      to,
      ...data,
    });
  }
  connection(peer) {
    if (this.connections.has(peer.clientId))
      return this.connections.get(peer.clientId);
    const pc = new RTCPeerConnection({
      iceServers: this.getState().iceServers || [],
    });
    const remoteStream = new MediaStream();
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = remoteStream;
    document.getElementById("remote-media").append(audio);
    const connection = {
      pc,
      remoteStream,
      audio,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      polite: this.clientId > peer.clientId,
      candidates: [],
      videoSender: null,
    };
    this.connections.set(peer.clientId, connection);
    this.applyAudio();
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.signal(peer.clientId, {
          candidate: event.candidate.toJSON(),
        }).catch(() => {});
    };
    pc.ontrack = (event) => {
      if (
        (event.track.kind === "audio" && peer.canSpeak === false) ||
        (event.track.kind === "video" && peer.canVideo === false)
      )
        return;
      if (!remoteStream.getTrackById(event.track.id))
        remoteStream.addTrack(event.track);
      event.track.onunmute = () => this.onChange();
      event.track.onmute = () => this.onChange();
      event.track.onended = () => {
        remoteStream.removeTrack(event.track);
        this.onChange();
      };
      audio.play().catch(() => {});
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed")
        this.toast(
          "A voice connection failed. The server may need a TURN relay for this network.",
          true,
        );
      this.onChange();
    };
    pc.onnegotiationneeded = async () => {
      // Pick one initial offerer. Both sides adding their microphone at once can
      // otherwise roll back an ICE generation before it produces candidates.
      // Later camera/screen renegotiation still uses perfect negotiation below.
      if (connection.polite && !pc.remoteDescription) return;
      try {
        connection.makingOffer = true;
        await pc.setLocalDescription();
        await this.signal(peer.clientId, {
          description: pc.localDescription.toJSON(),
        });
      } catch (error) {
        if (this.channelId)
          this.toast("Could not negotiate voice: " + error.message, true);
      } finally {
        connection.makingOffer = false;
      }
    };
    for (const track of this.stream?.getAudioTracks() || [])
      pc.addTrack(track, this.stream);
    if (!this.stream?.getAudioTracks().length)
      pc.addTransceiver("audio", { direction: "recvonly" });
    const video = this.videoStream?.getVideoTracks()[0];
    if (video) connection.videoSender = pc.addTrack(video, this.stream);
    return connection;
  }
  async syncPeers(peers) {
    if (!this.channelId) return;
    const others = peers.filter((p) => p.clientId !== this.clientId);
    this.peers = new Map(others.map((p) => [p.clientId, p]));
    for (const [id, c] of this.connections)
      if (!this.peers.has(id)) {
        c.pc.close();
        c.audio.remove();
        this.connections.delete(id);
      }
    for (const p of others) this.connection(p);
    this.onChange();
  }
  async handle(event) {
    if (!this.channelId) return;
    if (event.type === "voice-peers") {
      if (event.channel === this.channelId) await this.syncPeers(event.peers);
      return;
    }
    const peer = this.peers.get(event.from);
    if (!peer) return;
    const c = this.connection(peer),
      pc = c.pc;
    if (event.description) {
      const description = event.description;
      const readyForOffer =
        !c.makingOffer &&
        (pc.signalingState === "stable" || c.isSettingRemoteAnswerPending);
      const collision = description.type === "offer" && !readyForOffer;
      c.ignoreOffer = !c.polite && collision;
      if (c.ignoreOffer) return;
      c.isSettingRemoteAnswerPending = description.type === "answer";
      await pc.setRemoteDescription(description);
      c.isSettingRemoteAnswerPending = false;
      for (const candidate of c.candidates.splice(0))
        await pc.addIceCandidate(candidate);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        await this.signal(peer.clientId, {
          description: pc.localDescription.toJSON(),
        });
      }
    } else if (event.candidate) {
      try {
        if (pc.remoteDescription) await pc.addIceCandidate(event.candidate);
        else c.candidates.push(event.candidate);
      } catch (error) {
        if (!c.ignoreOffer) throw error;
      }
    }
  }
}
