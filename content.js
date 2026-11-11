
let lastEditor = null;

// Remember which Gmail message body the user clicked
document.addEventListener("focusin", event => {
  const editor = event.target.closest(
    '[contenteditable="true"]'
  );

  if (editor) {
    lastEditor = editor;
  }
}, true);

// Receive links from popup.js
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    if (message.type !== "INSERT_DRIVE_LINKS") {
      return;
    }

    const editor = lastEditor?.isConnected
      ? lastEditor
      : document.querySelector(
          '[contenteditable="true"][role="textbox"]'
        ) || document.querySelector(
          '[contenteditable="true"]'
        );

    if (!editor) {
      sendResponse({
        ok: false,
        error: "Open a Gmail compose window and click inside its message body first."
      });
      return;
    }

    editor.focus();

    const links = message.links || [];

    const html = links.map(item => {
      const safeName = String(item.name).replace(
        /[&<>"']/g,
        char => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[char]
      );

      const safeUrl = String(item.url).replace(
        /[&<>"']/g,
        char => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[char]
      );

      return `<div><a href="${safeUrl}">${safeName}</a></div>`;
    }).join("");

    const success = document.execCommand(
      "insertHTML",
      false,
      `<div><br></div><div><b>Google Drive files:</b></div>${html}`
    );

    if (!success) {
      sendResponse({
        ok: false,
        error: "Gmail could not insert the links. Please copy the links from the extension and paste them manually."
      });
      return;
    }

    sendResponse({ ok: true });
  }
);
