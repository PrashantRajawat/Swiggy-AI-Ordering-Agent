const $ = id => document.getElementById(id);
let activeChat = null;
let sending = false;
let profile = { diet: 'any', allergies: [], dislikes: [] };
let mode;
let authenticated = false;
let addressPage = 0;
let addressState = 'idle';
let latestLoad = 0;
let retryAt = 0;
let cooldownTimer;
function startCooldown(until) {
  if (!Number.isFinite(until)) return;
  retryAt = Math.max(retryAt, until);
  clearInterval(cooldownTimer);
  const tick = () => {
    const seconds = Math.ceil((retryAt - Date.now()) / 1000);
    if (seconds <= 0) {
      clearInterval(cooldownTimer);
      retryAt = 0;
      $('chat-status').textContent = 'You may retry the search. Swiggy availability is not yet confirmed.';
    } else $('chat-status').textContent = `Live search is paused for ${seconds}s. You can still chat and update preferences.`;
    setBusy(sending);
  };
  tick();
  if (retryAt > Date.now()) cooldownTimer = setInterval(tick, 1000);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) startCooldown(data.retryAt);
    if (response.status === 401) { authenticated = false; updateConnection(); }
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function showError(error) { $('chat-status').textContent = error.message || String(error); }
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
function scrollBottom() { $('conversation').scrollTop = $('conversation').scrollHeight; }
function setBusy(value) {
  sending = value;
  $('send').disabled = value || !mode;
  $('new-chat').disabled = value;
  $('change-address').disabled = value;
  $('open-settings').disabled = value;
  $('message').disabled = value;
}
function updateConnection() {
  $('mode-badge').textContent = mode === 'mock' ? 'Demo preview' : 'Swiggy live';
  $('connect-swiggy').hidden = mode !== 'live' || authenticated;
  $('onboarding-connect').hidden = mode !== 'live' || authenticated;
  const needsConnection = mode === 'live' && !authenticated;
  const needsAddress = mode === 'live' && !profile.addressId;
  $('connection-banner').hidden = !needsConnection && !needsAddress;
  $('connection-status').textContent = needsConnection ? 'Connect Swiggy to start finding your next meal.' : 'Choose a saved delivery address to continue.';
  setBusy(sending);
}
async function loadAddresses() {
  if (addressState === 'loading') return;
  addressState = 'loading';
  $('retry-addresses').hidden = true;
  $('onboarding-status').textContent = 'Loading your saved delivery addresses…';
  setBusy(sending);
  try {
    const data = await request(`/api/addresses?page=${addressPage + 1}`);
    addressPage = data.pagination.page;
    for (const address of data.addresses) {
      if ([...$('address').options].some(option => option.value === address.id)) continue;
      const option = node('option', '', `${address.addressTag || address.addressCategory || 'Address'} · ${address.addressLine}`);
      option.value = address.id;
      $('address').append(option);
    }
    $('more-addresses').hidden = !data.pagination.hasMore;
    $('address-panel').hidden = false;
    const saved = [...$('address').options].find(option => option.value === profile.addressId);
    if (saved) { $('address').value = saved.value; $('current-address').textContent = saved.textContent; }
    else if (mode === 'mock') { $('address').value = 'mock-home'; }
    addressState = $('address').options.length > 1 ? 'ready' : 'empty';
    $('onboarding-status').textContent = addressState === 'ready' ? (mode === 'mock' ? 'Demo mode uses sample restaurants, coupons, and a sample address.' : 'Choose an address. You can change it anytime.') : 'No saved addresses. Add one in Swiggy, then retry.';
    $('retry-addresses').hidden = addressState !== 'empty';
    updateConnection();
  } catch (error) {
    addressState = profile.addressId ? 'ready' : 'error';
    $('onboarding-status').textContent = error.message;
    $('connection-banner').hidden = false;
    $('connection-status').textContent = profile.addressId ? 'Address refresh failed. Your saved delivery address is still selected.' : 'Your delivery addresses could not be loaded.';
    $('retry-addresses').hidden = false;
    setBusy(sending);
  }
}
async function connect() {
  $('onboarding-connect').disabled = true;
  $('connect-swiggy').disabled = true;
  try { const { authorizeUrl } = await request('/api/mcp/auth/start', json('POST', {})); window.location.assign(authorizeUrl); }
  catch(error) { $('onboarding-status').textContent = error.message; showError(error); }
  finally { $('onboarding-connect').disabled = false; $('connect-swiggy').disabled = false; }
}
async function refreshHistory() {
  const chats = await request('/api/chats');
  $('history').replaceChildren();
  if (!chats.length) $('history').append(node('p', 'empty-history', 'Your next favorite meal starts a conversation.'));
  for (const chat of chats) {
    const row = node('div', `history-row${activeChat?.id === chat.id ? ' active' : ''}`);
    const open = node('button', '', chat.title);
    open.title = chat.title;
    open.addEventListener('click', () => { if (!sending) void openChat(chat.id).catch(showError); });
    const remove = node('button', 'delete-chat', '×');
    remove.setAttribute('aria-label', `Delete ${chat.title}`);
    remove.addEventListener('click', async () => {
      if (sending || !window.confirm('Delete this conversation?')) return;
      try {
        await request(`/api/chats/${chat.id}`, { method: 'DELETE' });
        if (activeChat?.id === chat.id) resetChat();
        await refreshHistory();
      } catch(error) { showError(error); }
    });
    row.append(open, remove); $('history').append(row);
  }
  return chats;
}
function resetChat() {
  latestLoad++;
  activeChat = null; localStorage.removeItem('crave-chat');
  $('messages').replaceChildren(); $('welcome').hidden = false;
  $('chat-status').textContent = ''; $('sidebar').classList.remove('open');
  void refreshHistory().catch(showError);
  $('message').focus();
}
async function openChat(id) {
  const sequence = ++latestLoad;
  const chat = await request(`/api/chats/${id}`);
  if (sequence !== latestLoad) return;
  activeChat = chat; localStorage.setItem('crave-chat', id);
  $('messages').replaceChildren(); $('welcome').hidden = chat.messages.length > 0;
  for (const message of chat.messages) renderMessage(message);
  $('sidebar').classList.remove('open');
  await refreshHistory(); scrollBottom();
}
function renderMessage(message) {
  const article = node('article', `message ${message.role}`);
  const body = node('div', 'message-body');
  if (message.role === 'assistant') {
    const label = node('div', 'assistant-label'); label.append(node('span', '', '✳'), node('strong', '', 'Crave')); body.append(label);
  }
  const text = node('div', 'message-text', message.text); body.append(text);
  if (message.cards?.length) {
    const cards = node('div', 'food-cards');
    message.cards.forEach((card, index) => cards.append(renderCard(card, index)));
    body.append(cards);
  }
  if (message.suggestions?.length) {
    const suggestions = node('div', 'suggestions');
    for (const prompt of message.suggestions) {
      const button = node('button', '', prompt);
      button.addEventListener('click', () => { if (!sending) void sendMessage(prompt); });
      suggestions.append(button);
    }
    body.append(suggestions);
  }
  article.append(body); $('messages').append(article);
  return { article, text };
}
function renderCard(card, index) {
  const article = node('section', 'food-card');
  const header = node('div', 'food-card-head');
  header.append(node('span', 'card-tag', card.overBudget ? 'Above your budget' : index === 0 ? 'Your top match' : 'Another good option'), node('h3', '', card.restaurant));
  const meta = node('div', 'card-meta');
  if (card.rating) meta.append(node('span', 'rating', `★ ${card.rating.toFixed(1)}`));
  if (card.eta) meta.append(document.createTextNode(`${card.rating ? '  ·  ' : ''}${card.eta} min`));
  header.append(meta);
  const body = node('div', 'food-card-body');
  for (const item of card.items) {
    const row = node('div', 'food-item');
    row.append(node('span', '', `${item.quantity} × ${item.name}${item.requiresCustomization ? ' · Customization required' : ''}`), node('span', '', money(item.unitPrice * item.quantity)));
    body.append(row);
  }
  if (card.coupon) body.append(node('div', 'coupon', `${card.coupon} · Demo saving ${money(card.savings)} included`));
  const price = node('div', 'card-price');
  price.append(node('span', '', card.estimate ? 'Estimated item total' : 'Demo total'), node('strong', '', money(card.total))); body.append(price);
  body.append(node('p', 'card-note', card.estimate ? 'Taxes, delivery, packaging and coupons will be verified at checkout.' : `Includes ${money(card.deliveryFee)} demo delivery. Sample prices and offers.`));
  const actions = node('div', 'card-actions');
  const edit = node('button', '', 'Refine in chat');
  edit.addEventListener('click', () => {
    $('message').value = `From ${card.restaurant}, `; $('message').focus();
    $('chat-status').textContent = 'Describe what to change, such as quantity or ingredients. I’ll search again.';
  });
  const review = node('button', '', 'Checkout coming next'); review.disabled = true;
  actions.append(edit, review); body.append(actions); article.append(header,body); return article;
}
async function sendMessage(text) {
  text = text.trim(); if (!text || sending) return;

  setBusy(true); $('chat-status').textContent = 'Understanding your craving…';
  let temporary;
  let userRendered = false;
  try {
    if (!activeChat) { activeChat = await request('/api/chats', json('POST', {})); localStorage.setItem('crave-chat', activeChat.id); }
    $('welcome').hidden = true;
    renderMessage({ role: 'user', text }); userRendered = true;
    $('message').value = ''; $('message').style.height = 'auto';
    temporary = renderMessage({ role: 'assistant', text: '' });
    scrollBottom();
    const response = await fetch(`/api/chats/${activeChat.id}/messages`, json('POST', { message: text }));
    if (!response.ok) {
      const data = await response.json();
      if (response.status === 429) startCooldown(data.retryAt);
      if (response.status === 401) { authenticated = false; updateConnection(); }
      throw new Error(data.error || 'Could not send your message.');
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split('\n\n'); buffer = events.pop();
      for (const event of events) {
        const name = event.match(/^event: (.+)$/m)?.[1];
        const payload = event.match(/^data: (.+)$/m)?.[1];
        if (!payload) continue;
        const data = JSON.parse(payload);
        if (name === 'rate_limited') startCooldown(data.retryAt);
        if (name === 'auth_required') {
          authenticated = false;
          updateConnection();
          $('onboarding-status').textContent = data.text;
        }
        if (name === 'status') $('chat-status').textContent = data.text;
        if (name === 'delta') { temporary.text.textContent += data.text; $('chat-status').textContent = ''; scrollBottom(); }
        if (name === 'done') { temporary.article.remove(); temporary = undefined; renderMessage(data); completed = true; scrollBottom(); }
      }
      if (done) break;
    }
    if (!completed) throw new Error('The connection was interrupted. Reopen this chat to recover the saved reply.');
    if (retryAt <= Date.now()) $('chat-status').textContent = '';
    await refreshHistory();
    profile = await request('/api/profile');
  } catch(error) {
    if (temporary) temporary.article.remove();
    showError(error);
    if (!userRendered) $('message').value = text;
    else if (activeChat) {
      // Recover the server's durable transcript, including replies completed after disconnects.
      try { await openChat(activeChat.id); } catch { /* keep visible error */ }
    }
  } finally { setBusy(false); $('message').focus(); }
}
$('chat-form').addEventListener('submit', event => { event.preventDefault(); void sendMessage($('message').value); });
$('message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void sendMessage($('message').value); }
});
$('message').addEventListener('input', () => { $('message').style.height = 'auto'; $('message').style.height = `${Math.min($('message').scrollHeight,150)}px`; });
$('starter-prompts').addEventListener('click', event => { const button = event.target.closest('[data-prompt]'); if (button) void sendMessage(button.dataset.prompt); });
$('new-chat').addEventListener('click', resetChat);
$('toggle-sidebar').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('change-address').addEventListener('click', () => {
  $('onboarding').showModal();
  if ((mode === 'mock' || authenticated) && addressPage === 0 && addressState !== 'loading') void loadAddresses();
});
$('close-onboarding').addEventListener('click', () => $('onboarding').close());
$('connect-swiggy').addEventListener('click', () => { if (!$('onboarding').open) $('onboarding').showModal(); });
$('onboarding-connect').addEventListener('click', () => { void connect(); });
$('retry-addresses').addEventListener('click', () => { if (!$('onboarding').open) $('onboarding').showModal(); void loadAddresses(); });
$('more-addresses').addEventListener('click', () => { void loadAddresses(); });
$('continue-chat').addEventListener('click', async () => {
  if (!$('address').value) { $('onboarding-status').textContent = 'Please choose a delivery address.'; return; }
  try {
    profile = await request('/api/profile', json('PUT', { ...profile, addressId: $('address').value, addressLabel: $('address').selectedOptions[0].textContent }));
    $('current-address').textContent = $('address').selectedOptions[0].textContent;
    $('onboarding').close(); updateConnection();
    if (activeChat?.messages?.length) $('chat-status').textContent = 'Address updated. Ask me to search again for this location.';
  } catch(error) { $('onboarding-status').textContent = error.message; }
});
$('open-settings').addEventListener('click', async () => {
  try {
    profile = await request('/api/profile');
    $('saved-budget').value = profile.budget || ''; $('saved-diet').value = profile.diet;
    $('saved-allergies').value = profile.allergies.join(', '); $('saved-dislikes').value = profile.dislikes.join(', ');
    $('settings-status').textContent = ''; $('settings').showModal();
  } catch(error) { showError(error); }
});
$('close-settings').addEventListener('click', () => $('settings').close());
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const split = id => $(id).value.split(',').map(x => x.trim()).filter(Boolean);
  try {
    profile = await request('/api/profile', json('PUT', { ...profile, budget: $('saved-budget').value ? Number($('saved-budget').value) : undefined, diet: $('saved-diet').value, allergies: split('saved-allergies'), dislikes: split('saved-dislikes') }));
    $('settings-status').textContent = 'Saved. These preferences apply to new chats.';
  } catch(error) { $('settings-status').textContent = error.message; }
});
async function init() {
  // Establish the HttpOnly session before issuing parallel profile/history requests.
  const status = await request('/api/mcp/status'); mode = status.mode; authenticated = status.authenticated;
  profile = await request('/api/profile');
  if (status.retryAt) startCooldown(status.retryAt);
  updateConnection();
  const chats = await refreshHistory();
  const last = localStorage.getItem('crave-chat');
  if (last && chats.some(chat => chat.id === last)) await openChat(last);
  if (profile.addressId) {
    addressState = 'ready';
    $('current-address').textContent = profile.addressLabel || 'Saved delivery address';
    updateConnection();
  } else if (mode === 'mock' || authenticated) await loadAddresses();
  if (!profile.addressId || (mode === 'live' && !authenticated)) $('onboarding').showModal();
  setBusy(false);
}
void init().catch(showError);
