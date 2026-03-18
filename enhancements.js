/**
 * VoiceLink Enhancements v2
 * - Context Menu (ПКМ) на пользователей
 * - Исправление бага с голосом при переподключении  
 * - Полноэкранный режим демонстрации экрана (Discord style)
 */

// ══════════════════════════════════════
// USER CONTEXT MENU (ПКМ)
// ══════════════════════════════════════

// Хранилище громкости для каждого пользователя
window.userVolumes = {};

function loadUserVolumes() {
  try {
    const data = localStorage.getItem('vl_user_volumes');
    if (data) window.userVolumes = JSON.parse(data);
  } catch(e) { window.userVolumes = {}; }
}

function saveUserVolumes() {
  try {
    localStorage.setItem('vl_user_volumes', JSON.stringify(window.userVolumes));
  } catch(e) {}
}

function getUserVolume(uid) {
  if (window.userVolumes[uid] === undefined) return 100;
  return window.userVolumes[uid];
}

function setUserVolume(uid, volume) {
  window.userVolumes[uid] = volume;
  saveUserVolumes();
  
  // Применяем громкость к AudioNode
  const state = window.peerAudio?.get(uid);
  if (state && state.gainNode) {
    state.gainNode.gain.value = (volume / 100) * (window._volumeGain || 1);
  }
  
  toast('Громкость', '🔊', `Громкость: ${volume}%`, 'info');
}

function showUserContextMenu(uid, x, y, element) {
  // Предотвращаем стандартное контекстное меню
  if (element) {
    element.oncontextmenu = function(e) {
      e.preventDefault();
      e.stopPropagation();
    };
  }
  
  closeUserContextMenu();
  
  const user = getUser(uid);
  if (!user || !user.name) return;
  
  const isMe = uid === window.myUid;
  const isOnline = user.status && user.status !== 'offline' && user.status !== 'invisible';
  const volume = getUserVolume(uid);
  
  // Создаем меню
  const menu = document.createElement('div');
  menu.className = 'user-ctx-menu';
  menu.id = 'userCtxMenu';
  menu.style.left = Math.min(x, window.innerWidth - 260) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 350) + 'px';
  
  menu.innerHTML = `
    <div class="ctx-header">
      <div class="ctx-av" style="background: ${user.color || '#5865f2'}">${user.init || '?'}</div>
      <div class="ctx-user-info">
        <div class="ctx-user-name">${esc(user.name)}</div>
        <div class="ctx-user-tag">${user.tag || '#0000'}</div>
      </div>
    </div>
    
    <div class="ctx-section">
      <button class="ctx-item" onclick="ctxMessageUser('${uid}')">
        <span class="ctx-item-icon">💬</span>
        <span class="ctx-item-text">Написать сообщение</span>
      </button>
      ${!isMe ? `
      <button class="ctx-item" onclick="ctxStartCall('${uid}')">
        <span class="ctx-item-icon">📞</span>
        <span class="ctx-item-text">Начать звонок</span>
      </button>
      ` : ''}
      <button class="ctx-item" onclick="ctxViewProfile('${uid}')">
        <span class="ctx-item-icon">👤</span>
        <span class="ctx-item-text">Профиль</span>
      </button>
    </div>
    
    <div class="ctx-sep"></div>
    
    <div class="ctx-vol-section">
      <div class="ctx-vol-label">
        <span>🔊 Громкость</span>
        <span id="ctxVolVal">${volume}%</span>
      </div>
      <input type="range" class="ctx-vol-slider" id="ctxVolSlider" 
             min="0" max="200" value="${volume}"
             oninput="ctxUpdateVolume('${uid}', this.value)">
    </div>
    
    ${!isMe ? `
    <div class="ctx-sep"></div>
    <div class="ctx-section">
      <button class="ctx-item" onclick="ctxMuteUser('${uid}')">
        <span class="ctx-item-icon">🔇</span>
        <span class="ctx-item-text">Заглушить</span>
      </button>
      <button class="ctx-item" onclick="ctxDeafenUser('${uid}')">
        <span class="ctx-item-icon">🎧</span>
        <span class="ctx-item-text">Отключить звук</span>
      </button>
    </div>
    ` : `
    <div class="ctx-sep"></div>
    <div class="ctx-section">
      <button class="ctx-item" onclick="ctxDisconnect()">
        <span class="ctx-item-icon">📵</span>
        <span class="ctx-item-text">Отключиться</span>
      </button>
    </div>
    `}
    
    ${window.myRole === 'admin' || window.myRole === 'mod' ? `
    <div class="ctx-sep"></div>
    <div class="ctx-section">
      <button class="ctx-item ctx-item-danger" onclick="ctxKick('${uid}')">
        <span class="ctx-item-icon">⚠️</span>
        <span class="ctx-item-text">Выгнать с сервера</span>
      </button>
    </div>
    ` : ''}
  `;
  
  document.body.appendChild(menu);
  
  // Закрытие по клику вне меню или Escape
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      closeUserContextMenu();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('contextmenu', closeHandler);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', closeHandler, { once: true });
    document.addEventListener('contextmenu', closeHandler, { once: true });
  }, 10);
}

function closeUserContextMenu() {
  const existing = document.getElementById('userCtxMenu');
  if (existing) existing.remove();
}

function ctxUpdateVolume(uid, value) {
  const valEl = document.getElementById('ctxVolVal');
  if (valEl) valEl.textContent = value + '%';
  setUserVolume(uid, parseInt(value));
}

function ctxMessageUser(uid) {
  closeUserContextMenu();
  if (typeof openDM === 'function') openDM(uid);
}

function ctxStartCall(uid) {
  closeUserContextMenu();
  if (typeof startCall === 'function') startCall(uid);
}

function ctxViewProfile(uid) {
  closeUserContextMenu();
  if (typeof openPP === 'function') openPP(uid);
}

function ctxMuteUser(uid) {
  closeUserContextMenu();
  setUserVolume(uid, 0);
  const user = getUser(uid);
  toast('Заглушен', '🔇', (user?.name || 'Пользователь') + ' заглушен', 'info');
}

function ctxDeafenUser(uid) {
  closeUserContextMenu();
  setUserVolume(uid, 0);
  const user = getUser(uid);
  toast('Звук отключен', '🎧', 'Звук от ' + (user?.name || 'пользователя') + ' отключен', 'info');
}

function ctxDisconnect() {
  closeUserContextMenu();
  if (typeof leaveVoice === 'function') leaveVoice();
}

function ctxKick(uid) {
  closeUserContextMenu();
  if (typeof kickUser === 'function') {
    const user = getUser(uid);
    if (confirm('Выгнать ' + (user?.name || 'пользователя') + ' с сервера?')) {
      kickUser(uid);
    }
  }
}

// ══════════════════════════════════════
// VOICE RECONNECT FIX - ИСПРАВЛЕНИЕ БАГА
// ══════════════════════════════════════

// Функция принудительного сброса AudioContext при переподключении
function forceAudioContextReset() {
  console.log('[VL Audio] Force resetting AudioContext...');
  
  // Очищаем все peer audio states
  if (window.peerAudio) {
    window.peerAudio.forEach((state, uid) => {
      if (state.gainNode) {
        try { state.gainNode.disconnect(); } catch(e) {}
      }
    });
    window.peerAudio.clear();
  }
  
  // Закрываем remote context
  if (window.remoteCtx) {
    try { 
      window.remoteCtx.close(); 
      console.log('[VL Audio] remoteCtx closed');
    } catch(e) {}
    window.remoteCtx = null;
  }
  
  // Очищаем nextTime для всех чтобы избежать stale audio
  // При следующем подключении AudioContext создастся заново
  
  toast('Аудио', '🔊', 'AudioContext сброшен для восстановления', 'info');
}

// Автоматическое восстановление звука
function ensureAudioContextResumed() {
  const ctx = window.remoteCtx;
  if (ctx && ctx.state !== 'running') {
    console.log('[VL Audio] Resuming suspended AudioContext, state:', ctx.state);
    ctx.resume().then(() => {
      console.log('[VL Audio] AudioContext resumed, new state:', ctx.state);
      toast('Аудио', '🔊', 'Звук восстановлен', 'success');
    }).catch(e => {
      console.error('[VL Audio] Failed to resume:', e);
    });
  }
}

// Автоматический сброс при изменении состояния visibility
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.inVoice) {
    console.log('[VL Audio] Page visible, checking audio state...');
    ensureAudioContextResumed();
  }
});

// Обработка ошибок audio playback
window.addEventListener('error', (e) => {
  if (e.target && (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO')) {
    console.warn('[VL Audio] Media error:', e.target.src, e.error);
    // Пробуем восстановить
    ensureAudioContextResumed();
  }
});

// ══════════════════════════════════════
// SCREEN STREAM PREVIEW (Discord Style)
// ══════════════════════════════════════

let currentScreenStreamInfo = null;

function showScreenStreamPreview(uid) {
  const user = getUser(uid);
  if (!user) return;
  
  // Создаем модальное окно просмотра
  closeScreenPreview();
  
  const modal = document.createElement('div');
  modal.className = 'stream-preview-modal vis';
  modal.id = 'screenPreviewModal';
  
  modal.innerHTML = `
    <div class="stream-preview-box">
      <div class="sp-header">
        <span class="sp-title">🖥 Демонстрация экрана</span>
        <button class="sp-close" onclick="closeScreenPreview()">✕</button>
      </div>
      
      <div class="sp-user">
        <div class="sp-av" style="background: ${user.color || '#5865f2'}">${user.init || '?'}</div>
        <div class="sp-user-info">
          <div class="sp-user-name">${esc(user.name)}</div>
          <div class="sp-user-status">Демонстрирует экран</div>
        </div>
      </div>
      
      <div class="sp-preview-wrap" id="spPreviewWrap">
        <canvas id="spPreviewCanvas" class="sp-canvas"></canvas>
        
        <div class="sp-overlay">
          <div class="sp-watching">
            <span class="sp-watching-dot"></span>
            <span>Смотрит демонстрацию</span>
          </div>
          <button class="sp-btn sp-btn-watch" onclick="enterFullscreenFromPreview('${uid}')" style="background: #5865f2; color: #fff;">
            ⛶ Полный экран
          </button>
        </div>
      </div>
      
      <div style="padding: 12px 16px; background: #1e1f22; border-top: 1px solid rgba(255,255,255,.06); display: flex; justify-content: space-between; align-items: center;">
        <div style="font-size: 12px; color: #72767d;">
          🖥 Демонстрация экрана от ${esc(user.name)}
        </div>
        <div class="sp-actions">
          <button class="sp-btn sp-btn-stop" onclick="closeScreenPreview()">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  currentScreenStreamInfo = uid;
  
  // Запускаем отрисовку
  startScreenPreviewRender(uid);
  
  // Обработка Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeScreenPreview();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeScreenPreview() {
  const modal = document.getElementById('screenPreviewModal');
  if (modal) modal.remove();
  currentScreenStreamInfo = null;
  if (window._screenPreviewInterval) {
    clearInterval(window._screenPreviewInterval);
    window._screenPreviewInterval = null;
  }
}

function startScreenPreviewRender(uid) {
  if (window._screenPreviewInterval) {
    clearInterval(window._screenPreviewInterval);
  }
  
  const canvas = document.getElementById('spPreviewCanvas');
  if (!canvas) return;
  
  // Получаем canvas демонстрации
  const srcCanvas = document.getElementById('scrcanvas_' + uid);
  if (!srcCanvas) {
    toast('Ошибка', '❌', 'Canvas демонстрации не найден', 'error');
    return;
  }
  
  const ctx = canvas.getContext('2d');
  
  window._screenPreviewInterval = setInterval(() => {
    if (!currentScreenStreamInfo) {
      clearInterval(window._screenPreviewInterval);
      return;
    }
    
    const src = document.getElementById('scrcanvas_' + uid);
    if (!src || !src.width) return;
    
    // Копируем canvas
    if (canvas.width !== src.width || canvas.height !== src.height) {
      canvas.width = src.width;
      canvas.height = src.height;
    }
    
    ctx.drawImage(src, 0, 0);
  }, 33); // ~30fps для превью
}

function enterFullscreenFromPreview(uid) {
  const canvas = document.getElementById('scrcanvas_' + uid);
  if (canvas) {
    canvas.requestFullscreen().catch(() => {
      toast('Ошибка', '❌', 'Не удалось открыть полноэкранный режим', 'error');
    });
  }
}

// ══════════════════════════════════════
// FULLSCREEN SCREEN MODE
// ══════════════════════════════════════

function enterFullscreenScreen(uid) {
  uid = uid || window.myUid;
  
  const tile = document.getElementById('screentile_' + uid);
  const canvas = document.getElementById('scrcanvas_' + uid);
  const video = document.getElementById('scrvid_' + uid);
  
  if (canvas && !document.fullscreenElement) {
    canvas.requestFullscreen().catch(() => {
      // Fallback для браузеров без fullscreen
      showScreenStreamPreview(uid);
    });
  } else if (video && !document.fullscreenElement) {
    video.requestFullscreen().catch(() => {
      showScreenStreamPreview(uid);
    });
  } else if (!canvas && !video) {
    // Если нет canvas/video - показываем preview
    showScreenStreamPreview(uid);
  }
}

// Перехватываем toggleScreenFullscreen для улучшения
const originalToggleScreenFullscreen = window.toggleScreenFullscreen;
window.toggleScreenFullscreen = function(uid) {
  uid = uid || window.myUid;
  
  // Проверяем есть ли у пользователя демонстрация
  if (window.rtcScreenVideos?.has(uid) || (uid === window.myUid && window.screenSharing)) {
    // Показываем preview модальное окно
    showScreenStreamPreview(uid);
  } else {
    toast('Демонстрация', '🖥', 'Демонстрация не активна', 'info');
  }
};

// ══════════════════════════════════════
// INIT ENHANCEMENTS
// ══════════════════════════════════════

function initVoiceLinkEnhancements() {
  console.log('[VL] Initializing enhancements...');
  
  // Загружаем сохраненные громкости
  try { loadUserVolumes(); } catch(e) { console.warn('[VL] loadUserVolumes error:', e); }
  
  // Периодически проверяем состояние аудио
  setInterval(() => {
    try {
      if (window.inVoice) {
        ensureAudioContextResumed();
      }
    } catch(e) { console.warn('[VL] Audio check error:', e); }
  }, 5000);
  
  console.log('[VL] Enhancements initialized!');
}

// Безопасный запуск
function safeInit() {
  try {
    initVoiceLinkEnhancements();
  } catch(e) {
    console.error('[VL] Enhancement init error:', e);
  }
}

// Запуск при загрузке DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(safeInit, 1500);
  });
} else {
  setTimeout(safeInit, 1500);
}

// Также запускаем после успешного подключения WebSocket
try {
  const originalConnectWS = window.connectWS;
  if (originalConnectWS) {
    window.connectWS = function() {
      console.log('[VL] WebSocket connecting...');
      if (window.inVoice) {
        console.log('[VL Audio] WS reconnecting in voice, will reset audio...');
        setTimeout(() => {
          try { ensureAudioContextResumed(); } catch(e) {}
        }, 1000);
      }
      originalConnectWS();
    };
  }
} catch(e) { console.warn('[VL] connectWS override error:', e); }

// Перехват leaveVoice для очистки контекста
try {
  const originalLeaveVoice = window.leaveVoice;
  if (originalLeaveVoice) {
    window.leaveVoice = async function() {
      await originalLeaveVoice();
      try {
        if (window.peerAudio) {
          window.peerAudio.forEach((state, uid) => {
            if (state.gainNode) {
              try { state.gainNode.disconnect(); } catch(e) {}
            }
          });
          window.peerAudio.clear();
        }
      } catch(e) {}
    };
  }
} catch(e) { console.warn('[VL] leaveVoice override error:', e); }
