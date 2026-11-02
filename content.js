/**
 * content.js — Zoho Batch Auto-Assign
 *
 * Injected into every Zoho Inventory page.
 * Watches for invoice pages and injects the
 * "Auto-Assign Batches (FIFO)" button.
 *
 * It works only through Zoho's own invoice form, in the user's
 * existing session, so it needs no API credentials and can't change
 * anything in Zoho until the user clicks Save.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────
const BTN_ID    = 'zba-auto-assign-btn';
const PANEL_ID  = 'zba-panel';
const SNAPSHOT_FILE = 'zoho-batch-dropdown.html';
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

// ─── Panel ────────────────────────────────────────────────
// Previews and results stay on screen until the user closes them.

/** Build an element. Text always goes in as text, never as HTML. */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined));
  return node;
}

function closePanel() {
  document.getElementById(PANEL_ID)?.remove();
}

/** Replace any open panel. Returns the element to fill with content. */
function openPanel(title, tone = 'info') {
  closePanel();
  const body = el('div', { className: 'zba-panel__body' });
  const close = el('button', { className: 'zba-panel__close', type: 'button', textContent: '×', title: 'Close' });
  close.addEventListener('click', closePanel);
  const header = el('div', { className: 'zba-panel__header' }, el('h2', { textContent: title }), close);
  document.body.append(el('section', { id: PANEL_ID, className: `zba-panel zba-panel--${tone}` }, header, body));
  return body;
}

function showMessage(title, message, tone = 'info') {
  openPanel(title, tone).append(el('p', { className: 'zba-panel__text', textContent: message }));
}

function actionButton(label, onClick, primary = false) {
  const btn = el('button', {
    type: 'button',
    textContent: label,
    className: primary ? 'zba-panel__btn zba-panel__btn--primary' : 'zba-panel__btn'
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function cell(text, className = '') {
  return el('td', { textContent: text, className });
}

/** One table row per batch, or one warning row for an item with none. */
function planRows(item) {
  if (item.lines.length === 0) {
    return [el('tr', {}, cell(item.name), cell('—'), cell('—'),
      cell(item.error ? 'Not checked' : 'No batch', 'zba-panel__warn'))];
  }
  return item.lines.map((line, i) => el('tr', {},
    cell(i === 0 ? item.name : ''),
    cell(line.label),
    cell(BatchPlan.formatDate(line.expiry)),
    cell(String(line.qty))));
}

function notesList(items) {
  const notes = items.flatMap(it => BatchPlan.notesFor(it).map(n => `${it.name}: ${n}`));
  if (notes.length === 0) return null;
  return el('ul', { className: 'zba-panel__notes' }, ...notes.map(n => el('li', { textContent: n })));
}

function showPreview(plan) {
  const { items, snapshot } = plan;
  const canFill = items.some(it => it.lines.length > 0);
  const warned  = items.some(it => BatchPlan.notesFor(it).length > 0);
  const body    = openPanel('Batch plan: review before filling', warned ? 'warning' : 'info');
  const head    = el('tr', {}, ...['Item', 'Batch', 'Expires', 'Qty'].map(t => el('th', { textContent: t })));

  body.append(el('table', { className: 'zba-panel__table' },
    el('thead', {}, head),
    el('tbody', {}, ...items.flatMap(planRows))));

  const notes = notesList(items);
  if (notes) body.append(notes);
  if (snapshot) body.append(el('p', { className: 'zba-panel__hint', textContent: `A copy of Zoho's batch list was saved to Downloads as ${SNAPSHOT_FILE}.` }));

  body.append(el('p', { className: 'zba-panel__hint', textContent: 'Nothing is saved to Zoho until you click Save on the invoice.' }));

  const actions = el('div', { className: 'zba-panel__actions' }, actionButton('Cancel', closePanel));
  if (canFill) {
    actions.append(actionButton('Fill these batches', () => confirmPlan(plan), true));
  }
  body.append(actions);
}

function showResults(results) {
  const failed = results.some(r => r.notes.length > 0);
  const body   = openPanel(failed ? 'Done: some items need attention' : 'Batches filled', failed ? 'warning' : 'success');

  body.append(el('ul', { className: 'zba-panel__results' }, ...results.map(r => el('li', {
    className: r.notes.length ? 'zba-panel__result--warn' : 'zba-panel__result--ok',
    textContent: `${r.notes.length ? '⚠' : '✓'} ${r.name}${r.notes.length ? `: ${r.notes.join('; ')}` : ''}`
  }))));
  body.append(el('p', { className: 'zba-panel__hint', textContent: 'Check the batches, then click Save as usual.' }));
}

// ─── Invoice Form Automation ──────────────────────────────
// Drives Zoho's own "Select Batches" pop-up for each line item on the
// invoice form (new or edit). First it opens each pop-up to read the
// batches and build the preview, then it fills them once confirmed.
// Nothing is saved to Zoho until the user clicks Save as Draft / Save
// and Send themselves.

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

function lineItemRows() {
  return [...document.querySelectorAll('tbody.line-item-body tr.line-item')];
}

/** The "Select Batches" link on a line item, if it still needs batches. */
function selectBatchLink(row) {
  return [...(row?.querySelectorAll('td.item-qty a') || [])]
    .find(a => /select batches/i.test(a.textContent));
}

function lineItemName(row, rowIndex) {
  return row.querySelector('.zf-item-details label')?.textContent.trim() || `Item ${rowIndex + 1}`;
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

/** Read one dropdown option into { el, label, expiry, available }. */
function parseOption(el) {
  const lines = el.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const text  = lines.join(' | ');
  const qtyM  = text.match(/(?:available|balance|stock|qty|quantity)[^\d]{0,20}([\d,]+(?:\.\d+)?)/i);
  return {
    el,
    label     : lines[0] || '',
    text,
    expiry    : BatchPlan.parseExpiry(text),
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

const modalRows = (modal) =>
  [...modal.querySelectorAll('table.batches-table tbody > tr')];

/** Open the pop-up for one line item. Returns the modal. */
async function openItemModal(rowIndex) {
  const link = selectBatchLink(lineItemRows()[rowIndex]);
  if (!link) throw new Error('This line no longer needs batches');
  link.click();
  const modal = await waitFor(findBatchModal, 'Select Batches pop-up');
  await sleep(300);
  return modal;
}

/** Leave the pop-up without saving. The first click may only close the dropdown. */
async function cancelBatchModal() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const modal = findBatchModal();
    if (!modal) return;
    const cancel = [...modal.querySelectorAll('.modal-footer button')].find(b => /cancel/i.test(b.textContent))
                || modal.querySelector('.modal-header .close, button.close');
    if (!cancel) break;
    realClick(cancel);
    try {
      await waitFor(() => !findBatchModal(), 'batch pop-up to close', 1200);
      return;
    } catch {
      // Try again
    }
  }
  throw new Error('Could not close the Select Batches pop-up');
}

/** Read one line's pop-up and plan it, leaving the pop-up closed again. */
async function planFormItem(rowIndex, name, today, reserved, plan) {
  const base = { rowIndex, name, needed: 0, lines: [], shortage: 0, expired: [], unknownStock: [], noExpiry: [] };

  const modal  = await openItemModal(rowIndex);
  const needed = readNeededQty(modal);
  if (!(needed > 0)) {
    await cancelBatchModal();
    return { ...base, error: 'Could not read the quantity needed' };
  }

  const options = await openBatchDropdown(modalRows(modal)[0]);
  const batches = options.map(o => ({ id: o.label, label: o.label, expiry: o.expiry, available: o.available }));

  if (options.length === 0 || batches.some(b => b.available === null || b.expiry === null)) {
    // Couldn't read everything from the list — save it so it can be studied
    if (!plan.snapshot) savePageSnapshot();
    plan.snapshot = true;
  }

  reserved[name] = reserved[name] || {};
  const item = { ...base, needed, ...BatchPlan.planItem(needed, batches, today, reserved[name]) };
  await cancelBatchModal();
  return item;
}

async function planForm() {
  const rows = lineItemRows()
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => selectBatchLink(row));

  if (rows.length === 0) {
    showMessage('Nothing to do', 'No line items are waiting for batch selection.');
    return null;
  }

  const plan     = { items: [], snapshot: false };
  const today    = BatchPlan.todayUtc();
  const reserved = {};
  const empty    = { needed: 0, lines: [], shortage: 0, expired: [], unknownStock: [], noExpiry: [] };

  for (let i = 0; i < rows.length; i++) {
    const { rowIndex, row } = rows[i];
    const name = lineItemName(row, rowIndex);
    try {
      plan.items.push(await planFormItem(rowIndex, name, today, reserved, plan));
    } catch (err) {
      console.error('[Zoho Batch Auto-Assign]', err);
      plan.items.push({ rowIndex, name, ...empty, error: err.message });
      try {
        await cancelBatchModal();
      } catch (closeErr) {
        // A stuck pop-up blocks every later line, so stop reading here
        for (const later of rows.slice(i + 1)) {
          plan.items.push({ rowIndex: later.rowIndex, name: lineItemName(later.row, later.rowIndex), ...empty, error: closeErr.message });
        }
        break;
      }
    }
    await sleep(300);
  }
  return plan;
}

/** Enter one line's planned batches into its pop-up and save the pop-up. */
async function fillFormItem(item) {
  const modal = await openItemModal(item.rowIndex);
  if (readNeededQty(modal) !== item.needed) {
    throw new Error('Quantity changed after the preview; click the button again');
  }

  for (let i = 0; i < item.lines.length; i++) {
    if (i > 0) {
      const before = modalRows(modal).length;
      const newRowBtn = [...modal.querySelectorAll('button')].find(b => /new row/i.test(b.textContent));
      if (!newRowBtn) throw new Error('"New Row" button not found in pop-up');
      realClick(newRowBtn);
      await waitFor(() => modalRows(modal).length > before, 'new batch row');
    }
    const row = modalRows(modal)[i];

    await openBatchDropdown(row);
    const optEl = findOpenOptions().find(o => parseOption(o).label === item.lines[i].label);
    if (!optEl) throw new Error(`Batch "${item.lines[i].label}" not found in dropdown`);
    realClick(optEl);
    await sleep(300);

    const qtyInput = row.querySelector('input[data-auto-gen-binding-key="out_quantity"]');
    if (!qtyInput) throw new Error('Quantity Out box not found in pop-up');
    setInputValue(qtyInput, item.lines[i].qty);
    await sleep(200);
  }

  // Save the pop-up (not the invoice)
  const saveBtn = modal.querySelector('.modal-footer button[type="submit"]');
  realClick(saveBtn);
  await waitFor(() => !findBatchModal(), 'batch pop-up to close', 4000)
    .catch(() => { throw new Error('Zoho did not accept the batches'); });
}

/** Fill every planned line. One failure doesn't stop the lines after it. */
async function fillForm(plan) {
  const results = [];

  for (let i = 0; i < plan.items.length; i++) {
    const item  = plan.items[i];
    const notes = BatchPlan.notesFor(item);

    if (item.lines.length === 0) {
      results.push({ name: item.name, notes });
      continue;
    }

    try {
      await fillFormItem(item);
    } catch (err) {
      console.error('[Zoho Batch Auto-Assign]', err);
      notes.unshift(err.message);
      try {
        await cancelBatchModal();
      } catch (closeErr) {
        // A stuck pop-up blocks every later line
        results.push({ name: item.name, notes: [...notes, closeErr.message] });
        for (const later of plan.items.slice(i + 1)) {
          results.push({ name: later.name, notes: ['Not filled: the pop-up above is still open'] });
        }
        break;
      }
    }
    results.push({ name: item.name, notes });
    await sleep(500);
  }

  showResults(results);
}

// ─── Main Auto-Assign Handler ─────────────────────────────

/** Run work with the button disabled, showing any failure in the panel. */
async function withBusyButton(label, work) {
  const btn = document.getElementById(BTN_ID);
  if (btn) {
    btn.disabled    = true;
    btn.textContent = label;
  }
  try {
    await work();
  } catch (err) {
    showMessage('Something went wrong', `${err.message}. Refresh this page and try again.`, 'error');
    console.error('[Zoho Batch Auto-Assign]', err);
  } finally {
    const current = document.getElementById(BTN_ID);
    if (current) {
      current.disabled    = false;
      current.textContent = BTN_LABEL;
    }
  }
}

function autoAssignBatches() {
  closePanel();
  return withBusyButton('⏳ Checking batches...', async () => {
    if (!document.querySelector('tbody.line-item-body')) {
      showMessage('Click Edit first', 'Batches are filled in on the invoice form. Click Edit on this invoice, then use the button again.');
      return;
    }
    const plan = await planForm();
    if (plan) showPreview(plan);
  });
}

function confirmPlan(plan) {
  closePanel();
  return withBusyButton('⏳ Filling batches...', () => fillForm(plan));
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
  document.getElementById(BTN_ID)?.remove();
  closePanel();
}

// ─── Page Snapshot (diagnostics) ─────────────────────────
// Saves the current page structure to the Downloads folder. Called
// automatically when the batch dropdown can't be read, so the layout
// can be studied and the automation adjusted.

function savePageSnapshot(filename = SNAPSHOT_FILE) {
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
