const PRESETS = {
  google: {
    label: 'Google (Google AI Studio)',
    mode: 'completions',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
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
    label: 'OpenAI Chat Completions',
    mode: 'completions',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o4-mini', 'o3', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
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
    label: 'OpenAI Responses',
    mode: 'responses',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o4-mini', 'o3', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
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
    label: '自定义 API',
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

const DEFAULT_SETTINGS = {
  activePreset: 'google',
  presetConfigs: Object.fromEntries(Object.entries(PRESETS).map(([id, info]) => [id, { ...info.defaults }])),
  userPrompt: '请阅读我提供的截图或文字：先归纳题目类型、已知条件和求解目标；然后按步骤写出推理过程与使用的公式，列出中间结果；最后汇总最终答案并给出简单检验或结论说明。如需理解图表，请先描述图中要素。',
  systemPrompt: '你是一名资深教研老师，擅长理解截图里的文字、公式与图表。请先准确复述题意和所有关键条件，推理时逐步解释每一步的依据，并在给出答案前做一次自检；若信息不足或题意含糊，要明确指出缺失内容。',
  streamEnabled: true
};

const DEFAULT_API_KEYS = Object.fromEntries(Object.keys(PRESETS).map((id) => [id, '']));
const FALLBACK_BASE_PLACEHOLDER = 'https://your-api-host';
const FALLBACK_PATH_PLACEHOLDER = '/v1/chat/completions';
const CUSTOM_MODEL_OPTION = '__custom__';

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  apiKeys: { ...DEFAULT_API_KEYS },
  currentPreset: DEFAULT_SETTINGS.activePreset,
  els: null
};

let autoSaveTimer = null;
let saveQueue = Promise.resolve();

function queueSave() {
  saveQueue = saveQueue
    .then(() => persistState())
    .catch((err) => {
      console.error('自动保存失败', err);
    });
  return saveQueue;
}

function scheduleAutoSave({ memorizePreset = false, memorizeGeneral = false } = {}) {
  if (memorizePreset) memorizeCurrentPreset();
  if (memorizeGeneral) memorizeGeneralFields();
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    queueSave();
  }, 400);
}

async function flushAutoSave({ memorizePreset = false, memorizeGeneral = false } = {}) {
  if (memorizePreset) memorizeCurrentPreset();
  if (memorizeGeneral) memorizeGeneralFields();
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  await queueSave();
}

document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    apiPreset: document.getElementById('apiPreset'),
    apiBaseUrl: document.getElementById('apiBaseUrl'),
    apiPath: document.getElementById('apiPath'),
    apiKey: document.getElementById('apiKey'),
    googleKeyBtn: document.getElementById('googleKeyBtn'),
    googleKeyHelp: document.getElementById('googleKeyHelp'),
    modelSelect: document.getElementById('modelSelect'),
    modelInput: document.getElementById('modelInput'),
    reasoningEffort: document.getElementById('reasoningEffort'),
    streamEnabled: document.getElementById('streamEnabled'),
    useTemperature: document.getElementById('useTemperature'),
    temperature: document.getElementById('temperature'),
    useMaxTokens: document.getElementById('useMaxTokens'),
    maxTokens: document.getElementById('maxTokens'),
    userPrompt: document.getElementById('userPrompt'),
    systemPrompt: document.getElementById('systemPrompt'),
    reset: document.getElementById('reset'),
    resetAll: document.getElementById('resetAll'),
    testChannel: document.getElementById('testChannel')
  };
  state.els = els;

  bindUiEvents();

  const loaded = await loadState();
  state.settings = loaded.settings;
  state.apiKeys = loaded.apiKeys;
  state.currentPreset = state.settings.activePreset;

  els.apiPreset.value = state.currentPreset;
  renderGeneralFields();
  renderPresetFields(state.currentPreset);
});

function bindUiEvents() {
  const {
    apiPreset,
    apiBaseUrl,
    apiPath,
    apiKey,
    modelSelect,
    modelInput,
    reasoningEffort,
    useTemperature,
    temperature,
    useMaxTokens,
    maxTokens,
    googleKeyBtn,
    streamEnabled,
    userPrompt,
    systemPrompt,
    reset,
    resetAll,
    testChannel
  } = state.els || {};
  if (!apiPreset) return;

  apiPreset.addEventListener('change', () => {
    memorizeCurrentPreset();
    state.currentPreset = apiPreset.value;
    state.settings.activePreset = state.currentPreset;
    renderPresetFields(state.currentPreset);
    scheduleAutoSave();
  });

  modelSelect?.addEventListener('change', () => {
    handleModelSelectChange();
    scheduleAutoSave({ memorizePreset: true });
  });

  [apiBaseUrl, apiPath, modelInput, temperature, maxTokens].forEach((el) => {
    el?.addEventListener('input', () => {
      scheduleAutoSave({ memorizePreset: true });
    });
  });

  apiKey?.addEventListener('input', () => {
    scheduleAutoSave({ memorizePreset: true });
  });

  reasoningEffort?.addEventListener('change', () => {
    scheduleAutoSave({ memorizePreset: true });
  });

  useTemperature?.addEventListener('change', () => {
    toggleTemperatureInput();
    scheduleAutoSave({ memorizePreset: true });
  });

  useMaxTokens?.addEventListener('change', () => {
    toggleMaxTokensInput();
    scheduleAutoSave({ memorizePreset: true });
  });

  streamEnabled?.addEventListener('change', () => {
    scheduleAutoSave({ memorizeGeneral: true });
  });

  userPrompt?.addEventListener('input', () => {
    scheduleAutoSave({ memorizeGeneral: true });
  });

  systemPrompt?.addEventListener('input', () => {
    scheduleAutoSave({ memorizeGeneral: true });
  });

  googleKeyBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://aistudio.google.com/app/apikey' }).catch(() => {
      window.open('https://aistudio.google.com/app/apikey', '_blank');
    });
  });

  testChannel?.addEventListener('click', async (e) => {
    e.preventDefault();
    await handleTestChannel(testChannel);
  });

  reset?.addEventListener('click', async (e) => {
    e.preventDefault();
    const presetId = state.currentPreset;
    const presetInfo = PRESETS[presetId];
    if (!presetInfo) return;
    const ok = window.confirm('确定要恢复当前渠道的默认配置吗？');
    if (!ok) return;
    state.settings.presetConfigs[presetId] = structuredClone(presetInfo.defaults);
    state.apiKeys[presetId] = '';
    state.settings.streamEnabled = true;
    renderGeneralFields();
    renderPresetFields(presetId);
    await flushAutoSave();
    alert('已恢复当前渠道的默认设置');
  });

  resetAll?.addEventListener('click', async (e) => {
    e.preventDefault();
    const confirmStep = window.confirm('确定要重置所有设置吗？该操作会清除所有渠道配置与提示词。');
    if (!confirmStep) return;
    const second = window.prompt('请键入 yes 以确认重置所有设置：');
    if (!second || second.trim().toLowerCase() !== 'yes') {
      alert('未输入 yes，操作已取消。');
      return;
    }
    state.settings = structuredClone(DEFAULT_SETTINGS);
    state.apiKeys = { ...DEFAULT_API_KEYS };
    state.currentPreset = state.settings.activePreset;
    renderGeneralFields();
    renderPresetFields(state.currentPreset);
    state.els.apiPreset.value = state.currentPreset;
    await flushAutoSave();
    alert('所有设置已重置');
  });
}

async function loadState() {
  const [syncRaw, localRaw] = await Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(['apiKeys'])
  ]);
  const settings = normalizeSettings(syncRaw || {});
  const apiKeys = {
    ...DEFAULT_API_KEYS,
    ...((localRaw.apiKeys && typeof localRaw.apiKeys === 'object') ? localRaw.apiKeys : {})
  };
  return { settings, apiKeys };
}

function normalizeSettings(raw) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (typeof raw.userPrompt === 'string') settings.userPrompt = raw.userPrompt;
  if (typeof raw.systemPrompt === 'string') settings.systemPrompt = raw.systemPrompt;
  if (typeof raw.streamEnabled === 'boolean') settings.streamEnabled = raw.streamEnabled;

  if (raw.presetConfigs && typeof raw.presetConfigs === 'object') {
    for (const [id, info] of Object.entries(PRESETS)) {
      settings.presetConfigs[id] = { ...info.defaults, ...(raw.presetConfigs[id] || {}) };
    }
  }

  let activePreset = typeof raw.activePreset === 'string' ? raw.activePreset : null;
  if (!activePreset && typeof raw.apiPreset === 'string') {
    activePreset = mapLegacyPreset(raw.apiPreset, raw.apiMode, raw.apiPath);
  }
  if (!activePreset || !PRESETS[activePreset]) activePreset = DEFAULT_SETTINGS.activePreset;
  settings.activePreset = activePreset;

  if (!raw.presetConfigs) {
    const legacyTarget = mapLegacyPreset(raw.apiPreset, raw.apiMode, raw.apiPath) || activePreset;
    if (legacyTarget && PRESETS[legacyTarget]) {
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

  for (const [id, info] of Object.entries(PRESETS)) {
    settings.presetConfigs[id] = { ...info.defaults, ...settings.presetConfigs[id] };
  }
  return settings;
}

function renderGeneralFields() {
  const { streamEnabled, userPrompt, systemPrompt } = state.els;
  streamEnabled.checked = state.settings.streamEnabled !== false;
  userPrompt.value = state.settings.userPrompt || '';
  systemPrompt.value = state.settings.systemPrompt || '';
}

function renderPresetFields(preset) {
  const cfg = resolvePresetConfig(preset);
  const defaults = PRESETS[preset]?.defaults || {};
  const {
    apiBaseUrl,
    apiPath,
    model,
    reasoningEffort,
    useTemperature,
    temperature,
    useMaxTokens,
    maxTokens
  } = cfg;
  const {
    apiBaseUrl: baseInput,
    apiPath: pathInput,
    apiKey: keyInput,
    modelSelect,
    modelInput,
    reasoningEffort: reasoningSelect,
    useTemperature: useTempCheckbox,
    temperature: tempInput,
    useMaxTokens: useMaxTokensCheckbox,
    maxTokens: maxTokensInput
  } = state.els;

  baseInput.value = apiBaseUrl || '';
  pathInput.value = apiPath || '';
  reasoningSelect.value = reasoningEffort || defaults.reasoningEffort || 'medium';
  useTempCheckbox.checked = !!useTemperature;
  tempInput.value = (temperature ?? defaults.temperature ?? 1).toString();
  useMaxTokensCheckbox.checked = !!useMaxTokens;
  maxTokensInput.value = (maxTokens ?? defaults.maxTokens ?? 65536).toString();
  keyInput.value = state.apiKeys[preset] || '';

  setupModelControls({ preset, model, defaults });

  toggleTemperatureInput();
  toggleMaxTokensInput();
  setPlaceholders(preset);
  updateGoogleControls(preset);
}

function updateGoogleControls(preset) {
  const isGoogle = preset === 'google';
  if (state.els.googleKeyBtn) {
    state.els.googleKeyBtn.style.display = isGoogle ? 'inline-flex' : 'none';
  }
  if (state.els.googleKeyHelp) {
    state.els.googleKeyHelp.style.display = isGoogle ? 'block' : 'none';
  }
  if (state.els.apiKey) {
    state.els.apiKey.placeholder = isGoogle ? 'AIza...' : 'sk-...';
  }
}

function setupModelControls({ preset, model, defaults }) {
  const { modelSelect, modelInput } = state.els || {};
  if (!modelSelect || !modelInput) return;
  const models = PRESETS[preset]?.models || [];
  const effective = model || defaults.model || '';
  modelInput.placeholder = defaults.model || '';
  if (models.length) {
    modelSelect.innerHTML = '';
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      modelSelect.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_MODEL_OPTION;
    customOpt.textContent = '自定义…';
    modelSelect.appendChild(customOpt);
    modelSelect.style.display = '';
    const hasMatch = effective && models.includes(effective);
    if (hasMatch) {
      modelSelect.value = effective;
      modelInput.value = effective;
    } else {
      modelSelect.value = CUSTOM_MODEL_OPTION;
      modelInput.value = effective;
    }
  } else {
    modelSelect.innerHTML = '';
    modelSelect.style.display = 'none';
    modelSelect.value = CUSTOM_MODEL_OPTION;
    modelInput.value = effective;
    modelInput.style.display = 'block';
    return;
  }
  handleModelSelectChange();
}

function handleModelSelectChange() {
  const { modelSelect, modelInput } = state.els || {};
  if (!modelSelect || !modelInput) return;
  if (modelSelect.style.display === 'none') {
    modelInput.style.display = 'block';
    return;
  }
  const value = modelSelect.value;
  const isCustom = !value || value === CUSTOM_MODEL_OPTION;
  modelInput.style.display = isCustom ? 'block' : 'none';
  if (!isCustom) {
    modelInput.value = value;
  }
}

function setPlaceholders(preset) {
  const defaults = PRESETS[preset]?.defaults || {};
  state.els.apiBaseUrl.placeholder = defaults.apiBaseUrl || FALLBACK_BASE_PLACEHOLDER;
  state.els.apiPath.placeholder = defaults.apiPath || FALLBACK_PATH_PLACEHOLDER;
}

function toggleTemperatureInput() {
  if (!state.els.useTemperature || !state.els.temperature) return;
  state.els.temperature.disabled = !state.els.useTemperature.checked;
}

function toggleMaxTokensInput() {
  if (!state.els.useMaxTokens || !state.els.maxTokens) return;
  state.els.maxTokens.disabled = !state.els.useMaxTokens.checked;
}

function memorizeGeneralFields() {
  if (!state.els) return;
  state.settings.streamEnabled = !!state.els.streamEnabled.checked;
  state.settings.userPrompt = state.els.userPrompt.value;
  state.settings.systemPrompt = state.els.systemPrompt.value;
}

function memorizeCurrentPreset() {
  const preset = state.currentPreset;
  const cfg = resolvePresetConfig(preset);
  cfg.apiBaseUrl = normalizeBase(state.els.apiBaseUrl.value);
  cfg.apiPath = normalizePath(state.els.apiPath.value);
  cfg.model = getCurrentModelValue();
  cfg.reasoningEffort = state.els.reasoningEffort.value;
  cfg.useTemperature = !!state.els.useTemperature.checked;
  cfg.temperature = clampNumber(parseFloat(state.els.temperature.value || '0'), 0, 2);
  cfg.useMaxTokens = !!state.els.useMaxTokens.checked;
  cfg.maxTokens = clampInt(parseInt(state.els.maxTokens.value || '0', 10), 1, 9999999);
  state.settings.presetConfigs[preset] = { ...state.settings.presetConfigs[preset], ...cfg };
  state.apiKeys[preset] = state.els.apiKey.value.trim();
}

function getCurrentModelValue() {
  const { modelSelect, modelInput } = state.els || {};
  if (modelSelect && modelSelect.style.display !== 'none') {
    const value = modelSelect.value;
    if (value && value !== CUSTOM_MODEL_OPTION) return value;
  }
  return (modelInput?.value || '').trim();
}

async function persistState() {
  const payload = {
    activePreset: state.settings.activePreset,
    presetConfigs: state.settings.presetConfigs,
    userPrompt: state.settings.userPrompt,
    systemPrompt: state.settings.systemPrompt,
    streamEnabled: state.settings.streamEnabled
  };
  await chrome.storage.sync.set(payload);
  await chrome.storage.local.set({ apiKeys: state.apiKeys });
}

function resolvePresetConfig(preset) {
  const defaults = PRESETS[preset]?.defaults || {}; 
  const stored = state.settings.presetConfigs?.[preset] || {}; 
  return { ...defaults, ...stored };
}

async function handleTestChannel(button) {
  if (!button) return;
  memorizeCurrentPreset();
  memorizeGeneralFields();
  scheduleAutoSave();
  const presetId = state.currentPreset;
  const apiKey = state.apiKeys[presetId] || '';
  if (!apiKey.trim()) {
    alert('请先填写当前渠道的 API Key。');
    return;
  }
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '测试中…';
  try {
    const settingsCopy = structuredClone(state.settings);
    settingsCopy.activePreset = presetId;
    const apiKeysCopy = { ...state.apiKeys };
    const history = [{ role: 'user', content: [{ type: 'text', text: '你好，这是一条测试消息，用于检查渠道配置是否可用。' }] }];
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CHANNEL',
      presetId,
      settings: settingsCopy,
      apiKeys: apiKeysCopy,
      history
    }).catch((err) => ({ ok: false, error: String(err) }));
    if (response?.ok) {
      const preview = (response.text || '').slice(0, 200) || '(无内容)';
      alert('测试成功！返回内容预览：\n\n' + preview);
    } else {
      alert('测试失败：' + (response?.error || '未知错误'));
    }
  } catch (e) {
    alert('测试失败：' + String(e));
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

function normalizePath(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  return ensureLeadingSlash(trimmed.replace(/\s+/g, ''));
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
  if (apiMode === 'responses') return 'openaiResponses';
  if (apiMode === 'completions') return 'openaiChat';
  if (typeof apiPath === 'string' && apiPath.includes('/responses')) return 'openaiResponses';
  return null;
}

function clampNumber(n, min, max) {
  const v = Number(n);
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function clampInt(n, min, max) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}
