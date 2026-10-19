# 书隐 iOS App · v0.10.13

本次在 v0.10.3 源码基础上更新：手机搜索支持自动（Google 优先并回退 Bing、DuckDuckGo）或手动选择引擎；试读筛选增加正文/目录噪声、段落和书名匹配检查；正文抽取扩充常见章节容器并优先保留段落结构；目录试读改为最多三个并发请求。默认仍不自动试读、不自动加入书架。

书隐的本机优先 iOS 阅读工程。阅读、导入、搜索、网页解析、章节下载、笔记书签、统计与听书在手机本机完成；NAS 对核心使用仅用于可选的书架与阅读进度双向同步，不需要 Docker。AI 阅读助手改为手机直连 DeepSeek API（需用户配置 Key，保存在 iOS Keychain，调用可能产生费用）；历史快照和追更记录在本机管理，追更直接检查公开书源。

本版在 v0.10.12 基础上增加百度、搜狗搜索，并保留 Google、Bing、DuckDuckGo；自动搜索依次使用 Google、Bing、DuckDuckGo、百度、搜狗。正文清理保留自然段边界，并合并句中硬换行。搜索引擎网页结构与地区可用性会变化，各引擎均可手动切换。

本版还改进快速切章：网络请求期间上一章/目录/下一章仍可操作，屏幕显示独立加载状态；快速连点时按最后一次选择更新，较慢的旧请求不会覆盖新章节。失败仍保留当前正文。

## 已实现

- 手机搜索默认只列候选、不自动加入书架；结果卡片分开提供“加入书架”和“试读”，加入后留在搜索页并自动开始后台整本缓存；可复制链接或通过 iOS 系统提供的书隐内浏览器打开（SFSafariViewController）。试读失败可删除，并手动补充其他候选；自动试读筛选为可选操作。
- 本机 IndexedDB 书库、JSON 备份与恢复；TXT、Markdown、EPUB、HTML、FB2、文字型和扫描版 PDF、DOCX 导入；扫描版 PDF 使用 iOS Vision 本机 OCR，无需上传。
- 手机直连 Google、Bing、DuckDuckGo、百度或搜狗搜索页面，默认依次尝试 Google、Bing、DuckDuckGo、百度与搜狗；用户可在搜索页选择固定引擎。客户端解析候选并在本机提取公开网页、目录和章节；iOS Capacitor 原生网络层负责跨域 HTTP。搜索引擎网页结构或站点反爬策略可能变化；手机端搜索与正文读取不回退到 NAS。
- 整本下载：加入书架后由 iPhone 在后台逐章读取并保存到 App 本机书库；阅读优先使用本机缓存，未缓存时由手机直连公开网页。章节标题会从正文识别并补齐目录；完成后可从本机资源导出标准 EPUB，通过 iOS 系统分享至 Apple Books、Kindle 等阅读器。本机下载支持暂停、异常重试和续传。NAS 只用于书架与进度同步，勾选完整同步时才上传正文/章节缓存。
- 阅读器采用适合中文长文的宋体排版，支持滚动/翻页、翻页过渡、左右滑动、章节导航、页码与进度定位、翻页边缘点击/键盘操作、旋转时分页重排、iPhone 安全区域适配；阅读进度与字号设置会恢复，字号/行距/字距/主题可调且有快捷入口。书签、笔记、高亮、跨书检索、导出和回跳、阅读统计（可设置每日阅读目标）、小时快照恢复与追更设置保存在本机。追更由手机直接读取公开目录，仅在 App 前台按用户选择的间隔检查。
- 书架支持自定义书架、批量移动、批量标签、标签与阅读状态筛选、重复书候选检测；重复项需用户确认后才删除。章节完整性检查可核对本机缓存并手动读取在线目录。
- AI 阅读助手从手机直连 DeepSeek Chat Completions API，仅发送用户主动提交的问题和当前章节最多 6,000 字；API Key 通过 iOS Keychain 保存。调用需用户自备 Key 并可能产生费用，不依赖 NAS，但需要网络和第三方 AI 服务。
- NAS 地址可在设置里填写；默认只同步书架元数据与阅读进度，正文及章节缓存需用户主动启用。NAS 不参与搜索、阅读、下载、听书或 EPUB 导出。保留本机离线副本，按书籍 ID 合并并记录近同时发生的进度冲突，提供冲突记录与最近同步时间。
- iOS 原生 AVSpeechSynthesizer 中文语音、声音列表与质量选择、AVAudioSession 后台播放、锁屏/耳机播放暂停与章节切换；缓存章节可交给原生队列连续朗读，并保存字词级续听位置。增强/高品质声音由 Apple 系统提供，按需在 iOS“设置 > 辅助功能”中的朗读声音选项下载；应用不捆绑第三方克隆音色。可将本章语音合成为 `.caf` 并放入“文件”App可见的“书隐/Audio”目录。
- 目录关闭与阅读浮动设置、邻章预取、章节缓存均保留；iOS 搜索、正文读取、整本缓存、听书及 EPUB 导出均由手机完成。

## Windows 上编辑

安装 Node.js 20 或更高版本后：

```bash
npm ci
npm run check
npm test
```

`npm ci` 会将 EPUB、PDF、DOCX 解析器和 Capacitor Browser、音频、Keychain、OCR 桥接编译到 `www/vendor/`。依赖和 lockfile 已提交。`npm test` 覆盖 NAS 合并策略及扫描 PDF OCR 导入分支。

## iPhone 免 Mac 安装（PWA）

将 `www/` 内容部署到 HTTPS 网站，在 iPhone Safari 打开地址，点“分享”→“添加到主屏幕”→开启“作为网页 App 打开”→“添加”。已配置应用图标、可离线加载的资源壳与首屏缓存。PWA 适合本机导入、管理与离线阅读；原生 Vision OCR、iOS 锁屏/后台语音、Keychain 和 Capacitor 原生联网能力需要安装原生 iOS 版本，PWA 不包含这些系统能力。纯 HTTP 的 NAS 地址不满足 Service Worker 安全上下文要求，需 HTTPS。

## macOS / Xcode 构建

需要 macOS、Xcode、可用的 Apple 开发者签名，以及可安装依赖的网络连接。Windows 可以维护源码，不能用 Xcode 本机生成 IPA；原生 IPA 需要 Mac/Xcode 或远程 Mac 构建环境，并由 Apple 签名。

```bash
npm ci
npm run ios:setup
npm run ios:sync
npm run ios:open
```

在 Xcode 的 **Signing & Capabilities** 中选择你的 Team 和 Bundle ID，确认 **Background Modes → Audio, AirPlay, and Picture in Picture** 已启用，然后选择真机或模拟器构建。导出 IPA：Xcode 选择 **Product → Archive → Distribute App**，按个人签名或 TestFlight 流程导出。也可在 macOS 上设置 `DEVELOPMENT_TEAM` 后运行 `./scripts/build-ios.sh` 完成归档，再用 Xcode Organizer 导出；没有证书不能生成可安装到个人 iPhone 的正式签名包。

`npm run ios:setup` 会生成 Capacitor iOS 工程并登记原生音频、Keychain 和 OCR 插件；`@capacitor/browser` 由 `npx cap sync ios` 自动登记。同步后包含 Safari 打开链接、后台音频和“文件”App 共享设置。反复执行不会重复登记插件文件。

## NAS 连接说明

在 App 的“设置与同步”中填写现有书隐 NAS 地址，仅用于多设备书架和阅读进度同步。书源搜索、网页提取与整本下载由 iPhone 直连互联网完成，不需要 NAS 或 Docker。整本下载完成后章节可离线阅读。

为兼容家庭 NAS 的 HTTP 地址，iOS 工程允许本地网络 HTTP；HTTP 内容未加密。优先使用 HTTPS，或只在可信家庭网络/VPN 内使用。当前 NAS `/api/books` 接口没有用户认证或服务端版本比较；不要把未加认证的接口直接暴露到公网。同步基于同 ID 的 `updatedAt` 时间戳和本机删除标记；设备系统时钟不准时，冲突选择可能不符合预期，重要书库请保留 JSON 备份。

## 当前验证边界

已运行 `npm run check`、`npm test`，21 项自动测试通过。搜索目前解析 DuckDuckGo/Bing 网页版结果，不是官方稳定搜索 API；搜索引擎反爬、地区网络和书站 DOM 变化可能导致个别来源不可用。站点需要登录、验证码、脚本执行或 DRM 时，手机端提取无法保证成功。当前运行环境不是 macOS，没有 Xcode 和 iPhone，因此**Swift 原生插件（含 OCR）编译、扫描 PDF 实际识别、系统声音选择、后台/锁屏行为、Keychain、NAS 联调、离线长任务、手势和完整真机界面回归尚未验证**。Apple 增强声音是否离线取决于用户是否在 iOS 设置下载。NAS TTS 模型未移植；iOS 使用系统语音。AI 助手仍是联网云模型而非离线端侧模型；历史快照在 App 前台检测到书库变更后按小时生成，最多保留 72 份；设备存储空间不足时仍需用户另行导出 JSON。直连 API 与 iOS Keychain 尚未在真机验证。
