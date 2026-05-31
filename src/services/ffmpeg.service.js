const { spawn, execSync } = require('child_process');
const { PLATFORMS } = require('../constants/platforms');
const { addLog } = require('./log.service');

/** @type {Record<string, import('child_process').ChildProcess>} */
const activeStreams = {};

/** @type {Record<string, ReturnType<typeof setTimeout>>} */
const restartTimers = {};

let ffmpegAvailable = null;

function checkFfmpegAvailable() {
  if (ffmpegAvailable !== null) {
    return ffmpegAvailable;
  }
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

function clearRestartTimer(platformId) {
  if (restartTimers[platformId]) {
    clearTimeout(restartTimers[platformId]);
    delete restartTimers[platformId];
  }
}

function isHlsInput(url) {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('playlist');
}

function buildFfmpegArgs(platformId, ivsUrl, outputUrl) {
  const inputArgs = isHlsInput(ivsUrl)
    ? [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', ivsUrl,
      ]
    : [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-re', '-i', ivsUrl,
      ];

  if (platformId === 'youtube') {
    return [
      ...inputArgs,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-pix_fmt', 'yuv420p',
      '-g', '60',
      '-keyint_min', '60',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-vf', 'scale=-2:720',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-f', 'flv',
      outputUrl,
    ];
  }

  return [
    ...inputArgs,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'flv',
    outputUrl,
  ];
}

function launchPlatformFfmpeg(platformId, ivsUrl, outputUrl, options) {
  const {
    autoRestart = true,
    maxRestarts = 5,
    restartCount = 0,
    isRestart = false,
  } = options;

  const ffmpegArgs = buildFfmpegArgs(platformId, ivsUrl, outputUrl);

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  activeStreams[platformId] = {
    process: ffmpeg,
    startTime: Date.now(),
    restarts: restartCount,
    maxRestarts,
    autoRestart,
    ivsUrl,
    outputUrl,
  };

  if (isRestart) {
    addLog(`FFmpeg restarted (PID ${ffmpeg.pid})`, 'reconnection', platformId);
  } else {
    addLog(`FFmpeg started (PID ${ffmpeg.pid}) — output connecting`, 'connection', platformId);
  }

  ffmpeg.on('error', (error) => {
    addLog(`FFmpeg error: ${error.message}`, 'error', platformId);
    if (activeStreams[platformId]?.process === ffmpeg) {
      delete activeStreams[platformId];
    }
  });

  let reportedLive = false;
  ffmpeg.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) addLog(`FFmpeg: ${line}`, 'info', platformId);
    if (!reportedLive && /speed=\s*[\d.]+x/.test(line) && /time=/.test(line)) {
      reportedLive = true;
      addLog('Output appears live (ffmpeg is sending data)', 'connection', platformId);
    }
  });

  ffmpeg.on('close', (code) => {
    const entry = activeStreams[platformId];
    if (!entry) return;

    const {
      ivsUrl: savedIvs,
      outputUrl: savedOut,
      autoRestart: willRestart,
      maxRestarts: cap,
      restarts: curRestarts,
    } = entry;
    const runtime = Math.round((Date.now() - entry.startTime) / 1000);
    delete activeStreams[platformId];

    if (code === 0) {
      addLog(`Output stopped (ran ${runtime}s)`, 'disconnection', platformId);
    } else {
      addLog(`Output disconnected (exit ${code}, ran ${runtime}s)`, 'disconnection', platformId);
    }

    if (!willRestart) {
      return;
    }

    const nextRestarts = runtime > 60 ? 0 : curRestarts + 1;
    if (nextRestarts > cap) {
      addLog(`Max restart attempts reached (${cap})`, 'error', platformId);
      return;
    }

    const delay = Math.min(3000, 500 * nextRestarts);
    addLog(`Auto-restart in ${delay}ms (attempt ${nextRestarts}/${cap})`, 'reconnection', platformId);

    clearRestartTimer(platformId);
    restartTimers[platformId] = setTimeout(() => {
      delete restartTimers[platformId];
      if (activeStreams[platformId]) return;
      launchPlatformFfmpeg(platformId, savedIvs, savedOut, {
        autoRestart: true,
        maxRestarts: cap,
        restartCount: nextRestarts,
        isRestart: true,
      });
    }, delay);
  });

  return true;
}

function startPlatform(platformId, ivsUrl, outputUrl, options = {}) {
  clearRestartTimer(platformId);
  if (activeStreams[platformId]) {
    addLog('Already streaming to this platform', 'error', platformId);
    return { ok: false, reason: 'already_streaming' };
  }

  if (!checkFfmpegAvailable()) {
    addLog('FFmpeg is not available on PATH', 'error', platformId);
    return { ok: false, reason: 'ffmpeg_unavailable' };
  }

  const autoRestart = options.autoRestart !== false;
  const maxRestarts = Number.isFinite(options.maxRestarts) ? options.maxRestarts : 5;

  launchPlatformFfmpeg(platformId, ivsUrl, outputUrl, {
    autoRestart,
    maxRestarts,
    restartCount: 0,
    isRestart: false,
  });

  return { ok: true };
}

function stopPlatform(platformId) {
  clearRestartTimer(platformId);
  const entry = activeStreams[platformId];
  if (!entry) return false;
  entry.autoRestart = false;
  entry.process.kill('SIGINT');
  return true;
}

function stopAllPlatforms() {
  Object.keys(restartTimers).forEach(clearRestartTimer);
  const ids = Object.keys(activeStreams);
  for (const id of ids) {
    stopPlatform(id);
  }
  return ids.length;
}

function isPlatformActive(platformId) {
  return Boolean(activeStreams[platformId]);
}

function getStatus() {
  const platformStatuses = {};
  let maxUptime = null;

  for (const id of Object.keys(PLATFORMS)) {
    const entry = activeStreams[id];
    const uptime = entry ? Math.round((Date.now() - entry.startTime) / 1000) : null;
    if (uptime !== null && (maxUptime === null || uptime > maxUptime)) {
      maxUptime = uptime;
    }
    platformStatuses[id] = {
      running: !!entry,
      uptime,
      restarts: entry ? entry.restarts : 0,
      maxRestarts: entry ? entry.maxRestarts : null,
      autoRestart: entry ? entry.autoRestart : null,
    };
  }

  const activeCount = Object.keys(activeStreams).length;

  return {
    running: activeCount > 0,
    anyRunning: activeCount > 0,
    activeCount,
    uptime: maxUptime,
    platforms: platformStatuses,
  };
}

function resetState() {
  Object.keys(restartTimers).forEach(clearRestartTimer);
  for (const id of Object.keys(activeStreams)) {
    try {
      activeStreams[id].process.kill('SIGKILL');
    } catch {
      // process may already be gone
    }
    delete activeStreams[id];
  }
  ffmpegAvailable = null;
}

module.exports = {
  checkFfmpegAvailable,
  startPlatform,
  stopPlatform,
  stopAllPlatforms,
  isPlatformActive,
  getStatus,
  resetState,
};
