/**
 * content.js — Zoho Batch Auto-Assign
 *
 * Injected into every Zoho Inventory page.
 * Watches for invoice pages and injects the
 * "Auto-Assign Batches (FIFO)" button.
 *
 * This script only handles the UI. All Zoho API calls run in
 * service-worker.js, because fetches from a content script are
 * blocked by the Zoho page's CORS rules.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────
const BTN_ID    = 'zba-auto-assign-btn';
const TOAST_ID  = 'zba-toast';
const BTN_LABEL = '⚡ Auto-Assign Batches (FIFO)';

// ─── Helpers ──────────────────────────────────────────────

/** Extract invoice ID from the current URL (detail or edit page). */
function getInvoiceIdFromUrl() {
  // Zoho invoice URLs look like:
  // /app/<org>#/invoices/<invoice_id>
  // /app/<org>#/invoices/<invoice_id>/edit
  const match = window.location.href.match(/invoices\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * New-invoice form. Zoho uses both:
 * #/invoices/new                                (blank invoice)
 * #/salesorders/<so_id>/invoice/new?...         (convert sales order → invoice)
 */
function isNewInvoicePage() {
  return /invoices?\/new/.test(window.location.href);
}

/** Show a toast notification inside the Zoho page. */
function showToast(message, type = 'success') {
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className   = `zba-toast zba-toast--${type} zba-toast--visible`;

  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('zba-toast--visible');
  }, type === 'error' ? 8000 : 5000);
}

// ─── Invoice Form Automation ──────────────────────────────
// Fills Zoho's own "Select Batches" pop-up for each line item on the
// invoice form (new or edit), FIFO by expiry. Nothing is saved to Zoho
// until the user clicks Save as Draft / Save and Send themselves.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Poll until fn() returns something truthy, or throw after timeout. */
async function waitFor(fn, what, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function isVisible(el) {
  return !!el && el.getClientRects().length > 0;
}

/** Full mouse click sequence (Ember dropdowns may listen on mousedown). */
function realClick(el) {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

/** Set an Ember text field's value so the app picks it up. */
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, String(value));
  for (const type of ['input', 'change', 'keyup']) {
    input.dispatchEvent(new Event(type, { bubbles: true }));
  }
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** "Select Batches" links on line items that still need batches. */
function findSelectBatchLinks() {
  return [...document.querySelectorAll('tbody.line-item-body tr.line-item td.item-qty a')]
    .filter(a => /select batches/i.test(a.textContent));
}

function findBatchModal() {
  return [...document.querySelectorAll('#modal-wrapper .modal-dialog[role="dialog"]')]
    .find(d => /select batches/i.test(d.querySelector('.modal-title')?.textContent || ''));
}

function parseNumber(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

/** Read "Quantity to be added : 1 Pack(s)" (falls back to Total Quantity). */
function readNeededQty(modal) {
  const text = modal.querySelector('.primary-info')?.textContent || modal.textContent;
  const m = text.match(/Quantity to be added\s*:\s*([\d.,]+)/i)
         || text.match(/Total Quantity\s*:\s*([\d.,]+)/i);
  return m ? parseNumber(m[1]) : NaN;
}

/** Visible dropdown options currently open on the page. */
function findOpenOptions() {
  const byRole = [...document.querySelectorAll('[role="option"]')].filter(isVisible);
  if (byRole.length) return byRole;
  const box = document.getElementById('acDropdownListBox');
  return box ? [...box.querySelectorAll('li')].filter(isVisible) : [];
}

/** Try to read a date out of option text. Returns a sortable timestamp or null. */
function parseExpiry(text) {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const dmy = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const named = text.match(/(?:[A-Za-z]{3,9},\s*)?[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}/);
  if (named) {
    const t = Date.parse(named[0]);
    if (!isNaN(t)) return t;
  }
  return null;
}

/** Read one dropdown option into { el, label, expiry, available }. */
function parseOption(el) {
  const lines = el.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const text  = lines.join(' | ');
  const qtyM  = text.match(/(?:available|balance|stock|qty|quantity)[^\d]{0,20}([\d,]+(?:\.\d+)?)/i);
  return {
    el,
    label     : lines[0] || '',
    text,
    expiry    : parseExpiry(text),
    available : qtyM ? parseNumber(qtyM[1]) : null
  };
}

function isRealBatchOption(opt) {
  return opt.label && !/no results|add new|create|select batch/i.test(opt.label);
}

/** Open the batch dropdown in a given batch row and return its parsed options. */
async function openBatchDropdown(row) {
  const box = row.querySelector('.ac-box[role="combobox"]');
  if (!box) throw new Error('Batch dropdown not found in pop-up');
  realClick(box);
  const els = await waitFor(() => {
    const o = findOpenOptions();
    return o.length ? o : null;
  }, 'batch list to open');
  return els.map(parseOption).filter(isRealBatchOption);
}

/** Fill the open Select Batches pop-up FIFO. Returns a short summary string. */
async function fillBatchModal(modal, itemName) {
  const needed = readNeededQty(modal);
  if (!(needed > 0)) return `${itemName}: nothing to add`;

  const tableBody = () => modal.querySelector('table.batches-table tbody');
  const rows      = () => [...tableBody().querySelectorAll(':scope > tr')];

  // Open the first row's dropdown to see what batches exist
  let options = await openBatchDropdown(rows()[0]);
  if (options.length === 0) {
    savePageSnapshot('zoho-batch-dropdown.html');
    throw new Error(`${itemName}: no batches listed in the dropdown`);
  }

  const withExpiry = options.filter(o => o.expiry !== null);
  const sortable   = withExpiry.length === options.length;
  if (sortable) options.sort((a, b) => a.expiry - b.expiry);
  if (!sortable || options.every(o => o.available === null)) {
    // Couldn't read expiry/stock from the list — save it so it can be studied
    savePageSnapshot('zoho-batch-dropdown.html');
  }

  // Plan FIFO allocation
  const plan = [];
  let remaining = needed;
  for (const o of options) {
    if (remaining <= 0) break;
    if (o.available !== null && o.available <= 0) continue;
    const take = o.available === null ? remaining : Math.min(o.available, remaining);
    plan.push({ label: o.label, qty: take });
    remaining -= take;
  }

  // Apply the plan row by row
  for (let i = 0; i < plan.length; i++) {
    if (i > 0) {
      const before = rows().length;
      const newRowBtn = [...modal.querySelectorAll('button')].find(b => /new row/i.test(b.textContent));
      if (!newRowBtn) throw new Error('"New Row" button not found in pop-up');
      realClick(newRowBtn);
      await waitFor(() => rows().length > before, 'new batch row');
    }
    const row = rows()[i];

    // Dropdown for row 0 is already open from the planning step
    if (i > 0) await openBatchDropdown(row);
    const optEl = findOpenOptions().find(el => parseOption(el).label === plan[i].label);
    if (!optEl) throw new Error(`Batch "${plan[i].label}" not found in dropdown`);
    realClick(optEl);
    await sleep(300);

    const qtyInput = row.querySelector('input[data-auto-gen-binding-key="out_quantity"]');
    if (!qtyInput) throw new Error('Quantity Out box not found in pop-up');
    setInputValue(qtyInput, plan[i].qty);
    await sleep(200);
  }

  // Save the pop-up (not the invoice)
  const saveBtn = modal.querySelector('.modal-footer button[type="submit"]');
  realClick(saveBtn);
  await waitFor(() => !findBatchModal(), 'batch pop-up to close', 4000)
    .catch(() => { throw new Error(`${itemName}: Zoho did not accept the batches — check the pop-up`); });

  const used = plan.map(p => `${p.label} ×${p.qty}`).join(', ');
  const short = remaining > 0 ? ` (⚠️ short by ${remaining})` : '';
  const note  = sortable ? '' : ' (⚠️ expiry not readable — used Zoho\'s list order)';
  return `${itemName}: ${used}${short}${note}`;
}

/** Walk every line item that still needs batches and fill its pop-up. */
async function autoAssignInForm() {
  const links = findSelectBatchLinks();
  if (links.length === 0) {
    return { ok: false, type: 'info', message: 'ℹ️ No line items are waiting for batch selection.' };
  }

  const done = [];
  // Re-query each time: Zoho re-renders the table after every pop-up save
  for (let n = 0; n < links.length; n++) {
    const link = findSelectBatchLinks()[0];
    if (!link) break;
    const itemName = link.closest('tr.line-item')
      ?.querySelector('.zf-item-details label')?.textContent.trim() || `Item ${n + 1}`;

    link.click();
    const modal = await waitFor(findBatchModal, 'Select Batches pop-up');
    await sleep(300);
    done.push(await fillBatchModal(modal, itemName));
    await sleep(500);
  }

  return {
    ok: true,
    type: done.some(d => d.includes('⚠️')) ? 'warning' : 'success',
    message: `✅ Batches filled — review, then click Save:\n• ${done.join('\n• ')}`
  };
}

// ─── Main Auto-Assign Handler ─────────────────────────────

async function autoAssignBatches() {
  const btn = document.getElementById(BTN_ID);
  if (!btn) return;

  // On the invoice form (new or edit) fill Zoho's own batch pop-ups
  if (document.querySelector('tbody.line-item-body')) {
    btn.disabled    = true;
    btn.textContent = '⏳ Filling batches...';
    try {
      const result = await autoAssignInForm();
      showToast(result.message, result.type);
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
      console.error('[Zoho Batch Auto-Assign]', err);
    } finally {
      btn.disabled    = false;
      btn.textContent = BTN_LABEL;
    }
    return;
  }

  const invoiceId = getInvoiceIdFromUrl();
  if (!invoiceId) {
    showToast('⚠️ Could not detect invoice ID. Make sure you are on a saved invoice page.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Assigning...';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'AUTO_ASSIGN', invoiceId });
    showToast(result.message, result.type);

    // Reload so Zoho shows the updated batch selections
    if (result.ok) setTimeout(() => window.location.reload(), 2500);
  } catch (err) {
    // Typically "Extension context invalidated" after the extension is reloaded
    showToast(`❌ ${err.message}. Refresh this page and try again.`, 'error');
    console.error('[Zoho Batch Auto-Assign]', err);
  } finally {
    btn.disabled    = false;
    btn.textContent = BTN_LABEL;
  }
}

// ─── Button Injection ──────────────────────────────────────

function isInvoicePage() {
  return getInvoiceIdFromUrl() !== null || isNewInvoicePage();
}

function injectButton() {
  if (document.getElementById(BTN_ID)) return;

  const btn       = document.createElement('button');
  btn.id          = BTN_ID;
  btn.textContent = BTN_LABEL;
  btn.className   = 'zba-assign-btn';
  btn.addEventListener('click', autoAssignBatches);
  document.body.appendChild(btn);
}

function removeButton() {
  const btn = document.getElementById(BTN_ID);
  if (btn) btn.remove();
}

// ─── Page Snapshot (diagnostics) ─────────────────────────
// Saves the current page structure to the Downloads folder. Called
// automatically when the batch dropdown can't be read, so the layout
// can be studied and the automation adjusted.

function savePageSnapshot(filename = 'zoho-batch-popup.html') {
  const html = `<!-- URL: ${window.location.href} | ${new Date().toISOString()} -->\n`
             + document.documentElement.outerHTML;
  const blob = new Blob([html], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast(`📸 Page snapshot saved to Downloads as ${filename}`, 'success');
}

// ─── SPA Route Observer ───────────────────────────────────
// Zoho Inventory is a Single Page App — watch for hash/URL changes

function checkPage() {
  if (isInvoicePage()) {
    injectButton();
  } else {
    removeButton();
  }
}

const observer = new MutationObserver(checkPage);
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('hashchange', checkPage);
window.addEventListener('popstate', checkPage);

checkPage();
