/**
 * service-worker.js — Zoho Batch Auto-Assign
 *
 * All Zoho network calls live here. Content scripts are bound by the
 * Zoho page's CORS rules, so fetches to accounts.zoho.com / zohoapis.com
 * from content.js fail with "Failed to fetch". The service worker is an
 * extension context and can use the manifest's host_permissions.
 *
 * content.js sends { type: 'AUTO_ASSIGN', invoiceId } and receives
 * { ok, type, message } to display as a toast.
 */
'use strict';

// ─── Constants ────────────────────────────────────────────
const ORG_ID   = 'YOUR_ORGANIZATION_ID';
const BASE_URL = 'https://www.zohoapis.com/inventory/v1';
const LOG      = '[Zoho Batch Auto-Assign]';

chrome.runtime.onInstalled.addListener(() => {
  console.log(`${LOG} Extension installed.`);
});

// ─── Token Management (auto-refresh) ──────────────────────

/**
 * Returns a valid access token, refreshing it silently if expired.
 * Uses the stored client_id, client_secret, and refresh_token.
 */
async function getValidToken() {
  const data = await chrome.storage.local.get([
    'client_id', 'client_secret', 'refresh_token',
    'access_token', 'token_expiry'
  ]);

  const { client_id, client_secret, refresh_token, access_token, token_expiry } = data;

  if (!client_id || !client_secret || !refresh_token) {
    throw new Error('NO_CREDENTIALS');
  }

  // Return cached token if still valid (with 60s buffer)
  if (access_token && token_expiry && (token_expiry - Date.now()) > 60000) {
    return access_token;
  }

  const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token : refresh_token,
      client_id     : client_id,
      client_secret : client_secret,
      grant_type    : 'refresh_token'
    })
  });

  const tokenData = await resp.json();

  if (!tokenData.access_token) {
    throw new Error(`Token refresh failed: ${tokenData.error || JSON.stringify(tokenData)}`);
  }

  await chrome.storage.local.set({
    access_token : tokenData.access_token,
    token_expiry : Date.now() + (tokenData.expires_in || 3600) * 1000
  });

  return tokenData.access_token;
}

// ─── API Helpers ──────────────────────────────────────────

async function zohoRequest(method, endpoint, token, body) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}/${endpoint}${sep}organization_id=${ORG_ID}`;
  const opts = {
    method,
    headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  const data = await resp.json();
  console.log(`${LOG} ${method} ${endpoint} →`, data);
  return data;
}

// ─── Core FIFO Logic ──────────────────────────────────────

/**
 * Fetch available batches for an item, sorted by expiry (FIFO).
 * Throws on API errors so they are shown to the user instead of
 * being mistaken for "item is not batch-tracked".
 */
async function getItemBatches(itemId, itemName, token) {
  const data = await zohoRequest('GET', `items/batches?item_id=${itemId}&include_empty_batches=false`, token);
  if (data.code !== 0) {
    throw new Error(`Could not fetch batches for "${itemName}": ${data.message} (code ${data.code})`);
  }

  const batches = (data.batches || []).filter(b => parseFloat(b.available_stock || 0) > 0);

  // Sort oldest expiry first; no-expiry items go last
  batches.sort((a, b) => {
    const da = a.expiry_date || '9999-12-31';
    const db = b.expiry_date || '9999-12-31';
    return da.localeCompare(db);
  });

  return batches;
}

/** FIFO-assign available batches to cover quantity_needed. */
function assignFifo(quantityNeeded, batches) {
  const assigned = [];
  let remaining  = parseFloat(quantityNeeded);

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(parseFloat(batch.available_stock || 0), remaining);
    if (take > 0) {
      assigned.push({ batch_id: batch.batch_id, quantity: take });
      remaining -= take;
    }
  }

  return { assigned, shortage: Math.max(0, remaining) };
}

// ─── Main Auto-Assign Function ────────────────────────────

async function autoAssignBatches(invoiceId) {
  let token;
  try {
    token = await getValidToken();
  } catch (err) {
    if (err.message === 'NO_CREDENTIALS') {
      return { ok: false, type: 'error', message: '⚠️ Extension not configured. Click the extension icon in your toolbar to set up credentials.' };
    }
    return { ok: false, type: 'error', message: `⚠️ Could not refresh token: ${err.message}` };
  }

  // 1. Fetch invoice
  const invData = await zohoRequest('GET', `invoices/${invoiceId}`, token);
  if (invData.code !== 0) {
    return { ok: false, type: 'error', message: `❌ Could not fetch invoice: ${invData.message} (code ${invData.code})` };
  }

  const lineItems = invData.invoice?.line_items || [];
  if (lineItems.length === 0) {
    return { ok: false, type: 'info', message: 'ℹ️ No line items found on this invoice.' };
  }

  // 2. Build updated line items with batch_details
  let assignedCount  = 0;
  const shortages    = [];
  const updatedItems = [];

  for (const li of lineItems) {
    const liPayload = {
      line_item_id : li.line_item_id,
      item_id      : li.item_id,
      quantity     : li.quantity,
      rate         : li.rate,
      unit         : li.unit,
      description  : li.description || '',
      discount     : li.discount,
      tax_id       : li.tax_id
    };
    if (li.warehouse_id) liPayload.warehouse_id = li.warehouse_id;

    if (!li.item_id || li.is_combo_product) {
      updatedItems.push(liPayload);
      continue;
    }

    const batches = await getItemBatches(li.item_id, li.name, token);

    if (batches.length === 0) {
      // Not batch-tracked or no stock — pass through unchanged
      updatedItems.push(liPayload);
      continue;
    }

    const { assigned, shortage } = assignFifo(li.quantity || 0, batches);
    if (shortage > 0) shortages.push(`${li.name}: short by ${shortage}`);

    liPayload.batch_details = assigned;
    updatedItems.push(liPayload);
    assignedCount++;
  }

  if (assignedCount === 0) {
    return { ok: false, type: 'info', message: 'ℹ️ No batch-tracked items with available stock found on this invoice.' };
  }

  // 3. PUT updated invoice
  const updateResp = await zohoRequest('PUT', `invoices/${invoiceId}`, token, { line_items: updatedItems });

  if (updateResp.code !== 0) {
    return { ok: false, type: 'error', message: `❌ Update failed: ${updateResp.message} (code ${updateResp.code})` };
  }

  let message = `✅ Batches assigned for ${assignedCount} item(s)!`;
  if (shortages.length > 0) {
    message += `\n⚠️ Stock shortages:\n• ${shortages.join('\n• ')}`;
  }
  return { ok: true, type: shortages.length > 0 ? 'warning' : 'success', message };
}

// ─── Message Bridge ───────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'AUTO_ASSIGN') return false;

  autoAssignBatches(msg.invoiceId)
    .then(sendResponse)
    .catch(err => {
      console.error(LOG, err);
      sendResponse({ ok: false, type: 'error', message: `❌ ${err.message}` });
    });

  return true; // keep the channel open for the async response
});
