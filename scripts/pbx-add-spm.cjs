/**
 * 把 sherpa-onnx 作为 Swift Package 依赖接进 Capacitor 生成的 Xcode 工程。
 *
 * 为什么必须自己改 pbxproj：Capacitor 7 的模板只声明了 App target，
 * `xcode` 这个 npm 库也不支持 Swift Package（只有旧的 PBX 对象 API）。
 * 所以要写三样东西：
 *   1) PBXBuildFile + PBXFrameworksBuildPhase.files —— 让框架真的被链接；
 *   2) XCSwiftPackageProductDependency + XCRemoteSwiftPackageReference —— 声明依赖；
 *   3) PBXProject.packageReferences 与 PBXNativeTarget.packageProductDependencies —— 把它们挂到工程和 target 上。
 *
 * 四个都要有，少一个就是「编译通过但 import SherpaOnnx 报找不到模块」。
 * 函数做成幂等的：重复跑不会插入第二次。
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

const PACKAGE_URL = 'https://github.com/k2-fsa/sherpa-onnx';
const PACKAGE_VERSION = '1.13.8';
const PRODUCT_NAME = 'sherpa-onnx';

const id = (seed) => crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24).toUpperCase();

function addSwiftPackage({ projectPath, url = PACKAGE_URL, version = PACKAGE_VERSION, product = PRODUCT_NAME } = {}) {
  if (!fs.existsSync(projectPath)) throw Error('找不到 pbxproj：' + projectPath);
  let text = fs.readFileSync(projectPath, 'utf8');
  if (text.includes('XCRemoteSwiftPackageReference "sherpa-onnx"')) {
    return { added: false, reason: 'already' };
  }

  const refId = id('sherpa-onnx-ref');          // XCRemoteSwiftPackageReference
  const productId = id('sherpa-onnx-product');  // XCSwiftPackageProductDependency
  const buildFileId = id('sherpa-onnx-buildfile');

  // 1) PBXBuildFile
  const buildFile = `\t\t${buildFileId} /* ${product} in Frameworks */ = {isa = PBXBuildFile; productRef = ${productId} /* ${product} */; };\n`;
  if (!text.includes('/* Begin PBXBuildFile section */')) throw Error('pbxproj 结构不认识：缺 PBXBuildFile 段');
  text = text.replace('/* Begin PBXBuildFile section */\n', '/* Begin PBXBuildFile section */\n' + buildFile);

  // 2) 挂到 App target 的 Frameworks 构建阶段
  const frameworksPhase = /([0-9A-F]{24}) \/\* Frameworks \*\/ = \{\s*isa = PBXFrameworksBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/;
  const match = text.match(frameworksPhase);
  if (!match) throw Error('找不到 App target 的 Frameworks 阶段');
  const injectedFiles = match[2] + `\t\t\t\t${buildFileId} /* ${product} in Frameworks */,\n\t\t\t`;
  text = text.replace(match[0], match[0].replace(match[2], injectedFiles));

  // 3) PBXNativeTarget.packageProductDependencies（App target）
  const targetRe = /(isa = PBXNativeTarget;[\s\S]*?name = App;[\s\S]*?)(\n\t\t\};)/;
  if (!targetRe.test(text)) throw Error('找不到 App 的 PBXNativeTarget');
  text = text.replace(targetRe, (full, body, tail) => {
    if (body.includes('packageProductDependencies')) return full;
    return body + `\n\t\t\tpackageProductDependencies = (\n\t\t\t\t${productId} /* ${product} */,\n\t\t\t);` + tail;
  });

  // 4) PBXProject.packageReferences
  // 注意：Xcode 15 的模板里本来就有一条**空的** packageReferences = ( );，
  // 只判断键名存在会直接跳过，写出来的引用是空的 —— 编译时报
  // "Missing package product"，但 pbxproj 看起来什么都有。必须单独处理空列表。
  const projectRe = /(isa = PBXProject;[\s\S]*?)(\n\t\t\};)/;
  if (!projectRe.test(text)) throw Error('找不到 PBXProject');
  text = text.replace(projectRe, (full, body, tail) => {
    if (/packageReferences = \(\s*\);/.test(body)) {
      return body.replace(/packageReferences = \(\s*\);/, `packageReferences = (\n\t\t\t\t${refId} /* XCRemoteSwiftPackageReference "${product}" */,\n\t\t\t);`) + tail;
    }
    if (body.includes('packageReferences')) return full;
    return body + `\n\t\t\tpackageReferences = (\n\t\t\t\t${refId} /* XCRemoteSwiftPackageReference "${product}" */,\n\t\t\t);` + tail;
  });

  // 5) 两个新段
  const refSection = `/* Begin XCRemoteSwiftPackageReference section */\n` +
    `\t\t${refId} /* XCRemoteSwiftPackageReference "${product}" */ = {\n` +
    `\t\t\tisa = XCRemoteSwiftPackageReference;\n` +
    `\t\t\trepositoryURL = "${url}";\n` +
    `\t\t\trequirement = {\n\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = ${version};\n\t\t\t};\n` +
    `\t\t};\n/* End XCRemoteSwiftPackageReference section */\n`;
  const productSection = `/* Begin XCSwiftPackageProductDependency section */\n` +
    `\t\t${productId} /* ${product} */ = {\n` +
    `\t\t\tisa = XCSwiftPackageProductDependency;\n` +
    `\t\t\tpackage = ${refId} /* XCRemoteSwiftPackageReference "${product}" */;\n` +
    `\t\t\tproductName = "${product}";\n` +
    `\t\t};\n/* End XCSwiftPackageProductDependency section */\n`;

  if (!text.includes('/* Begin XCRemoteSwiftPackageReference section */')) {
    text = text.replace('/* End PBXProject section */\n', '/* End PBXProject section */\n' + refSection + productSection);
  }

  fs.writeFileSync(projectPath, text);
  return { added: true, refId, productId, buildFileId };
}

module.exports = { addSwiftPackage };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) throw Error('用法：node pbx-add-spm.cjs ios/App/App.xcodeproj/project.pbxproj');
  console.log(JSON.stringify(addSwiftPackage({ projectPath: target })));
}
