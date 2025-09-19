// background.js (MV3 service worker)

const PRESET_INFO = {
  google: {
    mode: 'completions',
    defaults: {
      apiBaseUrl: 'https://generativelanguage.googleapis.com',
      apiPath: '/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash',
      reasoningEffort: 'high',
      useTemperature: true,
      temperature: 0.8,
      useMaxTokens: false,
      maxTokens: 65536
    }
  },
  openaiChat: {
    mode: 'completions',
    defaults: {
      apiBaseUrl: 'https://api.openai.com',
      apiPath: '/v1/chat/completions',
      model: 'gpt-5-nano',
      reasoningEffort: 'medium',
      useTemperature: false,
      temperature: 1,
      useMaxTokens: false,
      maxTokens: 65536
    }
  },
  openaiResponses: {
    mode: 'responses',
    defaults: {
      apiBaseUrl: 'https://api.openai.com',
      apiPath: '/v1/responses',
      model: 'gpt-5-nano',
      reasoningEffort: 'medium',
      useTemperature: false,
      temperature: 1,
      useMaxTokens: false,
      maxTokens: 65536
    }
  },
  custom: {
    mode: null,
    defaults: {
      apiBaseUrl: '',
      apiPath: '/v1/chat/completions',
      model: '',
      reasoningEffort: 'medium',
      useTemperature: false,
      temperature: 1,
      useMaxTokens: false,
      maxTokens: 65536
    }
  }
};

const DEFAULT_PROMPT_SETS = [
  {
    id: 'default',
    name: '默认提示',
    userPrompt: '请解读图中的内容，或者解答图中问题。',
    systemPrompt: '你是一名截图内容解读助手，请使用用户所用语言，简洁描述图中的关键信息与明显的要点，或解答图中提出的问题。'
  }
];

const DEFAULT_SETTINGS = {
  activePreset: 'google',
  presetConfigs: Object.fromEntries(Object.entries(PRESET_INFO).map(([key, info]) => [key, { ...info.defaults }])),
  promptSets: structuredClone(DEFAULT_PROMPT_SETS),
  activePromptId: DEFAULT_PROMPT_SETS[0].id,
  userPrompt: DEFAULT_PROMPT_SETS[0].userPrompt,
  systemPrompt: DEFAULT_PROMPT_SETS[0].systemPrompt,
  streamEnabled: true
};

const DEFAULT_API_KEYS = Object.fromEntries(Object.keys(PRESET_INFO).map((k) => [k, '']));
const DEFAULT_ACTION_TITLE = '截图问AI';
let actionBadgeTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  if (stored.activePreset === undefined) {
    toSet.activePreset = DEFAULT_SETTINGS.activePreset;
  }
  const presetConfigs = { ...(DEFAULT_SETTINGS.presetConfigs || {}) };
  const storedPresetConfigs = stored.presetConfigs && typeof stored.presetConfigs === 'object' ? stored.presetConfigs : {};
  for (const [id, defaults] of Object.entries(DEFAULT_SETTINGS.presetConfigs)) {
    const existing = storedPresetConfigs[id];
    if (!existing) {
      presetConfigs[id] = { ...defaults };
    } else {
      presetConfigs[id] = { ...defaults, ...existing };
    }
  }
  toSet.presetConfigs = presetConfigs;
  const promptState = coercePromptState(stored, DEFAULT_SETTINGS);
  const storedPromptSets = Array.isArray(stored.promptSets) ? stored.promptSets : null;
  const needsPromptInit = !storedPromptSets || !storedPromptSets.length || storedPromptSets.some((item) => !item || typeof item.id !== 'string' || !item.id.trim());
  if (needsPromptInit) {
    toSet.promptSets = promptState.promptSets;
  }
  if (stored.activePromptId === undefined || !promptState.promptSets.some((p) => p.id === stored.activePromptId)) {
    toSet.activePromptId = promptState.activePromptId;
  }
  if (stored.userPrompt === undefined) {
    toSet.userPrompt = promptState.activePrompt.userPrompt;
  }
  if (stored.systemPrompt === undefined) {
    toSet.systemPrompt = promptState.activePrompt.systemPrompt;
  }
  if (stored.streamEnabled === undefined) {
    toSet.streamEnabled = DEFAULT_SETTINGS.streamEnabled;
  }
  if (Object.keys(toSet).length) {
    await chrome.storage.sync.set(toSet);
  }

  const localStored = await chrome.storage.local.get(['apiKeys']);
  const keys = { ...DEFAULT_API_KEYS, ...(localStored.apiKeys || {}) };
  await chrome.storage.local.set({ apiKeys: keys });

  console.log('[截图问AI] 已安装/更新，默认设置已写入（如需）。');
});

// Hotkey command → ask the content script to start selection overlay
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[截图问AI] 收到快捷命令:', command);
  if (command === 'start_screenshot') {
    try {
      const tab = await getActiveTab();
      if (!tab) return;
      await triggerScreenshotOnTab(tab);
      clearActionError();
    } catch (err) {
      console.warn('[截图问AI] 快捷键截图失败:', err);
      await surfaceActionError(String(err || '无法启动截图'));
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
  if (msg?.type === 'START_SCREENSHOT_FROM_POPUP') {
    (async () => {
      try {
        let tab = null;
        if (msg.tabId) {
          try { tab = await chrome.tabs.get(msg.tabId); } catch (_) { tab = null; }
        }
        if (!tab) tab = await getActiveTab();
        if (!tab) throw new Error('未找到当前标签页');
        await triggerScreenshotOnTab(tab);
        clearActionError();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
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

  if (msg?.type === 'TEST_CHANNEL') {
    (async () => {
      try {
        const overrideSettings = normalizeSettings(msg.settings || {});
        if (msg.presetId) overrideSettings.activePreset = msg.presetId;
        const apiKeys = msg.apiKeys && typeof msg.apiKeys === 'object' ? msg.apiKeys : {};
        const history = Array.isArray(msg.history) && msg.history.length
          ? msg.history
          : [{ role: 'user', content: [{ type: 'text', text: '测试消息，用于检查渠道配置是否有效。' }] }];
        const result = await callAI({ history, requestId: `test-${Date.now()}` }, null, {
          overrideSettings,
          overrideApiKeys: apiKeys,
          overridePresetId: msg.presetId,
          forceNonStream: true,
          suppressClient: true
        });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  // keep listener open for async
  return false;
});

async function captureVisible() {
  // capture the currently focused window/tab viewport
  const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
  return dataUrl; // data:image/png;base64,...
}

async function getActiveTab() {
  // 1) Try last-focused window's active tab (works for commands)
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) return tab;
  } catch (_) {}
  // 2) Fallback: get last focused normal window, then pick its active tab
  try {
    const win = await chrome.windows.getLastFocused({ populate: true });
    if (win && Array.isArray(win.tabs) && win.tabs.length) {
      const active = win.tabs.find((t) => t.active && t.id);
      if (active) return active;
      return win.tabs[0] || null;
    }
  } catch (_) {}
  // 3) Fallback: currentWindow active
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) return tab;
  } catch (_) {}
  return null;
}

function getOriginPatternFromUrl(url) {
  try {
    const u = new URL(url || '');
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return `${u.origin}/*`;
  } catch (_) {
    return null;
  }
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id) throw new Error('缺少有效的标签页');
  if (!/^https?:/i.test(String(tab.url || ''))) throw new Error('当前页面类型不支持截图');
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return;
  } catch (err) {
    if (isMissingHostPermissionError(err)) {
      const granted = await requestHostPermissionForTab(tab);
      if (!granted) {
        throw buildMissingPermissionError(tab);
      }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return;
    }
    // 已注入时 Chrome 可能抛出“Cannot access contents”之类的错误，但随后 sendMessage 会立即成功。
    console.warn('[截图问AI] 注入内容脚本时出错（可忽略）:', err);
  }
}

function shouldRetryWithInjection(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : err?.message || String(err);
  return msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist');
}

function isMissingHostPermissionError(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : err?.message || String(err);
  if (!msg) return false;
  return msg.includes('Cannot access contents of the page')
    || msg.includes('This page cannot be scripted')
    || msg.includes('This extension is not allowed to run')
    || msg.includes('The extensions gallery cannot be scripted')
    || (msg.includes('permission') && msg.includes('host'));
}

async function requestHostPermissionForTab(tab) {
  const originPattern = getOriginPatternFromTab(tab);
  let granted = false;
  if (chrome.action?.requestScriptInjection) {
    try {
      await chrome.action.requestScriptInjection({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      granted = true;
    } catch (err) {
      if (isUserDismissedError(err)) return false;
      if (!isGestureRequiredError(err)) {
        console.warn('[截图问AI] requestScriptInjection 失败:', err);
      }
    }
  }
  if (!granted && originPattern) {
    try {
      const ok = await chrome.permissions.request({ origins: [originPattern] });
      if (ok) granted = true;
    } catch (err) {
      if (isGestureRequiredError(err) || isUserDismissedError(err)) {
        return false;
      }
      console.warn('[截图问AI] permissions.request 失败:', err);
    }
  }
  return granted;
}

function isUserDismissedError(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : err?.message || String(err);
  return msg.includes('User dismissed') || msg.includes('User denied');
}

function isGestureRequiredError(err) {
  if (!err) return false;
  const msg = typeof err === 'string' ? err : err?.message || String(err);
  return msg.includes('user gesture') || msg.includes('User gesture') || msg.includes('requires a user gesture');
}

function buildMissingPermissionError(tab) {
  const origin = getOriginFromTab(tab);
  if (origin) {
    return new Error(`需要先允许扩展访问 ${origin}，请点击地址栏右侧的拼图图标 → 选择“始终允许”。`);
  }
  return new Error('需要先允许扩展访问当前页面，点击地址栏右侧的拼图图标授予权限后再试。');
}

function getOriginFromTab(tab) {
  try {
    return new URL(String(tab?.url || '')).origin;
  } catch (_) {
    return '';
  }
}

async function ensureTabHostPermission(tab) {
  const pattern = getOriginPatternFromUrl(tab?.url || '');
  if (!pattern) return;
  try {
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return;
  } catch (err) {
    console.warn('[截图问AI] 检查站点权限失败:', err);
  }
  const granted = await requestHostPermissionForTab(tab);
  if (!granted) {
    throw buildMissingPermissionError(tab);
  }
}

async function triggerScreenshotOnTab(tab) {
  if (!tab?.id) throw new Error('缺少有效的标签页');
  await ensureTabHostPermission(tab);
  try {
    await ensureContentScriptReady(tab);
  } catch (err) {
    if (isMissingHostPermissionError(err)) {
      const granted = await requestHostPermissionForTab(tab);
      if (!granted) throw buildMissingPermissionError(tab);
      await ensureContentScriptReady(tab);
    } else if (!shouldRetryWithInjection(err)) {
      throw err;
    }
  }
  const send = async () => {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_SCREENSHOT' });
  };

  try {
    await send();
    return;
  } catch (err) {
    if (isMissingHostPermissionError(err)) {
      const granted = await requestHostPermissionForTab(tab);
      if (!granted) throw buildMissingPermissionError(tab);
      await ensureContentScriptReady(tab);
    } else if (!shouldRetryWithInjection(err)) {
      throw err;
    } else {
      await ensureContentScriptReady(tab);
    }
  }
  await send();
}

function clearActionError() {
  if (actionBadgeTimer) {
    clearTimeout(actionBadgeTimer);
    actionBadgeTimer = null;
  }
  try {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  } catch (e) {
    console.warn('[截图问AI] 清除提示失败:', e);
  }
}

async function surfaceActionError(message) {
  try {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setTitle({ title: `${DEFAULT_ACTION_TITLE}\n${message}`.slice(0, 256) });
  } catch (e) {
    console.warn('[截图问AI] 设置提示失败:', e);
  }
  if (actionBadgeTimer) clearTimeout(actionBadgeTimer);
  actionBadgeTimer = setTimeout(() => {
    actionBadgeTimer = null;
    try {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
    } catch (_) {}
  }, 6000);
}

async function getSettings() {
  const raw = await chrome.storage.sync.get(null);
  if (raw) {
    await migrateLegacyApiKey(raw);
  }
  return normalizeSettings(raw || {});
}

function normalizeSettings(raw) {
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const settings = structuredClone(DEFAULT_SETTINGS);

  settings.streamEnabled = typeof raw.streamEnabled === 'boolean' ? raw.streamEnabled : defaults.streamEnabled;

  const promptState = coercePromptState(raw, defaults);
  settings.promptSets = promptState.promptSets;
  settings.activePromptId = promptState.activePromptId;
  settings.userPrompt = promptState.activePrompt.userPrompt;
  settings.systemPrompt = promptState.activePrompt.systemPrompt;

  const storedPresetConfigs = raw.presetConfigs && typeof raw.presetConfigs === 'object' ? raw.presetConfigs : null;
  if (storedPresetConfigs) {
    for (const [id, info] of Object.entries(PRESET_INFO)) {
      const merged = { ...info.defaults, ...(storedPresetConfigs[id] || {}) };
      settings.presetConfigs[id] = merged;
    }
  }

  let activePreset = typeof raw.activePreset === 'string' ? raw.activePreset : null;
  if (!activePreset && typeof raw.apiPreset === 'string') {
    activePreset = mapLegacyPreset(raw.apiPreset, raw.apiMode, raw.apiPath);
  }
  if (!activePreset || !PRESET_INFO[activePreset]) {
    activePreset = defaults.activePreset;
  }
  settings.activePreset = activePreset;

  if (!storedPresetConfigs) {
    // Legacy fields fallback
    const legacyTarget = mapLegacyPreset(raw.apiPreset, raw.apiMode, raw.apiPath) || activePreset;
    if (legacyTarget && PRESET_INFO[legacyTarget]) {
      const cfg = settings.presetConfigs[legacyTarget];
      if (typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl.trim()) cfg.apiBaseUrl = raw.apiBaseUrl.trim();
      if (typeof raw.apiPath === 'string' && raw.apiPath.trim()) cfg.apiPath = ensureLeadingSlash(raw.apiPath.trim());
      if (typeof raw.model === 'string' && raw.model.trim()) cfg.model = raw.model.trim();
      if (typeof raw.reasoningEffort === 'string') cfg.reasoningEffort = raw.reasoningEffort;
      if (typeof raw.useTemperature === 'boolean') cfg.useTemperature = raw.useTemperature;
      if (raw.temperature !== undefined) cfg.temperature = clampNumber(raw.temperature, 0, 2);
      if (typeof raw.useMaxTokens === 'boolean') cfg.useMaxTokens = raw.useMaxTokens;
      if (raw.maxTokens !== undefined) cfg.maxTokens = clampInt(raw.maxTokens, 1, 9999999);
    }
  }

  // Ensure each preset config exists even if missing in storage
  for (const [id, info] of Object.entries(PRESET_INFO)) {
    if (!settings.presetConfigs[id]) {
      settings.presetConfigs[id] = { ...info.defaults };
    } else {
      settings.presetConfigs[id] = { ...info.defaults, ...settings.presetConfigs[id] };
    }
  }

  return settings;
}

function coercePromptState(raw, defaults = DEFAULT_SETTINGS) {
  const fallbackList = Array.isArray(defaults.promptSets) && defaults.promptSets.length
    ? defaults.promptSets
    : DEFAULT_PROMPT_SETS;
  const fallbackPrompt = fallbackList[0] || DEFAULT_PROMPT_SETS[0];

  const sanitized = [];
  const seenIds = new Set();

  const pushPrompt = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : generatePromptId(seenIds);
    while (seenIds.has(id)) {
      id = generatePromptId(seenIds);
    }
    const nameRaw = typeof entry.name === 'string' ? entry.name : '';
    const name = sanitizePromptName(nameRaw, sanitized.length);
    const systemPrompt = typeof entry.systemPrompt === 'string' ? entry.systemPrompt : '';
    const userPrompt = typeof entry.userPrompt === 'string' ? entry.userPrompt : '';
    sanitized.push({ id, name, systemPrompt, userPrompt });
    seenIds.add(id);
  };

  if (Array.isArray(raw.promptSets) && raw.promptSets.length) {
    for (const entry of raw.promptSets) {
      pushPrompt(entry);
    }
  }

  if (!sanitized.length) {
    pushPrompt({
      id: fallbackPrompt.id,
      name: fallbackPrompt.name,
      systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : fallbackPrompt.systemPrompt,
      userPrompt: typeof raw.userPrompt === 'string' ? raw.userPrompt : fallbackPrompt.userPrompt
    });
  }

  if (!sanitized.length) {
    pushPrompt(fallbackPrompt);
  }

  let activePromptId = typeof raw.activePromptId === 'string' && raw.activePromptId.trim()
    ? raw.activePromptId.trim()
    : null;
  if (!activePromptId || !sanitized.some((p) => p.id === activePromptId)) {
    activePromptId = sanitized[0].id;
  }

  const activePrompt = sanitized.find((p) => p.id === activePromptId) || sanitized[0];

  return {
    promptSets: sanitized,
    activePromptId,
    activePrompt
  };
}

function getActivePrompt(settings) {
  if (!settings) return null;
  const prompts = Array.isArray(settings.promptSets) ? settings.promptSets : [];
  const activeId = typeof settings.activePromptId === 'string' ? settings.activePromptId : null;
  const prompt = prompts.find((item) => item && item.id === activeId);
  if (prompt) return prompt;
  return prompts[0] || {
    systemPrompt: settings.systemPrompt || '',
    userPrompt: settings.userPrompt || ''
  };
}

function sanitizePromptName(nameRaw, index = 0) {
  const trimmed = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  if (trimmed) return trimmed.slice(0, 60);
  return `提示词 ${index + 1}`;
}

function generatePromptId(existing = new Set()) {
  let candidate;
  do {
    candidate = `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.has(candidate));
  return candidate;
}

function ensureLeadingSlash(path) {
  if (!path) return path;
  return path.startsWith('/') ? path : '/' + path;
}

function mapLegacyPreset(apiPreset, apiMode, apiPath) {
  if (apiPreset === 'google') return 'google';
  if (apiPreset === 'custom') return 'custom';
  if (apiPreset === 'openai') {
    if (apiMode === 'responses' || (typeof apiPath === 'string' && apiPath.includes('/responses'))) {
      return 'openaiResponses';
    }
    return 'openaiChat';
  }
  if (typeof apiMode === 'string') {
    if (apiMode === 'responses') return 'openaiResponses';
    if (apiMode === 'completions') return 'openaiChat';
  }
  if (typeof apiPath === 'string' && apiPath.includes('/responses')) return 'openaiResponses';
  return null;
}

function resolvePresetConfig(settings, presetId) {
  const defaults = PRESET_INFO[presetId]?.defaults || {};
  const stored = settings?.presetConfigs?.[presetId] || {};
  return { ...defaults, ...stored };
}

async function getApiKeyForPreset(presetId) {
  try {
    const { apiKeys } = await chrome.storage.local.get(['apiKeys']);
    if (apiKeys && typeof apiKeys === 'object' && apiKeys[presetId]) {
      return String(apiKeys[presetId] || '').trim();
    }
  } catch (_) {}
  return '';
}

async function migrateLegacyApiKey(raw) {
  const legacyKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (!legacyKey) return;
  const preset = mapLegacyPreset(raw.apiPreset, raw.apiMode, raw.apiPath) || DEFAULT_SETTINGS.activePreset;
  const localStored = await chrome.storage.local.get(['apiKeys']);
  const merged = { ...DEFAULT_API_KEYS, ...(localStored.apiKeys || {}) };
  if (!merged[preset]) {
    merged[preset] = legacyKey;
    await chrome.storage.local.set({ apiKeys: merged });
  }
  await chrome.storage.sync.remove('apiKey');
}

async function callAI(userPayload, tabId, opts = {}) {
  const settings = opts.overrideSettings ? normalizeSettings(opts.overrideSettings) : await getSettings();
  // Only accept image data from the caller; all other configs are from storage.
  const imageDataUrl = userPayload?.imageDataUrl;
  const history = Array.isArray(userPayload?.history) ? userPayload.history : null;
  const presetId = opts.overridePresetId || settings.activePreset || 'google';
  const presetInfo = PRESET_INFO[presetId] || {};
  const presetConfig = resolvePresetConfig(settings, presetId);
  let { apiBaseUrl, apiPath, model, reasoningEffort } = presetConfig;
  apiBaseUrl = (apiBaseUrl || '').trim();
  apiPath = ensureLeadingSlash((apiPath || '').trim());
  model = (model || '').trim();
  if (!reasoningEffort) {
    reasoningEffort = presetInfo.defaults?.reasoningEffort || 'medium';
  }
  const apiMode = presetInfo.mode || inferModeFromPath(apiPath);
  const activePrompt = getActivePrompt(settings);
  const systemPrompt = activePrompt?.systemPrompt || '';
  const userPrompt = activePrompt?.userPrompt || '';
  const streamEnabled = opts.forceNonStream ? false : !!settings.streamEnabled;
  const requestId = userPayload?.requestId;
  const useTemperature = !!presetConfig.useTemperature;
  const temperature = clampNumber(presetConfig.temperature, 0, 2);
  const useMaxTokens = !!presetConfig.useMaxTokens;
  const maxTokens = clampInt(presetConfig.maxTokens, 1, 9999999);

  const overrideApiKeys = opts.overrideApiKeys && typeof opts.overrideApiKeys === 'object' ? opts.overrideApiKeys : null;
  const apiKey = overrideApiKeys ? String(overrideApiKeys[presetId] || '').trim() : await getApiKeyForPreset(presetId);

  if (!apiBaseUrl) {
    const defaults = PRESET_INFO[presetId]?.defaults;
    apiBaseUrl = defaults?.apiBaseUrl || apiBaseUrl;
  }
  if (!apiPath) {
    const defaults = PRESET_INFO[presetId]?.defaults;
    apiPath = defaults?.apiPath || apiPath;
  }
  if (!apiBaseUrl) {
    return { ok: false, error: '缺少 API Base URL，请在扩展选项中设置。' };
  }
  if (!apiKey) {
    return { ok: false, error: '缺少 API Key，请在扩展选项中设置。' };
  }
  if (!model) {
    return { ok: false, error: '缺少模型名称，请在扩展选项中设置。' };
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
          ...(systemPrompt ? [{ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] }] : []),
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
    const targetTabId = opts.suppressClient ? null : tabId;
    if (streamEnabled) {
      const finalText = await streamAI({ url, headers, apiMode, chatPayload, responsesPayload, tabId: targetTabId, requestId, suppressClient: !!opts.suppressClient });
      return { ok: true, text: finalText ?? '', streamed: true };
    } else {
      const body = JSON.stringify(apiMode === 'completions' ? chatPayload : responsesPayload);
      const res = await fetch(url, { method: 'POST', headers, body });
      const parsed = await safeJson(res);
      if (!res.ok) {
        const errMsg = extractErr(parsed) || `HTTP ${res.status}`;
        return { ok: false, error: `调用失败: ${errMsg}` };
      }
      const text = extractText(parsed);
      return { ok: true, text: text ?? '(无内容)', streamed: false };
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
    input.push({ role: 'system', content: [{ type: 'input_text', text: systemPrompt }] });
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
      input.push({ role: 'system', content: [{ type: 'input_text', text }] });
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
    const exists = input.some((m) => m?.role === 'system' && Array.isArray(m.content) && m.content.some((c) => {
      if (typeof c?.text !== 'string') return false;
      const t = c?.type;
      return (!t || t === 'input_text' || t === 'text') && c.text.includes('尽可能精简回答');
    }));
    if (!exists) input.unshift({ role: 'system', content: [{ type: 'input_text', text: CONCISE_TEXT }] });
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

async function streamAI({ url, headers, apiMode, chatPayload, responsesPayload, tabId, requestId, suppressClient }) {
  // Add stream: true flag
  const payload = apiMode === 'completions' ? { ...chatPayload, stream: true } : { ...responsesPayload, stream: true };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const parsed = await safeJson(res);
    const errMsg = extractErr(parsed) || `HTTP ${res.status}`;
    const msg = { type: 'AI_STREAM_DONE', ok: false, error: `调用失败: ${errMsg}`, requestId };
    emitToClients(tabId, msg, suppressClient);
    throw new Error(errMsg);
  }
  const reader = res.body?.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  const sendDelta = (delta) => {
    if (!delta) return;
    full += delta;
    emitToClients(tabId, { type: 'AI_STREAM', delta, requestId }, suppressClient);
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
          emitToClients(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId }, suppressClient);
          return full;
        }
        try {
          const obj = JSON.parse(data);
          const deltaText = extractStreamDelta(obj, apiMode);
          if (deltaText) sendDelta(deltaText);
          // Some responses API variants signal completion via a typed event
          if (obj?.type === 'response.completed') {
            emitToClients(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId }, suppressClient);
            return full;
          }
        } catch (_) {
          // ignore non-JSON keepalive
        }
      }
    }
  }
  emitToClients(tabId, { type: 'AI_STREAM_DONE', ok: true, text: full, requestId }, suppressClient);
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

function emitToClients(tabId, msg, suppress) {
  if (suppress) return;
  try {
    if (tabId != null) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
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
