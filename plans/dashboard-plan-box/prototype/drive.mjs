import { spawn } from 'node:child_process';
import { createScreenModel } from '/Users/jan.krolikowski/src/plan-implement-review/src/shell/conversation-rig.mjs';
const PTY_RELAY = String.raw`
import os, pty, sys, struct, fcntl, termios, select, signal
rows, cols = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.execvp(sys.argv[3], sys.argv[3:])
inp = sys.stdin.buffer.raw
out = sys.stdout.buffer.raw
open_in = True
while True:
    fds = [fd] + ([inp] if open_in else [])
    r, _, _ = select.select(fds, [], [], 0.5)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        out.write(data)
    if open_in and inp in r:
        data = os.read(inp.fileno(), 65536)
        if not data:
            open_in = False
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
        else:
            os.write(fd, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) & 0xff)
`;

const MOCK = new URL('./plan-box-mock.mjs', import.meta.url).pathname;
const steps = JSON.parse(process.argv[2]);
const [rows, cols] = [22, 110];
const child = spawn('python3', ['-c', PTY_RELAY, String(rows), String(cols), process.execPath, MOCK], { cwd: process.argv[3] ?? process.cwd(), env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
const model = createScreenModel({ rows, cols });
child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => model.write(d));
let err = ''; child.stderr.on('data', (d) => (err += d));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
for (const s of steps) {
  child.stdin.write(s.k); await wait(s.ms ?? 400);
  if (s.show) console.log(`---- after ${JSON.stringify(s.k)} ----\n` + model.rows().map((r) => r.trimEnd()).join('\n').replace(/\n+$/, ''));
}
child.stdin.write('\x03'); await wait(300); child.kill(); if (err) console.error(err.slice(0, 2000));
