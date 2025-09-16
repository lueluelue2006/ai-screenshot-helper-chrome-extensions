document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const openBtn = document.getElementById('openOptions');
  const helpBtn = document.getElementById('help');

  startBtn?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab?.id || null;
      const res = await chrome.runtime.sendMessage({ type: 'START_SCREENSHOT_FROM_POPUP', tabId });
      if (!res?.ok) throw new Error(res?.error || '激活失败');
      window.close();
    } catch (e) {
      console.warn('无法启动截图：', e);
      alert('无法在此页面启动截图，请确认：\n\n1) 当前页面是普通网页（非系统页面）\n2) 已允许扩展访问此站点（点击地址栏右侧的拼图图标授予权限）');
    }
  });

  openBtn?.addEventListener('click', async () => {
    await chrome.runtime.openOptionsPage();
    window.close();
  });

  helpBtn?.addEventListener('click', async () => {
    alert('使用方法：\n\n1) 在选项页填入 API Key 等设置\n2) 点击工具栏图标或按快捷键开始截图\n3) 拖拽选择区域，AI 回答会在右下角浮窗显示\n\n注意：仅在普通网页有效，系统页面不可用。');
  });
});
