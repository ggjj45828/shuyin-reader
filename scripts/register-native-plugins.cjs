const fs = require('node:fs');
const path = require('node:path');

// 把书隐的四个 App 内原生插件写进 `ios/App/App/capacitor.config.json` 的 packageClassList。
//
// 为什么需要这一步：Capacitor 的自动注册（CapacitorBridge.registerPlugins）只认这个列表 ——
// 而该列表是 `cap sync` 用 `@objc(...)` 正则扫 **node_modules 里的插件包**生成的，
// 我们这些放在 App 工程里的插件不在列表里，运行时就看不见。
//
// 为什么不用 `bridge?.registerPluginInstance(...)`：Capacitor 7 的 iOS 模板只有
// AppDelegate.swift + Info.plist，**没有 MainViewController**，没有自然的注册位置。
//
// 顺序很重要：必须在 `npx cap sync ios` **之后**跑，否则会被 sync 覆盖。

const root = path.resolve(__dirname, '..');
const configFile = path.join(root, 'ios', 'App', 'App', 'capacitor.config.json');

if (!fs.existsSync(configFile)) {
  console.error('找不到 ' + configFile);
  console.error('先跑 `npm run ios:setup` 和 `npx cap sync ios`，再执行本脚本。');
  process.exit(1);
}

const PLUGINS = [
  'ShuyinAudioPlugin',        // 听书 / 锁屏控制 / CAF 导出
  'ShuyinSecureStorePlugin',  // DeepSeek Key 存 Keychain
  'ShuyinOCRPlugin',          // 扫描版 PDF 走 Vision
  'ShuyinSharePlugin',        // 系统分享面板导出 EPUB
  'ShuyinNeuralTtsPlugin',    // 离线神经语音（sherpa-onnx）
];

const json = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (!Array.isArray(json.packageClassList)) json.packageClassList = [];

const added = [];
for (const name of PLUGINS) {
  if (!json.packageClassList.includes(name)) {
    json.packageClassList.push(name);
    added.push(name);
  }
}

fs.writeFileSync(configFile, JSON.stringify(json, null, '\t') + '\n', 'utf8');

if (added.length) {
  console.log('已登记原生插件：' + added.join(', '));
} else {
  console.log('四个原生插件已在 packageClassList 中，未改动');
}
console.log('packageClassList 共 ' + json.packageClassList.length + ' 项：' + json.packageClassList.join(', '));
