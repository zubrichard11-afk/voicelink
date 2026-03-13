const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const users  = new Map(); // uid -> { ws, name, color, init, tag, room, speaking }
const rooms  = new Map(); // roomName -> Set(uid)
const msgs   = { general:[], gaming:[], dev:[] };
const dmMsgs = new Map(); // convId -> []

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    } else { res.writeHead(404); res.end('index.html not found'); }
  } else { res.writeHead(404); res.end(); }
});

const wss = new WebSocketServer({ server });

const send = (uid, data) => { const u = users.get(uid); if (u && u.ws.readyState === 1) u.ws.send(JSON.stringify(data)); };
const broadcast = (data, skip = null) => { const m = JSON.stringify(data); users.forEach((u, uid) => { if (uid !== skip && u.ws.readyState === 1) u.ws.send(m); }); };
const onlineList = () => { const o = {}; users.forEach((u, uid) => { o[uid] = { name: u.name, color: u.color, init: u.init, tag: u.tag, status: u.status || 'online', activity: u.activity || '' }; }); return o; };
const roomList = () => { const r = {}; rooms.forEach((uids, room) => { r[room] = {}; uids.forEach(uid => { const u = users.get(uid); if (u) r[room][uid] = { name: u.name, color: u.color, init: u.init, speaking: u.speaking || false }; }); }); return r; };

wss.on('connection', ws => {
  let me = null;

  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }

    if (d.type === 'join') {
      me = d.uid;
      users.set(me, { ws, name: d.name, color: d.color, init: d.init, tag: d.tag, status: 'online', activity: '', speaking: false, room: null });
      ws.send(JSON.stringify({ type: 'init', users: onlineList(), rooms: roomList(), msgs }));
      dmMsgs.forEach((m, convId) => { if (convId.includes(me)) ws.send(JSON.stringify({ type: 'dm_history', convId, msgs: m })); });
      broadcast({ type: 'user_join', uid: me, user: { name: d.name, color: d.color, init: d.init, tag: d.tag, status: 'online', activity: '' } }, me);
      console.log(`+ ${d.name}`);
      return;
    }
    if (!me) return;

    switch (d.type) {
      case 'chat': {
        const m = { from: me, fromName: users.get(me)?.name, fromColor: users.get(me)?.color, fromInit: users.get(me)?.init, text: d.text, time: d.time, ts: Date.now() };
        const ch = d.channel || 'general';
        if (!msgs[ch]) msgs[ch] = [];
        msgs[ch].push(m); if (msgs[ch].length > 100) msgs[ch].shift();
        broadcast({ type: 'chat', channel: ch, msg: m });
        break;
      }
      case 'dm': {
        const convId = [me, d.to].sort().join('_vs_');
        const m = { from: me, fromName: users.get(me)?.name, fromColor: users.get(me)?.color, fromInit: users.get(me)?.init, text: d.text, time: d.time, ts: Date.now() };
        if (!dmMsgs.has(convId)) dmMsgs.set(convId, []);
        dmMsgs.get(convId).push(m);
        send(d.to, { type: 'dm', convId, from: me, msg: m });
        ws.send(JSON.stringify({ type: 'dm_sent', convId, msg: m }));
        break;
      }
      case 'friend_req':    send(d.to, { type: 'friend_req',    from: me, name: users.get(me)?.name, color: users.get(me)?.color, init: users.get(me)?.init, tag: users.get(me)?.tag }); break;
      case 'friend_accept': send(d.to, { type: 'friend_accept', from: me, name: users.get(me)?.name }); break;
      case 'call':          send(d.to, { type: 'incoming_call', from: me, name: users.get(me)?.name, color: users.get(me)?.color, init: users.get(me)?.init, video: d.video }); break;
      case 'call_answer':   send(d.to, { type: 'call_answered', from: me }); break;
      case 'call_decline':  send(d.to, { type: 'call_declined', from: me }); break;
      case 'offer':
      case 'answer':
      case 'ice':           send(d.to, { ...d, from: me }); break;
      case 'join_voice': {
        const u = users.get(me);
        if (u?.room) { const prev = rooms.get(u.room); if (prev) { prev.delete(me); if (!prev.size) rooms.delete(u.room); } }
        if (!rooms.has(d.room)) rooms.set(d.room, new Set());
        const peers = [...rooms.get(d.room)];
        rooms.get(d.room).add(me); u.room = d.room;
        ws.send(JSON.stringify({ type: 'voice_peers', room: d.room, peers }));
        broadcast({ type: 'voice_update', rooms: roomList() });
        break;
      }
      case 'leave_voice': {
        const u = users.get(me);
        if (u?.room) { const r = rooms.get(u.room); if (r) { r.delete(me); if (!r.size) rooms.delete(u.room); } u.room = null; }
        broadcast({ type: 'voice_update', rooms: roomList() });
        break;
      }
      case 'speaking': {
        const u = users.get(me); if (u) u.speaking = d.speaking;
        if (u?.room) broadcast({ type: 'voice_update', rooms: roomList() });
        break;
      }
      case 'status': {
        const u = users.get(me); if (u) { u.status = d.status; u.activity = d.activity || ''; }
        broadcast({ type: 'user_update', uid: me, status: d.status, activity: d.activity || '' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!me) return;
    const u = users.get(me);
    if (u?.room) { const r = rooms.get(u.room); if (r) { r.delete(me); if (!r.size) rooms.delete(u.room); } }
    users.delete(me);
    broadcast({ type: 'user_leave', uid: me });
    console.log(`- ${u?.name} left`);
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => console.log(`VoiceLink running on :${PORT}`));
