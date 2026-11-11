'use strict';
(() => {
  const LIMIT = 2 * 1024 * 1024;
  const CHUNK_SIZE = 512 * 1024; // Multiple of Google Drive's 256 KiB requirement.
  const bypassEvents = new WeakSet();
  let lastCompose = null;

  function composeOf(node) {
    if (!node?.closest) return null;
    return node.closest('div[role="dialog"]') || node.closest('div[gh="cm"]') || node.closest('div[role="main"]');
  }
  function editorOf(node) {
    return node?.querySelector?.('[contenteditable="true"][role="textbox"], div[aria-label="Message Body"][contenteditable="true"], div[contenteditable="true"][g_editable="true"]');
  }
  document.addEventListener('focusin', event => {
    const composer = composeOf(event.target);
    if (composer && editorOf(composer)) lastCompose = composer;
  }, true);
  document.addEventListener('pointerdown', event => {
    const composer = composeOf(event.target);
    if (composer && editorOf(composer)) lastCompose = composer;
  }, true);

  function getComposer(input) {
    const direct = composeOf(input);
    if (direct && editorOf(direct)) return direct;
    if (lastCompose?.isConnected && editorOf(lastCompose)) return lastCompose;
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')].filter(editorOf);
    if (dialogs.length === 1) return dialogs[0];
    const editors = [...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"][g_editable="true"]')];
    if (editors.length === 1) return composeOf(editors[0]);
    return null;
  }
  function notice(message, bad = false) {
    const element = document.createElement('div');
    element.textContent = message;
    Object.assign(element.style, {position:'fixed', bottom:'20px', right:'20px', zIndex:'2147483647',
      background:bad?'#9b1c1c':'#1d3348', color:'#fff', padding:'12px 16px', borderRadius:'8px',
      font:'13px Arial,sans-serif', boxShadow:'0 4px 16px #0003', maxWidth:'340px'});
    document.documentElement.append(element);
    setTimeout(() => element.remove(), bad ? 9000 : 3500);
  }
  function ask(message) {
    return new Promise((resolve,reject) => {
      if (!chrome.runtime?.id) return reject(new Error('Extension updated. Refresh Gmail before trying again.'));
      chrome.runtime.sendMessage(message, reply => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!reply?.ok) return reject(new Error(reply?.error || 'Extension service worker unavailable.'));
        resolve(reply);
      });
    });
  }
  function insertLink(composer, name, url) {
    const editor = editorOf(composer);
    if (!composer?.isConnected || !editor) throw new Error('Cannot find the matching Gmail compose box. The file remains in Drive.');
    editor.focus();
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
    const wrapper = document.createElement('span');
    wrapper.append(document.createTextNode('\u00a0'));
    const link = document.createElement('a');
    link.href = url;
    link.textContent = `${name} (Google Drive)`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    wrapper.append(link, document.createElement('br'));
    range.insertNode(wrapper);
    editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:`${name}: ${url}`}));
  }
  async function upload(file, composer) {
    let uploadId;
    try {
      notice(`Uploading ${file.name} to Google Drive...`);
      const started = await ask({type:'START', name:file.name, size:file.size, mime:file.type});
      uploadId = started.uploadId;
      let response;
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
        response = await ask({type:'CHUNK', uploadId, offset, data:Array.from(bytes)});
      }
      if (!response?.complete) throw new Error('Google Drive did not finish the upload.');
      // By design public sharing must succeed BEFORE a link is inserted.
      if (!composer?.isConnected) throw new Error('The compose window was closed. The uploaded file remains private in Drive.');
      const shared = await ask({type:'SHARE', uploadId});
      if (!composer?.isConnected) throw new Error('The compose window was closed before link insertion.');
      insertLink(composer, file.name, shared.url);
      notice(`Drive link inserted: ${file.name}`);
    } catch (error) {
      notice(`${file.name}: ${error.message}. File was NOT attached.`, true);
    } finally {
      if (uploadId) ask({type:'CANCEL', uploadId}).catch(() => {});
    }
  }

  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || bypassEvents.has(event)) return;
    if (location.hostname !== 'mail.google.com') return;
    const files = [...(input.files || [])];
    if (!files.length || !files.some(file => file.size > LIMIT)) return;
    const composer = getComposer(input);
    if (!composer) {
      // Don't interfere with an unknown file picker (for example Gmail settings).
      console.warn('Smart Gmail Attachments: cannot associate file picker with a compose window.');
      return;
    }
    // A stale content script must not swallow Gmail's native attachment event.
    if (!chrome.runtime?.id) {
      notice('Extension updated. Refresh Gmail to enable Drive links. These files will attach normally.', true);
      return;
    }
    const approved = window.confirm('Upload the selected files over 2 MiB to Google Drive and make them viewable by anyone with the link?\n\nOK: upload and insert links. Cancel: attach all files normally in Gmail.');
    if (!approved) return;
    const small = files.filter(file => file.size <= LIMIT);
    const large = files.filter(file => file.size > LIMIT);
    // Prepare the replacement before suppressing the original event.
    try {
      const transfer = new DataTransfer();
      small.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
    } catch (error) {
      notice('Could not separate files. Gmail will attach the original selection normally.', true);
      return;
    }
    // Intercept the original Gmail file input CHANGE before Gmail handles it.
    event.stopImmediatePropagation();
    event.stopPropagation();
    try {
      if (small.length) {
        const synthetic = new Event('change', {bubbles: true});
        bypassEvents.add(synthetic);
        input.dispatchEvent(synthetic); // Let Gmail handle smaller files normally.
      }
    } catch (error) {
      notice(`Could not preserve small attachments: ${error.message}`, true);
    }
    // Preserve selection order and avoid multiple simultaneous multi-megabyte messages.
    (async () => { for (const file of large) await upload(file, composer); })();
  }, true);
})();
