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
  presetConfigs: Object.fromEntries(Object.entries(PRESETS).map(([id, info]) => [id, { ...info.defaults }])),
  promptSets: structuredClone(DEFAULT_PROMPT_SETS),
  activePromptId: DEFAULT_PROMPT_SETS[0].id,
  userPrompt: DEFAULT_PROMPT_SETS[0].userPrompt,
  systemPrompt: DEFAULT_PROMPT_SETS[0].systemPrompt,
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
  currentPromptId: DEFAULT_SETTINGS.activePromptId,
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

function scheduleAutoSave({ memorizePreset = false, memorizeGeneral = false, memorizePrompts = false } = {}) {
  if (memorizePreset) memorizeCurrentPreset();
  if (memorizeGeneral) memorizeGeneralFields();
  if (memorizePrompts) memorizePromptFields();
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    queueSave();
  }, 400);
}

async function flushAutoSave({ memorizePreset = false, memorizeGeneral = false, memorizePrompts = false } = {}) {
  if (memorizePreset) memorizeCurrentPreset();
  if (memorizeGeneral) memorizeGeneralFields();
  if (memorizePrompts) memorizePromptFields();
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
    promptSelect: document.getElementById('promptSelect'),
    promptAdd: document.getElementById('promptAdd'),
    promptRename: document.getElementById('promptRename'),
    promptDelete: document.getElementById('promptDelete'),
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
  state.currentPromptId = state.settings.activePromptId;

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
    promptSelect,
    promptAdd,
    promptRename,
    promptDelete,
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
    memorizePromptFields();
    scheduleAutoSave();
  });

  systemPrompt?.addEventListener('input', () => {
    memorizePromptFields();
    scheduleAutoSave();
  });

  promptSelect?.addEventListener('change', () => {
    memorizePromptFields();
    state.currentPromptId = promptSelect.value;
    state.settings.activePromptId = state.currentPromptId;
    syncPromptCompatibilityFields();
    renderPromptFields();
    scheduleAutoSave({ memorizePrompts: true });
  });

  promptAdd?.addEventListener('click', (e) => {
    e.preventDefault();
    memorizePromptFields();
    const next = createNewPrompt();
    state.settings.promptSets.push(next);
    state.currentPromptId = next.id;
    state.settings.activePromptId = next.id;
    syncPromptCompatibilityFields();
    renderPromptFields();
    scheduleAutoSave({ memorizePrompts: true });
  });

  promptRename?.addEventListener('click', (e) => {
    e.preventDefault();
    const active = ensureActivePrompt();
    if (!active) return;
    const input = window.prompt('请输入新的提示词名称：', active.name || '');
    if (input === null) return;
    const trimmed = sanitizePromptName(input, getPromptIndex(active.id));
    active.name = trimmed;
    renderPromptFields();
    scheduleAutoSave({ memorizePrompts: true });
  });

  promptDelete?.addEventListener('click', (e) => {
    e.preventDefault();
    const prompts = state.settings.promptSets || [];
    if (prompts.length <= 1) {
      alert('至少需要保留一条提示词。');
      return;
    }
    const active = ensureActivePrompt();
    if (!active) return;
    const ok = window.confirm(`确定要删除提示词“${active.name}”吗？`);
    if (!ok) return;
    state.settings.promptSets = prompts.filter((item) => item.id !== active.id);
    if (!state.settings.promptSets.length) {
      state.settings.promptSets = structuredClone(DEFAULT_PROMPT_SETS);
    }
    state.currentPromptId = state.settings.promptSets[0].id;
    state.settings.activePromptId = state.currentPromptId;
    syncPromptCompatibilityFields();
    renderPromptFields();
    scheduleAutoSave({ memorizePrompts: true });
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
    state.currentPromptId = state.settings.activePromptId;
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
  const defaults = structuredClone(DEFAULT_SETTINGS);
  const settings = structuredClone(DEFAULT_SETTINGS);

  settings.streamEnabled = typeof raw.streamEnabled === 'boolean' ? raw.streamEnabled : defaults.streamEnabled;

  const promptState = coercePromptState(raw, defaults);
  settings.promptSets = promptState.promptSets;
  settings.activePromptId = promptState.activePromptId;
  settings.userPrompt = promptState.activePrompt.userPrompt;
  settings.systemPrompt = promptState.activePrompt.systemPrompt;

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
  const { streamEnabled } = state.els;
  if (streamEnabled) {
    streamEnabled.checked = state.settings.streamEnabled !== false;
  }
  renderPromptFields();
}

function renderPromptFields() {
  const prompts = ensurePromptList();
  if (!prompts.length) {
    state.settings.promptSets = structuredClone(DEFAULT_PROMPT_SETS);
    state.currentPromptId = DEFAULT_PROMPT_SETS[0].id;
  }
  const list = ensurePromptList();
  if (!list.some((item) => item.id === state.currentPromptId)) {
    state.currentPromptId = list[0]?.id || DEFAULT_PROMPT_SETS[0].id;
    state.settings.activePromptId = state.currentPromptId;
  }
  const { promptSelect, userPrompt, systemPrompt, promptDelete, promptRename } = state.els || {};
  if (promptSelect) {
    promptSelect.innerHTML = '';
    for (const prompt of list) {
      const opt = document.createElement('option');
      opt.value = prompt.id;
      opt.textContent = prompt.name || '未命名提示';
      promptSelect.appendChild(opt);
    }
    promptSelect.value = state.currentPromptId;
  }
  const active = ensureActivePrompt();
  if (userPrompt) {
    userPrompt.value = active.userPrompt || '';
  }
  if (systemPrompt) {
    systemPrompt.value = active.systemPrompt || '';
  }
  if (promptDelete) {
    promptDelete.disabled = list.length <= 1;
  }
  if (promptRename) {
    promptRename.disabled = list.length === 0;
  }
  syncPromptCompatibilityFields();
}

function ensurePromptList() {
  if (!Array.isArray(state.settings.promptSets)) {
    state.settings.promptSets = structuredClone(DEFAULT_PROMPT_SETS);
  }
  if (!state.settings.promptSets.length) {
    state.settings.promptSets = structuredClone(DEFAULT_PROMPT_SETS);
  }
  return state.settings.promptSets;
}

function ensureActivePrompt() {
  const list = ensurePromptList();
  if (!list.length) {
    const fallback = structuredClone(DEFAULT_PROMPT_SETS[0]);
    fallback.id = DEFAULT_PROMPT_SETS[0].id;
    list.push(fallback);
  }
  let prompt = list.find((item) => item.id === state.currentPromptId);
  if (!prompt) {
    prompt = list[0];
    state.currentPromptId = prompt.id;
    state.settings.activePromptId = prompt.id;
  }
  return prompt;
}

function getPromptIndex(promptId) {
  const list = ensurePromptList();
  const idx = list.findIndex((item) => item.id === promptId);
  return idx >= 0 ? idx : 0;
}

function createNewPrompt() {
  const list = ensurePromptList();
  const active = ensureActivePrompt();
  const id = generatePromptId(new Set(list.map((item) => item.id)));
  const existingNames = new Set(list.map((item) => item.name));
  const baseName = '新提示词';
  let name = baseName;
  let counter = 2;
  while (existingNames.has(name)) {
    name = `${baseName} ${counter++}`;
  }
  return {
    id,
    name,
    userPrompt: active ? active.userPrompt : '',
    systemPrompt: active ? active.systemPrompt : ''
  };
}

function syncPromptCompatibilityFields() {
  const active = ensureActivePrompt();
  if (!active) return;
  state.settings.activePromptId = active.id;
  state.settings.userPrompt = active.userPrompt || '';
  state.settings.systemPrompt = active.systemPrompt || '';
}

function memorizePromptFields() {
  if (!state.els) return;
  const active = ensureActivePrompt();
  if (!active) return;
  active.userPrompt = state.els.userPrompt?.value || '';
  active.systemPrompt = state.els.systemPrompt?.value || '';
  syncPromptCompatibilityFields();
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
  syncPromptCompatibilityFields();
  const payload = {
    activePreset: state.settings.activePreset,
    presetConfigs: state.settings.presetConfigs,
    promptSets: state.settings.promptSets,
    activePromptId: state.settings.activePromptId,
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
  memorizePromptFields();
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
    const name = sanitizePromptName(entry.name, sanitized.length);
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
  if (!activePromptId || !sanitized.some((item) => item.id === activePromptId)) {
    activePromptId = sanitized[0].id;
  }
  const activePrompt = sanitized.find((item) => item.id === activePromptId) || sanitized[0];

  return {
    promptSets: sanitized,
    activePromptId,
    activePrompt
  };
}

function sanitizePromptName(nameRaw, index = 0) {
  const trimmed = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  if (trimmed) return trimmed.slice(0, 60);
  return `提示词 ${index + 1}`;
}

function generatePromptId(existingSet = new Set()) {
  let candidate;
  do {
    candidate = `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  } while (existingSet.has(candidate));
  return candidate;
}
