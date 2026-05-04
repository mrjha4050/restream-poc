// Global state
let platformConfigs = {};
let isStreamRunning = false;
let uptimeInterval = null;
let statusCheckInterval = null;
let streamStartTime = null;
let allLogs = [];
let logFilter = 'all';
let youtubeAuthStatus = { connected: false, email: null };

// Overlay state
let productDismissTimer = null;
let timerInterval = null;

const PRODUCTS = [
  { id: 1, name: 'Pro Headphones',   price: '$49',  originalPrice: '$79',  emoji: '🎧', url: '#' },
  { id: 2, name: 'Smart Watch',      price: '$129', originalPrice: '$199', emoji: '⌚', url: '#' },
  { id: 3, name: 'Wireless Speaker', price: '$39',  originalPrice: '$69',  emoji: '🔊', url: '#' },
  { id: 4, name: 'Phone Stand',      price: '$19',  originalPrice: '$29',  emoji: '📱', url: '#' }
];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('youtube') === 'connected') {
    addLog('YouTube authorization successful', 'connection');
    window.history.replaceState({}, '', '/');
  } else if (params.get('youtube') === 'error') {
    showError('YouTube authorization failed or was cancelled');
    window.history.replaceState({}, '', '/');
  }

  await loadPlatforms();
  renderOverlayProducts();
  setupEventListeners();
  startStatusCheck();
  connectLogs();
});

// Load platforms from backend
async function loadPlatforms() {
  try {
    const res = await fetch('/platforms');
    const platforms = await res.json();
    platformConfigs = platforms.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {});
    renderPlatforms();
    await checkYouTubeAuthStatus();
  } catch (e) {
    console.error('Failed to load platforms:', e);
  }
}

async function checkYouTubeAuthStatus() {
  try {
    const res = await fetch('/auth/youtube/status');
    youtubeAuthStatus = await res.json();
    updateYouTubeCard();
  } catch (e) {
    console.error('YouTube status check failed:', e);
  }
}

function updateYouTubeCard() {
  const statusEl = document.getElementById('youtube-auth-status');
  const oauthBtn = document.getElementById('youtube-oauth-btn');
  const startBtn = document.getElementById('youtube-start-btn');
  const disconnectBtn = document.getElementById('youtube-disconnect-btn');
  if (!statusEl) return;

  const card = document.getElementById('platform-youtube');
  const isLive = card && card.classList.contains('live');

  if (youtubeAuthStatus.connected) {
    statusEl.textContent = `Connected as ${youtubeAuthStatus.email || 'YouTube account'}`;
    statusEl.style.color = 'var(--success)';
    oauthBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    const ivsOk = !!document.getElementById('ivsUrl').value.trim();
    startBtn.style.display = isLive ? 'none' : '';
    startBtn.disabled = !ivsOk || isLive;
  } else {
    statusEl.textContent = 'Not connected';
    statusEl.style.color = 'var(--text-tertiary)';
    oauthBtn.style.display = '';
    startBtn.style.display = 'none';
    disconnectBtn.style.display = 'none';
  }
}

async function startYouTubeStream() {
  const ivsUrl = document.getElementById('ivsUrl').value.trim();
  if (!ivsUrl) { showError('IVS URL is required'); return; }

  const startBtn = document.getElementById('youtube-start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Fetching key...';

  const autoRestart = document.getElementById('autoRestart').checked;
  const maxRestarts = parseInt(document.getElementById('maxRestarts').value, 10) || 5;

  try {
    const res = await fetch('/auth/youtube/fetch-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ivsUrl, autoRestart, maxRestarts })
    });
    const data = await res.json();
    if (!res.ok) { showError(data.message || 'Failed to start YouTube'); return; }
    addLog(data.autoStarted ? 'YouTube stream auto-started via OAuth' : 'YouTube key fetched', 'connection');
  } catch (e) {
    showError('YouTube start failed: ' + e.message);
  } finally {
    startBtn.textContent = 'Start Stream';
    updateYouTubeCard();
  }
}

async function disconnectYouTube() {
  try {
    await fetch('/auth/youtube/disconnect', { method: 'POST' });
    youtubeAuthStatus = { connected: false, email: null };
    updateYouTubeCard();
    addLog('YouTube OAuth disconnected', 'disconnection');
  } catch (e) {
    showError('Failed to disconnect YouTube: ' + e.message);
  }
}

// Render platform cards
function renderPlatforms() {
  const grid = document.getElementById('platformsGrid');
  grid.innerHTML = '';

  Object.entries(platformConfigs).forEach(([id, config]) => {
    const card = document.createElement('div');
    card.className = 'platform-card';
    card.id = `platform-${id}`;

    const title = document.createElement('div');
    title.className = 'platform-name';
    title.innerHTML = `<span>${config.name}</span><span class="platform-live-badge">Live</span>`;

    if (id === 'youtube') {
      // YouTube OAuth card
      const oauthArea = document.createElement('div');
      oauthArea.id = 'youtube-oauth-area';
      oauthArea.className = 'youtube-oauth-area';

      const statusLine = document.createElement('div');
      statusLine.id = 'youtube-auth-status';
      statusLine.className = 'youtube-auth-status';
      statusLine.textContent = 'Not connected';

      const actions = document.createElement('div');
      actions.className = 'platform-actions';

      const oauthBtn = document.createElement('button');
      oauthBtn.type = 'button';
      oauthBtn.className = 'btn btn-primary';
      oauthBtn.id = 'youtube-oauth-btn';
      oauthBtn.textContent = 'Connect with YouTube';
      oauthBtn.addEventListener('click', () => { window.location.href = '/auth/youtube'; });

      const startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'btn btn-primary';
      startBtn.id = 'youtube-start-btn';
      startBtn.textContent = 'Start Stream';
      startBtn.style.display = 'none';
      startBtn.addEventListener('click', () => startYouTubeStream());

      const disconnectBtn = document.createElement('button');
      disconnectBtn.type = 'button';
      disconnectBtn.className = 'btn btn-danger';
      disconnectBtn.id = 'youtube-disconnect-btn';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.style.display = 'none';
      disconnectBtn.addEventListener('click', () => disconnectYouTube());

      const stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'btn btn-danger';
      stopBtn.dataset.platformDisconnect = 'youtube';
      stopBtn.textContent = 'Stop';
      stopBtn.disabled = true;
      stopBtn.addEventListener('click', () => disconnectPlatform('youtube'));

      actions.appendChild(oauthBtn);
      actions.appendChild(startBtn);
      actions.appendChild(disconnectBtn);
      actions.appendChild(stopBtn);

      oauthArea.appendChild(statusLine);
      card.appendChild(title);
      card.appendChild(oauthArea);
      card.appendChild(actions);
    } else {
      // Regular platform card (Twitch, Facebook, Custom)
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'input-field';
      keyInput.placeholder = `${config.name} stream key`;
      keyInput.dataset.platformKey = id;
      keyInput.autocomplete = 'off';

      const actions = document.createElement('div');
      actions.className = 'platform-actions';

      const connectBtn = document.createElement('button');
      connectBtn.type = 'button';
      connectBtn.className = 'btn btn-primary';
      connectBtn.dataset.platformConnect = id;
      connectBtn.textContent = 'Connect';

      const disconnectBtn = document.createElement('button');
      disconnectBtn.type = 'button';
      disconnectBtn.className = 'btn btn-danger';
      disconnectBtn.dataset.platformDisconnect = id;
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.disabled = true;

      connectBtn.addEventListener('click', () => connectPlatform(id));
      disconnectBtn.addEventListener('click', () => disconnectPlatform(id));

      const onKeyOrIvsChange = () => updatePlatformControls(id);
      keyInput.addEventListener('input', onKeyOrIvsChange);

      actions.appendChild(connectBtn);
      actions.appendChild(disconnectBtn);

      card.appendChild(title);
      card.appendChild(keyInput);
      card.appendChild(actions);
    }

    grid.appendChild(card);
  });

  const ivsEl = document.getElementById('ivsUrl');
  ivsEl.removeEventListener('input', refreshAllPlatformControls);
  ivsEl.addEventListener('input', refreshAllPlatformControls);
  ivsEl.addEventListener('input', () => updateYouTubeCard());
}

function refreshAllPlatformControls() {
  Object.keys(platformConfigs).forEach(id => updatePlatformControls(id));
}

function updatePlatformControls(platformId) {
  if (platformId === 'youtube') { updateYouTubeCard(); return; }

  const card = document.getElementById(`platform-${platformId}`);
  const connectBtn = document.querySelector(`[data-platform-connect="${platformId}"]`);
  const disconnectBtn = document.querySelector(`[data-platform-disconnect="${platformId}"]`);
  const keyInput = document.querySelector(`[data-platform-key="${platformId}"]`);
  if (!card || !connectBtn || !disconnectBtn || !keyInput) return;

  const ivsOk = !!document.getElementById('ivsUrl').value.trim();
  const keyOk = !!keyInput.value.trim();
  const running = card.classList.contains('live');

  connectBtn.disabled = running || !ivsOk || !keyOk || connectBtn.dataset.connecting === '1';
  if (connectBtn.dataset.connecting !== '1') {
    connectBtn.textContent = 'Connect';
  }
  disconnectBtn.disabled = !running;
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('stopBtn').addEventListener('click', stopAllStreams);
  document.getElementById('logFilter').addEventListener('change', (e) => {
    logFilter = e.target.value;
    renderLogs();
  });
  document.getElementById('clearLogsBtn').addEventListener('click', () => {
    allLogs = [];
    document.getElementById('logsContainer').innerHTML = '';
  });
  document.getElementById('startTimerBtn').addEventListener('click', sendTimerOverlay);
  document.getElementById('productDismiss').addEventListener('click', hideProductOverlay);
}

// ─── Overlay: Products ───────────────────────────────────────────────────────

function renderOverlayProducts() {
  const grid = document.getElementById('overlayProductsGrid');
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="overlay-product-card">
      <span class="product-emoji">${p.emoji}</span>
      <div class="product-name">${p.name}</div>
      <span class="product-price">${p.price}</span>
      <button class="btn btn-primary" onclick="sendProductOverlay(${p.id})">Show Overlay</button>
    </div>
  `).join('');
}

function getChannelArn() {
  return document.getElementById('channelArn').value.trim();
}

async function sendProductOverlay(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  const payload = { type: 'product', ...product, duration: 10000 };
  showProductOverlay(payload);
  addLog(`Popup shown: ${product.name}`, 'success');

  const channelArn = getChannelArn();
  if (!channelArn) {
    addLog('No Channel ARN — IVS metadata skipped (popup is local only)', 'info');
    return;
  }
  try {
    const res = await fetch('/overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelArn, payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    addLog(`IVS metadata sent: ${product.name}`, 'success');
  } catch (err) {
    addLog(`IVS metadata failed (popup still visible): ${err.message}`, 'error');
  }
}

async function sendTimerOverlay() {
  const duration = parseInt(document.getElementById('timerDuration').value, 10);
  const code = document.getElementById('timerCodeInput').value.trim().toUpperCase();
  const discount = document.getElementById('timerDiscountInput').value.trim();

  if (!duration || duration < 10) return showTimerFeedback('Duration must be at least 10 seconds.', true);
  if (!code) return showTimerFeedback('Discount code is required.', true);
  if (!discount) return showTimerFeedback('Discount label is required.', true);

  const payload = { type: 'timer', code, discount, duration };
  showTimerOverlay(payload);
  showTimerFeedback(`Showing: ${formatMMSS(duration)} — ${code}`, false);
  addLog(`Timer popup shown: ${code} (${formatMMSS(duration)})`, 'success');

  const channelArn = getChannelArn();
  if (!channelArn) {
    addLog('No Channel ARN — IVS metadata skipped (popup is local only)', 'info');
    return;
  }
  try {
    const res = await fetch('/overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelArn, payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    addLog(`IVS metadata sent for timer: ${code}`, 'success');
  } catch (err) {
    showTimerFeedback(`IVS failed (popup still visible): ${err.message}`, true);
    addLog(`IVS metadata failed: ${err.message}`, 'error');
  }
}

// ─── Overlay: Display ────────────────────────────────────────────────────────

function showProductOverlay(payload) {
  document.getElementById('productEmoji').textContent = payload.emoji || '🛍️';
  document.getElementById('productName').textContent = payload.name;
  document.getElementById('productPrice').textContent = payload.price;
  document.getElementById('productOriginalPrice').textContent = payload.originalPrice || '';
  document.getElementById('productUrl').href = payload.url || '#';

  const overlay = document.getElementById('productOverlay');
  overlay.classList.remove('overlay-fadeout');
  overlay.style.display = 'block';

  const bar = document.getElementById('productProgress');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  bar.offsetWidth; // force reflow
  bar.style.transition = `width ${payload.duration}ms linear`;
  bar.style.width = '0%';

  clearTimeout(productDismissTimer);
  productDismissTimer = setTimeout(hideProductOverlay, payload.duration);
}

function hideProductOverlay() {
  clearTimeout(productDismissTimer);
  const overlay = document.getElementById('productOverlay');
  overlay.classList.add('overlay-fadeout');
  setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('overlay-fadeout'); }, 300);
}

function showTimerOverlay(payload) {
  document.getElementById('timerDiscount').textContent = payload.discount || '';
  document.getElementById('timerCode').textContent = payload.code || '';

  const overlay = document.getElementById('timerOverlay');
  overlay.classList.remove('overlay-fadeout');
  overlay.style.display = 'block';

  clearInterval(timerInterval);
  let remaining = payload.duration;
  document.getElementById('timerCountdown').textContent = formatMMSS(remaining);
  timerInterval = setInterval(() => {
    remaining--;
    document.getElementById('timerCountdown').textContent = formatMMSS(remaining);
    if (remaining <= 0) { clearInterval(timerInterval); hideTimerOverlay(); }
  }, 1000);
}

function hideTimerOverlay() {
  clearInterval(timerInterval);
  const overlay = document.getElementById('timerOverlay');
  overlay.classList.add('overlay-fadeout');
  setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('overlay-fadeout'); }, 300);
}

function showTimerFeedback(message, isError) {
  const el = document.getElementById('timerFeedback');
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function formatMMSS(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0');
  const s = (Math.max(0, seconds) % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function connectPlatform(platformId) {
  const ivsUrl = document.getElementById('ivsUrl').value.trim();
  const keyInput = document.querySelector(`[data-platform-key="${platformId}"]`);
  const key = keyInput.value.trim();
  const connectBtn = document.querySelector(`[data-platform-connect="${platformId}"]`);

  if (!ivsUrl) {
    showError('IVS URL is required');
    return;
  }
  if (!key) {
    showError(`Enter a stream key for ${platformConfigs[platformId].name}`);
    return;
  }

  const autoRestart = document.getElementById('autoRestart').checked;
  const maxRestarts = parseInt(document.getElementById('maxRestarts').value, 10) || 5;

  const body = { ivsUrl, key, autoRestart, maxRestarts };
  if (platformId === 'custom') {
    body.customUrl = key.split('/').slice(0, -1).join('/') + '/';
  }

  connectBtn.dataset.connecting = '1';
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  try {
    const res = await fetch(`/platforms/${platformId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.message || 'Failed to connect');
    }
  } catch (e) {
    showError('Server connection failed: ' + e.message);
  } finally {
    delete connectBtn.dataset.connecting;
    updatePlatformControls(platformId);
  }
}

async function disconnectPlatform(platformId) {
  const disconnectBtn = document.querySelector(`[data-platform-disconnect="${platformId}"]`);
  disconnectBtn.disabled = true;

  try {
    const res = await fetch(`/platforms/${platformId}/stop`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok && res.status !== 404) {
      showError(data.message || 'Failed to disconnect');
    }
  } catch (e) {
    showError('Failed to disconnect: ' + e.message);
  } finally {
    updatePlatformControls(platformId);
  }
}

// Stop all outputs
async function stopAllStreams() {
  const stopBtn = document.getElementById('stopBtn');
  stopBtn.disabled = true;

  try {
    await fetch('/stop', { method: 'POST' });
    isStreamRunning = false;
    streamStartTime = null;
    clearInterval(uptimeInterval);
    updateStatus('offline');
    document.querySelectorAll('.platform-card').forEach(el => el.classList.remove('live'));
    refreshAllPlatformControls();
    addLog('✓ All outputs stopped', 'success');
  } catch (e) {
    showError('Failed to stop: ' + e.message);
  } finally {
    stopBtn.disabled = !isStreamRunning;
  }
}

// Start uptime timer
function startUptimeTimer() {
  clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    if (streamStartTime) {
      const uptime = Math.floor((Date.now() - streamStartTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;
      document.getElementById('statUptime').textContent =
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }, 1000);
}

// Check stream status
async function startStatusCheck() {
  statusCheckInterval = setInterval(async () => {
    try {
      const res = await fetch('/status');
      const status = await res.json();

      const anyRunning = status.anyRunning || status.running;

      if (!isStreamRunning && anyRunning) {
        isStreamRunning = true;
        streamStartTime = Date.now() - (status.uptime || 0) * 1000;
        updateStatus('online');
        startUptimeTimer();
      } else if (isStreamRunning && !anyRunning) {
        isStreamRunning = false;
        streamStartTime = null;
        clearInterval(uptimeInterval);
        updateStatus('offline');
        document.getElementById('stopBtn').disabled = true;
      }

      if (anyRunning) {
        document.getElementById('stopBtn').disabled = false;
        if (status.uptime != null) {
          streamStartTime = Date.now() - status.uptime * 1000;
        }
      }

      if (status.platforms) {
        Object.entries(status.platforms).forEach(([id, p]) => {
          const card = document.getElementById(`platform-${id}`);
          if (card) {
            card.classList.toggle('live', !!p.running);
          }
        });
        refreshAllPlatformControls();
        updateYouTubeCard();
      }

      document.getElementById('statStatus').textContent = anyRunning ? 'LIVE' : 'OFFLINE';
      document.getElementById('statStatus').className = `stat-value ${anyRunning ? 'online' : 'offline'}`;
      document.getElementById('statOutputs').textContent = status.activeCount ?? 0;

      const restartSum = status.platforms
        ? Object.values(status.platforms).reduce((s, p) => s + (p.restarts || 0), 0)
        : 0;
      document.getElementById('statRestarts').textContent = String(restartSum);
    } catch (e) {
      console.error('Status check failed:', e);
    }
  }, 3000);
}

// Connect to SSE logs
function connectLogs() {
  const eventSource = new EventSource('/stream-logs');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.log) {
        allLogs.push(data.log);
        renderLogs();
      }
    } catch (e) {
      console.error('Failed to parse log:', e);
    }
  };

  eventSource.onerror = () => {
    console.error('Log connection failed');
    setTimeout(connectLogs, 5000);
  };
}

// Filter and render logs based on current filter
function renderLogs() {
  const container = document.getElementById('logsContainer');

  let filteredLogs = allLogs;

  if (logFilter === 'connection') {
    filteredLogs = allLogs.filter(log =>
      log.category === 'connection'
    );
  } else if (logFilter === 'connection-disconnect') {
    filteredLogs = allLogs.filter(log =>
      log.category === 'connection' || log.category === 'disconnection'
    );
  }

  container.innerHTML = '';
  if (filteredLogs.length === 0) {
    container.innerHTML = '<div class="log-entry">No logs to display</div>';
    return;
  }

  filteredLogs.forEach(log => {
    const entry = document.createElement('div');
    const category = log.category || 'info';
    entry.className = `log-entry ${category}`;
    entry.textContent = log.displayText || log;
    container.appendChild(entry);
  });

  container.scrollTop = container.scrollHeight;
}

// Add log entry (backward compatibility)
function addLog(message, type = 'info') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    message: typeof message === 'string' ? message : message.message || message,
    category: type,
    displayText: typeof message === 'string' ? `[${new Date().toISOString()}] ${message}` : (message.displayText || message)
  };
  allLogs.push(logEntry);
  renderLogs();
}

// Update status badge
function updateStatus(state) {
  const badge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  badge.classList.remove('online', 'error');
  if (state === 'online') {
    badge.classList.add('online');
    statusText.textContent = 'LIVE';
  } else if (state === 'error') {
    badge.classList.add('error');
    statusText.textContent = 'ERROR';
  } else {
    statusText.textContent = 'OFFLINE';
  }
}

// Show error
function showError(message) {
  const errorBox = document.getElementById('errorBox');
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorBox.style.display = 'block';
  addLog(`✗ Error: ${message}`, 'error');

  setTimeout(() => {
    errorBox.style.display = 'none';
  }, 8000);
}
