# Zoho Batch Auto-Assign — Microsoft Edge Extension

A lightweight browser extension for Zoho Inventory users that automatically assigns inventory batches (FIFO — oldest expiry first) to Zoho Inventory invoices in one click.

---

## Why this approach?
- **Zero local servers:** Nobody needs to run any server, command prompt, or Python script.
- **Zero token hassle:** Because everyone has their credentials (`Client ID`, `Client Secret`, and `Refresh Token`), the extension silently auto-refreshes the access token in the background. No one ever has to generate or paste hourly tokens.
- **Built-in setup helper:** New team members can open the Zoho API Console and generate their permanent refresh token directly inside the extension popup.
- **Works directly in Microsoft Edge** (and Chrome/Brave).

---

## 🚀 1-Minute Setup for Team Members

### Step 1: Install the Extension in Microsoft Edge
1. Open **Microsoft Edge**.
2. Type `edge://extensions` in the address bar and press **Enter**.
3. Toggle ON **"Developer mode"** (bottom-left switch).
4. Click the **"Load unpacked"** button at the top.
5. Select this folder:
   ```
   zoho-batch-picker-extension
   ```
6. The extension **"Zoho Batch Auto-Assign"** will now appear in your browser. Pin it to your toolbar by clicking the puzzle icon 🧩 next to the URL bar and clicking the eye/pin icon next to it.

---

### Step 2: One-Time Credential Setup

Click the extension icon in your browser toolbar.

#### Option A: If you already have your Refresh Token
1. Enter your **Client ID**, **Client Secret**, and **Refresh Token**.
2. Click **"Save Credentials"**.
3. You will see `✅ Credentials saved! Token auto-refreshes silently.`

#### Option B: If you are a new member (Need credentials)
Click **"🔑 New member? Get your credentials"** in the popup:
1. Click the button: **"Open Zoho API Console ↗"**.
2. In the Zoho API Console, click **Add Client** &rarr; choose **Self Client** (or select your existing Self Client).
3. Copy your **Client ID** and **Client Secret** and paste them into the fields in the extension.
4. In Zoho, click the **"Generate Code"** tab:
   - Click the **"Copy"** button in the extension for Scope (`ZohoInventory.fullaccess.ALL`).
   - Time Duration: **10 minutes**.
   - Scope Description: **Batch Auto-Assign**.
   - Click **Create** in Zoho.
5. Copy the generated 10-minute code from Zoho, paste it into the extension's code box, and click:
   **"⚡ Exchange Code & Save Permanently"**.
6. The extension generates your permanent refresh token, saves it, and connects you automatically!

> **Note:** You only have to do this once. Your credentials are saved locally in your own browser, and the extension will automatically keep your token valid forever.

---

## ⚡ How to Use

1. Go to **Zoho Inventory** (`https://inventory.zoho.com`) and create an invoice — a new one, or from a Sales Order.
2. A blue floating button **"⚡ Auto-Assign Batches (FIFO)"** will appear at the bottom-right corner of the screen.
3. Click the button. For every item showing **⚠ Select Batches**, the extension will:
   - Open Zoho's "Select Batches" window
   - Pick the batch that expires soonest first (FIFO), adding more batches if one isn't enough
   - Fill in the quantity and save that window
4. Check the batches, then click **Save as Draft** or **Save and Send** as usual. The extension never saves the invoice for you.

> On an already-saved invoice (not the form), the button assigns batches through the Zoho API instead and reloads the page.

### If something goes wrong
- A red message explains what failed — send it (or a screenshot) to whoever maintains the extension.
- If the extension can't read Zoho's batch list, it saves a file called `zoho-batch-dropdown.html` to your **Downloads** folder. Send that file too; it shows how Zoho displayed the list.
