const DEFAULTS = {
  apiBaseUrl: 'https://api.openai.com',
  apiPath: '/v1/chat/completions',
  apiMode: 'completions',
  apiKey: '',
  model: 'o4-mini',
  reasoningEffort: 'medium',
  userPrompt: '请解答这张截图中的题目，并给出详细的推理过程与最终答案。',
  systemPrompt: '你是一个擅长图文理解和解题的助理。',
  streamEnabled: true,
  useTemperature: false,
  temperature: 1,
  useMaxTokens: false,
  maxTokens: 65536
};

document.addEventListener('DOMContentLoaded', async () => {
  const els = {
    apiBaseUrl: document.getElementById('apiBaseUrl'),
    apiPath: document.getElementById('apiPath'),
    apiMode: document.getElementById('apiMode'),
    apiKey: document.getElementById('apiKey'),
    model: document.getElementById('model'),
    reasoningEffort: document.getElementById('reasoningEffort'),
    userPrompt: document.getElementById('userPrompt'),
    systemPrompt: document.getElementById('systemPrompt'),
    streamEnabled: document.getElementById('streamEnabled'),
    useTemperature: document.getElementById('useTemperature'),
    temperature: document.getElementById('temperature'),
    useMaxTokens: document.getElementById('useMaxTokens'),
    maxTokens: document.getElementById('maxTokens'),
    save: document.getElementById('save'),
    reset: document.getElementById('reset')
  };

  const cfg = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const settings = { ...DEFAULTS, ...cfg };
  els.apiBaseUrl.value = settings.apiBaseUrl || '';
  els.apiPath.value = settings.apiPath || '';
  els.apiKey.value = settings.apiKey || '';
  els.model.value = settings.model || '';
  els.reasoningEffort.value = settings.reasoningEffort || 'medium';
  els.userPrompt.value = settings.userPrompt || '';
  els.systemPrompt.value = settings.systemPrompt || '';
  els.apiMode.value = settings.apiMode || 'completions';
  els.streamEnabled.checked = settings.streamEnabled !== false; // default true
  els.useTemperature.checked = !!settings.useTemperature;
  els.temperature.value = (settings.temperature ?? 1).toString();
  els.temperature.disabled = !els.useTemperature.checked;
  els.useMaxTokens.checked = !!settings.useMaxTokens;
  els.maxTokens.value = (settings.maxTokens ?? 65536).toString();
  els.maxTokens.disabled = !els.useMaxTokens.checked;

  // Set placeholder/path based on mode if empty or matching old default
  const setDefaultPathForMode = (mode) => mode === 'responses' ? '/v1/responses' : '/v1/chat/completions';
  if (!els.apiPath.value || els.apiPath.value === '/v1/responses' || els.apiPath.value === '/v1/chat/completions') {
    els.apiPath.placeholder = setDefaultPathForMode(els.apiMode.value);
  }
  els.apiMode.addEventListener('change', () => {
    const newDefault = setDefaultPathForMode(els.apiMode.value);
    // If current equals the previous default or empty, switch to new default for convenience
    const current = els.apiPath.value.trim();
    if (!current || current === '/v1/responses' || current === '/v1/chat/completions') {
      els.apiPath.value = newDefault;
    }
    els.apiPath.placeholder = newDefault;
  });

  els.useTemperature.addEventListener('change', () => {
    els.temperature.disabled = !els.useTemperature.checked;
  });
  els.useMaxTokens.addEventListener('change', () => {
    els.maxTokens.disabled = !els.useMaxTokens.checked;
  });

  els.save.addEventListener('click', async () => {
    const toSet = {
      apiBaseUrl: els.apiBaseUrl.value.trim() || DEFAULTS.apiBaseUrl,
      apiPath: els.apiPath.value.trim() || (els.apiMode.value === 'responses' ? '/v1/responses' : '/v1/chat/completions'),
      apiMode: els.apiMode.value,
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || DEFAULTS.model,
      reasoningEffort: els.reasoningEffort.value,
      userPrompt: els.userPrompt.value,
      systemPrompt: els.systemPrompt.value,
      streamEnabled: !!els.streamEnabled.checked,
      useTemperature: !!els.useTemperature.checked,
      temperature: parseFloat(els.temperature.value || '1') || 1,
      useMaxTokens: !!els.useMaxTokens.checked,
      maxTokens: parseInt(els.maxTokens.value || '65536', 10) || 65536
    };
    await chrome.storage.sync.set(toSet);
    alert('已保存');
  });

  els.reset.addEventListener('click', async () => {
    await chrome.storage.sync.set({ ...DEFAULTS });
    els.apiBaseUrl.value = DEFAULTS.apiBaseUrl;
    els.apiPath.value = DEFAULTS.apiPath;
    els.apiKey.value = '';
    els.model.value = DEFAULTS.model;
    els.reasoningEffort.value = DEFAULTS.reasoningEffort;
    els.userPrompt.value = DEFAULTS.userPrompt;
    els.systemPrompt.value = DEFAULTS.systemPrompt;
    els.apiMode.value = DEFAULTS.apiMode;
    els.apiPath.value = DEFAULTS.apiPath;
    els.apiPath.placeholder = DEFAULTS.apiPath;
    els.streamEnabled.checked = DEFAULTS.streamEnabled;
    els.useTemperature.checked = DEFAULTS.useTemperature;
    els.temperature.value = DEFAULTS.temperature;
    els.temperature.disabled = !DEFAULTS.useTemperature;
    els.useMaxTokens.checked = DEFAULTS.useMaxTokens;
    els.maxTokens.value = DEFAULTS.maxTokens;
    els.maxTokens.disabled = !DEFAULTS.useMaxTokens;
    alert('已恢复默认');
  });
});
