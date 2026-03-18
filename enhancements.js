/**
 * VoiceLink Enhancements v3 (Clean)
 */
(function() {
  'use strict';
  
  // ══ CONTEXT MENU ══
  function closeCtxMenu() {
    var m = document.getElementById('userCtxMenu');
    if (m) m.remove();
  }
  
  window.showUserContextMenu = function(uid, x, y) {
    closeCtxMenu();
    var user = window.getUser ? window.getUser(uid) : null;
    if (!user || !user.name) return;
    
    var isMe = uid === window.myUid;
    var vol = window.userVolumes && window.userVolumes[uid] !== undefined ? window.userVolumes[uid] : 100;
    
    var menu = document.createElement('div');
    menu.id = 'userCtxMenu';
    menu.style.cssText = 'position:fixed;left:' + Math.min(x, window.innerWidth - 240) + 'px;top:' + Math.min(y, window.innerHeight - 320) + 'px;z-index:1000;background:#18191c;border-radius:8px;min-width:200px;padding:6px 0;box-shadow:0 8px 32px rgba(0,0,0,.7);animation:ctxIn .12s ease';
    
    menu.innerHTML = 
      '<div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;gap:10px">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:' + (user.color || '#5865f2') + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">' + (user.init || '?') + '</div>' +
        '<div><div style="font-size:13px;font-weight:700">' + escHtml(user.name) + '</div><div style="font-size:11px;color:#b9bbbe">' + (user.tag || '#0000') + '</div></div>' +
      '</div>' +
      '<div style="padding:6px 0">' +
        '<button onclick="ctxMsg(\'' + uid + '\')" style="display:block;width:100%;padding:7px 12px;background:none;border:none;color:#dcddde;font-size:13px;text-align:left;cursor:pointer;font-family:inherit">💬 Написать</button>' +
        '<button onclick="ctxProf(\'' + uid + '\')" style="display:block;width:100%;padding:7px 12px;background:none;border:none;color:#dcddde;font-size:13px;text-align:left;cursor:pointer;font-family:inherit">👤 Профиль</button>' +
      '</div>' +
      '<div style="padding:6px 12px;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="font-size:11px;color:#b9bbbe;margin-bottom:6px">🔊 Громкость: <span id="ctxVolNum">' + vol + '%</span></div>' +
        '<input type="range" min="0" max="200" value="' + vol + '" oninput="ctxSetVol(\'' + uid + '\',this.value)" style="width:100%;cursor:pointer">' +
      '</div>' +
      (!isMe ? '<div style="padding:6px 0">' +
        '<button onclick="ctxMute(\'' + uid + '\')" style="display:block;width:100%;padding:7px 12px;background:none;border:none;color:#dcddde;font-size:13px;text-align:left;cursor:pointer;font-family:inherit">🔇 Заглушить</button>' +
      '</div>' : '') +
      '<div style="padding:6px 0">' +
        '<button onclick="ctxLeave()" style="display:block;width:100%;padding:7px 12px;background:none;border:none;color:#ed4245;font-size:13px;text-align:left;cursor:pointer;font-family:inherit">📵 Отключиться</button>' +
      '</div>';
    
    document.body.appendChild(menu);
    setTimeout(function() {
      document.addEventListener('click', closeCtxMenu, { once: true });
      document.addEventListener('contextmenu', closeCtxMenu, { once: true });
    }, 10);
  };
  
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  
  window.ctxMsg = function(uid) { closeCtxMenu(); if (window.openDM) window.openDM(uid); };
  window.ctxProf = function(uid) { closeCtxMenu(); if (window.openPP) window.openPP(uid); };
  window.ctxMute = function(uid) { 
    closeCtxMenu(); 
    window.userVolumes = window.userVolumes || {};
    window.userVolumes[uid] = 0;
    saveVols();
    toast('Заглушен', '🔇', 'Громкость 0%', 'info');
  };
  window.ctxLeave = function() { closeCtxMenu(); if (window.leaveVoice) window.leaveVoice(); };
  window.ctxSetVol = function(uid, v) {
    var el = document.getElementById('ctxVolNum');
    if (el) el.textContent = v + '%';
    window.userVolumes = window.userVolumes || {};
    window.userVolumes[uid] = parseInt(v);
    saveVols();
  };
  
  function saveVols() {
    try { localStorage.setItem('vl_uvols', JSON.stringify(window.userVolumes)); } catch(e) {}
  }
  
  function loadVols() {
    try {
      var d = localStorage.getItem('vl_uvols');
      if (d) window.userVolumes = JSON.parse(d);
    } catch(e) { window.userVolumes = {}; }
  }
  
  // ══ AUDIO FIX ══
  window.ensureAudioContextResumed = function() {
    var ctx = window.remoteCtx;
    if (ctx && ctx.state !== 'running') {
      console.log('[VL] Resuming AudioContext:', ctx.state);
      ctx.resume().then(function() {
        console.log('[VL] AudioContext resumed');
      }).catch(function(e) {
        console.error('[VL] Resume failed:', e);
      });
    }
  };
  
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && window.inVoice) {
      window.ensureAudioContextResumed();
    }
  });
  
  // ══ INIT ══
  function init() {
    loadVols();
    console.log('[VL] Enhancements loaded');
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
