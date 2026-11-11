# Validation — 11 November 2026

Inputs: supplied `gmail_drive_attachment_extension.crx` plus the newer local `gmail-smart-attachment` source. The historical `/mnt/data/gmail-smart-attachment-fixed.zip` was not present in this Windows session. The CRX confirmed the earlier placeholder OAuth configuration; the local source supplied the existing complete OAuth client ID. The CRX's embedded public key fixes the extension ID at `cddcchndhodbleloafloodfhodffmlhh`. The private `.pem` was not read.

Passed: JavaScript syntax for background, content and popup; manifest JSON and referenced-file checks; public-key-derived ID; 31 mocked behavior tests; ZIP extraction and byte-for-byte content comparison; no private-key or token artifacts in the package.

Coverage: interactive consent boundary, reconnect cache clearing, denied/revoked permission messages, granular scopes, 401 recovery, trusted message senders, 2 MiB boundary, resumable chunk validation, worker suspension, session ownership/expiry, public-sharing failure, mixed file handling, canceled confirmation, stale context, file-list replacement failure, and link insertion after successful sharing.

Not verified: Google Cloud OAuth client type/Item ID, API enablement, test-user or Workspace policy, Google consent, Chrome installation, current Gmail's real file picker, actual upload bytes or signed-out link access. Browser automation stopped because it could not confidently determine Chrome's current URL. No claim of live authorization or end-to-end browser success is made.
