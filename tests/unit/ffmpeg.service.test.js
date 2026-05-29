jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('../../src/services/log.service', () => ({
  addLog: jest.fn(),
}));

const { spawn, execSync } = require('child_process');
const { createMockProcess } = require('../helpers/mockChildProcess');
const ffmpegService = require('../../src/services/ffmpeg.service');
const logService = require('../../src/services/log.service');

describe('ffmpeg.service', () => {
  beforeEach(() => {
    ffmpegService.resetState();
    jest.clearAllMocks();
    execSync.mockReset();
    spawn.mockReset();
  });

  describe('checkFfmpegAvailable', () => {
    it('returns true when ffmpeg is on PATH', () => {
      execSync.mockImplementation(() => Buffer.from('ffmpeg version'));
      expect(ffmpegService.checkFfmpegAvailable()).toBe(true);
      expect(ffmpegService.checkFfmpegAvailable()).toBe(true);
      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it('returns false when ffmpeg is missing', () => {
      execSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(ffmpegService.checkFfmpegAvailable()).toBe(false);
    });
  });

  describe('startPlatform', () => {
    it('returns already_streaming when platform is active', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');
      const result = ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');

      expect(result).toEqual({ ok: false, reason: 'already_streaming' });
      expect(logService.addLog).toHaveBeenCalledWith(
        'Already streaming to this platform',
        'error',
        'youtube'
      );
    });

    it('returns ffmpeg_unavailable when binary missing', () => {
      execSync.mockImplementation(() => {
        throw new Error('missing');
      });
      const result = ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');
      expect(result).toEqual({ ok: false, reason: 'ffmpeg_unavailable' });
    });

    it('starts stream and reports active status', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      const result = ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out/key');
      expect(result).toEqual({ ok: true });
      expect(spawn).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-i', 'https://ivs/', 'rtmp://out/key'])
      );
      expect(ffmpegService.isPlatformActive('youtube')).toBe(true);
      expect(ffmpegService.getStatus().platforms.youtube.running).toBe(true);
    });
  });

  describe('stopPlatform', () => {
    it('returns false when platform is idle', () => {
      expect(ffmpegService.stopPlatform('youtube')).toBe(false);
    });

    it('kills process and disables autoRestart', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);
      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');

      expect(ffmpegService.stopPlatform('youtube')).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith('SIGINT');
    });
  });

  describe('stopAllPlatforms', () => {
    it('stops all active streams and returns count', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      spawn.mockReturnValue(createMockProcess());

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://y');
      ffmpegService.startPlatform('twitch', 'https://ivs/', 'rtmp://t');

      const count = ffmpegService.stopAllPlatforms();
      expect(count).toBe(2);
    });
  });

  describe('process events', () => {
    it('removes stream on process error event', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);
      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');

      proc.emit('error', new Error('spawn failed'));
      expect(ffmpegService.isPlatformActive('youtube')).toBe(false);
    });

    it('logs live output when stderr matches speed and time', () => {
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);
      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out');

      proc.stderr.emit('data', Buffer.from('frame=1 fps=30 speed=1.0x time=00:00:01.00'));
      expect(logService.addLog).toHaveBeenCalledWith(
        'Output appears live (ffmpeg is sending data)',
        'connection',
        'youtube'
      );
    });

    it('does not restart when autoRestart is false', () => {
      jest.useFakeTimers();
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out', {
        autoRestart: false,
      });
      proc.emit('close', 1);
      jest.runAllTimers();

      expect(spawn).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('schedules restart on non-zero exit with autoRestart enabled', () => {
      jest.useFakeTimers();
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out', {
        autoRestart: true,
        maxRestarts: 3,
      });
      proc.emit('close', 1);
      jest.advanceTimersByTime(500);

      expect(spawn).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('resets restart counter after runtime exceeds 60 seconds', () => {
      jest.useFakeTimers();
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out', {
        maxRestarts: 1,
      });

      Date.now.mockReturnValue(now + 61000);
      proc.emit('close', 1);
      jest.advanceTimersByTime(500);

      expect(spawn).toHaveBeenCalledTimes(2);
      Date.now.mockRestore();
      jest.useRealTimers();
    });

    it('does not restart when max restarts exceeded', () => {
      jest.useFakeTimers();
      execSync.mockImplementation(() => Buffer.from('ok'));
      const proc = createMockProcess();
      spawn.mockReturnValue(proc);

      ffmpegService.startPlatform('youtube', 'https://ivs/', 'rtmp://out', {
        maxRestarts: 0,
      });
      proc.emit('close', 1);
      jest.runAllTimers();

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(logService.addLog).toHaveBeenCalledWith(
        'Max restart attempts reached (0)',
        'error',
        'youtube'
      );
      jest.useRealTimers();
    });
  });
});
