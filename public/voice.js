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
    this.serverSelf = null;
    this.pushHeld = false;
    document.addEventListener('keydown',event=>{if(event.code==='KeyV'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,textarea,select,[contenteditable="true"]')){this.pushHeld=true;this.applyAudio();}});
    document.addEventListener('keyup',event=>{if(event.code==='KeyV'){this.pushHeld=false;this.applyAudio();}});
    window.addEventListener('blur',()=>{this.pushHeld=false;this.applyAudio();});
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
  get forcedDeafened(){return !!this.serverSelf?.serverDeafened;}
  get canSpeak(){return this.allowed('speak')&&this.serverSelf?.canSpeak!==false;}
  get pushToTalk(){return this.preferences.inputMode==='pushToTalk'||this.serverSelf?.canVoiceActivity===false;}
  audioConstraints(){return {echoCancellation:this.preferences.echoCancellation!==false,noiseSuppression:this.preferences.noiseSuppression!==false,autoGainControl:this.preferences.autoGainControl!==false,...(this.preferences.inputDevice?{deviceId:{exact:this.preferences.inputDevice}}:{})};}
  async publishState(){if(!this.channelId)return;try{await this.api('/voice/state','PATCH',{clientId:this.clientId,cameraOn:!!this.cameraStream,screenOn:!!this.screenStream,selfMuted:this.muted,deafened:this.deafened});}catch(error){if(error.status!==404)throw error;}}
  async join(channel) {
    if (this.channelId === channel) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone access needs HTTPS or localhost.");
    await this.leave();
    let stream;
    try {
      const server=this.getState().servers.find(s=>s.channels.some(c=>c.id===channel)),stage=server?.channels.find(c=>c.id===channel)?.stage;
      stream = this.allowed("speak", channel)&&(!stage||this.allowed('manageStage',channel))
        ? await navigator.mediaDevices.getUserMedia({
            audio: this.audioConstraints(),
          })
        : new MediaStream();
      this.stream = stream;
      this.channelId = channel;
      this.applyAudio();
      const result = await this.api("/voice/join", "POST", {
        channel,
        clientId: this.clientId,
        mediaStateKnown:true,
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
    this.serverSelf = null;
    this.pushHeld = false;
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
    this.publishState().catch(error=>this.toast(error.message,true));
  }
  toggleDeafen() {
    this.deafened = !this.deafened;
    this.applyAudio();
    this.onChange();
    this.publishState().catch(error=>this.toast(error.message,true));
  }
  applyAudio() {
    this.stream
      ?.getAudioTracks()
      .forEach(
        (t) =>
          (t.enabled = !this.muted && !this.deafened && !this.forcedDeafened && this.canSpeak && (!this.pushToTalk||this.pushHeld)),
      );
    for (const c of this.connections.values()) {
      c.audio.muted = this.deafened||this.forcedDeafened;
      c.audio.volume = this.preferences.volume ?? 1;
    }
  }
  async changeMicrophone() {
    if (!this.channelId) return;
    if (!this.canSpeak)
      throw new Error("Your roles do not allow you to speak in this channel.");
    const channel=this.channelId;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: this.audioConstraints(),
    });
    const track = stream.getAudioTracks()[0];
    if(channel!==this.channelId){stream.getTracks().forEach(t=>t.stop());return;}
    for (const connection of this.connections.values()) {
      const transceiver=connection.pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');
      if(transceiver){await transceiver.sender.replaceTrack(track);transceiver.direction='sendrecv';}
      else connection.pc.addTrack(track,stream);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    this.applyAudio();
    this.onChange();
  }
  async toggleCamera() {
    if (!this.channelId) throw new Error("Join a voice channel first.");
    if (!this.cameraStream&&(!this.allowed("video")||this.serverSelf?.canVideo===false))
      throw new Error(
        "Your roles do not allow camera or screen sharing in this channel.",
      );
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      this.onChange();
    } else {
      const channel=this.channelId;
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if(channel!==this.channelId){this.cameraStream.getTracks().forEach(t=>t.stop());this.cameraStream=null;return;}
      this.cameraStream.getVideoTracks()[0].onended=()=>{this.cameraStream=null;this.onChange();this.updateVideo().then(()=>this.publishState()).catch(error=>this.toast(error.message,true));};
    }
    await this.updateVideo();
    await this.publishState();
    this.onChange();
  }
  async toggleScreen() {
    if (!this.channelId) throw new Error("Join a voice channel first.");
    if (!this.screenStream&&(!this.allowed("stream")||this.serverSelf?.canScreen===false))
      throw new Error(
        "Your roles do not allow camera or screen sharing in this channel.",
      );
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.onChange();
    } else {
      if (!navigator.mediaDevices.getDisplayMedia)
        throw new Error("Screen sharing is unavailable in this browser.");
      const channel=this.channelId;
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if(channel!==this.channelId){this.screenStream.getTracks().forEach(t=>t.stop());this.screenStream=null;return;}
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.screenStream = null;
        this.updateVideo()
          .then(() => this.publishState()).then(() => this.onChange())
          .catch((error) => this.toast(error.message, true));
      };
    }
    await this.updateVideo();
    await this.publishState();
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
      if(sender)c.videoSender=sender;
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
      this.reconcileTracks(peer.clientId,connection);
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
  reconcileTracks(id,c){
    const peer=this.peers.get(id);if(!peer)return;
    const tracks=c.pc.getReceivers().map(r=>r.track).filter(t=>t.readyState==='live'&&(t.kind==='audio'?peer.canSpeak!==false:peer.mediaStateKnown?peer.cameraOn&&peer.canVideo!==false||peer.screenOn&&peer.canScreen!==false:peer.canVideo!==false));
    for(const old of c.remoteStream.getTracks())if(!tracks.includes(old))c.remoteStream.removeTrack(old);
    for(const track of tracks)if(!c.remoteStream.getTrackById(track.id))c.remoteStream.addTrack(track);
    c.audio.play().catch(()=>{});
  }
  async syncPeers(peers) {
    if (!this.channelId) return;
    this.serverSelf=peers.find(p=>p.clientId===this.clientId)||this.serverSelf;
    this.applyAudio();
    let changed=false;
    if(this.serverSelf?.canVideo===false&&this.cameraStream){this.cameraStream.getTracks().forEach(t=>t.stop());this.cameraStream=null;changed=true;}
    if(this.serverSelf?.canScreen===false&&this.screenStream){this.screenStream.getTracks().forEach(t=>t.stop());this.screenStream=null;changed=true;}
    if(changed)await this.updateVideo();
    if(this.canSpeak&&!this.stream?.getAudioTracks().length&&!this.microphonePending){this.microphonePending=true;this.changeMicrophone().catch(error=>this.toast('Enable your microphone to speak: '+error.message,true)).finally(()=>{this.microphonePending=false;});}
    const others = peers.filter((p) => p.clientId !== this.clientId);
    this.peers = new Map(others.map((p) => [p.clientId, p]));
    for (const [id, c] of this.connections)
      if (!this.peers.has(id)) {
        c.pc.close();
        c.audio.remove();
        this.connections.delete(id);
      }
    for (const p of others){const c=this.connection(p);this.reconcileTracks(p.clientId,c);}
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
