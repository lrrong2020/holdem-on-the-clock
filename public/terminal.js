// Each frame is a piece of a local transcript. The command strings are only displayed.
function* command(text) {
  for (let end = 3; end < text.length + 3; end += 3) {
    const part = text.slice(0, end);
    yield {kind: 'command', text: part, replace: end > 3, delay: part === text ? 380 : 90};
  }
}

function line(text, kind = 'output', delay = 340) {
  return {kind, text, delay};
}

const statusOutput = [
  line('## canary/timeout...origin/canary/timeout', 'branch'),
  line(' M config/edge.yaml'),
  line(' M internal/upstream/client.go'),
  line(' M internal/upstream/client_test.go'),
];

export const initialTranscript = [
  line('go test -v -run TestRequestDeadline ./internal/upstream', 'command'),
  line('=== RUN   TestRequestDeadline', 'muted'),
  line('=== RUN   TestRequestDeadline/cached', 'muted'),
  line('=== RUN   TestRequestDeadline/origin', 'muted'),
  line('--- PASS: TestRequestDeadline (0.18s)', 'success'),
  line('    --- PASS: TestRequestDeadline/cached (0.00s)', 'success'),
  line('    --- PASS: TestRequestDeadline/origin (0.18s)', 'success'),
  line('PASS', 'success'),
  line('ok    edge-cache/internal/upstream  0.186s', 'success'),
  line('git status --short --branch', 'command'),
  ...statusOutput
];

export function* terminalFrames() {
  let run = 0;
  while (true) {
    yield* command('git diff --stat');
    yield line(' config/edge.yaml                  |  2 +-');
    yield line(' internal/upstream/client.go       |  6 +++---');
    yield line(' internal/upstream/client_test.go  | 10 ++++++++++');
    yield line(' 3 files changed, 14 insertions(+), 4 deletions(-)', 'muted', 850);
    yield* command('git diff -U1 -- config/edge.yaml');
    yield line('diff --git a/config/edge.yaml b/config/edge.yaml', 'muted');
    yield line('--- a/config/edge.yaml', 'muted');
    yield line('+++ b/config/edge.yaml', 'muted');
    yield line('@@ -7,3 +7,3 @@ upstream:', 'branch');
    yield line('   connect_timeout: 100ms');
    yield line('-  request_timeout: 150ms', 'removed');
    yield line('+  request_timeout: 180ms', 'added');
    yield line('   max_idle_conns: 200', 'output', 900);
    yield* command('go test -count=1 ./...');
    yield line('?     edge-cache/cmd/edge     [no test files]', 'muted');
    yield line('ok    edge-cache/internal/cache     ' + (0.412 + run * 0.007).toFixed(3) + 's', 'success', 510);
    yield line('ok    edge-cache/internal/upstream  ' + (0.673 + run * 0.013).toFixed(3) + 's', 'success', 800);
    yield* command('./scripts/canary.sh --check');
    yield line('Checking edge workers at 50% traffic…', 'output', 360);
    for (let checked = 0; checked <= 12; checked++) {
      yield {kind: 'progress', text: '[' + '#'.repeat(checked) + '.'.repeat(12 - checked) + ']  ' + checked + '/12 checks',
        replace: checked > 0, delay: checked === 12 ? 420 : 205};
    }
    yield line('healthy  3/3 workers  ·  p95 ' + (184 + run) + ' ms', 'success', 920);
    yield* command('git status --short --branch');
    yield* statusOutput;
    run = (run + 1) % 4;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('folio-terminal')) {
  // Keep a manual pause across language and skin changes in this tab.
  let manuallyPaused = false;
  customElements.define('folio-terminal', class extends HTMLElement {
    connectedCallback() {
      this.zh = this.getAttribute('lang') === 'zh';
      this.innerHTML = `<div class="term-path"><span>~/work/edge-cache</span><button type="button" data-terminal-toggle></button></div>
        <div class="term-log" data-terminal-log role="group" aria-label="${this.zh ? '终端输出' : 'Terminal output'}" aria-live="off"></div>`;
      this.log = this.querySelector('[data-terminal-log]');
      this.toggle = this.querySelector('[data-terminal-toggle]');
      this.frames = terminalFrames();
      for (const frame of initialTranscript) this.show(frame);
      this.motion = matchMedia('(prefers-reduced-motion: reduce)');
      this.userPaused = manuallyPaused ? true : null;
      this.toggle.onclick = () => {
        this.userPaused = !this.paused;
        manuallyPaused = this.userPaused;
        this.schedule();
      };
      this.onPreference = () => {
        if (this.motion.matches && this.userPaused === false) this.userPaused = null;
        this.schedule();
      };
      this.onVisibility = () => this.schedule();
      this.motion.addEventListener('change', this.onPreference);
      this.ownerDocument.addEventListener('visibilitychange', this.onVisibility);
      this.schedule();
    }

    get paused() { return this.userPaused ?? this.motion.matches; }

    schedule() {
      clearTimeout(this.timer);
      const playing = !this.paused && !this.ownerDocument.hidden && this.isConnected;
      this.toggleAttribute('data-playing', playing);
      const label = this.paused
        ? (this.zh ? '继续终端输出' : 'Resume terminal output')
        : (this.zh ? '暂停终端输出' : 'Pause terminal output');
      this.toggle.title = label;
      this.toggle.setAttribute('aria-label', label);
      this.toggle.dataset.icon = this.paused ? 'play' : 'pause';
      if (playing) this.timer = setTimeout(() => this.tick(), 220);
    }

    tick() {
      const frame = this.frames.next().value;
      this.show(frame);
      this.timer = setTimeout(() => this.tick(), frame.delay);
    }

    show(frame) {
      if (frame.replace) {
        this.log.lastElementChild.textContent = frame.text;
        return;
      }
      const row = this.ownerDocument.createElement('div');
      row.className = 'term-row term-' + frame.kind;
      row.textContent = frame.text;
      this.log.append(row);
      if (this.log.childElementCount > 22) this.log.firstElementChild.remove();
    }

    disconnectedCallback() {
      clearTimeout(this.timer);
      this.motion.removeEventListener('change', this.onPreference);
      this.ownerDocument.removeEventListener('visibilitychange', this.onVisibility);
      this.removeAttribute('data-playing');
    }
  });
}
