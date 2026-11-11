'use strict';
const status=document.querySelector('#status');
const buttons=[...document.querySelectorAll('button')];
async function send(type){const r=await chrome.runtime.sendMessage({type});if(!r?.ok)throw Error(r?.error||'Extension unavailable.');return r;}
send('STATUS').then(r=>{document.querySelector('#config').textContent=`Extension ID: ${r.extensionId}\nOAuth client: ${r.clientId}\nThe OAuth client must be type Chrome Extension and its Item ID must match this Extension ID. Chrome's Google account may differ from the account open in Gmail.`;}).catch(e=>status.textContent=e.message);
async function connect(type){buttons.forEach(b=>b.disabled=true);status.textContent='Connecting… Complete Google’s permission screen if it opens.';try{const r=await send(type);status.textContent=`Drive API connection verified${r.email?' for '+r.email:''}. Refresh Gmail once, then use the paperclip.`;}catch(e){status.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}}
document.querySelector('#connect').addEventListener('click',()=>connect('AUTH'));
document.querySelector('#reconnect').addEventListener('click',()=>connect('RECONNECT'));
