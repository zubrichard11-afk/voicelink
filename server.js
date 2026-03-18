const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

// ── Rate limiting ──
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 30; // messages per second

function checkRateLimit(uid) {
  const now = Date.now();
  if (!rateLimits.has(uid)) {
    rateLimits.set(uid, { count: 0, resetAt: now + RATE_LIMIT_WINDOW });
  }
  const limit = rateLimits.get(uid);
  if (now > limit.resetAt) {
    limit.count = 0;
    limit.resetAt = now + RATE_LIMIT_WINDOW;
  }
  limit.count++;
  return limit.count <= RATE_LIMIT_MAX;
}

// ── HTML Escape Utility ──
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const users   = new Map();
const rooms   = new Map();
const msgs    = { general:[], gaming:[], dev:[] };
const dmMsgs  = new Map();

// ── Roles: first user to join becomes Admin ──
const roles = new Map(); // uid -> 'admin'|'mod'|'user'
let firstUser = null;

// ── Stats for dashboard ──
const stats = { conns: 0, peak: 0, msgCount: 0, audioBytes: 0, startTime: Date.now() };
const statHistory = { cpu:[], ram:[], conns:[] }; // last 60 points
setInterval(() => {
  const mem = process.memoryUsage();
  statHistory.ram.push(Math.round(mem.rss/1024/1024));
  statHistory.conns.push(users.size);
  // CPU via process.cpuUsage (delta)
  const cpu = process.cpuUsage();
  statHistory.cpu.push(Math.round((cpu.user+cpu.system)/1000/100));
  if (statHistory.ram.length > 60) { statHistory.ram.shift(); statHistory.conns.shift(); statHistory.cpu.shift(); }
}, 5000);

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    } else { res.writeHead(404); res.end('index.html not found'); }
  } else if (url === '/stats') {
    // Admin dashboard endpoint
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      users: users.size, peak: stats.peak, msgs: stats.msgCount,
      audioMB: Math.round(stats.audioBytes/1024/1024*10)/10,
      uptime: Math.round((Date.now()-stats.startTime)/1000),
      history: statHistory,
      rooms: [...rooms.entries()].map(([r,u])=>({room:r,count:u.size}))
    }));
  } else { res.writeHead(404); res.end(); }
});

const wss = new WebSocketServer({
  server,
  maxPayload: 100 * 1024 * 1024,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 }, // fastest compression
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    threshold: 512 // only compress packets > 512 bytes
  }
});

const send = (uid, data) => {
  const u = users.get(uid);
  if (u && u.ws.readyState === 1) u.ws.send(typeof data==='string'?data:JSON.stringify(data));
};
const broadcast = (data, skip=null) => {
  const m = typeof data==='string'?data:JSON.stringify(data);
  users.forEach((u,uid) => { if(uid!==skip && u.ws.readyState===1) u.ws.send(m); });
};
const broadcastRoom = (room, data, skip=null) => {
  const m = (typeof data==='string'||Buffer.isBuffer(data))?data:JSON.stringify(data);
  const r = rooms.get(room); if(!r) return;
  r.forEach(uid => { if(uid!==skip){const u=users.get(uid);if(u&&u.ws.readyState===1)u.ws.send(m);} });
};
const onlineList = () => {
  const o = {};
  users.forEach((u,uid) => {
    o[uid] = { name:escapeHtml(u.name), color:u.color, init:escapeHtml(u.init||''), tag:escapeHtml(u.tag||''),
      status:u.status||'online', activity:escapeHtml(u.activity||''),
      role:roles.get(uid)||'user' };
  });
  return o;
};
const roomList = () => {
  const r = {};
  rooms.forEach((uids,room) => {
    r[room] = {};
    uids.forEach(uid => {
      const u = users.get(uid);
      if(u) r[room][uid] = { name:escapeHtml(u.name), color:u.color, init:escapeHtml(u.init||''),
        speaking:u.speaking||false, screenSharing:u.screenSharing||false,
        role:roles.get(uid)||'user', ping:u.ping||0 };
    });
  });
  return r;
};

wss.on('connection', ws => {
  let me = null;
  let pingInterval = null;
  let lastPingTime = 0;

  // ── Ping measurement — every 3s for responsive display ──
  pingInterval = setInterval(() => {
    if (!me || ws.readyState !== 1) return;
    lastPingTime = Date.now();
    ws.ping();
  }, 3000);

  ws.on('pong', () => {
    if (!me) return;
    const ping = Date.now() - lastPingTime;
    const u = users.get(me);
    if (u) { u.ping = ping; }
    // Only broadcast to room, not all users (reduces traffic)
    if (u?.room) broadcastRoom(u.room, JSON.stringify({type:'ping_update',uid:me,ping}), me);
    ws.send(JSON.stringify({type:'my_ping',ping}));
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (!me) return;
      const u = users.get(me);
      if (!u || !u.room) return;

      // Peek header
      let nl = -1;
      for (let i = 0; i < Math.min(raw.length, 256); i++) { if (raw[i]===10){nl=i;break;} }
      if (nl > 0) {
        try {
          const hdr = JSON.parse(raw.slice(0,nl).toString('utf8'));
          if (hdr.type === 'screen_frame') { broadcastRoom(u.room, raw, me); return; }
        } catch(e) {}
      }

      // Audio relay
      stats.audioBytes += raw.length;
      const header = JSON.stringify({ type:'audio', from:me, name:u.name, color:u.color, ping:u.ping||0, sr:u.sampleRate||48000 });
      const headerBuf = Buffer.from(header + '\n');
      broadcastRoom(u.room, Buffer.concat([headerBuf, raw]), me);
      return;
    }

    let d; try { d = JSON.parse(raw); } catch { return; }

    if (d.type === 'join') {
      me = d.uid;
      // Sanitize input
      const cleanName = escapeHtml(String(d.name || 'User').slice(0, 24));
      const cleanInit = escapeHtml(String(d.init || cleanName[0] || 'U').slice(0, 2));
      const cleanTag = escapeHtml(String(d.tag || '').slice(0, 8));

      const role = firstUser===null ? 'admin' : 'user';
      if (firstUser===null) firstUser = me;
      roles.set(me, role);
      users.set(me, { ws, name:cleanName, color:d.color, init:cleanInit, tag:cleanTag,
        status:'online', activity:'', speaking:false, screenSharing:false, room:null, ping:0, sampleRate:d.sampleRate||48000 });
      stats.conns++;
      if (users.size > stats.peak) stats.peak = users.size;
      ws.send(JSON.stringify({ type:'init', users:onlineList(), rooms:roomList(), msgs, myRole:role }));
      dmMsgs.forEach((m,convId) => { if(convId.includes(me)) ws.send(JSON.stringify({type:'dm_history',convId,msgs:m})); });
      broadcast({ type:'user_join', uid:me, user:{name:cleanName,color:d.color,init:cleanInit,tag:cleanTag,status:'online',activity:'',role} }, me);
      console.log(`+ ${cleanName} [${role}]`);
      return;
    }
    if (!me) return;
    const myRole = roles.get(me)||'user';

    switch (d.type) {
      case 'chat': {
        // Rate limit check
        if (!checkRateLimit(me)) {
          ws.send(JSON.stringify({type:'error', msg:'Слишком много сообщений'}));
          break;
        }
        // Sanitize text
        const cleanText = escapeHtml(String(d.text || '').slice(0, 2000));
        const m = { from:me, fromName:escapeHtml(users.get(me)?.name||'?'), fromColor:users.get(me)?.color,
          fromInit:escapeHtml(users.get(me)?.init||'?'), fromRole:myRole, text:cleanText, time:d.time, ts:Date.now() };
        const ch = String(d.channel||'general').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
        if (!msgs[ch]) msgs[ch]=[];
        msgs[ch].push(m); if(msgs[ch].length>200) msgs[ch].shift();
        stats.msgCount++;
        broadcast({ type:'chat', channel:ch, msg:m });
        break;
      }
      case 'dm': {
        // Rate limit check
        if (!checkRateLimit(me)) {
          ws.send(JSON.stringify({type:'error', msg:'Слишком много сообщений'}));
          break;
        }
        // Validate recipient
        if (!d.to || !users.has(d.to)) break;
        // Sanitize text
        const cleanText = escapeHtml(String(d.text || '').slice(0, 2000));
        const convId=[me,d.to].sort().join('_vs_');
        const m={from:me,fromName:escapeHtml(users.get(me)?.name||'?'),fromColor:users.get(me)?.color,
          fromInit:escapeHtml(users.get(me)?.init||'?'),fromRole:myRole,text:cleanText,time:d.time,ts:Date.now()};
        if(!dmMsgs.has(convId)) dmMsgs.set(convId,[]);
        const conv=dmMsgs.get(convId);
        conv.push(m); if(conv.length>200) conv.shift();
        send(d.to,{type:'dm',convId,from:me,msg:m});
        ws.send(JSON.stringify({type:'dm_sent',convId,msg:m}));
        break;
      }

      // ── Role management (admin only) ──
      case 'set_role': {
        if (myRole!=='admin') break;
        const target = d.uid; const newRole = d.role;
        if (!['admin','mod','user'].includes(newRole)) break;
        roles.set(target, newRole);
        const tu = users.get(target);
        broadcast({type:'role_update', uid:target, role:newRole, name:tu?.name||target});
        break;
      }
      case 'kick': {
        if (myRole!=='admin'&&myRole!=='mod') break;
        const tu = users.get(d.uid);
        if (tu) { send(d.uid,{type:'kicked',by:users.get(me)?.name}); setTimeout(()=>tu.ws.close(),500); }
        break;
      }

      case 'friend_req':    send(d.to,{type:'friend_req',from:me,name:escapeHtml(users.get(me)?.name||'?'),color:users.get(me)?.color,init:escapeHtml(users.get(me)?.init||'?'),tag:escapeHtml(users.get(me)?.tag||'')}); break;
      case 'friend_accept': send(d.to,{type:'friend_accept',from:me,name:escapeHtml(users.get(me)?.name||'?')}); break;
      case 'call':          send(d.to,{type:'incoming_call',from:me,name:escapeHtml(users.get(me)?.name||'?'),color:users.get(me)?.color,init:escapeHtml(users.get(me)?.init||'?'),video:d.video}); break;
      case 'call_answer':   send(d.to,{type:'call_answered',from:me}); break;
      case 'call_decline':  send(d.to,{type:'call_declined',from:me}); break;
      case 'rtc_offer':     send(d.to,{type:'rtc_offer',from:me,sdp:d.sdp,kind:d.kind||'screen'}); break;
      case 'rtc_answer':    send(d.to,{type:'rtc_answer',from:me,sdp:d.sdp,kind:d.kind||'screen'}); break;
      case 'rtc_ice':       send(d.to,{type:'rtc_ice',from:me,candidate:d.candidate}); break;

      case 'screen_start': {
        const u=users.get(me); if(u) u.screenSharing=true;
        broadcastRoom(u?.room||'',{type:'screen_start',uid:me,name:escapeHtml(users.get(me)?.name||'?')},me);
        broadcast({type:'voice_update',rooms:roomList()}); break;
      }
      case 'screen_stop': {
        const u=users.get(me); if(u) u.screenSharing=false;
        broadcastRoom(u?.room||'',{type:'screen_stop',uid:me},me);
        broadcast({type:'voice_update',rooms:roomList()}); break;
      }
      case 'join_voice': {
        const u=users.get(me);
        if(u?.room){const prev=rooms.get(u.room);if(prev){prev.delete(me);if(!prev.size)rooms.delete(u.room);}}
        if(!rooms.has(d.room)) rooms.set(d.room,new Set());
        rooms.get(d.room).add(me); u.room=d.room;
        broadcast({type:'voice_update',rooms:roomList()});
        broadcastRoom(d.room,{type:'peer_joined',uid:me,name:u.name,color:u.color,init:u.init,role:myRole},me);
        ws.send(JSON.stringify({type:'voice_joined',room:d.room,
          peers:[...rooms.get(d.room)].filter(x=>x!==me).map(uid=>{
            const u=users.get(uid);
            return{uid,name:u?.name,color:u?.color,init:u?.init,screenSharing:u?.screenSharing||false,role:roles.get(uid)||'user',ping:u?.ping||0};
          })}));
        break;
      }
      case 'leave_voice': {
        const u=users.get(me); if(u) u.screenSharing=false;
        if(u?.room){const r=rooms.get(u.room);if(r){r.delete(me);if(!r.size)rooms.delete(u.room);}broadcastRoom(u.room,{type:'peer_left',uid:me});u.room=null;}
        broadcast({type:'voice_update',rooms:roomList()}); break;
      }
      case 'typing': {
        // Relay typing to target (DM or server channel)
        if(d.ctx==='dm' && d.target){
          send(d.target, {type:'typing',uid:me,ctx:'dm',name:escapeHtml(users.get(me)?.name||'?')});
        } else if(d.ctx==='srv'){
          broadcast({type:'typing',uid:me,ctx:'srv',target:d.target,name:escapeHtml(users.get(me)?.name||'?')}, me);
        }
        break;
      }
      case 'speaking': {
        const u=users.get(me); if(u) u.speaking=d.speaking;
        if(u?.room) broadcastRoom(u.room,{type:'speaking',uid:me,speaking:d.speaking},me); break;
      }
      case 'status': {
        const u=users.get(me);
        if(u){
          u.status=String(d.status||'online').slice(0,16);
          u.activity=escapeHtml(String(d.activity||'').slice(0,64));
        }
        broadcast({type:'user_update',uid:me,status:u?.status,activity:u?.activity||''}); break;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (!me) return;
    const u = users.get(me);
    if(u?.room){const r=rooms.get(u.room);if(r){r.delete(me);if(!r.size)rooms.delete(u.room);}broadcastRoom(u.room,{type:'peer_left',uid:me});}
    users.delete(me);
    if (firstUser===me) firstUser=null;
    broadcast({type:'user_leave',uid:me});
    console.log(`- ${u?.name}`);
  });
  ws.on('error', ()=>{});
});

server.listen(PORT, () => console.log(`VoiceLink running on :${PORT}`));
