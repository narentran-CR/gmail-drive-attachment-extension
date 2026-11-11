
const LIMIT = 2 * 1024 * 1024;

const fileInput = document.getElementById("files");
const uploadButton = document.getElementById("upload");
const statusBox = document.getElementById("status");
const results = document.getElementById("results");

// Enable button after selecting files
fileInput.addEventListener("change", () => {
  uploadButton.disabled = fileInput.files.length === 0;
  statusBox.textContent = "";
  results.replaceChildren();
});

// Get Google Drive authorization
function getDriveToken() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GET_DRIVE_TOKEN" },
      response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response?.error || "Authorization failed"));
          return;
        }

        resolve(response.token);
      }
    );
  });
}

// Upload file to Google Drive
async function uploadFile(file, token) {
  const metadata = {
    name: file.name,
    mimeType: file.type || "application/octet-stream"
  };

  const boundary = "drive_boundary_" + crypto.randomUUID();

  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ], {
    type: `multipart/related; boundary=${boundary}`
  });

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!response.ok) {
    throw new Error(
      "Drive upload failed: " + await response.text()
    );
  }

  const uploaded = await response.json();

  // Create Anyone with the link - Viewer permission
  const permissionResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "anyone",
        role: "reader"
      })
    }
  );

  if (!permissionResponse.ok) {
    throw new Error(
      "File uploaded, but sharing failed: " +
      await permissionResponse.text()
    );
  }

  return {
    name: uploaded.name,
    url: `https://drive.google.com/file/d/${uploaded.id}/view`
  };
}

// Insert links into Gmail
function insertLinks(tabId, links) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      type: "INSERT_DRIVE_LINKS",
      links
    }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error("Could not connect to Gmail."));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Could not insert links."));
        return;
      }

      resolve();
    });
  });
}

// Upload selected large files
uploadButton.addEventListener("click", async () => {
  const files = Array.from(fileInput.files);

  const largeFiles = files.filter(
    file => file.size > LIMIT
  );

  const smallFiles = files.filter(
    file => file.size <= LIMIT
  );

  if (largeFiles.length === 0) {
    statusBox.textContent =
      "No files larger than 2 MB. Use Gmail's paperclip button.";
    return;
  }

  uploadButton.disabled = true;

  try {
    statusBox.textContent = "Connecting to Google Drive...";

    const token = await getDriveToken();

    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("https://mail.google.com/")) {
      throw new Error("Open Gmail before uploading files.");
    }

    const uploadedLinks = [];

    for (let i = 0; i < largeFiles.length; i++) {
      const file = largeFiles[i];

      statusBox.textContent =
        `Uploading ${i + 1} of ${largeFiles.length}: ${file.name}`;

      const result = await uploadFile(file, token);
      uploadedLinks.push(result);
    }

    statusBox.textContent = "Adding links to Gmail...";

    await insertLinks(tab.id, uploadedLinks);

    uploadedLinks.forEach(item => {
      const li = document.createElement("li");
      const a = document.createElement("a");

      a.href = item.url;
      a.textContent = item.name;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      li.appendChild(a);
      results.appendChild(li);
    });

    statusBox.textContent =
      `${uploadedLinks.length} file(s) uploaded successfully. ` +
      (smallFiles.length
        ? `${smallFiles.length} small file(s) were skipped. Attach them normally in Gmail.`
        : "");

  } catch (error) {
    statusBox.textContent = error.message;
  }

  uploadButton.disabled = false;
});
