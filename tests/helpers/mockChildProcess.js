const EventEmitter = require('events');

function createMockProcess(pid = 12345) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = pid;
  proc.kill = jest.fn((signal) => {
    proc.killed = signal;
  });
  return proc;
}

module.exports = { createMockProcess };
