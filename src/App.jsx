
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Home, Plus, Settings, Hash, Send, UserPlus, Users, Image, Phone, Video, PhoneOff,
  Paperclip, Trash2, Edit3, Smile, LogOut, X, Search, Pin, Star, Bell,
  Shield, UserMinus, MessageSquare, Palette, StickyNote, Reply
} from "lucide-react";
import "./style.css";

const API = "https://lapchat-jwra.onrender.com";

async function request(path, options = {}) {
  try {
    const res = await fetch(`${API}${path}`, options);
    const text = await res.text();

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { ok: false, error: "Backend returned invalid JSON" };
    }

    if (!res.ok) {
      return { ok: false, error: data.error || `Request failed (${res.status})` };
    }

    return data;
  } catch {
    return { ok: false, error: "Cannot connect to backend server" };
  }
}
const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (path, body) => request(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const del = (path) => request(path, { method: "DELETE" });

function Avatar({ name, big = false, avatar }) {
  if (avatar) return <img className={big ? "avatar big" : "avatar"} src={avatar} />;
  return <div className={big ? "avatar big" : "avatar"}>{(name || "?")[0].toUpperCase()}</div>;
}

function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop"><div className="modal-card">
    <div className="modal-top"><h2>{title}</h2><button onClick={onClose}><X size={20}/></button></div>{children}
  </div></div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [deviceMode, setDeviceMode] = useState(localStorage.getItem("lapchat-device") || null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callStatus, setCallStatus] = useState("");
  const [remoteReady, setRemoteReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [auth, setAuth] = useState({ username: "", password: "" });
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null);
  const [profilePopup, setProfilePopup] = useState(null);
  const [servers, setServers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [conversationMembers, setConversationMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [pins, setPins] = useState([]);
  const [notes, setNotes] = useState([]);
  const [view, setView] = useState("home");
  const [currentServer, setCurrentServer] = useState(null);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [typing, setTyping] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const fileRef = useRef(null);
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const scope = view === "server" && currentChannel ? "channel" : (view === "dm" || view === "group") && currentConversation ? "conversation" : null;
  const targetId = scope === "channel" ? currentChannel?.id : scope === "conversation" ? currentConversation?.id : null;

  function toast(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 2600);
  }

  function chooseMode(mode) {
    localStorage.setItem("lapchat-device", mode);
    setDeviceMode(mode);
  }

  function resetLayoutChoice() {
    localStorage.removeItem("lapchat-device");
    setDeviceMode(null);
  }


  function openProfile(profile) {
    const username = profile?.username || profile?.name || "Unknown";
    const friendMatch = friends.find((f) => f.username === username);
    const memberMatch = members.find((m) => m.username === username);
    const isSelf = user?.username === username;

    setProfilePopup({
      username,
      avatar: profile?.avatar || friendMatch?.avatar || memberMatch?.profile?.avatar || (isSelf ? user?.avatar : ""),
      bio: profile?.bio || friendMatch?.bio || memberMatch?.profile?.bio || (isSelf ? user?.bio : "") || "No bio yet.",
      status: profile?.status || friendMatch?.status || (isSelf ? user?.status : "") || "online",
      customStatus: profile?.customStatus || friendMatch?.customStatus || (isSelf ? user?.customStatus : "") || "",
      type: profile?.type || profile?.role || memberMatch?.role || "user",
      role: profile?.role || memberMatch?.role || "",
    });
  }


  function attachCallStreams() {
    setTimeout(() => {
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.muted = true;
      }
      if (remoteVideoRef.current && remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
      if (remoteAudioRef.current && remoteStreamRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
    }, 80);
  }

  async function getCallStream(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Calls need a secure browser with mic/camera support.");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { facingMode: "user" } : false
      });
      localStreamRef.current = stream;
      attachCallStreams();
      return stream;
    } catch (err) {
      console.error("Media permission failed:", err);
      toast(video ? "Allow camera and microphone to start video calls." : "Allow microphone to start voice calls.");
      return null;
    }
  }

  function stopLocalStream() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }

  function closePeer() {
    if (peerRef.current) {
      peerRef.current.onicecandidate = null;
      peerRef.current.ontrack = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    remoteStreamRef.current = null;
    setRemoteReady(false);
  }

  function createPeer(remoteUser, video) {
    closePeer();

    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    peerRef.current = peer;
    remoteStreamRef.current = new MediaStream();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peer.addTrack(track, localStreamRef.current);
      });
    }

    peer.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStreamRef.current.addTrack(track);
      });
      setRemoteReady(true);
      setCallStatus("Connected");
      attachCallStreams();
    };

    peer.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("call-user", {
          type: "webrtc-ice",
          from: user.username,
          to: remoteUser,
          candidate: event.candidate
        });
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setCallStatus("Connected");
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        setCallStatus("Call ended");
      }
    };

    return peer;
  }

  async function startCall(video = false) {
    if (!currentConversation || currentConversation.type !== "dm") {
      return toast("Open a DM first.");
    }

    const other = currentConversation.members.find((m) => m !== user.username);
    if (!other) return toast("No user found for this DM.");

    const stream = await getCallStream(video);
    if (!stream) return;

    setActiveCall({ with: other, video, direction: "outgoing" });
    setCallStatus(video ? "Starting video call..." : "Starting voice call...");

    const peer = createPeer(other, video);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socketRef.current?.emit("call-user", {
      type: "webrtc-offer",
      from: user.username,
      to: other,
      video,
      offer
    });

    setCallStatus("Ringing...");
    attachCallStreams();
  }

  async function acceptIncomingCall() {
    if (!incomingCall) return;

    const stream = await getCallStream(incomingCall.video);
    if (!stream) return;

    const from = incomingCall.from;
    const offer = incomingCall.offer;

    setActiveCall({ with: from, video: incomingCall.video, direction: "incoming" });
    setCallStatus("Connecting...");
    setIncomingCall(null);

    const peer = createPeer(from, incomingCall.video);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socketRef.current?.emit("call-user", {
      type: "webrtc-answer",
      from: user.username,
      to: from,
      video: incomingCall.video,
      answer
    });

    attachCallStreams();
  }

  function declineIncomingCall() {
    if (!incomingCall) return;

    socketRef.current?.emit("call-user", {
      type: "call-declined",
      from: user.username,
      to: incomingCall.from,
      video: incomingCall.video
    });

    setIncomingCall(null);
    toast("You cannot attend right now.");
  }

  function endCall(sendSignal = true) {
    const other = activeCall?.with || incomingCall?.from;

    if (sendSignal && other) {
      socketRef.current?.emit("call-user", {
        type: "call-ended",
        from: user.username,
        to: other
      });
    }

    stopLocalStream();
    closePeer();
    setActiveCall(null);
    setIncomingCall(null);
    setCallStatus("");
  }

  async function refreshAll() {
    if (!user) return;
    const [s, f, r, c, n] = await Promise.all([
      get(`/api/servers?username=${encodeURIComponent(user.username)}`),
      get(`/api/friends?username=${encodeURIComponent(user.username)}`),
      get(`/api/friends/requests?username=${encodeURIComponent(user.username)}`),
      get(`/api/conversations?username=${encodeURIComponent(user.username)}`),
      get(`/api/notes?username=${encodeURIComponent(user.username)}`)
    ]);
    setServers(s.servers || []);
    setFriends(f.friends || []);
    setRequests(r.requests || []);
    setConversations(c.conversations || []);
    setNotes(n.notes || []);
  }

  async function loadMessages(q = search) {
    if (!scope || !targetId) { setMessages([]); setPins([]); return; }
    const data = await get(`/api/messages?scope=${scope}&targetId=${targetId}&q=${encodeURIComponent(q || "")}`);
    const pinData = await get(`/api/pins?scope=${scope}&targetId=${targetId}`);
    setMessages(data.messages || []);
    setPins(pinData.pins || []);
  }

  async function login() {
    const result = await post(authMode === "login" ? "/api/auth/login" : "/api/auth/signup", auth);
    if (!result.ok) return toast(result.error || "Something failed.");
    if (authMode === "signup") { toast("Account created. Switch to login."); setAuthMode("login"); return; }
    setUser(result.user);
  }

  useEffect(() => {
    if (!user) return;
    refreshAll();
    socketRef.current = io(API);
    socketRef.current.emit("identify", user.username);
    socketRef.current.on("refresh", () => { refreshAll(); loadMessages(); });
    socketRef.current.on("typing", (data) => {
      if (data.from !== user.username && data.scope === scope && data.targetId === targetId) {
        setTyping(`${data.from} is typing...`);
        setTimeout(() => setTyping(""), 1700);
      }
    });
    socketRef.current.on("call-user", async (data) => {
      if (!data || data.to !== user.username) return;

      if (data.type === "webrtc-offer") {
        if (activeCall) {
          socketRef.current?.emit("call-user", {
            type: "call-declined",
            from: user.username,
            to: data.from,
            video: data.video
          });
          return;
        }
        setIncomingCall({
          from: data.from,
          video: !!data.video,
          offer: data.offer,
          startedAt: Date.now()
        });
        return;
      }

      if (data.type === "webrtc-answer") {
        if (peerRef.current && data.answer) {
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          setCallStatus("Connected");
          attachCallStreams();
        }
        return;
      }

      if (data.type === "webrtc-ice") {
        if (peerRef.current && data.candidate) {
          try {
            await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.warn("ICE candidate failed:", err);
          }
        }
        return;
      }

      if (data.type === "call-declined") {
        toast(`${data.from} cannot attend right now.`);
        endCall(false);
        return;
      }

      if (data.type === "call-ended") {
        toast(`${data.from} ended the call.`);
        endCall(false);
        return;
      }
    });
    return () => socketRef.current?.disconnect();
  }, [user, scope, targetId]);

  useEffect(() => { loadMessages(); }, [view, currentChannel?.id, currentConversation?.id]);

  useEffect(() => {
    attachCallStreams();
  }, [activeCall, remoteReady]);

  useEffect(() => {
    return () => {
      stopLocalStream();
      closePeer();
    };
  }, []);


  async function openHome() {
    setMobileSidebar(false);
    setView("home"); setCurrentServer(null); setCurrentChannel(null); setCurrentConversation(null); setMessages([]); setPins([]); await refreshAll();
  }

  async function openServer(server) {
    setMobileSidebar(false);
    setView("server"); setCurrentServer(server); setCurrentConversation(null);
    const ch = await get(`/api/servers/${server.id}/channels`);
    const mem = await get(`/api/servers/${server.id}/members`);
    setChannels(ch.channels || []); setMembers(mem.members || []); setCurrentChannel((ch.channels || [])[0] || null);
  }

  async function selectChannel(channel) { setMobileSidebar(false); setView("server"); setCurrentChannel(channel); setCurrentConversation(null); }
  async function openConversation(conversation) {
    setMobileSidebar(false);
    setCurrentConversation(conversation); setCurrentServer(null); setCurrentChannel(null); setView(conversation.type === "group" ? "group" : "dm");
    if (conversation.type === "group") {
      const mem = await get(`/api/conversations/${conversation.id}/members`);
      setConversationMembers(mem.members || []);
    } else setConversationMembers(conversation.members || []);
  }

  async function sendMessage(type = "text", content = text) {
    if (!scope || !targetId || !content.trim()) return;
    await post("/api/messages", { scope, targetId, sender: user.username, content, type, replyTo: replyTo?.id || null });
    setText(""); setReplyTo(null); await loadMessages("");
  }

  function handleTyping(value) {
    setText(value);
    if (scope && targetId) socketRef.current?.emit("typing", { from: user.username, scope, targetId });
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const form = new FormData(); form.append("file", file);
    const result = await fetch(`${API}/api/upload`, { method: "POST", body: form }).then((r) => r.json());
    if (!result.ok) return toast(result.error);
    let type = "file";
    if (result.mime?.startsWith("image/")) type = "image";
    if (result.mime?.startsWith("video/")) type = "video";
    if (result.mime?.includes("gif")) type = "gif";
    await sendMessage(type, result.url);
    e.target.value = "";
  }

  function openForm(title, fields, submit) { setModal({ title, fields, submit }); }
  const values = (form) => Object.fromEntries(new FormData(form).entries());

  async function editMessage(message) {
    openForm("Edit Message", [{ name: "content", label: "Message", value: message.content }], async (v) => {
      await put(`/api/messages/${message.id}`, { sender: user.username, content: v.content });
      setModal(null); loadMessages();
    });
  }
  async function deleteMessage(message) { await del(`/api/messages/${message.id}?sender=${encodeURIComponent(user.username)}`); await loadMessages(); }
  async function react(message, emoji) { await post(`/api/messages/${message.id}/react`, { username: user.username, emoji }); await loadMessages(); }
  async function pinMessage(message) { await post(`/api/messages/${message.id}/pin`, {}); await loadMessages(); }

  function addFriend() {
    openForm("Add Friend", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post("/api/friends/request", { requester: user.username, receiver: v.username });
      toast(result.ok ? "Friend request sent." : result.error); setModal(null); refreshAll();
    });
  }
  async function acceptFriend(requester) { await post("/api/friends/accept", { username: user.username, requester }); toast("Friend request accepted."); refreshAll(); }
  async function removeFriend(friend) { await del(`/api/friends/${friend}?username=${encodeURIComponent(user.username)}`); toast("Friend removed."); refreshAll(); }
  async function openDm(friend) {
    const name = typeof friend === "string" ? friend : friend.username;
    const result = await post("/api/conversations/dm", { user: user.username, friend: name });
    if (!result.ok) return toast(result.error);
    await refreshAll();
    const data = await get(`/api/conversations?username=${encodeURIComponent(user.username)}`);
    const convo = (data.conversations || []).find((c) => c.id === result.conversationId);
    if (convo) openConversation(convo);
  }

  function createGroup() {
    openForm("Create Group", [{ name: "name", label: "Group name" }, { name: "members", label: "Members, comma separated" }], async (v) => {
      const members = v.members ? v.members.split(",").map((x) => x.trim()).filter(Boolean) : [];
      const result = await post("/api/conversations/group", { owner: user.username, name: v.name, members });
      toast(result.ok ? "Group created." : result.error); setModal(null); refreshAll();
    });
  }

  function addGroupMember() {
    openForm("Add Group Member", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post(`/api/conversations/${currentConversation.id}/members`, { owner: user.username, username: v.username });
      toast(result.ok ? "Member added." : result.error); setModal(null);
      const mem = await get(`/api/conversations/${currentConversation.id}/members`);
      setConversationMembers(mem.members || []);
    });
  }

  function createServer() {
    openForm("Create Server", [{ name: "name", label: "Server name" }], async (v) => {
      const result = await post("/api/servers", { owner: user.username, name: v.name });
      toast(result.ok ? "Server created." : result.error); setModal(null); refreshAll();
    });
  }

  function serverSettings() {
    openForm("Server Settings", [
      { name: "name", label: "Server name", value: currentServer?.name || "" },
      { name: "description", label: "Description", value: currentServer?.description || "" },
      { name: "icon", label: "Icon URL", value: currentServer?.icon || "" }
    ], async (v) => {
      const result = await put(`/api/servers/${currentServer.id}`, { username: user.username, name: v.name, description: v.description, icon: v.icon });
      toast(result.ok ? "Server updated." : result.error); setModal(null);
      if (result.ok) openServer({ ...currentServer, ...result.server });
    });
  }

  function inviteToServer() {
    openForm("Invite User", [{ name: "username", label: "Username" }], async (v) => {
      const result = await post("/api/servers/invite", { serverId: currentServer.id, inviter: user.username, username: v.username });
      toast(result.ok ? "User invited." : result.error); setModal(null);
      const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
    });
  }

  function createChannel() {
    openForm("Create Channel", [{ name: "name", label: "Channel name" }, { name: "topic", label: "Topic" }], async (v) => {
      const result = await post("/api/channels", { serverId: currentServer.id, username: user.username, name: v.name, topic: v.topic });
      toast(result.ok ? "Channel created." : result.error); setModal(null); openServer(currentServer);
    });
  }
  function renameChannel() {
    openForm("Channel Settings", [{ name: "name", label: "Channel name", value: currentChannel.name }, { name: "topic", label: "Topic", value: currentChannel.topic || "" }], async (v) => {
      const result = await put(`/api/channels/${currentChannel.id}`, { name: v.name, topic: v.topic });
      toast(result.ok ? "Channel updated." : result.error); setModal(null); openServer(currentServer);
    });
  }
  async function deleteChannel() { const result = await del(`/api/channels/${currentChannel.id}`); toast(result.ok ? "Channel deleted." : result.error); openServer(currentServer); }

  async function changeRole(member, role) {
    const result = await post(`/api/servers/${currentServer.id}/role`, { actor: user.username, username: member.username, role });
    toast(result.ok ? "Role updated." : result.error);
    const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
  }
  async function kickMember(member) {
    const result = await del(`/api/servers/${currentServer.id}/members/${encodeURIComponent(member.username)}?actor=${encodeURIComponent(user.username)}`);
    toast(result.ok ? "Member removed." : result.error);
    const mem = await get(`/api/servers/${currentServer.id}/members`); setMembers(mem.members || []);
  }

  function settings() {
    openForm("Settings", [
      { name: "username", label: "Username", value: user.username },
      { name: "password", label: "New password", type: "password" },
      { name: "bio", label: "Bio", value: user.bio || "" },
      { name: "customStatus", label: "Custom status", value: user.customStatus || "" },
      { name: "avatar", label: "Avatar URL", value: user.avatar || "" },
      { name: "banner", label: "Banner URL", value: user.banner || "" },
      { name: "accent", label: "Accent color", value: user.accent || "#00d9ff" },
      { name: "theme", label: "Theme: neon, ocean, violet, emerald, mono", value: user.theme || "neon" },
      { name: "density", label: "Density: compact or comfortable", value: user.density || "comfortable" }
    ], async (v) => {
      const result = await post("/api/settings", {
        oldUsername: user.username, newUsername: v.username, newPassword: v.password,
        bio: v.bio, avatar: v.avatar, banner: v.banner, accent: v.accent, theme: v.theme, density: v.density, customStatus: v.customStatus
      });
      if (result.ok) { setUser(result.user); toast("Settings saved."); } else toast(result.error);
      setModal(null); refreshAll();
    });
  }

  function statusModal() {
    openForm("Set Status", [{ name: "status", label: "online, idle, dnd, invisible", value: user.status || "online" }, { name: "customStatus", label: "Custom status", value: user.customStatus || "" }], async (v) => {
      const result = await post("/api/status", { username: user.username, status: v.status, customStatus: v.customStatus });
      if (result.ok) setUser(result.user);
      setModal(null); refreshAll();
    });
  }

  function sendMedia() {
    openForm("Send Media Link", [{ name: "url", label: "GIF / image / video / file URL" }, { name: "type", label: "Type: text, gif, image, video, file", value: "file" }], async (v) => {
      await sendMessage(v.type || "file", v.url); setModal(null);
    });
  }

  function addNote() {
    openForm("Add Personal Note", [{ name: "text", label: "Note" }], async (v) => {
      const result = await post("/api/notes", { username: user.username, text: v.text });
      toast(result.ok ? "Note added." : result.error); setModal(null); refreshAll();
    });
  }
  async function deleteNote(id) { await del(`/api/notes/${id}`); refreshAll(); }

  function callUser(video = false) {
    startCall(video);
  }

  function answerCall(accepted) {
    if (accepted) acceptIncomingCall();
    else declineIncomingCall();
  }

  const currentTitle = () => view === "home" ? "Home" : view === "server" ? (currentChannel ? `# ${currentChannel.name}` : currentServer?.name) : currentConversation?.name || "LapChat";
  const currentSubtitle = () => view === "home" ? "Friends, requests, DMs, groups, and notes" : view === "server" ? (currentChannel?.topic || currentServer?.description || currentServer?.name || "Server") : view === "dm" ? "Direct Message" : "Group Chat";

  if (!user) {
    return <div className="auth-screen">{notice && <div className="toast">{notice}</div>}<div className="auth-card">
      <h1>LapChat+</h1><p>Neon messaging, servers, friends, groups, themes, and customization.</p>
      <input placeholder="Username" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })}/>
      <input placeholder="Password" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })}/>
      <button onClick={login}>{authMode === "login" ? "Login" : "Create Account"}</button>
      <button className="ghost" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "Need an account?" : "Already have an account?"}</button>
    </div></div>;
  }

  if (user && !deviceMode) {
    return <div className="auth-screen">
      <div className="auth-card layout-card">
        <h1>Choose Layout</h1>
        <p>Pick how you are using LapChat+ right now. You can change it later in settings.</p>
        <button onClick={() => chooseMode("desktop")}>Laptop / Desktop</button>
        <button className="ghost" onClick={() => chooseMode("mobile")}>Mobile / Tablet</button>
      </div>
    </div>;
  }

  return <div className={`app layout-${deviceMode} ${view === "server" ? "" : "no-right-panel"} theme-${user.theme || "neon"} density-${user.density || "comfortable"}`} style={{ "--accent": user.accent || "#00d9ff" }}>
    {notice && <div className="toast">{notice}</div>}
    {incomingCall && <div className="call-overlay">
      <div className="call-card">
        <div className="call-glow" />
        <Avatar name={incomingCall.from} big />
        <p className="call-label">Incoming {incomingCall.video ? "video" : "voice"} call</p>
        <h2>{incomingCall.from}</h2>
        <p className="call-hint">Accepting will ask your browser for {incomingCall.video ? "camera and microphone" : "microphone"} permission.</p>
        <div className="call-actions">
          <button className="call-decline" onClick={() => answerCall(false)}><PhoneOff size={20}/> Cannot attend</button>
          <button className="call-accept" onClick={() => answerCall(true)}>{incomingCall.video ? <Video size={20}/> : <Phone size={20}/>} Accept</button>
        </div>
      </div>
    </div>}
    {activeCall && <div className="active-call-panel">
      <div className="active-call-top">
        <div>
          <strong>{activeCall.video ? "Video" : "Voice"} call with {activeCall.with}</strong>
          <span>{callStatus || "Connecting..."}</span>
        </div>
        <button className="call-end-small" onClick={() => endCall(true)}><PhoneOff size={18}/> End</button>
      </div>
      <div className={activeCall.video ? "call-media video-call" : "call-media voice-call"}>
        {activeCall.video ? <>
          <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
          <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
        </> : <>
          <Avatar name={activeCall.with} big />
          <p>Voice call active</p>
          <audio ref={remoteAudioRef} autoPlay />
        </>}
      </div>
    </div>}
    {deviceMode === "mobile" && mobileSidebar && <button className="mobile-scrim" onClick={() => setMobileSidebar(false)} aria-label="Close menu" />}
    {modal && <Modal title={modal.title} onClose={() => setModal(null)}><form onSubmit={(e) => { e.preventDefault(); modal.submit(values(e.currentTarget)); }}>{modal.fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} type={field.type || "text"} defaultValue={field.value || ""}/></label>)}<button type="submit">Confirm</button></form></Modal>}

    <div className="server-rail">
      <button className={view === "home" ? "server-icon active" : "server-icon"} onClick={openHome}><Home size={24}/></button>
      <div className="rail-divider"/>
      {servers.map((server) => <button key={server.id} className={currentServer?.id === server.id && view === "server" ? "server-icon active" : "server-icon"} onClick={() => openServer(server)} title={server.name}>{server.icon ? <img src={server.icon}/> : server.name.slice(0, 2).toUpperCase()}</button>)}
      <button className="server-icon add" onClick={createServer}><Plus size={24}/></button>
    </div>

    <div className={`sidebar ${mobileSidebar ? "open" : ""}`}>
      {view === "server" ? <>
        <div className="sidebar-title">{currentServer?.name}</div>
        <button className="sidebar-action" onClick={inviteToServer}>Invite User</button>
        <button className="sidebar-action subtle" onClick={serverSettings}><Shield size={16}/> Server Settings</button>
        <div className="section-title">Text Channels</div>
        {channels.map((channel) => <button key={channel.id} className={currentChannel?.id === channel.id ? "channel active" : "channel"} onClick={() => selectChannel(channel)}><Hash size={18}/>{channel.name}</button>)}
        <button className="channel special" onClick={createChannel}><Plus size={18}/> Create Channel</button>
        {currentChannel && <div className="tool-row"><button onClick={renameChannel}>Edit</button><button onClick={deleteChannel}>Delete</button></div>}
      </> : <>
        <div className="sidebar-title">Home</div>
        <button className="sidebar-action" onClick={addFriend}><UserPlus size={16}/> Add Friend</button>
        <button className="sidebar-action" onClick={createGroup}><Users size={16}/> New Group</button>
        <button className="sidebar-action subtle" onClick={addNote}><StickyNote size={16}/> Add Note</button>
        <div className="section-title">Friends</div>
        <div className="friends-scroll">
          {friends.length === 0 && <div className="empty">No friends yet.</div>}
          {friends.map((friend) => <div key={friend.username} className="friend-row"><button className="dm-item" onClick={() => openDm(friend)}><span className="avatar-click" onClick={(e) => { e.stopPropagation(); openProfile({ username: friend.username, avatar: friend.avatar, status: friend.status, customStatus: friend.customStatus, type: "friend" }); }}><Avatar name={friend.username} avatar={friend.avatar}/></span><span>{friend.username}</span><small>{friend.status}</small></button><button className="mini" onClick={() => removeFriend(friend.username)}><UserMinus size={14}/></button></div>)}
        </div>
        <div className="section-title">Requests</div>
        {requests.length === 0 && <div className="empty">No pending requests.</div>}
        {requests.map((req) => <div key={req.requester} className="request-card"><span>{req.requester}</span><button onClick={() => acceptFriend(req.requester)}>Accept</button></div>)}
        <div className="section-title">DMs / Groups</div>
        {conversations.map((conversation) => <button key={conversation.id} className={currentConversation?.id === conversation.id ? "dm-item active" : "dm-item"} onClick={() => openConversation(conversation)}><span className="avatar-click" onClick={(e) => { e.stopPropagation(); openProfile({ username: conversation.name, bio: conversation.type, type: conversation.type }); }}><Avatar name={conversation.name}/></span><span>{conversation.name}</span><small>{conversation.type}</small></button>)}
      </>}
      <div className="sidebar-bottom"><button className="profile-avatar-button" onClick={() => openProfile({ username: user.username, avatar: user.avatar, bio: user.bio, status: user.status, customStatus: user.customStatus, type: "you" })}><Avatar name={user.username} avatar={user.avatar}/></button><div><strong>{user.username}</strong><small onClick={statusModal}>{user.customStatus || user.status || "Online"}</small></div><button title="Change layout" onClick={resetLayoutChoice}><Palette size={18}/></button><button onClick={settings}><Settings size={18}/></button><button onClick={() => setUser(null)}><LogOut size={18}/></button></div>
    </div>

    <div className="chat-main">
      <div className="topbar"><button className="mobile-menu-btn" onClick={() => setMobileSidebar(!mobileSidebar)}>☰</button><div><h2>{currentTitle()}</h2><p>{currentSubtitle()}</p></div><div className="top-actions">
        <input className="search" placeholder="Search messages" value={search} onChange={(e) => { setSearch(e.target.value); loadMessages(e.target.value); }}/>
        <button onClick={sendMedia}><Image size={20}/></button><button onClick={() => fileRef.current?.click()}><Paperclip size={20}/></button><button onClick={() => callUser(false)}><Phone size={20}/></button><button onClick={() => callUser(true)}><Video size={20}/></button>
      </div></div>
      {pins.length > 0 && <div className="pinbar"><Pin size={15}/> {pins.length} pinned message{pins.length > 1 ? "s" : ""}: {pins[0].content.slice(0, 90)}</div>}
      <div className="messages">{view === "home" ? <div className="welcome"><h1>Welcome to LapChat+</h1><p>Customize your profile, add friends, create servers, manage roles, pin messages, search chats, and upload media.</p></div> : messages.length === 0 ? <div className="welcome"><h1>No messages yet</h1><p>Start the conversation.</p></div> : messages.map((message) => <div key={message.id} className={message.sender === user.username ? "message mine" : "message"}><button className="message-avatar-button" onClick={() => openProfile({ username: message.sender, type: message.sender === user.username ? "you" : "user" })}><Avatar name={message.sender}/></button><div className="message-bubble">
        {message.replyTo && <div className="reply-preview"><Reply size={13}/> Replying to message #{message.replyTo}</div>}
        <div className="message-meta"><strong>{message.sender}</strong><span>{message.createdAt}</span>{message.edited && !message.deleted && <em>edited</em>}{message.pinned && <Pin size={13}/>}</div>
        {message.deleted ? <p className="deleted">[deleted]</p> : message.type === "gif" || message.type === "image" ? <img className="media-img" src={message.content}/> : message.type === "video" ? <video className="media-video" src={message.content} controls/> : message.type === "file" ? <a href={message.content} target="_blank">Open attachment</a> : <p>{message.content}</p>}
        <div className="reactions">{Object.entries(message.reactions || {}).map(([emoji, users]) => users.length ? <button key={emoji} onClick={() => react(message, emoji)}>{emoji} {users.length}</button> : null)}</div>
        {!message.deleted && <div className="message-actions"><button onClick={() => setReplyTo(message)}><Reply size={14}/> Reply</button><button onClick={() => react(message, "👍")}><Smile size={14}/> 👍</button><button onClick={() => react(message, "🔥")}>🔥</button><button onClick={() => pinMessage(message)}><Pin size={14}/> Pin</button>{message.sender === user.username && <><button onClick={() => editMessage(message)}><Edit3 size={14}/> Edit</button><button onClick={() => deleteMessage(message)}><Trash2 size={14}/> Delete</button></>}</div>}
      </div></div>)}</div>
      {typing && <div className="typing">{typing}</div>}
      {replyTo && <div className="replying">Replying to {replyTo.sender}: {replyTo.content.slice(0, 80)} <button onClick={() => setReplyTo(null)}>cancel</button></div>}
      <div className="composer"><input ref={fileRef} type="file" onChange={uploadFile} hidden/><button disabled={!scope} onClick={() => fileRef.current?.click()}><Paperclip size={20}/></button><input disabled={!scope} placeholder={scope ? "Message..." : "Select a chat first..."} value={text} onChange={(e) => handleTyping(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}/><button disabled={!scope} onClick={() => sendMessage()}><Send size={20}/></button></div>
    </div>

    {view === "server" && (
      <div className="right-panel">
        <h3>Members</h3>
        {members.map((m) => <div key={m.username} className="member"><button className="profile-avatar-button" onClick={() => openProfile({ username: m.username, avatar: m.profile?.avatar, bio: m.profile?.bio, role: m.role, type: "server member" })}><Avatar name={m.username} avatar={m.profile?.avatar}/></button><div><strong>{m.username}</strong><small>{m.role}</small></div>{m.role !== "owner" && <div className="member-actions"><button onClick={() => changeRole(m, m.role === "admin" ? "member" : "admin")}><Shield size={13}/></button><button onClick={() => kickMember(m)}><UserMinus size={13}/></button></div>}</div>)}
      </div>
    )}

    {profilePopup && (
      <div className="profile-popup-backdrop" onClick={() => setProfilePopup(null)}>
        <div className="profile-popup-card" onClick={(e) => e.stopPropagation()}>
          <button className="profile-popup-close" onClick={() => setProfilePopup(null)}><X size={28}/></button>
          <div className="profile-popup-hero">
            <Avatar name={profilePopup.username} avatar={profilePopup.avatar} big />
            <h1>{profilePopup.username}</h1>
            <p>@{profilePopup.type || "user"}</p>
          </div>
          <div className="profile-popup-stats">
            <div><strong>{messages.filter((m) => m.sender === profilePopup.username).length}</strong><span>Visible Messages</span></div>
            <div><strong>{profilePopup.status || "online"}</strong><span>Status</span></div>
          </div>
          <div className="profile-popup-info">
            <div><span>Username</span><strong>{profilePopup.username}</strong></div>
            <div><span>Bio</span><strong>{profilePopup.bio || "No bio yet."}</strong></div>
            {profilePopup.customStatus && <div><span>Custom Status</span><strong>{profilePopup.customStatus}</strong></div>}
            {profilePopup.role && <div><span>Role</span><strong>{profilePopup.role}</strong></div>}
          </div>
          <div className="profile-popup-actions">
            <button onClick={() => setProfilePopup(null)}>Close</button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export default App;
