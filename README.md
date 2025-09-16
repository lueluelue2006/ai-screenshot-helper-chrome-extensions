# 截图问AI Chrome 扩展

一个基于 Manifest V3 的浏览器扩展，支持在网页上框选截图并将内容发送给自定义的 AI 渠道进行解析或解题。默认提供 Google (Google AI Studio)、OpenAI Chat Completions、OpenAI Responses 以及自定义接口四种预设，配置完全保存在 `chrome.storage` 中。

## 功能特性
- 快捷键或工具栏按钮唤起可拖拽的截图选区，结果在当前页右下角弹出面板。
- 多渠道预设：自动填充 Base URL、路径、模型列表、默认温度与推理力度，支持为每个渠道分别保存 API Key。
- 全局 Streaming 默认开启，可在设置页快速测试当前渠道是否可用。
- 支持在页面内或新标签页继续对话，图片/文字消息会保留在历史中。
- 重置功能：可单独恢复当前渠道，也可以双重确认后清空所有配置。

## 快速开始
1. 在 `chrome://extensions/` 打开开发者模式并加载此目录。
2. 打开扩展的“选项”页，按需填入各渠道的 API Key 及模型参数。
3. 在 `chrome://extensions/shortcuts` 为命令“开始截图并向AI提问”设置自定义快捷键（macOS 需要包含 ⌘ 或 ⌥，Windows/Linux 需要包含 Ctrl 或 Alt）。
4. 在任意普通网页按下快捷键或点击工具栏图标进行截图，AI 回复将出现在页面内的会话面板。

## 配置提示
- 默认系统提示词定位为“资深教研老师”，用户提示词会引导模型先复述题意、再逐步推理并给出结论。
- Google 渠道默认模型为 `gemini-2.5-flash`，推理力度为 `high`；OpenAI 渠道默认模型为 `gpt-5-nano`，推理力度为 `medium`。
- 若首次使用快捷键时弹出权限提示，请在地址栏拼图图标中选择“始终允许访问此站点”。

## 开发说明
- Background 逻辑集中在 `background.js`，负责存储、调度、权限申请及与内容脚本的消息通信。
- 截图选区与浮动对话面板位于 `content.js`；选项页逻辑在 `options.js`，聊天新标签页在 `chat.js`。
- 扩展版本请在 `manifest.json` 的 `version` 字段中逐次递增。

欢迎根据需求继续扩展功能，例如增加 Markdown/KaTeX 渲染或更多渠道预设。
