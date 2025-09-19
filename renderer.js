// renderer.js – shared Markdown + KaTeX rendering helpers

(function () {
  // Marked v12 在 UMD 下导出为对象（含 parse 方法），而非可调用函数。
  // 这里兼容旧版和新版的全局标识。
  const hasMarked = (typeof marked !== 'undefined') && !!marked &&
    (typeof marked.parse === 'function' || typeof marked === 'function');
  const hasDomPurify = typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function';
  const hasAutoRender = typeof renderMathInElement === 'function';

  function sanitizeHtml(html) {
    if (!hasDomPurify) return html;
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
    });
  }

  function markdownToHtml(markdown) {
    if (!hasMarked) return markdown.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
    // 兼容 marked 作为函数或对象两种形式
    const parse = (typeof marked === 'function') ? marked : marked.parse;
    return parse(markdown, {
      breaks: true,
      gfm: true,
      mangle: false,
      headerIds: false,
    });
  }

  function renderMathIfAvailable(container) {
    if (!hasAutoRender || !container) return;
    try {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        strict: 'ignore',
        trust: true,
        macros: {},
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
    } catch (_) {
      // ignore rendering failures to avoid breaking the panel
    }
  }

  function renderMarkdown(target, markdown) {
    if (!target) return;
    const text = typeof markdown === 'string' ? markdown : '';
    if (!text) {
      target.textContent = '';
      return;
    }
    const html = markdownToHtml(text);
    const sanitized = sanitizeHtml(html);
    target.innerHTML = sanitized;
    renderMathIfAvailable(target);
    try { attachQuadClickCopy(target); } catch (_) {}
  }

  function renderPlain(target, text) {
    if (!target) return;
    target.textContent = typeof text === 'string' ? text : '';
  }

  window.__screenshotRenderMarkdown = function (target, text) {
    if (!target) return;
    if (typeof text !== 'string' || text.length === 0) {
      target.textContent = text || '';
      return;
    }
    renderMarkdown(target, text);
  };

  window.__screenshotSetPlainText = renderPlain;

  // --- Helpers: quadruple-click to copy a full code block (no buttons) ---
  const boundContainers = new WeakSet();
  function attachQuadClickCopy(container) {
    if (!container || boundContainers.has(container)) return;
    boundContainers.add(container);
    container.addEventListener('click', async (e) => {
      try {
        if (e.detail !== 4) return; // only on the fourth click
        const pre = e.target && (e.target.closest ? e.target.closest('pre') : null);
        if (!pre) return;
        const code = pre.querySelector('code');
        if (!code) return;
        const text = code.innerText || code.textContent || '';
        if (!text) return;
        const ok = await copyToClipboard(text);
        showTip(pre, ok ? '已复制' : '复制失败');
      } catch (_) { /* ignore */ }
    });
  }

  function showTip(pre, msg) {
    try {
      const tip = document.createElement('span');
      tip.textContent = String(msg || '');
      tip.style.position = 'absolute';
      tip.style.top = '6px';
      tip.style.right = '8px';
      tip.style.padding = '2px 6px';
      tip.style.fontSize = '11px';
      tip.style.border = '1px solid #334155';
      tip.style.borderRadius = '6px';
      tip.style.background = 'rgba(15,23,42,0.9)';
      tip.style.color = '#93c5fd';
      tip.style.pointerEvents = 'none';
      pre.style.position = pre.style.position || 'relative';
      pre.appendChild(tip);
      setTimeout(() => { try { tip.remove(); } catch (_) {} }, 900);
    } catch (_) {}
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.pointerEvents = 'none';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }
})();
