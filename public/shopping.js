const PRODUCTS = [
  { id: 1, name: 'Pro Headphones',   price: '$49',  originalPrice: '$79',  emoji: '🎧', url: '#' },
  { id: 2, name: 'Smart Watch',      price: '$129', originalPrice: '$199', emoji: '⌚', url: '#' },
  { id: 3, name: 'Wireless Speaker', price: '$39',  originalPrice: '$69',  emoji: '🔊', url: '#' },
  { id: 4, name: 'Phone Stand',      price: '$19',  originalPrice: '$29',  emoji: '📱', url: '#' }
];

let player = null;
let channelArn = '';
let productDismissTimer = null;
let productProgressInterval = null;
let timerInterval = null;

// ─── Init ────────────────────────────────────────────────────────────────────

function init() {
  renderProducts();
  document.getElementById('connectBtn').addEventListener('click', connectStream);
  document.getElementById('disconnectBtn').addEventListener('click', disconnectStream);
  document.getElementById('startTimerBtn').addEventListener('click', sendTimerOverlay);
  document.getElementById('productDismiss').addEventListener('click', hideProductOverlay);
}

// ─── Products ────────────────────────────────────────────────────────────────

function renderProducts() {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-host-card">
      <span class="product-emoji">${p.emoji}</span>
      <div class="product-name">${p.name}</div>
      <span class="product-price">${p.price}</span>
      <button class="btn btn-primary" onclick="sendProductOverlay(${p.id})">Show Overlay</button>
    </div>
  `).join('');
}

// ─── IVS Player ──────────────────────────────────────────────────────────────

function connectStream() {
  const playbackUrl = document.getElementById('playbackUrl').value.trim();
  const arn = document.getElementById('channelArnInput').value.trim();

  if (!playbackUrl) return showSetupError('Playback URL is required.');
  if (!arn) return showSetupError('Channel ARN is required.');
  if (!arn.startsWith('arn:aws:ivs:')) return showSetupError('Channel ARN must start with arn:aws:ivs:');
  if (!window.IVSPlayer || !IVSPlayer.isPlayerSupported) {
    return showSetupError('IVS Player is not supported in this browser.');
  }

  channelArn = arn;

  player = IVSPlayer.create({
    wasmWorker: 'https://player.live-video.net/1.28.0/amazon-ivs-wasmworker.min.js',
    wasmBinary: 'https://player.live-video.net/1.28.0/amazon-ivs-wasmworker.min.wasm'
  });

  player.attachHTMLVideoElement(document.getElementById('videoPlayer'));

  const { PlayerEventType } = IVSPlayer;
  player.addEventListener(PlayerEventType.STATE_CHANGED, onPlayerStateChange);
  player.addEventListener(PlayerEventType.ERROR, onPlayerError);
  player.addEventListener(PlayerEventType.TEXT_METADATA_CUE, onMetadataCue);

  player.load(playbackUrl);
  player.play();

  document.getElementById('setupPanel').style.display = 'none';
  document.getElementById('shoppingStage').style.display = 'grid';
  document.getElementById('playerBadge').style.display = 'flex';
}

function disconnectStream() {
  if (player) {
    player.pause();
    player.delete();
    player = null;
  }
  clearTimeout(productDismissTimer);
  clearInterval(productProgressInterval);
  clearInterval(timerInterval);
  document.getElementById('productOverlay').style.display = 'none';
  document.getElementById('timerOverlay').style.display = 'none';
  document.getElementById('shoppingStage').style.display = 'none';
  document.getElementById('playerBadge').style.display = 'none';
  document.getElementById('setupPanel').style.display = 'block';
}

// ─── Player Events ───────────────────────────────────────────────────────────

function onPlayerStateChange(state) {
  const { PlayerState } = IVSPlayer;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const headerDot = document.getElementById('playerDot');
  const headerText = document.getElementById('playerStatusText');

  const stateMap = {
    [PlayerState.PLAYING]:   { label: 'LIVE',         cls: 'live' },
    [PlayerState.BUFFERING]: { label: 'Buffering...', cls: '' },
    [PlayerState.IDLE]:      { label: 'Idle',         cls: '' },
    [PlayerState.ENDED]:     { label: 'Stream Ended', cls: '' }
  };

  const s = stateMap[state] || { label: state, cls: '' };
  dot.className = 'status-dot ' + s.cls;
  text.textContent = s.label;
  headerDot.className = 'status-dot ' + s.cls;
  headerText.textContent = s.label;
}

function onPlayerError(err) {
  document.getElementById('statusDot').className = 'status-dot error';
  document.getElementById('statusText').textContent = 'Error';
  appendOverlayLog(`Player error: ${err.message || err.type}`, 'error');
}

function onMetadataCue(cue) {
  try {
    const payload = JSON.parse(cue.text);
    if (payload.type === 'product') showProductOverlay(payload);
    else if (payload.type === 'timer') showTimerOverlay(payload);
  } catch {
    appendOverlayLog(`Received cue (unparsed): ${cue.text}`, 'info');
  }
}

// ─── Send Overlays ───────────────────────────────────────────────────────────

async function sendProductOverlay(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  const payload = { type: 'product', ...product, duration: 10000 };
  try {
    const res = await fetch('/overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelArn, payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    appendOverlayLog(`Product overlay sent: ${product.name}`, 'success');
  } catch (err) {
    appendOverlayLog(`Error: ${err.message}`, 'error');
  }
}

async function sendTimerOverlay() {
  const duration = parseInt(document.getElementById('timerDuration').value, 10);
  const code = document.getElementById('timerCodeInput').value.trim().toUpperCase();
  const discount = document.getElementById('timerDiscountInput').value.trim();
  const feedback = document.getElementById('timerFeedback');

  if (!duration || duration < 10) return showTimerFeedback('Duration must be at least 10 seconds.', true);
  if (!code) return showTimerFeedback('Discount code is required.', true);
  if (!discount) return showTimerFeedback('Discount label is required.', true);

  const payload = { type: 'timer', code, discount, duration };
  try {
    const res = await fetch('/overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelArn, payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showTimerFeedback(`Timer started: ${formatMMSS(duration)} — ${code}`, false);
    appendOverlayLog(`Timer overlay sent: ${code} for ${formatMMSS(duration)}`, 'success');
  } catch (err) {
    showTimerFeedback(`Error: ${err.message}`, true);
    appendOverlayLog(`Error: ${err.message}`, 'error');
  }
}

// ─── Show / Hide Overlays ────────────────────────────────────────────────────

function showProductOverlay(payload) {
  document.getElementById('productEmoji').textContent = payload.emoji || '🛍️';
  document.getElementById('productName').textContent = payload.name;
  document.getElementById('productPrice').textContent = payload.price;
  document.getElementById('productOriginalPrice').textContent = payload.originalPrice || '';
  const link = document.getElementById('productUrl');
  link.href = payload.url || '#';

  const overlay = document.getElementById('productOverlay');
  overlay.classList.remove('overlay-fadeout');
  overlay.style.display = 'block';

  // Progress bar
  const bar = document.getElementById('productProgress');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  // Trigger reflow before starting transition
  bar.offsetWidth; // eslint-disable-line no-unused-expressions
  bar.style.transition = `width ${payload.duration}ms linear`;
  bar.style.width = '0%';

  clearTimeout(productDismissTimer);
  productDismissTimer = setTimeout(hideProductOverlay, payload.duration);
}

function hideProductOverlay() {
  clearTimeout(productDismissTimer);
  const overlay = document.getElementById('productOverlay');
  overlay.classList.add('overlay-fadeout');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('overlay-fadeout');
  }, 300);
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
    if (remaining <= 0) {
      clearInterval(timerInterval);
      hideTimerOverlay();
    }
  }, 1000);
}

function hideTimerOverlay() {
  clearInterval(timerInterval);
  const overlay = document.getElementById('timerOverlay');
  overlay.classList.add('overlay-fadeout');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('overlay-fadeout');
  }, 300);
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function appendOverlayLog(message, category) {
  const log = document.getElementById('overlayLog');
  // Remove placeholder
  const placeholder = log.querySelector('[style*="text-tertiary"]');
  if (placeholder) placeholder.remove();

  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${category || ''}`;
  entry.textContent = `[${time}] ${message}`;
  log.appendChild(entry);

  // Trim to 20 entries
  while (log.children.length > 20) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function showSetupError(message) {
  const el = document.getElementById('setupError');
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
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

document.addEventListener('DOMContentLoaded', init);
