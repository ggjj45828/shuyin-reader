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

// ①b 离线神经语音（sherpa-onnx）在 v0.10.11 暂停接入。
// 它是 v0.10.9 起「打开就是白屏」的头号嫌疑：接了 SPM 之后 App 包里会多出
// SherpaOnnxC.framework 与 onnxruntime.framework 两个第三方动态库，未签名 IPA
// 经重签工具处理后很容易在 dyld 加载阶段失败 —— 表现正是点开图标只有一片白。
// 先把它摘掉，用「App 能不能正常打开」来做一次干净的对照实验；
// 确认与它无关、并改用更稳的方式（例如按需下载的 xcframework）后再恢复。
//
// try {
//   const spm = addSwiftPackage({ projectPath: path.join(root, 'ios/App/App.xcodeproj/project.pbxproj') });
//   console.log(spm.added ? '已接入 Swift Package：sherpa-onnx' : 'Swift Package 已存在，跳过');
// } catch (error) {
//   console.log('接入 sherpa-onnx 失败（离线语音将不可用）：' + error.message);
// }
console.log('v0.10.11：离线神经语音（sherpa-onnx）暂停接入，本次不引入第三方动态库');

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

// ④ 启动图（LaunchScreen）改成墨绿底
// 作用有两个：一是白底启动图挂了看不出来，换成深色一眼就知道「卡在启动图」还是「页面白屏」；
// 二是万一 WebView 迟迟不出首帧，屏幕上至少是品牌色，不是让人以为 App 坏了的纯白。
// 只动 backgroundColor 一个字面量，不碰 storyboard 结构，编译风险最低。
try {
  const launch = path.join(destDir, 'Base.lproj', 'LaunchScreen.storyboard');
  if (fs.existsSync(launch)) {
    const raw = fs.readFileSync(launch, 'utf8');
    const green = 'red="0.1255" green="0.302" blue="0.2235" alpha="1" colorSpace="custom" customColorSpace="sRGB"';
    // Xcode 各版本的写法不一样：有的带 systemColor="systemBackgroundColor"，
    // 有的还多一个 cocoaTouchSystemColor="whiteColor"，有的干脆写死 red/green/blue。
    // 一律整段替换第一个 backgroundColor，不猜具体属性。
    const out = raw.replace(/<color key="backgroundColor"[^>]*\/>/,
      '<color key="backgroundColor" ' + green + '/>');
    if (out !== raw) {
      fs.writeFileSync(launch, out, 'utf8');
      console.log('启动图底色已改为墨绿 #204d39');
    } else {
      console.log('启动图底色未改动（未识别的 storyboard 写法，不影响构建）');
    }
  }
} catch (error) {
  console.log('改启动图底色失败（不影响构建）：' + error.message);
}

// ⑤ 原生启动探针：不经过 WebView，直接用 UIKit 画一屏，停 3.5 秒。
//
// 为什么非做不可：白屏查了三轮，全在网页侧打转，可「白屏」这个词本身什么都证明不了。
// 它可能是 ①App 根本没启动（安装/签名没成，点了图标就退）
//          ②启动图之后 WebView 没出首帧
//          ③网页跑起来了但没渲染
// 这三种的修法完全相反，继续猜就是浪费版本。探针把 ① 和 ②③ 切开：
// 只要能看到这屏墨绿大字，就证明 App 起来了、原生是活的，问题一定在网页侧；
// 看不到，就说明根本没跑起来，得去查安装和签名。
// 用 window.tag 做标记，保证一次进程只弹一次（切后台回来不再弹）。
try {
  const appDelegate = path.join(destDir, 'AppDelegate.swift');
  if (!fs.existsSync(appDelegate)) {
    console.log('没有 AppDelegate.swift，跳过启动探针');
  } else {
    let src = fs.readFileSync(appDelegate, 'utf8');
    if (src.includes('918273')) {
      console.log('启动探针已存在，跳过');
    } else {
      const version = pkg.version;
      // 需要 WKWebView 类型才能读网页地址和标题；模板里默认只有 UIKit/Capacitor。
      if (!src.includes('import WebKit')) {
        src = src.replace('import UIKit', 'import UIKit\nimport WebKit');
      }
      const probe = [
        '    func applicationDidBecomeActive(_ application: UIApplication) {',
        '        // 书隐诊断探针 v' + version + '：不再只证明「原生活着」，',
        '        // 而是把 WebView 的真实地址与标题读出来，直接判断网页到底加载了没有。',
        '        // 网页自检脚本会持续把状态写进 document.title（DIAG|阶段|shell|字数|ready|错误），',
        '        // 所以这一屏就是一份现成的现场报告。',
        '        guard let win = self.window, win.tag != 918273 else { return }',
        '        win.tag = 918273',
        '        let panel = UIView(frame: win.bounds)',
        '        panel.autoresizingMask = [.flexibleWidth, .flexibleHeight]',
        '        panel.backgroundColor = UIColor(red: 0.0784, green: 0.1059, blue: 0.0863, alpha: 1)',
        '        let label = UILabel(frame: panel.bounds.insetBy(dx: 20, dy: 70))',
        '        label.numberOfLines = 0',
        '        label.textAlignment = .left',
        '        label.textColor = UIColor.white',
        '        label.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)',
        '        let ver = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"',
        '        label.text = "书隐 v" + ver + "\\n\\n原生层已启动，正在读取网页状态…\\n\\n（这一屏停留 18 秒，请截图）"',
        '        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]',
        '        panel.addSubview(label)',
        '        win.addSubview(panel)',
        '        func findWebView(_ view: UIView) -> WKWebView? {',
        '            if let web = view as? WKWebView { return web }',
        '            for sub in view.subviews {',
        '                if let found = findWebView(sub) { return found }',
        '            }',
        '            return nil',
        '        }',
        '        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {',
        '            guard let web = findWebView(win) else {',
        '                label.text = "书隐 v" + ver + "\\n\\n没有找到 WKWebView\\n\\n说明 Capacitor 的网页视图根本没建起来 —— 问题在工程配置，不在网页代码。"',
        '                return',
        '            }',
        '            var report = "书隐 v" + ver + "\\n\\n"',
        '            report += "地址 " + (web.url?.absoluteString ?? "nil") + "\\n"',
        '            report += "窗口 " + NSStringFromCGRect(win.bounds) + "\\n"',
        '            report += "网页框 " + NSStringFromCGRect(web.frame) + "\\n"',
        '            report += "隐藏 " + (web.isHidden ? "是" : "否") + " · 透明 " + String(format: "%.1f", web.alpha) + "\\n"',
        '            report += "内边距 " + NSStringFromUIEdgeInsets(web.scrollView.contentInset) + "\\n\\n"',
        '            report += "标题 " + (web.title ?? "nil") + "\\n\\n"',
        '            label.text = report',
        '            let js = "(function(){var b=window.__shuyinBoot||{};var d=document.body?document.body.innerText:\'\';return \'状态 \'+document.readyState+\' | 阶段 \'+(b.stage||\'-\')+\' | 就绪 \'+(b.ready?1:0)+\' | 字数 \'+d.length+\' | 视口 \'+window.innerWidth+\'x\'+window.innerHeight+\' | 错误 \'+(window.__shuyinLastError||\'-\')})()"',
        '            web.evaluateJavaScript(js) { result, error in',
        '                if let text = result as? String {',
        '                    label.text = report + text',
        '                } else if let err = error {',
        '                    label.text = report + "JS 读取失败 " + err.localizedDescription',
        '                } else {',
        '                    label.text = report + "JS 返回空值"',
        '                }',
        '            }',
        '        }',
        '        DispatchQueue.main.asyncAfter(deadline: .now() + 18.0) {',
        '            UIView.animate(withDuration: 0.3, animations: { panel.alpha = 0 }) { _ in panel.removeFromSuperview() }',
        '        }',
        '    }'
      ].join('\n');
      const before = src;
      // 连前导缩进一起吃掉，避免 probe 的第一行比函数体多缩进一层
      src = src.replace(/\n    func applicationDidBecomeActive\(_ application: UIApplication\)\s*\{[\s\S]*?\n    \}/,
        '\n' + probe);
      if (src === before) {
        console.log('启动探针注入失败：AppDelegate 里没匹配到 applicationDidBecomeActive（不影响构建）');
      } else {
        fs.writeFileSync(appDelegate, src, 'utf8');
        console.log('启动探针已注入 AppDelegate（原生诊断层 3.5 秒 · v' + version + '）');
      }
    }
  }
} catch (error) {
  console.log('注入启动探针失败（不影响构建）：' + error.message);
}

console.log('iOS 工程已配置书隐锁屏语音、安全 Keychain、本机 OCR、系统分享面板与后台音频模式。');
