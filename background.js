// background.js (MV3 service worker)

const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://api.openai.com',
  apiPath: '/v1/chat/completions', // 默认 completions；用户可改
  apiMode: 'completions', // 'completions' | 'responses'（决定 payload 形状）
  apiKey: '',
  model: 'o4-mini',
  reasoningEffort: 'medium', // 'none' | 'minimal' | 'low' | 'medium' | 'high'
  userPrompt: '请解答这张截图中的题目，并给出详细的推理过程与最终答案。',
  systemPrompt: '你是一个擅长图文理解和解题的助理。',
  streamEnabled: true,
  useTemperature: false,
  temperature: 1,
  useMaxTokens: false,
  maxTokens: 65536
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[k] === undefined) toSet[k] = v;
  }
  if (Object.keys(toSet).length) {
    await chrome.storage.sync.set(toSet);
  }
  console.log('[截图问AI] 已安装/更新，默认设置已写入（如需）。');
});

// Hotkey command → ask the content script to start selection overlay
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[截图问AI] 收到快捷命令:', command);
  if (command === 'start_screenshot') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'START_SCREENSHOT' }).catch(() => {});
    }
  }
});

// Message router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension (e.g., our content scripts)
  if (sender?.id && sender.id !== chrome.runtime.id) {
    sendResponse?.({ ok: false, error: 'unauthorized' });
    return; // reject other extensions
  }
  // Open chat tab with initial history (from content script)
  if (msg?.type === 'OPEN_CHAT_TAB') {
    (async () => {
      try {
        const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const init = { history: Array.isArray(msg.history) ? msg.history : [] };
        setPendingInit(sid, init);
        const url = chrome.runtime.getURL(`chat.html?sid=${encodeURIComponent(sid)}`);
        await chrome.tabs.create({ url });
        sendResponse({ ok: true, sid });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }
  // Chat page asks for its initial session by sid
  if (msg?.type === 'GET_INIT_SESSION') {
    const sid = msg.sid;
    const data = takePendingInit(sid);
    sendResponse({ ok: true, init: data || { history: [] } });
    return true;
  }
  if (msg?.type === 'CAPTURE_VISIBLE') {
    // The content script will hide overlay before requesting this
    captureVisible().then((dataUrl) => {
      sendResponse({ ok: true, dataUrl });
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true; // async
  }

  if (msg?.type === 'CALL_AI') {
    const tabId = sender?.tab?.id;
    callAI(msg.payload, tabId).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
    return true; // async
  }

  // keep listener open for async
  return false;
});

async function captureVisible() {
  // capture the currently focused window/tab viewport
  const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
  return dataUrl; // data:image/png;base64,...
}

async function getSettings() {
  const cfg = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...cfg };
}

async function callAI(userPayload, tabId) {
  const settings = await getSettings();
  // Only accept image data from the caller; all other configs are from storage.
  const imageDataUrl = userPayload?.imageDataUrl;
  const history = Array.isArray(userPayload?.history) ? userPayload.history : null;
  const apiBaseUrl = settings.apiBaseUrl;
  const apiPath = settings.apiPath;
  const apiMode = settings.apiMode || inferModeFromPath(apiPath);
  const apiKey = settings.apiKey;
  const model = settings.model;
  const reasoningEffort = settings.reasoningEffort;
  const systemPrompt = settings.systemPrompt;
  const userPrompt = settings.userPrompt;
  const streamEnabled = !!settings.streamEnabled;
  const requestId = userPayload?.requestId;
  const useTemperature = !!settings.useTemperature;
  const temperature = clampNumber(settings.temperature, 0, 2);
  const useMaxTokens = !!settings.useMaxTokens;
  const maxTokens = clampInt(settings.maxTokens, 1, 9999999);

  if (!apiKey) {
    return { ok: false, error: '缺少 API Key，请在扩展选项中设置。' };
  }
  if (!imageDataUrl && !(history && history.length)) {
    return { ok: false, error: '缺少输入：请提供对话上下文或图片。' };
  }

  const url = (apiBaseUrl.replace(/\/$/, '')) + (apiPath.startsWith('/') ? apiPath : '/' + apiPath);

  // Ensure we have host permission for the chosen origin
  await ensureOriginPermission(url);

  // Build payload from history, or fallback to single-turn (image + default text)
  const chatPayload = history && history.length
    ? buildChatPayloadFromHistory({ history, model, systemPrompt, reasoningEffort, useTemperature, temperature, useMaxTokens, maxTokens })
    : (() => {
        const messages = [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt || '' },
              ...(imageDataUrl ? [{ type: 'image_url', image_url: { url: imageDataUrl } }] : [])
            ]
          }
        ];
        addConciseSystemToChatMessages(messages);
        const payload = { model, messages };
        if (reasoningEffort && reasoningEffort !== 'none') payload.reasoning_effort = reasoningEffort;
        if (useTemperature) payload.temperature = temperature;
        if (useMaxTokens) payload.max_tokens = maxTokens;
        return payload;
      })();

  const responsesPayload = history && history.length
    ? buildResponsesPayloadFromHistory({ history, model, systemPrompt, reasoningEffort, useTemperature, temperature, useMaxTokens, maxTokens })
    : (() => {
        const input = [
          ...(systemPrompt ? [{ role: 'system', content: [{ type: 'text', text: systemPrompt }] }] : []),
          {
            role: 'user',
            content: [
              { type: 'input_text', text: userPrompt || '' },
              ...(imageDataUrl ? [{ type: 'input_image', image_url: imageDataUrl }] : [])
            ]
          }
        ];
        addConciseSystemToResponsesInput(input);
        const payload = { model, input };
        if (reasoningEffort && reasoningEffort !== 'none') payload.reasoning = { effort: reasoningEffort };
        if (useTemperature) payload.temperature = temperature;
        if (useMaxTokens) payload.max_output_tokens = maxTokens;
        return payload;
      })();

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  try {
    if (streamEnabled) {
      const finalText = await streamAI({ url, headers, apiMode, chatPayload, responsesPayload, tabId, requestId });
      return { ok: true, text: finalText ?? '' };
    } else {
      const body = JSON.stringify(apiMode === 'completions' ? chatPayload : responsesPayload);
      const res = await fetch(url, { method: 'POST', headers, body });
      const parsed = await safeJson(res);
      if (!res.ok) {
        const errMsg = extractErr(parsed) || `HTTP ${res.status}`;
        return { ok: false, error: `调用失败: ${errMsg}` };
      }
      const text = extractText(parsed);
      return { ok: true, text: text ?? '(无内容)' };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function hasSystemInHistory(history) {
  return Array.isArray(history) && history.some((m) => m?.role === 'system');
}

function buildChatPayloadFromHistory({ history, model, systemPrompt, reasoningEffort, useTemperature, temperature, useMaxTokens, maxTokens }) {
  const messages = [];
  if (systemPrompt && !hasSystemInHistory(history)) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  for (const turn of history) {
    const role = turn?.role;
    const contentBlocks = Array.isArray(turn?.content) ? turn.content : [];
    if (role === 'user') {
      const content = [];
      for (const b of contentBlocks) {
        if (!b || !b.type) continue;
        if (b.type === 'text' && typeof b.text === 'string') content.push({ type: 'text', text: b.text });
        if (b.type === 'image' && typeof b.dataUrl === 'string') content.push({ type: 'image_url', image_url: { url: b.dataUrl } });
      }
      messages.push({ role: 'user', content });
    } else if (role === 'assistant') {
      // Concatenate assistant text blocks
      const text = contentBlocks.map((b) => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
      messages.push({ role: 'assistant', content: text });
    } else if (role === 'system') {
      const text = contentBlocks.map((b) => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
      messages.push({ role: 'system', content: text });
    }
  }
  addConciseSystemToChatMessages(messages);
  const payload = { model, messages };
  if (reasoningEffort && reasoningEffort !== 'none') payload.reasoning_effort = reasoningEffort;
  if (useTemperature) payload.temperature = temperature;
  if (useMaxTokens) payload.max_tokens = maxTokens;
  return payload;
}

function buildResponsesPayloadFromHistory({ history, model, systemPrompt, reasoningEffort, useTemperature, temperature, useMaxTokens, maxTokens }) {
  const input = [];
  if (systemPrompt && !hasSystemInHistory(history)) {
    input.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] });
  }
  for (const turn of history) {
    const role = turn?.role;
    const contentBlocks = Array.isArray(turn?.content) ? turn.content : [];
    if (role === 'user') {
      const content = [];
      for (const b of contentBlocks) {
        if (!b || !b.type) continue;
        if (b.type === 'text' && typeof b.text === 'string') content.push({ type: 'input_text', text: b.text });
        if (b.type === 'image' && typeof b.dataUrl === 'string') content.push({ type: 'input_image', image_url: b.dataUrl });
      }
      input.push({ role: 'user', content });
    } else if (role === 'assistant') {
      const text = contentBlocks.map((b) => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
      input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
    } else if (role === 'system') {
      const text = contentBlocks.map((b) => (b?.type === 'text' ? b.text : '')).filter(Boolean).join('\n');
      input.push({ role: 'system', content: [{ type: 'text', text }] });
    }
  }
  addConciseSystemToResponsesInput(input);
  const payload = { model, input };
  if (reasoningEffort && reasoningEffort !== 'none') payload.reasoning = { effort: reasoningEffort };
  if (useTemperature) payload.temperature = temperature;
  if (useMaxTokens) payload.max_output_tokens = maxTokens;
  return payload;
}

const CONCISE_TEXT = '尽可能精简回答。';
function addConciseSystemToChatMessages(messages) {
  try {
    const exists = messages.some((m) => m?.role === 'system' && typeof m.content === 'string' && m.content.includes('尽可能精简回答'));
    if (!exists) messages.unshift({ role: 'system', content: CONCISE_TEXT });
  } catch (_) {}
}
function addConciseSystemToResponsesInput(input) {
  try {
    const exists = input.some((m) => m?.role === 'system' && Array.isArray(m.content) && m.content.some((c) => typeof c?.text === 'string' && c.text.includes('尽可能精简回答')));
    if (!exists) input.unshift({ role: 'system', content: [{ type: 'text', text: CONCISE_TEXT }] });
  } catch (_) {}
}

async function ensureOriginPermission(url) {
  try {
    const u = new URL(url);
    const originPattern = `${u.origin}/*`;
    // Check if already granted
    const have = await chrome.permissions.contains({ origins: [originPattern] });
    if (have) return;
    // Request optional host permission if not present
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) throw new Error(`缺少访问权限：${originPattern}`);
  } catch (e) {
    // If URL invalid, surface error upstream
    throw e;
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

function extractErr(parsed) {
  if (!parsed) return null;
  if (parsed.error && (parsed.error.message || parsed.error.code)) {
    return parsed.error.message || parsed.error.code;
  }
  return null;
}

function extractText(parsed) {
  if (!parsed) return null;
  // Chat Completions
  if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices[0]) {
    const c = parsed.choices[0];
    if (c.message && typeof c.message.content === 'string') {
      return c.message.content;
    }
    if (typeof c.text === 'string') return c.text;
  }
  // Responses API (new style)
  if (typeof parsed.output_text === 'string' && parsed.output_text.length) {
    return parsed.output_text;
  }
  if (Array.isArray(parsed.output)) {
    // try to flatten message content blocks
    const parts = [];
    for (const item of parsed.output) {
      if (item?.content && Array.isArray(item.content)) {
        for (const it of item.content) {
          if (typeof it.text === 'string') parts.push(it.text);
          else if (typeof it?.content === 'string') parts.push(it.content);
        }
      }
    }
    if (parts.length) return parts.join('\n');
  }
  // Fallback to looking for message.content path
  if (parsed.message && Array.isArray(parsed.message?.content)) {
    const parts = parsed.message.content.map((c) => c?.text || '').filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  return null;
}

function inferModeFromPath(apiPath) {
  if (!apiPath) return 'completions';
  return apiPath.includes('/responses') ? 'responses' : 'completions';
}

async function streamAI({ url, headers, apiMode, chatPayload, responsesPayload, tabId, requestId }) {
  // Add stream: true flag
  const payload = apiMode === 'completions' ? { ...chatPayload, stream: true } : { ...responsesPayload, stream: true };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const parsed = await safeJson(res);
    const errMsg = extractErr(parsed) || `HTTP ${res.status}`;
    const msg = { type: 'AI_STREAM_DONE', ok: false, error: `调用失败: ${errMsg}`, requestId };
    sendToClient(tabId, msg);
    throw new Error(errMsg);
  }
  const reader = res.body?.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  const sendDelta = (delta) => {
    if (!delta) return;
    full += delta;
    sendToClient(tabId, { type: 'AI_STREAM', delta, requestId });
  };
  if (!reader) return '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    // SSE events are separated by double newlines
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = rawEvent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          sendToClient(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId });
          return full;
        }
        try {
          const obj = JSON.parse(data);
          const deltaText = extractStreamDelta(obj, apiMode);
          if (deltaText) sendDelta(deltaText);
          // Some responses API variants signal completion via a typed event
          if (obj?.type === 'response.completed') {
            sendToClient(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId });
            return full;
          }
        } catch (_) {
          // ignore non-JSON keepalive
        }
      }
    }
  }
  sendToClient(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId });
  return full;
}

function extractStreamDelta(obj, apiMode) {
  // Chat completions delta
  if (apiMode === 'completions') {
    try {
      const choice = obj?.choices?.[0];
      // OpenAI style: choices[].delta.content
      if (choice?.delta?.content) return choice.delta.content;
      // Some providers use choices[].text
      if (typeof choice?.text === 'string') return choice.text;
    } catch (_) {}
  } else {
    // Responses API streaming events
    const t = obj?.type;
    if (t === 'response.output_text.delta' && typeof obj?.delta === 'string') {
      return obj.delta;
    }
    if (t === 'message.delta' && obj?.delta?.content) {
      // Aggregate text parts
      const parts = [];
      for (const c of obj.delta.content) {
        if (typeof c?.text === 'string') parts.push(c.text);
        else if (typeof c?.content === 'string') parts.push(c.content);
      }
      if (parts.length) return parts.join('');
    }
    // Some providers wrap as { output_text: "..." } chunks
    if (typeof obj?.output_text === 'string') return obj.output_text;
  }
  return '';
}

function clampNumber(n, min, max) {
  const v = Number(n);
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function clampInt(n, min, max) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v | 0));
}

function sendToClient(tabId, msg) {
  try {
    if (tabId != null) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
    // Also broadcast to extension pages (chat.html) which listen via runtime.onMessage
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch (_) {}
}

// Ephemeral transfer store for initial chat data between content page and chat tab
const __PENDING_INIT = new Map();
function setPendingInit(sid, data) {
  __PENDING_INIT.set(String(sid), data);
  // Auto-expire after 60s to avoid leaks if tab fails to load
  setTimeout(() => { __PENDING_INIT.delete(String(sid)); }, 60000);
}
function takePendingInit(sid) {
  const key = String(sid);
  const data = __PENDING_INIT.get(key);
  __PENDING_INIT.delete(key);
  return data;
}
