
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.type !== "GET_DRIVE_TOKEN") {
      return;
    }

    chrome.identity.getAuthToken(
      { interactive: true },
      (token) => {
        if (chrome.runtime.lastError || !token) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError?.message ||
              "Google authorization failed"
          });
          return;
        }

        sendResponse({
          ok: true,
          token: token
        });
      }
    );

    return true;
  }
);
