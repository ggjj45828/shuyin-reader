const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') throw Error('生成/编译 iOS 原生工程必须在 macOS 上运行；Windows 只能编辑和检查源码。');

if (!fs.existsSync(path.join(root, 'ios', 'App', 'App.xcodeproj'))) {
  execFileSync(path.join(root, 'node_modules', '.bin', 'cap'), ['add', 'ios'], { cwd: root, stdio: 'inherit' });
}

const projectPath = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
const project = require('xcode').project(projectPath);
project.parseSync();
const appTarget = project.getFirstTarget().uuid;

// 取 PBXGroup 的 **key（uuid 字符串）**。
// 踩坑记录：`xcode` 库的 addSourceFile(path, opt, group) 里，group 必须是这个 key；
// `pbxGroupByName()` 返回的组对象上并没有 `.uuid` 属性。原先传 `appGroup.uuid` 得到 undefined，
// addSourceFile 于是退化成「无组」分支 → addPluginFile → correctForPluginsPath，
// 而 Capacitor 生成的工程里没有 `Plugins` 组 → pbxGroupByName('Plugins') 返回 null
// → 崩在 "Cannot read properties of null (reading 'path')"（CI run 39113350081）。
//
// 键的形态：hash 里同时存在 `"<24位uuid>"` 与 `"<24位uuid>_comment"` 两份，
// 后者是名字（库里的 COMMENT_KEY = /_comment$/）。所以按 _comment 后缀找名字，再切掉后缀。
function groupKeyByName(project, name) {
  const groups = project.hash.project.objects.PBXGroup || {};
  for (const key of Object.keys(groups)) {
    if (!/_comment$/.test(key)) continue;
    if (groups[key] === name) return key.replace(/_comment$/, '');
  }
  return null;
}

const groupKey = groupKeyByName(project, 'App');
if (!groupKey) throw Error('Xcode 工程中找不到 App 源码组');

const nativeDir = path.join(root, 'native', 'ios');
const destDir = path.join(root, 'ios', 'App', 'App');
const plugins = [
  'ShuyinAudioPlugin.swift',
  'ShuyinSecureStorePlugin.swift',
  'ShuyinOCRPlugin.swift',
  'ShuyinSharePlugin.swift',
];

for (const name of plugins) {
  if (!fs.existsSync(path.join(nativeDir, name))) throw Error('缺少原生插件源码：' + name);
  fs.copyFileSync(path.join(nativeDir, name), path.join(destDir, name));
  if (!JSON.stringify(project.pbxFileReferenceSection()).includes(name)) {
    project.addSourceFile(name, { target: appTarget, group: 'App' }, groupKey);
    console.log('已登记插件：' + name);
  } else {
    console.log('已存在，跳过：' + name);
  }
}

project.writeSync();

// 注册插件实例：MainViewController 里必须有四个 registerPluginInstance
const controller = path.join(destDir, 'MainViewController.swift');
let src = fs.readFileSync(controller, 'utf8');
const needed = [
  'registerPluginInstance(ShuyinAudioPlugin()',
  'registerPluginInstance(ShuyinSecureStorePlugin()',
  'registerPluginInstance(ShuyinOCRPlugin()',
  'registerPluginInstance(ShuyinSharePlugin()',
];
if (!needed.every((token) => src.includes(token))) {
  const body = [
    '    override func capacitorDidLoad() {',
    '        bridge?.registerPluginInstance(ShuyinAudioPlugin())',
    '        bridge?.registerPluginInstance(ShuyinSecureStorePlugin())',
    '        bridge?.registerPluginInstance(ShuyinOCRPlugin())',
    '        bridge?.registerPluginInstance(ShuyinSharePlugin())',
    '    }',
  ].join('\n');
  if (src.includes('override func capacitorDidLoad()')) {
    src = src.replace(/override func capacitorDidLoad\(\)\s*\{[\s\S]*?\n\s*\}/, body.trim());
  } else {
    src = src.replace(/\}\s*$/, body + '\n}\n');
  }
  fs.writeFileSync(controller, src);
  console.log('已写入 capacitorDidLoad 插件注册');
}

// Info.plist：后台音频、文件共享、本地网络 HTTP
const plist = path.join(destDir, 'Info.plist');
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
