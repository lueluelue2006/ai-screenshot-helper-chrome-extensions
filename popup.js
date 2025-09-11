document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start');
  const openBtn = document.getElementById('openOptions');
  const helpBtn = document.getElementById('help');

  startBtn?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      // 发送给当前标签页的内容脚本
      await chrome.tabs.sendMessage(tab.id, { type: 'START_SCREENSHOT' });
      window.close();
    } catch (e) {
      console.warn('无法启动截图：', e);
      alert('请在普通网页中使用（不要在 chrome:// 或扩展商店页），并刷新页面后再试。');
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

