// content.js – selection overlay + multi-session in-page chat panel

if (window.__SCREENSHOT_AI_CONTENT_LOADED__) {
  // Already injected on this page; avoid re-running to prevent duplicate panels/handlers.
} else {
  window.__SCREENSHOT_AI_CONTENT_LOADED__ = true;

  (() => {
  const OVERLAY_ID = '__ai_capture_overlay__';
  const STYLE_ID = '__ai_capture_styles__';

  // Sessions & request routing
  const sessions = new Map(); // id -> { id, panel, body, input, history, pendingRequestId, lastAssistantEl, receivedStream }
  const requestToSession = new Map(); // requestId -> sessionId

  // Selection state
  let overlayEl = null;
  let selectionEl = null;
  let startX = 0, startY = 0;
  let currentRect = null;
  let selecting = false;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} { position: fixed; inset: 0; z-index: 2147483645; cursor: crosshair; background: rgba(0,0,0,0.15); backdrop-filter: saturate(105%) blur(0px); }
      #${OVERLAY_ID} .ai-cap-instructions { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.65); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; user-select: none; pointer-events: none; }
      #${OVERLAY_ID} .ai-cap-rect { position: fixed; border: 2px solid #4f9cf9; background: rgba(79,156,249,0.15); box-shadow: 0 0 0 9999px rgba(0,0,0,0.25) inset; pointer-events: none; }

      .ai-panel { position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; width: min(520px, 60vw); height: min(520px, 65vh); background: #111827; color: #e5e7eb; box-shadow: 0 10px 30px rgba(0,0,0,0.45); border: 1px solid #374151; border-radius: 10px; display: flex; flex-direction: column; overflow: hidden; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      .ai-panel .ai-panel-header { flex: 0 0 auto; height: 36px; background: #1f2937; border-bottom: 1px solid #374151; display: flex; align-items: center; padding: 0 10px; cursor: move; user-select: none; }
      .ai-panel .ai-panel-title { font-size: 13px; color: #d1d5db; }
      .ai-panel .ai-panel-spacer { flex: 1; }
      .ai-panel .ai-panel-btn { border: none; background: transparent; color: #9ca3af; cursor: pointer; font-size: 14px; padding: 4px; border-radius: 6px; }
      .ai-panel .ai-panel-btn:hover { background: rgba(255,255,255,0.06); color: #e5e7eb; }
      .ai-panel .ai-panel-body { flex: 1 1 auto; overflow: auto; padding: 10px 12px 6px 12px; line-height: 1.5; font-size: 14px; white-space: pre-wrap; display: flex; flex-direction: column; }
      .ai-panel .ai-panel-footer { border-top: 1px solid #374151; display: flex; gap: 8px; padding: 8px 10px; background: #111827; }
      .ai-panel .ai-chip { background: #1f2937; border: 1px solid #374151; color: #9ca3af; font-size: 12px; padding: 2px 8px; border-radius: 999px; }
      .ai-panel .ai-input { flex: 1; display: flex; gap: 8px; }
      .ai-panel .ai-input textarea { flex: 1; resize: vertical; min-height: 40px; max-height: 120px; border-radius: 8px; border: 1px solid #374151; background: #0b1220; color: #e5e7eb; padding: 6px 8px; font-size: 13px; line-height: 1.45; }
      .ai-panel .ai-send-btn { border: 1px solid #4f46e5; background: #4f46e5; color: #fff; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
      .ai-panel .ai-attach-btn { border: 1px solid #374151; background: #1f2937; color: #e5e7eb; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
      .ai-panel .ai-attach-info { align-self: center; font-size: 12px; color: #9ca3af; min-width: 100px; text-align: right; }
      .ai-panel .ai-send-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
      .ai-panel .msg { margin: 8px 0; padding: 8px 10px; border-radius: 10px; border: 1px solid #243047; max-width: 100%; }
      .ai-panel .msg.user { background: #0b1220; color: #cbd5e1; align-self: flex-end; }
      .ai-panel .msg.assistant { background: #111827; color: #e5e7eb; align-self: stretch; }
      .ai-panel .msg .role { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    `;
    document.head.appendChild(style);
  }

  function enablePanelDrag(panel) {
    const header = panel.querySelector('.ai-panel-header');
    if (!header) return;
    let isDragging = false;
    let offsetX = 0, offsetY = 0;
    const onDown = (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!isDragging) return;
      const x = Math.min(window.innerWidth - 40, Math.max(0, e.clientX - offsetX));
      const y = Math.min(window.innerHeight - 40, Math.max(0, e.clientY - offsetY));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.position = 'fixed';
    };
    const onUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    header.addEventListener('mousedown', onDown);
  }

  function startSelection() {
    ensureStyles();
    if (document.getElementById(OVERLAY_ID)) return;
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `<div class="ai-cap-instructions">拖拽选择截图区域 · 按 Esc 取消</div>`;
    selectionEl = document.createElement('div');
    selectionEl.className = 'ai-cap-rect';
    overlayEl.appendChild(selectionEl);
    document.documentElement.appendChild(overlayEl);

    selecting = false;
    currentRect = null;
    selectionEl.style.display = 'none';

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      selecting = true;
      startX = e.clientX;
      startY = e.clientY;
      currentRect = { left: startX, top: startY, width: 0, height: 0 };
      selectionEl.style.display = 'block';
      updateSelection(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!selecting) return;
      updateSelection(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onMouseUp = async () => {
      if (!selecting) return;
      selecting = false;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      if (!currentRect || currentRect.width < 5 || currentRect.height < 5) { cleanupOverlay(); return; }
      overlayEl.style.display = 'none';
      await new Promise((r) => requestAnimationFrame(r));
      try {
        const { ok, dataUrl, error } = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE' });
        if (!ok) throw new Error(error || '截图失败');
        const clipped = await cropDataUrl(dataUrl, currentRect);
        await createSessionAndAskWithImage(clipped);
      } catch (err) {
        const s = createSession();
        appendMessage(s, 'assistant', '错误：' + String(err));
      } finally {
        cleanupOverlay();
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanupOverlay(); };

    overlayEl.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keydown', onKey, { once: true, capture: true });
  }

  function updateSelection(x, y) {
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    currentRect = { left, top, width, height };
    Object.assign(selectionEl.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  }

  function cleanupOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
      selectionEl = null;
    }
  }

  async function cropDataUrl(fullDataUrl, rect) {
    const img = new Image(); img.src = fullDataUrl; await img.decode();
    const dpr = window.devicePixelRatio || 1;
    const sx = Math.round(rect.left * dpr);
    const sy = Math.round(rect.top * dpr);
    const sw = Math.round(rect.width * dpr);
    const sh = Math.round(rect.height * dpr);
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  // Chat sessions
  function createSession() {
    ensureStyles();
    const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 6);
    const panel = document.createElement('div'); panel.className = 'ai-panel'; panel.dataset.sessionId = id;
    panel.style.right = '16px'; panel.style.bottom = '16px';
    panel.innerHTML = `
      <div class=\"ai-panel-header\">
        <div class=\"ai-panel-title\">AI 解答</div>
        <div class=\"ai-panel-spacer\"></div>
        <button class=\"ai-panel-btn\" data-action=\"open-tab\">在新标签页继续</button>
        <button class=\"ai-panel-btn\" data-action=\"copy\" title=\"复制\">📋</button>
        <button class=\"ai-panel-btn\" data-action=\"close\" title=\"关闭\">✕</button>
      </div>
      <div class=\"ai-panel-body\"></div>
      <div class=\"ai-panel-footer\">
        <div class=\"ai-input\" style=\"flex:1;\">
          <textarea class=\"ai-panel-input\" placeholder=\"继续提问…（Enter 发送，Shift+Enter 换行；支持粘贴/拖入图片）\"></textarea>
        </div>
        <span class=\"ai-attach-info\"></span>
        <button class=\"ai-attach-btn\" title=\"添加图片\">添加图片</button>
        <button class=\"ai-send-btn\">发送</button>
      </div>`;
    document.documentElement.appendChild(panel);
    enablePanelDrag(panel);
    const body = panel.querySelector('.ai-panel-body');
    const input = panel.querySelector('.ai-panel-input');
    const sendBtn = panel.querySelector('.ai-send-btn');
    const attachBtn = panel.querySelector('.ai-attach-btn');
    const attachInfo = panel.querySelector('.ai-attach-info');
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true; fileInput.style.display = 'none';
    panel.appendChild(fileInput);
    const session = { id, panel, body, input, history: [], pendingRequestId: null, lastAssistantEl: null, receivedStream: false, pendingImages: [], attachInfo, fileInput, attachBtn };
    sessions.set(id, session);

    panel.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest('button[data-action="close"]')) { sessions.delete(id); panel.remove(); }
      if (t && t.closest('button[data-action="copy"]')) { const text = body?.innerText || ''; navigator.clipboard?.writeText(text).catch(() => {}); }
      if (t && t.closest('button[data-action="open-tab"]')) { openChatTabWithHistory(session.history).catch(()=>{}); }
    });

    const send = async () => {
      if (session.pendingRequestId) return;
      const text = (input.value || '').trim(); if (!text && !session.pendingImages?.length) return; input.value = '';
      const content = [];
      if (text) content.push({ type: 'text', text });
      for (const url of (session.pendingImages || [])) content.push({ type: 'image', dataUrl: url });
      const hasImages = session.pendingImages?.length > 0;
      appendMessage(session, 'user', text + (hasImages ? (text ? '\n' : '') + `[已添加 ${session.pendingImages.length} 张图片]` : ''));
      session.history.push({ role: 'user', content });
      session.pendingImages = []; updateAttachInfo(session);
      await askAIWithHistory(session);
    };
    sendBtn?.addEventListener('click', send);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
    // Attach images: button + file input
    attachBtn?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => { await addFilesToSession(session, fileInput.files); fileInput.value = ''; });
    // Paste images into textarea
    input?.addEventListener('paste', async (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      const images = files.filter(f => /^image\//i.test(f.type));
      if (images.length) { e.preventDefault(); await addFilesToSession(session, images); }
    });
    // Drag & drop images over panel
    panel.addEventListener('dragover', (e) => { e.preventDefault(); });
    panel.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      const images = files.filter(f => /^image\//i.test(f.type));
      if (images.length) await addFilesToSession(session, images);
    });
    return session;
  }

  function appendMessage(session, role, text) {
    const div = document.createElement('div'); div.className = `msg ${role}`;
    const roleName = role === 'user' ? '你' : role === 'assistant' ? 'AI' : '系统';
    div.innerHTML = `<div class="role">${roleName}</div><div class="content"></div>`;
    const content = div.querySelector('.content'); content.textContent = text;
    session.body.appendChild(div); session.body.scrollTop = session.body.scrollHeight;
    return div;
  }

  function startAssistantStream(session) { session.lastAssistantEl = appendMessage(session, 'assistant', '思考中…'); }
  function appendAssistantDelta(session, delta) {
    const el = session.lastAssistantEl || startAssistantStream(session);
    const content = el.querySelector('.content');
    const prev = content.textContent === '思考中…' ? '' : (content.textContent || '');
    content.textContent = prev + delta;
    session.body.scrollTop = session.body.scrollHeight;
  }

  async function askAIWithHistory(session) {
    const requestId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
    session.pendingRequestId = requestId; requestToSession.set(requestId, session.id); session.receivedStream = false;
    startAssistantStream(session);
    try {
      const { ok, text, error, streamed } = await chrome.runtime.sendMessage({ type: 'CALL_AI', payload: { history: session.history, requestId } });
      if (!ok) throw new Error(error || '调用失败');
      if (text) {
        const el = session.lastAssistantEl; if (el) el.querySelector('.content').textContent = text;
        if (!streamed) session.history.push({ role: 'assistant', content: [{ type: 'text', text }] });
      }
    } catch (err) {
      const el = session.lastAssistantEl; if (el) el.querySelector('.content').textContent = '错误：' + String(err);
    }
  }

  async function createSessionAndAskWithImage(imageDataUrl) {
    const s = createSession();
    appendMessage(s, 'user', '已发送截图');
    s.history.push({ role: 'user', content: [{ type: 'image', dataUrl: imageDataUrl }] });
    const requestId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
    s.pendingRequestId = requestId; requestToSession.set(requestId, s.id); s.receivedStream = false;
    startAssistantStream(s);
    try {
      const { ok, text, error, streamed } = await chrome.runtime.sendMessage({ type: 'CALL_AI', payload: { imageDataUrl, requestId } });
      if (!ok) throw new Error(error || '调用失败');
      if (text) {
        const el = s.lastAssistantEl; if (el) el.querySelector('.content').textContent = text;
        if (!streamed) s.history.push({ role: 'assistant', content: [{ type: 'text', text }] });
      }
    } catch (err) {
      const el = s.lastAssistantEl; if (el) el.querySelector('.content').textContent = '错误：' + String(err);
    }
  }

  async function openChatTabWithHistory(history) {
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_CHAT_TAB', history: Array.isArray(history) ? history : [] });
    } catch (e) {
      // ignore
    }
  }

  async function addFilesToSession(session, fileList) {
    const files = Array.from(fileList || []);
    const images = files.filter((f) => /^image\//i.test(f.type));
    if (!images.length) return;
    const urls = await Promise.all(images.map(readFileAsDataUrl));
    for (const url of urls) session.pendingImages.push(url);
    updateAttachInfo(session);
  }

  function updateAttachInfo(session) {
    if (!session.attachInfo) return;
    const n = session.pendingImages?.length || 0;
    session.attachInfo.textContent = n ? `已选 ${n} 张图片` : '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.onload = () => resolve(String(fr.result || ''));
      fr.readAsDataURL(file);
    });
  }

  // Background messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'START_SCREENSHOT') { startSelection(); return; }
    if (msg?.type === 'AI_STREAM' && typeof msg.requestId === 'string') {
      const sid = requestToSession.get(msg.requestId); if (!sid) return; const s = sessions.get(sid); if (!s) return;
      s.receivedStream = true;
      if (typeof msg.delta === 'string' && msg.delta) appendAssistantDelta(s, msg.delta);
      return;
    }
    if (msg?.type === 'AI_STREAM_DONE' && typeof msg.requestId === 'string') {
      const sid = requestToSession.get(msg.requestId); if (!sid) return; const s = sessions.get(sid); if (!s) return;
      if (!msg.ok) { const el = s.lastAssistantEl; if (el) el.querySelector('.content').textContent = '错误：' + (msg.error || '未知错误'); }
      else { const el = s.lastAssistantEl; if (el) el.querySelector('.content').textContent = msg.text || '(无内容)'; s.history.push({ role: 'assistant', content: [{ type: 'text', text: msg.text || '' }] }); }
      s.pendingRequestId = null; s.receivedStream = false; requestToSession.delete(msg.requestId);
      return;
    }
  });
  })();
}
