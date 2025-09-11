// chat.js – extension tab conversation page

(function () {
  const bodyEl = document.getElementById('chatBody');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const attachBtn = document.getElementById('attachBtn');
  const attachInfo = document.getElementById('attachInfo');
  const copyBtn = document.getElementById('copyBtn');
  const clearBtn = document.getElementById('clearBtn');

  const state = {
    history: [],
    pendingRequestId: null,
    lastAssistantEl: null,
    receivedStream: false,
    pendingImages: [],
  };

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const roleName = role === 'user' ? '你' : role === 'assistant' ? 'AI' : '系统';
    div.innerHTML = `<div class="role">${roleName}</div><div class="content"></div>`;
    div.querySelector('.content').textContent = text;
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return div;
  }

  function startAssistantStream() {
    state.lastAssistantEl = appendMessage('assistant', '思考中…');
  }

  function appendAssistantDelta(delta) {
    const el = state.lastAssistantEl || startAssistantStream();
    const content = el.querySelector('.content');
    const prev = content.textContent === '思考中…' ? '' : (content.textContent || '');
    content.textContent = prev + delta;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  async function send() {
    if (state.pendingRequestId) return;
    const text = (inputEl.value || '').trim();
    if (!text && !state.pendingImages.length) return;
    inputEl.value = '';
    const content = [];
    if (text) content.push({ type: 'text', text });
    for (const url of state.pendingImages) content.push({ type: 'image', dataUrl: url });
    const hasImages = state.pendingImages.length > 0;
    appendMessage('user', text + (hasImages ? (text ? '\n' : '') + `[已添加 ${state.pendingImages.length} 张图片]` : ''));
    state.history.push({ role: 'user', content });
    state.pendingImages = []; updateAttachInfo();
    await askAIWithHistory();
  }

  async function askAIWithHistory() {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.pendingRequestId = requestId;
    state.receivedStream = false;
    startAssistantStream();
    try {
      const { ok, text, error } = await chrome.runtime.sendMessage({ type: 'CALL_AI', payload: { history: state.history, requestId } });
      if (!ok) throw new Error(error || '调用失败');
      if (text) {
        // Non-stream fallback: update content; history will be appended on AI_STREAM_DONE if streaming, otherwise add now
        const el = state.lastAssistantEl; if (el) el.querySelector('.content').textContent = text;
        // If no stream delta was received, treat as non-stream and append history here
        if (!state.receivedStream) {
          state.history.push({ role: 'assistant', content: [{ type: 'text', text }] });
        }
      }
    } catch (e) {
      const el = state.lastAssistantEl; if (el) el.querySelector('.content').textContent = '错误：' + String(e);
    }
  }

  function setHistory(his) {
    state.history = Array.isArray(his) ? his : [];
    bodyEl.innerHTML = '';
    for (const turn of state.history) {
      if (turn.role === 'user') {
        const texts = (turn.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        const imgs = (turn.content || []).filter((c) => c.type === 'image' && typeof c.dataUrl === 'string');
        if (texts) appendMessage('user', texts);
        if (imgs.length) appendMessage('user', '[包含截图，共 ' + imgs.length + ' 张]');
      } else if (turn.role === 'assistant') {
        const text = (turn.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        if (text) appendMessage('assistant', text);
      } else if (turn.role === 'system') {
        const text = (turn.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        if (text) appendMessage('system', text);
      }
    }
  }

  function parseQuery() {
    const u = new URL(location.href); return Object.fromEntries(u.searchParams.entries());
  }

  async function init() {
    const { sid } = parseQuery();
    if (sid) {
      try {
        const { ok, init } = await chrome.runtime.sendMessage({ type: 'GET_INIT_SESSION', sid });
        if (ok && init && Array.isArray(init.history)) {
          setHistory(init.history);
        }
      } catch (_) {}
    }
  }

  // Wire UI
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  });
  // Hidden file input for attachments
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  attachBtn?.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => { await addFilesToState(fileInput.files); fileInput.value = ''; });
  // Paste images
  inputEl.addEventListener('paste', async (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    const images = files.filter(f => /^image\//i.test(f.type));
    if (images.length) { e.preventDefault(); await addFilesToState(images); }
  });
  // Drag & drop into window
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    const images = files.filter(f => /^image\//i.test(f.type));
    if (images.length) await addFilesToState(images);
  });
  copyBtn.addEventListener('click', () => { const text = bodyEl.innerText || ''; navigator.clipboard?.writeText(text).catch(() => {}); });
  clearBtn.addEventListener('click', () => { bodyEl.innerHTML = ''; state.history = []; });

  async function addFilesToState(fileList) {
    const files = Array.from(fileList || []);
    const images = files.filter((f) => /^image\//i.test(f.type));
    if (!images.length) return;
    const urls = await Promise.all(images.map(readFileAsDataUrl));
    for (const url of urls) state.pendingImages.push(url);
    updateAttachInfo();
  }

  function updateAttachInfo() {
    if (!attachInfo) return;
    const n = state.pendingImages.length;
    attachInfo.textContent = n ? `已选 ${n} 张图片` : '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.onload = () => resolve(String(fr.result || ''));
      fr.readAsDataURL(file);
    });
  }

  // Receive streaming
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'AI_STREAM') {
      if (!state.pendingRequestId || msg.requestId !== state.pendingRequestId) return;
      state.receivedStream = true;
      if (typeof msg.delta === 'string' && msg.delta) appendAssistantDelta(msg.delta);
      return;
    }
    if (msg?.type === 'AI_STREAM_DONE') {
      if (!state.pendingRequestId || msg.requestId !== state.pendingRequestId) return;
      if (!msg.ok) { const el = state.lastAssistantEl; if (el) el.querySelector('.content').textContent = '错误：' + (msg.error || '未知错误'); }
      else { const el = state.lastAssistantEl; if (el) el.querySelector('.content').textContent = msg.text || '(无内容)'; state.history.push({ role: 'assistant', content: [{ type: 'text', text: msg.text || '' }] }); }
      state.pendingRequestId = null;
      state.receivedStream = false;
      return;
    }
  });

  init();
})();
