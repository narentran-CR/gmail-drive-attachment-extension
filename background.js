'use strict';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const busy = new Set();
const ownerOf = s => `${s.tab?.id}:${s.frameId}:${s.documentId || ''}`;
const popupOf = s => !s.tab && s.url === chrome.runtime.getURL('popup.html');
function authError(e) {
  const raw = e?.message || String(e);
  if (/bad client|invalid.client/i.test(raw)) return 'OAuth client rejected. Match the Chrome Extension OAuth client Item ID to the Extension ID shown here. ' + raw;
  if (/not granted|revoked|sign.?in|not signed/i.test(raw)) return 'Google Drive is not connected. Open this extension and click Connect Google Drive, then approve Google’s permission screen. ' + raw;
  return raw;
}
async function auth(interactive = false) {
  const client = chrome.runtime.getManifest().oauth2?.client_id;
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(client || '')) throw Error('Configure a real Chrome Extension OAuth client ID in manifest.json.');
  let result;
  try { result = await chrome.identity.getAuthToken({interactive, enableGranularPermissions:true}); }
  catch(e) { throw Error(authError(e)); }
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw Error('No Google authorization token. Click Connect Google Drive.');
  if (result.grantedScopes && !result.grantedScopes.includes(SCOPE)) throw Error('Drive access was not selected. Connect again and approve the Drive permission.');
  return token;
}
async function request(url, options = {}, allowed = [200,201]) {
  let token = await auth();
  const run = () => fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(25000)});
  let response = await run();
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({token});
    token = await auth(); response = await run();
  }
  if (!allowed.includes(response.status)) {
    let detail;try {detail=(await response.json()).error?.message;}catch{}
    throw Error(`Google Drive ${response.status}: ${detail || 'Request failed'}. ${response.status===403?'Check Drive API enablement, granted access, and Workspace sharing policy.':''}`);
  }
  return response;
}
async function save(id,value) { await chrome.storage.session.set({[id]:value}); }
async function session(id,owner) {
  const s=(await chrome.storage.session.get(id))[id];
  if (!s || s.owner!==owner || Date.now()-s.touched>3600000) throw Error('Upload session expired or belongs to another compose tab. Select the file again.');
  return s;
}
async function start({name,size,mime},owner) {
  if(typeof name!=='string'||!name||!Number.isSafeInteger(size)||size<=2097152)throw Error('Select a file larger than 2 MiB.');
  const response=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name',{
    method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':mime||'application/octet-stream','X-Upload-Content-Length':String(size)},body:JSON.stringify({name})
  });
  const location=response.headers.get('Location');
  if(!location||new URL(location).origin!=='https://www.googleapis.com')throw Error('Invalid Drive upload URL.');
  const uploadId=crypto.randomUUID();await save(uploadId,{location,name,size,offset:0,owner,touched:Date.now()});return {uploadId};
}
async function chunk({uploadId,offset,data},owner) {
  if(busy.has(uploadId))throw Error('Upload already processing.');busy.add(uploadId);
  try {
    const s=await session(uploadId,owner);
    if(s.fileId||offset!==s.offset||!Array.isArray(data)||!data.length||data.length>524288||data.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('Invalid or out-of-order upload bytes.');
    const end=offset+data.length;
    if(end>s.size||(end<s.size&&data.length%262144!==0))throw Error('Invalid chunk size.');
    const r=await request(s.location,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes ${offset}-${end-1}/${s.size}`},body:new Uint8Array(data)},[200,201,308]);
    if(r.status===308){
      const match=/^bytes=0-(\d+)$/.exec(r.headers.get('Range')||'');
      if(!match||Number(match[1])+1!==end||end===s.size)throw Error('Drive did not confirm the expected byte range. Select the file again.');
      Object.assign(s,{offset:end,touched:Date.now()});await save(uploadId,s);return {complete:false,uploaded:end};
    }
    const meta=await r.json();if(end!==s.size||!meta.id)throw Error('Drive returned an incomplete upload.');
    Object.assign(s,{offset:end,fileId:meta.id,touched:Date.now()});await save(uploadId,s);
    return {complete:true,fileId:meta.id,uploaded:end};
  } finally {busy.delete(uploadId);}
}
async function share({uploadId},owner) {
  const s=await session(uploadId,owner);if(!s.fileId)throw Error('Upload is not complete.');
  try {await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(s.fileId)}/permissions?fields=id`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})});}
  catch(e){throw Error(`File uploaded to Drive, but sharing failed. No link inserted. Find the private file in Drive before retrying. ${e.message}`);}
  return {url:`https://drive.google.com/file/d/${encodeURIComponent(s.fileId)}/view`};
}
async function dispatch(m,s) {
  if(s.id!==chrome.runtime.id)throw Error('Untrusted sender.');
  const popup=popupOf(s);
  if(['AUTH','RECONNECT','STATUS'].includes(m?.type)){
    if(!popup)throw Error('Open the extension popup to connect.');
    if(m.type==='STATUS')return {extensionId:chrome.runtime.id,clientId:chrome.runtime.getManifest().oauth2.client_id};
    if(m.type==='RECONNECT')await chrome.identity.clearAllCachedAuthTokens();
    await auth(true);
    const r=await request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    return {connected:true,email:(await r.json()).user?.emailAddress||''};
  }
  if(!s.tab||s.frameId!==0||!s.url?.startsWith('https://mail.google.com/'))throw Error('Uploads must come from Gmail.');
  const owner=ownerOf(s);
  switch(m?.type){
    case 'START':return start(m,owner);
    case 'CHUNK':return chunk(m,owner);
    case 'SHARE':return share(m,owner);
    case 'CANCEL':await session(m.uploadId,owner);await chrome.storage.session.remove(m.uploadId);return {cancelled:true};
    default:throw Error('Unknown operation.');
  }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  dispatch(message,sender).then(r=>sendResponse({ok:true,...r}),e=>sendResponse({ok:false,error:e.message||String(e)}));return true;
});
