# Gmail Smart Attachments 1.1.0

Use Gmail's paperclip. Files up to and including **2 MiB (2,097,152 bytes)** attach normally. For larger files, the extension asks whether to upload them to Google Drive and grant **anyone with the link** viewer access. Cancel keeps Gmail's normal attachments. It inserts a link only after the upload and sharing succeed. It never sends an email.

## Install and connect

1. Extract the ZIP into a permanent folder. In Chrome open `chrome://extensions`, enable Developer mode, then choose **Load unpacked** and select the folder containing `manifest.json`. Disable the old version if it has a different ID so two versions do not intercept Gmail together. If Chrome reports the same ID already installed, disable/remove the old installation before loading this folder.
2. Open the extension popup and click **Connect Google Drive**. Approve the permission screen yourself. The popup verifies Drive API access and shows the Drive account. This can differ from your Gmail account because Chrome identity uses the Chrome profile's Google account.
3. Refresh Gmail. Test a draft with one small file and one non-sensitive file larger than 2 MiB. Approve sharing only if appropriate. Confirm the small attachment and Drive link appear in the intended draft; verify the large file's size in Drive and open its link in a signed-out window. No email needs to be sent.

Your existing local OAuth client ID is already configured. Its format is valid; Google Cloud registration and consent have not been verified. The CRX supplied for this repair had a placeholder client ID. The `.pem` was not read or bundled.

## Only if Google refuses to connect

The extension now always has this ID, derived from the public key in your CRX:

`cddcchndhodbleloafloodfhodffmlhh`

Open [Google Cloud OAuth clients](https://console.cloud.google.com/auth/clients) in the project containing the configured client. Confirm its application type is **Chrome Extension** and its **Item ID** equals the ID above. The public manifest key preserves this ID across unpacked folder moves; no private signing key is needed.

Enable the **Google Drive API** in that same project. Configure the consent audience; if External and Testing, include your Google account as a test user. A Workspace administrator may need to permit this app. Click **Reconnect** in the popup to clear this extension's cached credentials and request permission again. Reconnect does not revoke the app's server-side grant. Do not repeatedly create new clients or change IDs.

If using a different OAuth client, replace only `oauth2.client_id` in `manifest.json`, reload the extension, and refresh Gmail. An OAuth client ID is public configuration, not a client secret. Never put a client secret, access token, or `.pem` in this folder.

## Repairs

- Interactive Google authorization runs only from popup Connect/Reconnect, with granted-scope validation and a Drive API check.
- Revoked/denied authorization and bad client configuration give specific recovery instructions. A 401 removes the invalid cached token and retries once without silently opening consent.
- The background worker holds tokens; no access tokens are passed into Gmail. Only the popup can request interactive authorization, and uploads require the top-level Gmail tab.
- Upload sessions survive worker suspension in `storage.session`, are bound to the originating tab/document, and expire after one hour. No access token is stored there. Browser restart or extension reload clears sessions.
- Upload byte order, size, acknowledged ranges, final completion, and session URL origin are checked. Sharing accepts only a completed upload session.
- Mixed selections retain small attachments, uploads run sequentially, stale content scripts leave native attachments available, and sharing requires confirmation.

## Failure behavior and limits

After approving interception, a large file that fails authorization, upload, sharing, or insertion **is not attached**. Select it again after fixing the error, or cancel the confirmation to use Gmail's normal attachment behavior. If sharing fails, the uploaded file remains private in Drive. If insertion fails after sharing, the file remains shared in Drive: review it there. Cancel/session cleanup removes local session records only; it does not delete Drive files. Interrupted attempts may leave incomplete sessions or uploaded files, and retrying can create duplicates. There is no automatic recovery after browser restart or network interruption.

Gmail's file picker and compose DOM are undocumented. Live Gmail validation is still required, especially with mixed selections, multiple drafts, inline-image pickers, and Workspace policies. A token and a syntactically valid client ID cannot prove consent or registration are correct. This package is an unpacked development install, not a signed CRX update or Chrome Web Store release.

## Validation

JavaScript syntax checks and 31 automated tests pass under Node.js 24. The tests simulate Chrome identity/storage, Drive responses, and file-selection/compose handling. They do not log in, upload real files, or prove current Gmail compatibility. From this folder run `node --test tests/extension.test.cjs`.

Live browser checks were unavailable because browser control could not reliably determine the Chrome URL. No Google consent, live upload, or public sharing was performed during this repair.

References: [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [stable extension IDs](https://developer.chrome.com/docs/extensions/reference/manifest/key), [Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
