const esbuild=require('esbuild');const path=require('node:path');
esbuild.buildSync({entryPoints:[path.join(__dirname,'../www/native-audio-entry.js')],bundle:true,format:'iife',platform:'browser',target:['safari15'],outfile:path.join(__dirname,'../www/vendor/shuyin-audio.js')});
esbuild.buildSync({entryPoints:[path.join(__dirname,'../www/native-secure-store-entry.js')],bundle:true,format:'iife',platform:'browser',target:['safari15'],outfile:path.join(__dirname,'../www/vendor/shuyin-secure-store.js')});
esbuild.buildSync({entryPoints:[path.join(__dirname,'../www/native-ocr-entry.js')],bundle:true,format:'iife',platform:'browser',target:['safari15'],outfile:path.join(__dirname,'../www/vendor/shuyin-ocr.js')});
esbuild.buildSync({entryPoints:[path.join(__dirname,'../www/native-browser-entry.js')],bundle:true,format:'iife',platform:'browser',target:['safari15'],outfile:path.join(__dirname,'../www/vendor/shuyin-browser.js')});
console.log('Bundled Capacitor browser, audio, secure-store, OCR, and share bridges.');

esbuild.buildSync({entryPoints:[path.join(__dirname,'../www/native-share-entry.js')],bundle:true,format:'iife',platform:'browser',target:['safari15'],outfile:path.join(__dirname,'../www/vendor/shuyin-share.js')});
