const API = '';
const YOUTUBE_CONNECTED_KEY = 'restream_youtube_connected';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const ivsUrl = $('#ivs-url');
const apiKey = $('#api-key');
const autoRestart = $('#auto-restart');
const maxRestarts = $('#max-restarts');
const platformGrid = $('#platform-grid');
const statusOutput = $('#status-output');
const logsOutput = $('#logs-output');
const toast = $('#toast');

const PLATFORM_COLORS = {
  youtube: 'youtube',
  twitch: 'twitch',
  facebook: 'facebook',
  custom: 'custom',
};

let platforms = [];
let statusPollTimer = null;

function getHeaders(jsonBody = false) {
  const headers = {};
  if (jsonBody) headers['Content-Type'] = 'application/json';
  const key = apiKey.value.trim();
  if (key) headers['x-service-key'] = key;
  return headers;
}

async function api(method, path, body) {
  const hasBody = body !== undefined;
  const opts = {
    method,
    headers: getHeaders(hasBody),
    credentials: 'same-origin',
  };
  if (hasBody) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }
  return data;
}

function markYouTubeConnected(connected) {
  if (connected) {
    sessionStorage.setItem(YOUTUBE_CONNECTED_KEY, '1');
  } else {
    sessionStorage.removeItem(YOUTUBE_CONNECTED_KEY);
  }
}

function hasLocalYouTubeFlag() {
  return sessionStorage.getItem(YOUTUBE_CONNECTED_KEY) === '1';
}

function warnIfWrongHost() {
  const host = window.location.hostname;
  if (host === '127.0.0.1') {
    showToast('Use http://localhost:3000/ui so YouTube login cookies work', 'error');
  }
}

function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.hidden = true; }, 4000);
}

function getStreamOptions() {
  const title = $('#youtube-event-title')?.value.trim();
  const privacyStatus = $('#youtube-privacy')?.value || 'unlisted';
  return {
    ivsUrl: ivsUrl.value.trim(),
    autoRestart: autoRestart.checked,
    maxRestarts: parseInt(maxRestarts.value, 10) || 5,
    ...(title ? { broadcastTitle: title } : {}),
    privacyStatus,
  };
}

function requireIvsUrl() {
  const url = ivsUrl.value.trim();
  if (!url) {
    showToast('Enter an IVS input URL first', 'error');
    return null;
  }
  return url;
}

async function checkHealth() {
  try {
    const health = await api('GET', '/health');
    const badge = $('#health-badge');
    badge.textContent = `Health: ${health.status}`;
    badge.className = 'badge ok';
  } catch {
    $('#health-badge').textContent = 'Health: down';
    $('#health-badge').className = 'badge err';
  }

  try {
    const ready = await api('GET', '/ready');
    const badge = $('#ready-badge');
    const ok = ready.status === 'ready';
    badge.textContent = ok ? 'Ready' : 'Not ready';
    badge.className = `badge ${ok ? 'ok' : 'err'}`;
  } catch {
    $('#ready-badge').textContent = 'Not ready';
    $('#ready-badge').className = 'badge err';
  }
}

async function loadPlatforms() {
  platforms = await api('GET', '/platforms');
  renderPlatformCards();
}

function renderPlatformCards() {
  platformGrid.innerHTML = platforms.map((p) => {
    const color = PLATFORM_COLORS[p.id] || 'custom';
    const isCustom = p.id === 'custom';
    return `
      <div class="platform-card" data-platform="${p.id}">
        <div class="platform-card-header">
          <div class="platform-title">
            <span class="platform-icon ${color}">${p.name[0]}</span>
            <h3>${p.name}</h3>
          </div>
          <span class="status-pill" data-status-pill="${p.id}">Idle</span>
        </div>
        ${p.url ? `<div class="platform-rtmp">${p.url}</div>` : ''}
        <label class="field">
          <span>Stream key</span>
          <input type="password" data-key="${p.id}" placeholder="Enter stream key" autocomplete="off" />
        </label>
        ${isCustom ? `
          <label class="field">
            <span>Custom RTMP URL</span>
            <input type="url" data-custom-url="${p.id}" placeholder="rtmp://..." />
          </label>
        ` : ''}
        <div class="platform-actions">
          <button class="btn btn-primary" data-start="${p.id}">Start</button>
          <button class="btn btn-ghost" data-stop="${p.id}">Stop</button>
        </div>
      </div>
    `;
  }).join('');

  platformGrid.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', () => startPlatform(btn.dataset.start));
  });
  platformGrid.querySelectorAll('[data-stop]').forEach((btn) => {
    btn.addEventListener('click', () => stopPlatform(btn.dataset.stop));
  });
}

async function startPlatform(id) {
  const url = requireIvsUrl();
  if (!url) return;

  const keyInput = platformGrid.querySelector(`[data-key="${id}"]`);
  const key = keyInput?.value.trim();
  if (!key) {
    showToast(`Enter a stream key for ${id}`, 'error');
    return;
  }

  const body = { ...getStreamOptions(), key };

  if (id === 'custom') {
    const customUrl = platformGrid.querySelector('[data-custom-url="custom"]')?.value.trim();
    if (!customUrl) {
      showToast('Enter a custom RTMP URL', 'error');
      return;
    }
    body.customUrl = customUrl;
  }

  try {
    const result = await api('POST', `/platforms/${id}/start`, body);
    showToast(result.message || `Started ${id}`, 'success');
    await refreshStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function stopPlatform(id) {
  try {
    const result = await api('POST', `/platforms/${id}/stop`);
    showToast(result.message || `Stopped ${id}`, 'success');
    await refreshStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function stopAll() {
  try {
    const result = await api('POST', '/stop');
    showToast(result.message, 'success');
    await refreshStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function refreshStatus() {
  try {
    const status = await api('GET', '/status');
    statusOutput.textContent = JSON.stringify(status, null, 2);

    for (const [id, info] of Object.entries(status.platforms || {})) {
      const pill = document.querySelector(`[data-status-pill="${id}"]`);
      const card = document.querySelector(`[data-platform="${id}"]`);
      if (!pill) continue;

      if (info.running) {
        pill.textContent = `Live · ${info.uptime}s`;
        pill.className = 'status-pill live';
        card?.classList.add('running');
      } else {
        pill.textContent = 'Idle';
        pill.className = 'status-pill';
        card?.classList.remove('running');
      }
    }
  } catch (err) {
    statusOutput.textContent = `Error: ${err.message}`;
  }
}

function setYouTubeUi(connected, label) {
  const active = connected || hasLocalYouTubeFlag();
  $('#youtube-status').innerHTML = active
    ? `<span class="dot online"></span><span>${label}</span>`
    : `<span class="dot offline"></span><span>Not connected</span>`;

  $('#youtube-connect').style.display = active ? 'none' : 'inline-flex';
  $('#youtube-fetch').disabled = !active;
  $('#youtube-disconnect').disabled = !active;
}

async function updateYouTubeStatus(retry = 0) {
  try {
    const status = await api('GET', '/auth/youtube/status');
    const connected = Boolean(status.connected);
    markYouTubeConnected(connected);

    const label = status.email || (connected ? 'YouTube connected' : 'Not connected');
    setYouTubeUi(connected, label);

    if (!connected && hasLocalYouTubeFlag() && retry < 4) {
      setYouTubeUi(true, 'YouTube connected (verifying session…)');
      setTimeout(() => updateYouTubeStatus(retry + 1), 400);
      return;
    }

    if (!connected && hasLocalYouTubeFlag()) {
      $('#youtube-status').innerHTML =
        '<span class="dot offline"></span><span>Session lost — open http://localhost:3000/ui and connect again</span>';
      markYouTubeConnected(false);
      setYouTubeUi(false, 'Not connected');
    }
  } catch (err) {
    if (hasLocalYouTubeFlag() && retry < 4) {
      setYouTubeUi(true, 'YouTube connected (verifying session…)');
      setTimeout(() => updateYouTubeStatus(retry + 1), 400);
      return;
    }
    if (hasLocalYouTubeFlag()) {
      markYouTubeConnected(false);
    }
    setYouTubeUi(false, 'Not connected');
    $('#youtube-status').innerHTML =
      `<span class="dot offline"></span><span>Status check failed — ${err.message}</span>`;
  }
}

function renderDetailRow(grid, label, value) {
  if (value == null || value === '') return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = String(value);
  grid.appendChild(dt);
  grid.appendChild(dd);
}

function renderYouTubeStreamDetails(result) {
  const panel = $('#youtube-details');
  const grid = $('#youtube-details-grid');
  const jsonEl = $('#youtube-details-json');
  const { stream, broadcast, key, rtmpUrl } = result;

  grid.innerHTML = '';
  renderDetailRow(grid, 'Stream key', key);
  renderDetailRow(grid, 'RTMP URL', rtmpUrl);
  if (stream) {
    renderDetailRow(grid, 'Stream title', stream.title);
    renderDetailRow(grid, 'Stream ID', stream.id);
    renderDetailRow(grid, 'Status', stream.status);
    renderDetailRow(grid, 'Health', stream.health);
    renderDetailRow(grid, 'Ingestion', stream.cdn?.ingestionAddress);
    renderDetailRow(grid, 'Resolution', stream.cdn?.resolution);
    renderDetailRow(grid, 'Frame rate', stream.cdn?.frameRate);
  }
  if (broadcast) {
    renderDetailRow(grid, 'Broadcast title', broadcast.title);
    renderDetailRow(grid, 'Lifecycle', broadcast.lifeCycleStatus);
    renderDetailRow(grid, 'Privacy', broadcast.privacyStatus);
    renderDetailRow(grid, 'Scheduled start', broadcast.scheduledStartTime);
    renderDetailRow(grid, 'Actual start', broadcast.actualStartTime);
  }
  if (result.autoCreated) {
    renderDetailRow(
      grid,
      'Auto-created',
      [
        result.autoCreated.stream ? 'stream' : null,
        result.autoCreated.broadcast ? 'live event' : null,
      ]
        .filter(Boolean)
        .join(' + ') || 'no'
    );
  }

  jsonEl.textContent = JSON.stringify(
    { key, rtmpUrl, stream, broadcast, streams: result.streams, autoCreated: result.autoCreated },
    null,
    2
  );
  panel.hidden = false;
}

let pipelinePollTimer = null;

async function pollYouTubePipeline() {
  try {
    const status = await api('GET', '/auth/youtube/pipeline');
    const phase = status.pipeline?.phase;

    if (phase === 'live' || status.studioVisible) {
      showToast('YouTube is LIVE — open YouTube Studio', 'success');
      clearInterval(pipelinePollTimer);
      pipelinePollTimer = null;
      await updateYouTubeStatus();
      return;
    }

    if (phase === 'failed') {
      showToast(status.pipeline.error || 'YouTube go-live failed', 'error');
      clearInterval(pipelinePollTimer);
      pipelinePollTimer = null;
    }
  } catch {
    /* keep polling */
  }
}

function startPipelinePolling() {
  if (pipelinePollTimer) clearInterval(pipelinePollTimer);
  pollYouTubePipeline();
  pipelinePollTimer = setInterval(pollYouTubePipeline, 4000);
}

async function fetchYouTubeKey() {
  if (!requireIvsUrl()) return;

  const btn = $('#youtube-fetch');
  btn.disabled = true;
  btn.textContent = 'Going live…';

  try {
    const result = await api('POST', '/auth/youtube/fetch-key', getStreamOptions());
    renderYouTubeStreamDetails(result);

    let liveMsg = 'FFmpeg started — waiting for YouTube to go LIVE…';
    if (result.autoCreated?.stream || result.autoCreated?.broadcast) {
      liveMsg = 'Created stream/event — going LIVE…';
    }
    showToast(liveMsg, 'success');
    startPipelinePolling();
    await refreshStatus();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Go Live on YouTube';
  }
}

async function disconnectYouTube() {
  try {
    await api('POST', '/auth/youtube/disconnect');
    $('#youtube-details').hidden = true;
    showToast('YouTube disconnected', 'success');
    await updateYouTubeStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function appendLog(entry) {
  const line = document.createElement('div');
  line.className = `log-line ${entry.category || 'info'}`;
  line.textContent = entry.displayText || `[${entry.timestamp}] ${entry.message}`;
  logsOutput.appendChild(line);
  logsOutput.scrollTop = logsOutput.scrollHeight;

  while (logsOutput.children.length > 200) {
    logsOutput.removeChild(logsOutput.firstChild);
  }
}

async function loadHistoricalLogs() {
  try {
    const logs = await api('GET', '/logs');
    logsOutput.innerHTML = '';
    logs.forEach(appendLog);
  } catch {
    /* ignore */
  }
}

function connectLogStream() {
  const key = apiKey.value.trim();
  const url = key
    ? `${API}/stream-logs?key=${encodeURIComponent(key)}`
    : `${API}/stream-logs`;

  const source = new EventSource(url, { withCredentials: true });

  source.onmessage = (event) => {
    try {
      const { log } = JSON.parse(event.data);
      appendLog(log);
    } catch {
      /* ignore malformed events */
    }
  };

  source.onerror = () => {
    source.close();
    setTimeout(connectLogStream, 3000);
  };
}

async function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const yt = params.get('youtube');
  if (yt === 'connected') {
    markYouTubeConnected(true);
    setYouTubeUi(true, 'YouTube connected');
    window.history.replaceState({}, '', '/ui');
    await updateYouTubeStatus();
    showToast('YouTube connected — you can fetch your stream key now', 'success');
  } else if (yt === 'error') {
    markYouTubeConnected(false);
    showToast('YouTube connection failed', 'error');
    window.history.replaceState({}, '', '/ui');
  }
}

function loadSavedSettings() {
  const savedKey = localStorage.getItem('restream_api_key');
  const savedIvs = localStorage.getItem('restream_ivs_url');
  if (savedKey) apiKey.value = savedKey;
  if (savedIvs) ivsUrl.value = savedIvs;
}

function saveSettings() {
  localStorage.setItem('restream_api_key', apiKey.value.trim());
  localStorage.setItem('restream_ivs_url', ivsUrl.value.trim());
}

async function init() {
  loadSavedSettings();
  warnIfWrongHost();
  await handleOAuthRedirect();

  $('#youtube-fetch').addEventListener('click', fetchYouTubeKey);
  $('#youtube-disconnect').addEventListener('click', disconnectYouTube);
  $('#stop-all').addEventListener('click', stopAll);
  $('#refresh-status').addEventListener('click', refreshStatus);
  $('#clear-logs').addEventListener('click', () => { logsOutput.innerHTML = ''; });

  apiKey.addEventListener('change', saveSettings);
  ivsUrl.addEventListener('change', saveSettings);

  checkHealth();
  loadPlatforms();
  updateYouTubeStatus();
  refreshStatus();
  loadHistoricalLogs();
  connectLogStream();

  statusPollTimer = setInterval(refreshStatus, 5000);
  setInterval(updateYouTubeStatus, 10000);
}

init();
