/* Device-local import of books. Does not upload files to NAS. */
async function parseLocalBook(file,ext,options={}){
  if(['txt','md','markdown'].includes(ext))return {content:await file.text(),metadata:{}};
  if(['html','htm'].includes(ext)){
    const doc=new DOMParser().parseFromString(await file.text(),'text/html');
    doc.querySelectorAll('script,style,iframe,nav').forEach(n=>n.remove());
    return {content:(doc.body?.textContent||'').trim(),metadata:{}};
  }
  if(ext==='fb2'){
    const doc=new DOMParser().parseFromString(await file.text(),'application/xml');
    if(doc.querySelector('parsererror'))throw Error('FB2 文件 XML 格式错误');
    const title=doc.querySelector('book-title')?.textContent?.trim();
    const body=[...doc.querySelectorAll('body')].map(el=>[...el.querySelectorAll('title,p,subtitle')].map(x=>x.textContent.trim()).filter(Boolean).join('\n\n')).join('\n\n');
    return {content:body,metadata:title?{title}:{}};
  }
  if(ext==='pdf'){
    if(!window.pdfjsLib)throw Error('PDF 离线解析模块未安装，请运行 npm install');
    const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    const pages=[],visionOcrAvailable=!!(window.Capacitor?.isNativePlatform?.()&&(window.ShuyinOCR||window.Capacitor?.Plugins?.ShuyinOCR));let usedOCR=false;
    try{for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i),data=await page.getTextContent();
      const line=data.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim();
      if(line.length>20){pages.push(line);page.cleanup();options.onProgress?.(i,pdf.numPages,'读取文字');continue}
      const ocr=window.Capacitor?.isNativePlatform?.()?(window.ShuyinOCR||window.Capacitor?.Plugins?.ShuyinOCR):null;
      if(!ocr?.recognize){throw Error(`第 ${i} 页没有可提取文字；扫描版 PDF 请使用书隐 iOS App 本机 Vision OCR 导入`)}
      const viewport=page.getViewport({scale:1}),scale=Math.min(2,1600/viewport.width),renderViewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(renderViewport.width);canvas.height=Math.ceil(renderViewport.height);
      const context=canvas.getContext('2d',{alpha:false});
      await page.render({canvasContext:context,viewport:renderViewport}).promise;
      const imageBase64=canvas.toDataURL('image/jpeg',0.78).split(',')[1];canvas.width=0;canvas.height=0;
      const result=await ocr.recognize({imageBase64});
      usedOCR=true;
      const recognized=String(result?.text||'').trim();if(recognized)pages.push(recognized);else if(line)pages.push(line);
      page.cleanup();options.onProgress?.(i,pdf.numPages,'OCR');
    }}finally{await pdf.destroy()}
    if(!pages.length)throw Error(visionOcrAvailable?'PDF 页面未识别出可读文字':'这是扫描版 PDF；请在书隐 iOS App 中使用本机 Vision OCR 导入');
    return {content:pages.join('\n\n'),metadata:{ocr:usedOCR}};
  }
  if(ext==='docx'){
    if(!window.mammoth)throw Error('DOCX 离线解析模块未安装，请运行 npm install');
    const result=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    const content=String(result.value||'').trim();
    if(!content)throw Error('DOCX 中没有可提取的正文');
    return {content,metadata:{}};
  }
  if(ext==='epub'){
    if(!window.JSZip)throw Error('EPUB 离线解析模块未安装，请运行 npm install');
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const xml=src=>new DOMParser().parseFromString(src,'application/xml');
    const container=zip.file('META-INF/container.xml');
    if(!container)throw Error('缺少 EPUB 容器索引');
    const containerDoc=xml(await container.async('text'));
    const opfPath=containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if(!opfPath||!zip.file(opfPath))throw Error('找不到 EPUB 内容索引');
    const opf=xml(await zip.file(opfPath).async('text'));
    const manifest=new Map([...opf.getElementsByTagName('*')].filter(n=>n.localName==='item').map(n=>[n.getAttribute('id'),n.getAttribute('href')]));
    const ids=[...opf.getElementsByTagName('*')].filter(n=>n.localName==='itemref').map(n=>n.getAttribute('idref'));
    const dir=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')+1):'';
    const resolvePath=href=>{const parts=[];for(const part of (dir+decodeURIComponent(href.split('#')[0])).split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part)}return parts.join('/')};
    const chapters=[];
    for(const id of ids){
      const href=manifest.get(id);if(!href)continue;
      const entry=zip.file(resolvePath(href));if(!entry)continue;
      const doc=new DOMParser().parseFromString(await entry.async('text'),'text/html');
      doc.querySelectorAll('script,style,svg,nav').forEach(n=>n.remove());
      const text=(doc.body?.textContent||doc.documentElement?.textContent||'').replace(/[ \t]+/g,' ').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
      if(text)chapters.push(text);
      if(chapters.join('').length>12_000_000)throw Error('正文过大，超过本地导入安全限制');
    }
    if(!chapters.length)throw Error('EPUB 没有可读取的章节');
    const meta=[...opf.getElementsByTagName('*')];
    const title=meta.find(n=>n.localName==='title')?.textContent?.trim();
    const author=meta.find(n=>n.localName==='creator')?.textContent?.trim();
    return {content:chapters.join('\n\n'),metadata:{...(title?{title}:{}),...(author?{author}:{})}};
  }
  throw Error(`${ext.toUpperCase()} 本地解析暂未实现，不能将空正文加入书架`);
}
