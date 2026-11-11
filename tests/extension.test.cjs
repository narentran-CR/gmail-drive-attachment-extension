const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const base=fs.existsSync('manifest.json')?'.':'work/fixed';
const manifest=JSON.parse(fs.readFileSync(`${base}/manifest.json`));
const id='cddcchndhodbleloafloodfhodffmlhh';
const scope=manifest.oauth2.scopes[0];
const gmail={id,tab:{id:1},frameId:0,documentId:'draft',url:'https://mail.google.com/mail/u/0/'};
const popup={id,url:`chrome-extension://${id}/popup.html`};
function harness(options={},saved={}){
 let handler,removed=0,cleared=0;const calls=[],authCalls=[];
 const chrome={runtime:{id,getManifest:()=>manifest,getURL:p=>`chrome-extension://${id}/${p}`,onMessage:{addListener:f=>handler=f}},
 identity:{getAuthToken:async d=>{authCalls.push(d);if(options.authError)throw Error(options.authError);return options.authResult||{token:'mock-token',grantedScopes:[scope]};},removeCachedAuthToken:async()=>removed++,clearAllCachedAuthTokens:async()=>cleared++},
 storage:{session:{get:async k=>({[k]:saved[k]&&structuredClone(saved[k])}),set:async v=>Object.assign(saved,structuredClone(v)),remove:async k=>delete saved[k]}}};
 const context=vm.createContext({chrome,crypto,URL,Uint8Array,AbortSignal,console,fetch:async(url,opts)=>{calls.push({url,opts});return options.fetch?options.fetch(url,opts,calls.length):new Response(JSON.stringify({user:{emailAddress:'test@example.com'}}));}});
 vm.runInContext(fs.readFileSync(`${base}/background.js`,'utf8'),context);
 const send=(m,s=gmail)=>new Promise(resolve=>{assert.equal(handler(m,s,resolve),true);});
 return {send,calls,authCalls,saved,get removed(){return removed},get cleared(){return cleared}};
}
const sessionState=()=>({upload:{location:'https://www.googleapis.com/upload/test',size:2097153,name:'sample',offset:0,owner:'1:0:draft',touched:Date.now()}});
test('public key fixes extension identity and contains no private key',()=>{const computed=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));assert.equal(computed,id);assert.equal(manifest.permissions.join(','),'identity,storage');assert(!JSON.stringify(manifest).includes('PRIVATE KEY'));});
test('popup diagnostics make no token request',async()=>{const h=harness();const r=await h.send({type:'STATUS'},popup);assert.equal(r.extensionId,id);assert.equal(h.authCalls.length,0);});
test('connect requests interactive consent and checks Drive API',async()=>{const h=harness();const r=await h.send({type:'AUTH'},popup);assert(r.ok);assert.equal(r.email,'test@example.com');assert.equal(h.authCalls[0].interactive,true);assert.equal(h.calls.length,1);});
test('reconnect clears old credentials',async()=>{const h=harness();assert((await h.send({type:'RECONNECT'},popup)).ok);assert.equal(h.cleared,1);});
test('revoked permission gives actionable error',async()=>{const h=harness({authError:'OAuth2 not granted or revoked.'});const r=await h.send({type:'START',name:'x',size:2097153});assert(!r.ok);assert.match(r.error,/Connect Google Drive/);assert.equal(h.calls.length,0);assert.equal(h.authCalls[0].interactive,false);});
test('bad client gives Item ID diagnosis',async()=>{const h=harness({authError:'bad client id'});assert.match((await h.send({type:'AUTH'},popup)).error,/Item ID/);});
test('denied granular scope is rejected',async()=>{const h=harness({authResult:{token:'mock',grantedScopes:[]}});assert.match((await h.send({type:'AUTH'},popup)).error,/not selected/);assert.equal(h.calls.length,0);});
test('401 invalidates cached token and retries once',async()=>{const h=harness({fetch:(_u,_o,n)=>new Response(JSON.stringify({user:{}}),{status:n===1?401:200})});assert((await h.send({type:'AUTH'},popup)).ok);assert.equal(h.removed,1);assert.equal(h.calls.length,2);});
test('repeated 401 does not loop',async()=>{const h=harness({fetch:()=>new Response('{}',{status:401})});assert(!(await h.send({type:'AUTH'},popup)).ok);assert.equal(h.calls.length,2);});
test('web content cannot open consent',async()=>{const h=harness();assert(!(await h.send({type:'AUTH'})).ok);assert.equal(h.authCalls.length,0);});
test('foreign sender and non Gmail denied',async()=>{const h=harness();assert(!(await h.send({type:'START'},{...gmail,id:'other'})).ok);assert(!(await h.send({type:'START'},{...gmail,url:'https://evil.example/'})).ok);});
test('2 MiB threshold is strict',async()=>{const h=harness();for(const size of [0,2097152,-1,NaN,Infinity])assert(!(await h.send({type:'START',name:'x',size})).ok);assert.equal(h.calls.length,0);});
test('upload session saved without token',async()=>{const h=harness({fetch:()=>new Response(null,{headers:{Location:'https://www.googleapis.com/upload/test'}})});const r=await h.send({type:'START',name:'x',size:2097153});assert(r.ok);assert(h.saved[r.uploadId]);assert(!JSON.stringify(h.saved).includes('mock-token'));});
test('upload URL cannot leak bearer to other origin',async()=>{const h=harness({fetch:()=>new Response(null,{headers:{Location:'https://evil.example/upload'}})});assert(!(await h.send({type:'START',name:'x',size:2097153})).ok);});
test('wrong tab cannot use session',async()=>{const h=harness({},sessionState());assert(!(await h.send({type:'CANCEL',uploadId:'upload'},{...gmail,tab:{id:2}})).ok);assert(h.saved.upload);});
test('expired session rejected',async()=>{const saved=sessionState();saved.upload.touched=0;const h=harness({},saved);assert(!(await h.send({type:'CHUNK',uploadId:'upload',offset:0,data:[1]})).ok);});
test('bad chunks rejected without network',async()=>{const h=harness({},sessionState());for(const [offset,data]of [[1,[1]],[0,[256]],[0,[-1]],[0,[1.5]],[0,[]],[0,[1]]])assert(!(await h.send({type:'CHUNK',uploadId:'upload',offset,data})).ok);assert.equal(h.calls.length,0);});
test('confirmed chunk persists across worker restart',async()=>{const saved=sessionState();let h=harness({fetch:()=>new Response(null,{status:308,headers:{Range:'bytes=0-524287'}})},saved);assert((await h.send({type:'CHUNK',uploadId:'upload',offset:0,data:Array(524288).fill(0)})).ok);h=harness({fetch:()=>new Response(null,{status:308,headers:{Range:'bytes=0-1048575'}})},saved);assert((await h.send({type:'CHUNK',uploadId:'upload',offset:524288,data:Array(524288).fill(0)})).ok);assert.equal(saved.upload.offset,1048576);});
test('missing acknowledgement does not advance offset',async()=>{const h=harness({fetch:()=>new Response(null,{status:308})},sessionState());assert(!(await h.send({type:'CHUNK',uploadId:'upload',offset:0,data:Array(524288).fill(0)})).ok);assert.equal(h.saved.upload.offset,0);});
test('early success is rejected',async()=>{const h=harness({fetch:()=>new Response('{"id":"file"}')},sessionState());assert(!(await h.send({type:'CHUNK',uploadId:'upload',offset:0,data:Array(524288).fill(0)})).ok);});
test('final upload chunk returns file and public link only after permission succeeds',async()=>{const saved=sessionState();saved.upload.offset=2097152;const h=harness({fetch:(u)=>new Response(JSON.stringify({id:u.includes('permissions')?'permission':'file'}))},saved);const r=await h.send({type:'CHUNK',uploadId:'upload',offset:2097152,data:[42]});assert(r.complete);const shared=await h.send({type:'SHARE',uploadId:'upload'});assert.equal(shared.url,'https://drive.google.com/file/d/file/view');assert.equal(JSON.parse(h.calls[1].opts.body).role,'reader');});
test('sharing cannot operate on arbitrary file IDs',async()=>{const h=harness({},sessionState());assert(!(await h.send({type:'SHARE',uploadId:'upload',fileId:'other'})).ok);assert.equal(h.calls.length,0);});
test('sharing policy failure reports retained private file',async()=>{const saved=sessionState();saved.upload.fileId='file';const h=harness({fetch:()=>new Response('{"error":{"message":"Domain policy"}}',{status:403})},saved);const r=await h.send({type:'SHARE',uploadId:'upload'});assert(!r.ok);assert.match(r.error,/private file/);assert(!r.url);});
test('cancel removes local session only',async()=>{const h=harness({},sessionState());assert((await h.send({type:'CANCEL',uploadId:'upload'})).ok);assert(!h.saved.upload);assert.equal(h.calls.length,0);});

function contentHarness({approve=true,connected=true,brokenTransfer=false,composerExists=true,failUpload=false}={}){
 const handlers={},messages=[],notices=[],links=[];let confirms=0,stopped=false;
 class Input{constructor(files){this.type='file';this.files=files;}closest(){return composerExists?composer:null;}dispatchEvent(e){e.target=this;handlers.change(e);}}
 const editor={focus(){},dispatchEvent(){}};
 const composer={isConnected:true,querySelector:()=>editor};
 const selection={removeAllRanges(){},addRange(){}};
 function node(tag){return {tag,style:{},append(...n){if(tag==='span')links.push(...n.filter(x=>x?.tag==='a'));},remove(){}};}
 const document={addEventListener:(n,f)=>handlers[n]=f,querySelectorAll:()=>[],getSelection:()=>selection,createRange:()=>({selectNodeContents(){},collapse(){},insertNode(){}}),createElement:node,createTextNode:s=>s,documentElement:{append:n=>notices.push(n.textContent)}};
 const chrome={runtime:{id:connected?'id':undefined,sendMessage:(m,cb)=>{messages.push(m);queueMicrotask(()=>cb(failUpload?{ok:false,error:'Connect Google Drive'}:{ok:true,...({START:{uploadId:'upload'},CHUNK:{complete:true,fileId:'file'},SHARE:{url:'https://drive.google.com/file/d/file/view'},CANCEL:{}}[m.type])}));}}};
 class Transfer{constructor(){if(brokenTransfer)throw Error('unsupported');this.files=[];this.items={add:f=>this.files.push(f)};}}
 vm.runInNewContext(fs.readFileSync(`${base}/content.js`,'utf8'),{document,chrome,HTMLInputElement:Input,DataTransfer:Transfer,window:{confirm:()=>{confirms++;return approve;}},location:{hostname:'mail.google.com'},console,Uint8Array,Event:class{constructor(type){this.type=type;}},InputEvent:class{},setTimeout:()=>{}});
 function change(files){const input=new Input(files);handlers.change({target:input,stopImmediatePropagation:()=>stopped=true,stopPropagation(){}});return input;}
 return {change,messages,notices,links,get stopped(){return stopped},get confirms(){return confirms}};
}
const file=size=>({name:'sample.txt',size,type:'text/plain',slice:(a,b)=>({arrayBuffer:async()=>new ArrayBuffer(Math.min(size,b)-a)})});
const settle=()=>new Promise(r=>setImmediate(r));
test('small and exactly threshold files stay native',()=>{const h=contentHarness();h.change([file(5),file(2097152)]);assert(!h.stopped);assert.equal(h.confirms,0);assert.equal(h.messages.length,0);});
test('declining sharing keeps all original attachments',()=>{const h=contentHarness({approve:false});const f=[file(2097153)];assert.equal(h.change(f).files,f);assert(!h.stopped);assert.equal(h.messages.length,0);});
test('stale context leaves native selection intact',()=>{const h=contentHarness({connected:false});h.change([file(2097153)]);assert(!h.stopped);assert.equal(h.confirms,0);assert.equal(h.messages.length,0);});
test('unknown compose does not intercept',()=>{const h=contentHarness({composerExists:false});h.change([file(2097153)]);assert(!h.stopped);assert.equal(h.messages.length,0);});
test('DataTransfer failure preserves native behavior',()=>{const h=contentHarness({brokenTransfer:true});h.change([file(2097153)]);assert(!h.stopped);assert.equal(h.messages.length,0);});
test('mixed selection attaches small file and inserts verified large link',async()=>{const h=contentHarness();const small=file(2);const input=h.change([small,file(2097153)]);await settle();assert(h.stopped);assert.equal(input.files.length,1);assert.equal(input.files[0],small);assert.equal(h.messages.filter(m=>m.type==='CHUNK').length,5);assert.equal(h.links.length,1);assert.equal(h.messages.find(m=>m.type==='SHARE').uploadId,'upload');});
test('OAuth failure inserts no link and reports unattached file',async()=>{const h=contentHarness({failUpload:true});h.change([file(2097153)]);await settle();assert.equal(h.links.length,0);assert(h.notices.some(s=>s.includes('File was NOT attached')));});
