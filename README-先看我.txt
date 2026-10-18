书隐 iOS App v0.10.2 — iOS 源码工程（非 IPA）

核心功能在手机本机运行：导入与阅读、搜索与正文提取、整本离线下载、笔记书签检索与导出、阅读统计、追更、系统语音、阅读翻页手势、阅读进度/字号恢复、书架标签/批量整理和重复书检查。NAS 默认只同步书架与阅读进度；正文与章节缓存可由用户选择同步，其他阅读功能全部由 iPhone 本机运行。NAS 对核心使用仅用于书架与阅读进度同步，不需要 Docker。AI 阅读助手由手机直连 DeepSeek（需自备 API Key，Key 存在 iOS Keychain，可能产生费用）；历史快照与追更设置保存在本机，追更直接读取公开书源。

快速检查：
  npm ci
  npm run check
  npm test  # 14 项自动测试

EPUB/PDF/DOCX 解析器及 Capacitor Browser、音频、Keychain、OCR 桥接由 npm install 脚本复制到 www/vendor。

iPhone 免 Mac 安装：将 www 部署到 HTTPS，Safari 打开后选择“分享 → 添加到主屏幕 → 作为网页 App 打开”。该方式支持本机导入与阅读；OCR、锁屏听书、Keychain 等需原生版。

macOS + Xcode 构建：
  npm run ios:setup
  npm run ios:sync
  npm run ios:open

在 Xcode 配置开发者签名后构建或归档。Windows 可编辑和运行 JS 检查，不能本机生成 iOS IPA。

重要边界：
- 搜索解析 DuckDuckGo/Bing 网页结果；站点反爬、验证码、登录限制或网页结构变化会造成部分来源无法读取。
- iOS 增强/高品质中文声音需用户在系统设置下载；Kokoro/Piper 模型未捆绑。
- 扫描图片型 PDF 使用 iOS Vision 本机 OCR；纯浏览器环境不支持原生 OCR。
- 当前工作环境未提供 macOS、Xcode 或 iPhone，原生编译、真机行为及签名 IPA 尚未验证。
- NAS 同步接口当前没有认证，请勿将未加认证服务直接暴露到公网。
