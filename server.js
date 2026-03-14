const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const users  = new Map();
const rooms  = new Map();
const msgs   = { general:[], gaming:[], dev:[] };
const dmMsgs = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    } else { res.writeHead(404); res.end('index.html not found'); }
  } else { res.writeHead(404); res.end(); }
});

const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 * 1024 });

const send = (uid, data) => {
  const u = users.get(uid);
  if (u && u.ws.readyState === 1) {
    if (typeof data === 'string') u.ws.send(data);
    else u.ws.send(JSON.stringify(data));
  }
};
const broadcast = (data, skip = null) => {
  const m = typeof data === 'string' ? data : JSON.stringify(data);
  users.forEach((u, uid) => { if (uid !== skip && u.ws.readyState === 1) u.ws.send(m); });
};
const broadcastRoom = (room, data, skip = null) => {
  const m = (typeof data === 'string' || Buffer.isBuffer(data)) ? data : JSON.stringify(data);
  const r = rooms.get(room);
  if (!r) return;
  r.forEach(uid => { if (uid !== skip) { const u = users.get(uid); if (u && u.ws.readyState === 1) u.ws.send(m); } });
};
const onlineList = () => { const o = {}; users.forEach((u, uid) => { o[uid] = { name:u.name, color:u.color, init:u.init, tag:u.tag, status:u.status||'online', activity:u.activity||'' }; }); return o; };
const roomList = () => { const r = {}; rooms.forEach((uids, room) => { r[room] = {}; uids.forEach(uid => { const u=users.get(uid); if(u) r[room][uid]={name:u.name,color:u.color,init:u.init,speaking:u.speaking||false,screenSharing:u.screenSharing||false}; }); }); return r; };

wss.on('connection', ws => {
  let me = null;

  ws.on('message', (raw, isBinary) => {
    // Binary = audio chunk OR screen frame (peek at header)
    if (isBinary) {
      if (!me) return;
      const u = users.get(me);
      if (!u || !u.room) return;

      // Peek at JSON header to check type
      let nl = -1;
      for (let i = 0; i < Math.min(raw.length, 256); i++) { if (raw[i] === 10) { nl = i; break; } }
      if (nl > 0) {
        try {
          const hdr = JSON.parse(raw.slice(0, nl).toString('utf8'));
          if (hdr.type === 'screen_frame') {
            // Relay screen frame to room (already has full header+jpeg)
            broadcastRoom(u.room, raw, me);
            return;
          }
        } catch(e) {}
      }

      // Audio: wrap with header and relay
      const header = JSON.stringify({ type:'audio', from:me, name:u.name, color:u.color });
      const headerBuf = Buffer.from(header + '\n');
      const combined = Buffer.concat([headerBuf, raw]);
      broadcastRoom(u.room, combined, me);
      return;
    }

    let d; try { d = JSON.parse(raw); } catch { return; }

    if (d.type === 'join') {
      me = d.uid;
      users.set(me, { ws, name:d.name, color:d.color, init:d.init, tag:d.tag, status:'online', activity:'', speaking:false, screenSharing:false, room:null });
      ws.send(JSON.stringify({ type:'init', users:onlineList(), rooms:roomList(), msgs }));
      dmMsgs.forEach((m, convId) => { if(convId.includes(me)) ws.send(JSON.stringify({ type:'dm_history', convId, msgs:m })); });
      broadcast({ type:'user_join', uid:me, user:{name:d.name,color:d.color,init:d.init,tag:d.tag,status:'online',activity:''} }, me);
      console.log(`+ ${d.name}`);
      return;
    }
    if (!me) return;

    switch (d.type) {
      case 'chat': {
        const m = { from:me, fromName:users.get(me)?.name, fromColor:users.get(me)?.color, fromInit:users.get(me)?.init, text:d.text, time:d.time, ts:Date.now() };
        const ch = d.channel||'general';
        if (!msgs[ch]) msgs[ch]=[];
        msgs[ch].push(m); if(msgs[ch].length>100) msgs[ch].shift();
        broadcast({ type:'chat', channel:ch, msg:m });
        break;
      }
      case 'dm': {
        const convId=[me,d.to].sort().join('_vs_');
        const m={from:me,fromName:users.get(me)?.name,fromColor:users.get(me)?.color,fromInit:users.get(me)?.init,text:d.text,time:d.time,ts:Date.now()};
        if(!dmMsgs.has(convId)) dmMsgs.set(convId,[]);
        dmMsgs.get(convId).push(m);
        send(d.to,{type:'dm',convId,from:me,msg:m});
        ws.send(JSON.stringify({type:'dm_sent',convId,msg:m}));
        break;
      }
      case 'friend_req':    send(d.to,{type:'friend_req',from:me,name:users.get(me)?.name,color:users.get(me)?.color,init:users.get(me)?.init,tag:users.get(me)?.tag}); break;
      case 'friend_accept': send(d.to,{type:'friend_accept',from:me,name:users.get(me)?.name}); break;
      case 'call':          send(d.to,{type:'incoming_call',from:me,name:users.get(me)?.name,color:users.get(me)?.color,init:users.get(me)?.init,video:d.video}); break;
      case 'call_answer':   send(d.to,{type:'call_answered',from:me}); break;
      case 'call_decline':  send(d.to,{type:'call_declined',from:me}); break;

      // ── WebRTC signaling (screen share & peer video) ──
      case 'rtc_offer':     send(d.to,{type:'rtc_offer',  from:me, sdp:d.sdp,  kind:d.kind||'screen'}); break;
      case 'rtc_answer':    send(d.to,{type:'rtc_answer', from:me, sdp:d.sdp,  kind:d.kind||'screen'}); break;
      case 'rtc_ice':       send(d.to,{type:'rtc_ice',    from:me, candidate:d.candidate}); break;

      // ── Screen share state broadcast ──
      case 'screen_start': {
        const u=users.get(me);
        if(u){u.screenSharing=true;}
        broadcastRoom(u?.room||'',{type:'screen_start',uid:me,name:users.get(me)?.name},me);
        broadcast({type:'voice_update',rooms:roomList()});
        break;
      }
      case 'screen_stop': {
        const u=users.get(me);
        if(u){u.screenSharing=false;}
        broadcastRoom(u?.room||'',{type:'screen_stop',uid:me},me);
        broadcast({type:'voice_update',rooms:roomList()});
        break;
      }

      case 'join_voice': {
        const u=users.get(me);
        if(u?.room){const prev=rooms.get(u.room);if(prev){prev.delete(me);if(!prev.size)rooms.delete(u.room);}}
        if(!rooms.has(d.room)) rooms.set(d.room,new Set());
        rooms.get(d.room).add(me); u.room=d.room;
        broadcast({type:'voice_update',rooms:roomList()});
        broadcastRoom(d.room,{type:'peer_joined',uid:me,name:u.name,color:u.color,init:u.init},me);
        ws.send(JSON.stringify({type:'voice_joined',room:d.room,peers:[...rooms.get(d.room)].filter(x=>x!==me).map(uid=>{const u=users.get(uid);return{uid,name:u?.name,color:u?.color,init:u?.init,screenSharing:u?.screenSharing||false};})}));
        break;
      }
      case 'leave_voice': {
        const u=users.get(me);
        if(u){u.screenSharing=false;}
        if(u?.room){const r=rooms.get(u.room);if(r){r.delete(me);if(!r.size)rooms.delete(u.room);}broadcastRoom(u.room,{type:'peer_left',uid:me});u.room=null;}
        broadcast({type:'voice_update',rooms:roomList()});
        break;
      }
      case 'speaking': {
        const u=users.get(me);if(u)u.speaking=d.speaking;
        if(u?.room) broadcastRoom(u.room,{type:'speaking',uid:me,speaking:d.speaking},me);
        break;
      }
      case 'status': {
        const u=users.get(me);if(u){u.status=d.status;u.activity=d.activity||'';}
        broadcast({type:'user_update',uid:me,status:d.status,activity:d.activity||''});
        break;
      }
    }
  });

  ws.on('close', () => {
    if(!me) return;
    const u=users.get(me);
    if(u?.room){const r=rooms.get(u.room);if(r){r.delete(me);if(!r.size)rooms.delete(u.room);}broadcastRoom(u.room,{type:'peer_left',uid:me});}
    users.delete(me);
    broadcast({type:'user_leave',uid:me});
    console.log(`- ${u?.name}`);
  });
  ws.on('error',()=>{});
});

server.listen(PORT, () => console.log(`VoiceLink running on :${PORT}`));
