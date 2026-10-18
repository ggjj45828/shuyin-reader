const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform!=='darwin')throw Error('生成/编译 iOS 原生工程必须在 macOS 上运行；Windows 只能编辑和检查源码。');
if(!fs.existsSync(path.join(root,'ios','App','App.xcodeproj'))){execFileSync(path.join(root,'node_modules','.bin','cap'),['add','ios'],{cwd:root,stdio:'inherit'})}
const projectPath=path.join(root,'ios/App/App.xcodeproj/project.pbxproj');
const project=require('xcode').project(projectPath);project.parseSync();
const appTarget=project.getFirstTarget().uuid;
const swiftPath=path.join(root,'ios/App/App/ShuyinAudioPlugin.swift');
fs.copyFileSync(path.join(root,'native/ios/ShuyinAudioPlugin.swift'),swiftPath);
const relative='ShuyinAudioPlugin.swift';
const appGroup=project.pbxGroupByName('App');
if(!appGroup)throw Error('Xcode 工程中找不到 App 源码组');
if(!JSON.stringify(project.pbxFileReferenceSection()).includes('ShuyinAudioPlugin.swift'))project.addSourceFile(relative,{target:appTarget},appGroup.uuid);
const securePath=path.join(root,'ios/App/App/ShuyinSecureStorePlugin.swift');
fs.copyFileSync(path.join(root,'native/ios/ShuyinSecureStorePlugin.swift'),securePath);
if(!JSON.stringify(project.pbxFileReferenceSection()).includes('ShuyinSecureStorePlugin.swift'))project.addSourceFile('ShuyinSecureStorePlugin.swift',{target:appTarget},appGroup.uuid);
const ocrPath=path.join(root,'ios/App/App/ShuyinOCRPlugin.swift');
fs.copyFileSync(path.join(root,'native/ios/ShuyinOCRPlugin.swift'),ocrPath);
if(!JSON.stringify(project.pbxFileReferenceSection()).includes('ShuyinOCRPlugin.swift'))project.addSourceFile('ShuyinOCRPlugin.swift',{target:appTarget},appGroup.uuid);
const sharePath=path.join(root,'ios/App/App/ShuyinSharePlugin.swift');
fs.copyFileSync(path.join(root,'native/ios/ShuyinSharePlugin.swift'),sharePath);
if(!JSON.stringify(project.pbxFileReferenceSection()).includes('ShuyinSharePlugin.swift'))project.addSourceFile('ShuyinSharePlugin.swift',{target:appTarget},appGroup.uuid);
fs.writeFileSync(projectPath,project.writeSync());
const controller=path.join(root,'ios/App/App/MainViewController.swift');
let src=fs.readFileSync(controller,'utf8');
if(!src.includes('registerPluginInstance(ShuyinAudioPlugin()')||!src.includes('registerPluginInstance(ShuyinSecureStorePlugin()')||!src.includes('registerPluginInstance(ShuyinOCRPlugin()')||!src.includes('registerPluginInstance(ShuyinSharePlugin()')){
  const method=`\n    override func capacitorDidLoad() {\n        bridge?.registerPluginInstance(ShuyinAudioPlugin())\n        bridge?.registerPluginInstance(ShuyinSecureStorePlugin())\n        bridge?.registerPluginInstance(ShuyinOCRPlugin())
        bridge?.registerPluginInstance(ShuyinSharePlugin())\n    }\n`;
  if(src.includes('override func capacitorDidLoad()'))src=src.replace(/override func capacitorDidLoad\(\)\s*\{[\s\S]*?\n\s*\}/,method.trim());
  else src=src.replace(/\}\s*$/,`${method}}\n`);
  fs.writeFileSync(controller,src);
}
const plist=path.join(root,'ios/App/App/Info.plist');
const data=require('node:child_process').execFileSync('/usr/bin/plutil',['-convert','xml1','-o','-',plist],{encoding:'utf8'});
let updated=data;
const settings=[['UIBackgroundModes','<key>UIBackgroundModes</key><array><string>audio</string></array>'],['UIFileSharingEnabled','<key>UIFileSharingEnabled</key><true/>'],['LSSupportsOpeningDocumentsInPlace','<key>LSSupportsOpeningDocumentsInPlace</key><true/>'],['NSAppTransportSecurity','<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/><key>NSAllowsLocalNetworking</key><true/></dict>']];
for(const [key,entry] of settings)if(!updated.includes(`<key>${key}</key>`))updated=updated.replace('</dict>',`${entry}\n</dict>`);
if(updated!==data){const temp=plist+'.tmp';fs.writeFileSync(temp,updated);execFileSync('/usr/bin/plutil',['-lint',temp],{stdio:'inherit'});fs.renameSync(temp,plist)}
console.log('iOS 工程已配置书隐锁屏语音、安全 Keychain、本机 OCR、系统分享面板与后台音频模式。');
