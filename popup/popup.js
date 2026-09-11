'use strict';

const clientIdInput     = document.getElementById('client-id');
const clientSecretInput = document.getElementById('client-secret');
const refreshTokenInput = document.getElementById('refresh-token');
const saveBtn           = document.getElementById('save-btn');
const savedMsg          = document.getElementById('saved-msg');
const statusDot         = document.getElementById('status-dot');
const statusText        = document.getElementById('status-text');

// Guide & Redirection elements
const guideToggle       = document.getElementById('guide-toggle');
const guideBody         = document.getElementById('guide-body');
const guideChevron      = document.getElementById('guide-chevron');
const openConsoleBtn    = document.getElementById('open-console-btn');
const copyScopeBtn      = document.getElementById('copy-scope-btn');
const grantCodeInput    = document.getElementById('grant-code');
const exchangeBtn       = document.getElementById('exchange-btn');
const exchangeError     = document.getElementById('exchange-error');
const exchangeSuccess   = document.getElementById('exchange-success');

function setStatus(state, text) {
  statusDot.className    = `status-dot ${state}`;
  statusText.textContent = text;
}

// ─── Load Status ───────────────────────────────────────────

async function loadStatus() {
  const data = await chrome.storage.local.get(['client_id', 'client_secret', 'refresh_token']);

  if (data.client_id && data.client_secret && data.refresh_token) {
    setStatus('valid', 'Credentials configured — ready to use');
    clientIdInput.value     = data.client_id;
    clientSecretInput.value = data.client_secret;
    refreshTokenInput.value = data.refresh_token;
  } else {
    setStatus('invalid', 'No credentials saved — see guide below');
    // Auto-expand guide for new users who have not configured yet
    guideBody.classList.remove('hidden');
    guideChevron.classList.add('open');
  }
}

// ─── Save Credentials Manually ─────────────────────────────

saveBtn.addEventListener('click', async () => {
  const clientId     = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();
  const refreshToken = refreshTokenInput.value.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    setStatus('invalid', 'Please fill in all three fields');
    return;
  }

  // Clear any old cached token so new credentials take effect immediately
  await chrome.storage.local.set({
    client_id     : clientId,
    client_secret : clientSecret,
    refresh_token : refreshToken,
    access_token  : null,
    token_expiry  : 0
  });

  setStatus('valid', 'Credentials saved — ready to use');
  savedMsg.classList.remove('hidden');
  setTimeout(() => savedMsg.classList.add('hidden'), 4000);
});

// ─── Guide Toggle Accordion ────────────────────────────────

guideToggle.addEventListener('click', () => {
  const isHidden = guideBody.classList.toggle('hidden');
  guideChevron.classList.toggle('open', !isHidden);
});

// ─── Redirection to Zoho API Console ───────────────────────

openConsoleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://api-console.zoho.com/' });
});

// ─── Copy Scope Button ─────────────────────────────────────

copyScopeBtn.addEventListener('click', async () => {
  const scope = 'ZohoInventory.fullaccess.ALL';
  try {
    await navigator.clipboard.writeText(scope);
    copyScopeBtn.textContent = 'Copied! ✓';
    setTimeout(() => {
      copyScopeBtn.textContent = 'Copy';
    }, 2000);
  } catch (err) {
    // Fallback if clipboard API is restricted
    const ta = document.createElement('textarea');
    ta.value = scope;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    copyScopeBtn.textContent = 'Copied! ✓';
    setTimeout(() => {
      copyScopeBtn.textContent = 'Copy';
    }, 2000);
  }
});

// ─── Exchange Code for Refresh Token ───────────────────────

exchangeBtn.addEventListener('click', async () => {
  const clientId     = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();
  const grantCode    = grantCodeInput.value.trim();

  exchangeError.classList.add('hidden');
  exchangeSuccess.classList.add('hidden');

  if (!clientId || !clientSecret) {
    exchangeError.textContent = '⚠️ Please enter your Client ID and Client Secret in the fields above first.';
    exchangeError.classList.remove('hidden');
    return;
  }

  if (!grantCode) {
    exchangeError.textContent = '⚠️ Please paste the generated 10-minute code from Zoho.';
    exchangeError.classList.remove('hidden');
    return;
  }

  exchangeBtn.disabled    = true;
  exchangeBtn.textContent = '⏳ Exchanging with Zoho...';

  try {
    const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code          : grantCode,
        client_id     : clientId,
        client_secret : clientSecret,
        grant_type    : 'authorization_code',
        redirect_uri  : 'http://www.zoho.com/inventory'
      })
    });

    const data = await resp.json();

    if (data.refresh_token) {
      // Auto-fill the refresh token field
      refreshTokenInput.value = data.refresh_token;
      grantCodeInput.value    = '';

      const expiry = Date.now() + (data.expires_in || 3600) * 1000;

      // Save everything to permanent storage
      await chrome.storage.local.set({
        client_id     : clientId,
        client_secret : clientSecret,
        refresh_token : data.refresh_token,
        access_token  : data.access_token || null,
        token_expiry  : expiry
      });

      setStatus('valid', 'Credentials configured — ready to use');
      exchangeSuccess.classList.remove('hidden');
      setTimeout(() => exchangeSuccess.classList.add('hidden'), 5000);
    } else {
      const errMsg = data.error || data.message || JSON.stringify(data);
      if (errMsg.includes('invalid_code')) {
        exchangeError.textContent = '❌ Invalid or expired code. Generate a fresh 10-minute code in Zoho and try again.';
      } else {
        exchangeError.textContent = `❌ Zoho error: ${errMsg}`;
      }
      exchangeError.classList.remove('hidden');
    }
  } catch (err) {
    exchangeError.textContent = `❌ Network/Connection error: ${err.message}`;
    exchangeError.classList.remove('hidden');
  } finally {
    exchangeBtn.disabled    = false;
    exchangeBtn.textContent = '⚡ Exchange Code & Save Permanently';
  }
});

// Initialize
loadStatus();
