const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { addPlugins } = require('./pbx-add-plugins.cjs');
const { addSwiftPackage } = require('./pbx-add-spm.cjs');

const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') throw Error('生成/编译 iOS 原生工程必须在 macOS 上运行；Windows 只能编辑和检查源码。');

if (!fs.existsSync(path.join(root, 'ios', 'App', 'App.xcodeproj'))) {
  execFileSync(path.join(root, 'node_modules', '.bin', 'cap'), ['add', 'ios'], { cwd: root, stdio: 'inherit' });
}

const destDir = path.join(root, 'ios', 'App', 'App');

// ① 四个原生插件接进 App target（细节与踩坑注释见 scripts/pbx-add-plugins.cjs）
const { added, skipped } = addPlugins({
  projectPath: path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'),
  sourceDir: path.join(root, 'native', 'ios'),
  destDir,
});
if (added.length) console.log('已接入 App target：' + added.join(', '));
if (skipped.length) console.log('已存在，跳过：' + skipped.join(', '));

// ①b 离线语音需要 sherpa-onnx，走 Swift Package（binaryTarget 是官方 iOS 静态 xcframework）
try {
  const spm = addSwiftPackage({ projectPath: path.join(root, 'ios/App/App.xcodeproj/project.pbxproj') });
  console.log(spm.added ? '已接入 Swift Package：sherpa-onnx' : 'Swift Package 已存在，跳过');
} catch (error) {
  console.log('接入 sherpa-onnx 失败（离线语音将不可用）：' + error.message);
}

// 插件**注册**不在这里：Capacitor 7 的 iOS 模板只有 AppDelegate.swift + Info.plist，
// 没有 MainViewController / capacitorDidLoad 可覆写。注册改由
// scripts/register-native-plugins.cjs 写进 capacitor.config.json 的 packageClassList，
// 且必须在 `cap sync` **之后**跑（见 package.json 的 ios:sync）。

// ①c 最低系统抬到 iOS 15.0：sherpa-onnx 的 xcframework 就是 15.0 起的，
// 留在 14.0 会报 "compiling for iOS 14.0, but module 'SherpaOnnx' has a minimum deployment target of iOS 15.0"
try {
  const pbxPath = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
  const pbx = fs.readFileSync(pbxPath, 'utf8');
  const bumped = pbx.replace(/IPHONEOS_DEPLOYMENT_TARGET = 1[0-4]\.\d;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
  if (bumped !== pbx) {
    fs.writeFileSync(pbxPath, bumped);
    console.log('最低系统已抬到 iOS 15.0');
  }
} catch (error) {
  console.log('抬高最低系统失败：' + error.message);
}

// ② 版本号：Capacitor 模板默认 1.0 / 1，必须从 package.json 灌进去，否则包内全是 1.0
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const plist = path.join(destDir, 'Info.plist');
const buildNumber = process.env.GITHUB_RUN_NUMBER || String(pkg.version).replace(/\D/g, '') || '1';
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleShortVersionString ' + pkg.version, plist]);
execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleVersion ' + buildNumber, plist]);
console.log('版本号写入 Info.plist：' + pkg.version + ' (build ' + buildNumber + ')');

// ③ Info.plist 补充：后台音频、文件共享、本地网络 HTTP
const data = execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plist], { encoding: 'utf8' });
let updated = data;
const settings = [
  ['UIBackgroundModes', '<key>UIBackgroundModes</key><array><string>audio</string></array>'],
  ['UIFileSharingEnabled', '<key>UIFileSharingEnabled</key><true/>'],
  ['LSSupportsOpeningDocumentsInPlace', '<key>LSSupportsOpeningDocumentsInPlace</key><true/>'],
  ['NSAppTransportSecurity', '<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/><key>NSAllowsLocalNetworking</key><true/></dict>'],
];
for (const [key, entry] of settings) {
  if (!updated.includes('<key>' + key + '</key>')) updated = updated.replace('</dict>', entry + '\n</dict>');
}
if (updated !== data) {
  const temp = plist + '.tmp';
  fs.writeFileSync(temp, updated);
  execFileSync('/usr/bin/plutil', ['-lint', temp], { stdio: 'inherit' });
  fs.renameSync(temp, plist);
  console.log('已补 Info.plist：后台音频 / 文件共享 / 本地网络 HTTP');
}

console.log('iOS 工程已配置书隐锁屏语音、安全 Keychain、本机 OCR、系统分享面板与后台音频模式。');
