const fs = require('node:fs');
const path = require('node:path');

// 把 App 内的四个原生插件接进 Xcode 工程的 App target：
//   PBXFileReference（文件引用）+ PBXBuildFile（构建文件）+ App 组 + PBXSourcesBuildPhase。
//
// 两个必须记住的坑（都在 v0.10.2 上踩过）：
//
// 1) `xcode` 库的 addSourceFile(path, opt, group) 第三个参数要的是 **PBXGroup 的 key（24 位 uuid）**，
//    不是组对象 —— `pbxGroupByName()` 返回的组对象上没有 `.uuid`。传 undefined 会退化成「无组」分支，
//    进而去找 `Plugins` 组，Capacitor 的工程里没有 → 崩 "Cannot read properties of null (reading 'path')"。
//
// 2) **`xcode@3` 的 `project.writeSync()` 只返回序列化字符串，不写盘**（旧版本才写盘）。
//    直接 `project.writeSync()` 等于把全部改动扔掉，且不报错 —— 表现是 CI 里构建"成功"，
//    但 App target 只编译了 AppDelegate.swift，四个插件静默缺失，运行期 NSClassFromString 拿到 nil。

const PLUGINS = [
  'ShuyinAudioPlugin.swift',
  'ShuyinSecureStorePlugin.swift',
  'ShuyinOCRPlugin.swift',
  'ShuyinSharePlugin.swift',
];

function groupKeyByName(project, name) {
  const groups = project.hash.project.objects.PBXGroup || {};
  for (const key of Object.keys(groups)) {
    if (!/_comment$/.test(key)) continue;   // 库内 COMMENT_KEY = /_comment$/
    if (groups[key] === name) return key.replace(/_comment$/, '');
  }
  return null;
}

function addPlugins({ projectPath, sourceDir, destDir }) {
  const project = require('xcode').project(projectPath);
  project.parseSync();

  const target = project.getFirstTarget().uuid;
  const groupKey = groupKeyByName(project, 'App');
  if (!groupKey) throw new Error('Xcode 工程中找不到 App 源码组');

  const added = [];
  const skipped = [];
  for (const name of PLUGINS) {
    const from = path.join(sourceDir, name);
    if (!fs.existsSync(from)) throw new Error('缺少原生插件源码：' + name);
    fs.copyFileSync(from, path.join(destDir, name));

    if (JSON.stringify(project.pbxFileReferenceSection()).includes(name)) {
      skipped.push(name);
      continue;
    }
    project.addSourceFile(name, { target, group: 'App' }, groupKey);
    added.push(name);
  }

  const serialized = project.writeSync();
  if (typeof serialized !== 'string' || serialized.length < 1000) {
    throw new Error('pbxproj 序列化结果异常（长度 ' + (serialized ? serialized.length : 0) + '）');
  }
  fs.writeFileSync(projectPath, serialized, 'utf8');

  // 立刻回读，确认真的落到盘上（writeSync 只序列化不写盘，这一步是唯一的保障）
  const onDisk = fs.statSync(projectPath).size;
  console.log('pbxproj 写入 ' + projectPath);
  console.log('  序列化 ' + serialized.length + ' 字符，磁盘 ' + onDisk + ' 字节');
  if (onDisk < 1000) throw new Error('pbxproj 落盘失败，磁盘上只有 ' + onDisk + ' 字节');

  return { added, skipped };
}

module.exports = { addPlugins, groupKeyByName, PLUGINS };
