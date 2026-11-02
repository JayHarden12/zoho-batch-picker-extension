# Zoho Batch Auto-Assign — Microsoft Edge Extension

A lightweight browser extension for Zoho Inventory users that automatically assigns inventory batches (FIFO — oldest expiry first) to Zoho Inventory invoices in one click.

---

## Why this approach?
- **Nothing to set up:** No servers, scripts, API credentials or tokens. It works in the Zoho session you're already signed in to.
- **Safe by design:** It only fills in Zoho's own invoice form, so nothing reaches Zoho until you click Save.
- **Works directly in Microsoft Edge** (and Chrome/Brave).

---

## 🚀 1-Minute Setup for Team Members

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

> **Upgrading from version 1:** remove the old extension first, then load this one. That deletes the Zoho credentials version 1 stored in your browser.

---

## ⚡ How to Use

1. Go to **Zoho Inventory** (`https://inventory.zoho.com`) and create an invoice — a new one, or from a Sales Order. For a saved invoice, click **Edit**.
2. Click the blue **"⚡ Auto-Assign Batches (FIFO)"** button at the bottom-right corner of the screen.
3. The extension opens each item's "Select Batches" window briefly to read the batches, then shows a **batch plan**: item, batch, expiry and quantity, with any warnings.
4. Click **Fill these batches** to fill them in, or **Cancel** to change nothing.
5. Check the batches, then click **Save as Draft** or **Save and Send** as usual. The extension never saves the invoice for you.

### How batches are chosen
- Soonest expiry first. If one batch isn't enough, the rest comes from the next one.
- Expired batches are skipped and listed as a warning.
- Batches with no readable expiry date are used last, with a warning.
- Batches whose stock can't be read are skipped, with a warning.
- Two lines of the same item share the stock, so they can't both use the same units.

### If something goes wrong
- The results stay on screen until you close them. If one item fails, the others still run and the failed one is listed.
- If the extension can't fully read Zoho's batch list, it saves a file called `zoho-batch-dropdown.html` to your **Downloads** folder. Send that file to whoever maintains the extension; it shows how Zoho displayed the list.

### Running the tests
On a Mac, from this folder:
```
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/batch-plan.test.js
```
