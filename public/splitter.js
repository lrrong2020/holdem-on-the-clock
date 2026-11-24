const panels = {
  sidebar: {minFirst:164, minSecond:520, maxFirst:400, gutter:8, label:['Sidebar width','侧栏宽度']},
  document: {minFirst:260, minSecond:280, gutter:16, ratio:1.65 / 2.65, label:['Document width','文档宽度']},
  terminal: {minFirst:240, minSecond:270, gutter:10, ratio:1.1 / 2.1, label:['Terminal output width','终端输出宽度']},
  table: {minFirst:174, minSecond:215, gutter:12, ratio:1.1 / 2.1, label:['Seat list width','座位列表宽度']}
};

// The sidebar has a fixed preferred width. Inside a workspace the saved fraction
// follows the available space, even when an enclosing pane is resized.
export function splitGeometry(name, contentWidth, viewportWidth, preference = null, outerWidth = contentWidth) {
  const panel = panels[name];
  const space = Math.max(0, Math.floor(contentWidth - panel.gutter));
  const max = Math.min(panel.maxFirst ?? Infinity, space - panel.minSecond);
  const allowed = name === 'sidebar' ? viewportWidth > 780
    : name === 'document' ? outerWidth > 672
    : name === 'terminal' ? viewportWidth > 700 : viewportWidth > 530 && contentWidth >= 480;
  const saved = Number.isFinite(preference) && preference > 0 &&
    (name === 'sidebar' || preference < 1);
  const wanted = name === 'sidebar' ? (saved ? preference : viewportWidth <= 1100 ? 198 : 228)
    : space * (saved ? preference : panel.ratio);
  return {inline:allowed && max >= panel.minFirst, space, min:panel.minFirst, max,
    first:Math.max(panel.minFirst, Math.min(max, Math.round(wanted))), gutter:panel.gutter};
}

const unsavedPreferences = new Map();
const storageKey = name => 'folio.split.v1.' + name;
function readPreference(name) {
  if (unsavedPreferences.has(name)) return unsavedPreferences.get(name);
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw === null ? null : Number(raw);
  } catch { return null; }
}
function storePreference(name, value) {
  try {
    if (value === null) localStorage.removeItem(storageKey(name));
    else localStorage.setItem(storageKey(name), String(value));
    unsavedPreferences.delete(name);
  } catch { unsavedPreferences.set(name, value); }
}
let nextControlId = 1;

if (typeof customElements !== 'undefined' && !customElements.get('folio-splitter')) {
  customElements.define('folio-splitter', class extends HTMLElement {
    static get observedAttributes() { return ['lang']; }
    attributeChangedCallback() { if (this.hostPane) this.refresh(); }
    connectedCallback() {
      this.name = this.dataset.split;
      this.hostPane = this.parentElement;
      this.preference = readPreference(this.name);
      const first = this.previousElementSibling;
      if (!first.id) first.id = 'folio-pane-' + nextControlId++;
      this.setAttribute('aria-controls', first.id);
      this.setAttribute('role','separator');
      this.setAttribute('aria-orientation','vertical');
      this.onpointerdown = e => this.start(e);
      this.onpointermove = e => this.move(e);
      this.onpointerup = e => this.finish(e, true);
      this.onpointercancel = this.onlostpointercapture = e => this.finish(e, false);
      this.onkeydown = e => this.key(e);
      this.ondblclick = e => { e.preventDefault(); this.reset(); };
      this.onResize = () => this.refresh();
      this.onStorage = e => {
        if (!this.drag && (e.key === null || e.key === storageKey(this.name))) {
          this.preference = readPreference(this.name);
          this.refresh();
        }
      };
      this.observer = new ResizeObserver(() => {
        if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
      });
      this.observer.observe(this.hostPane);
      window.addEventListener('resize', this.onResize);
      window.addEventListener('storage', this.onStorage);
      this.refresh();
    }

    disconnectedCallback() {
      this.observer.disconnect();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      window.removeEventListener('resize', this.onResize);
      window.removeEventListener('storage', this.onStorage);
      this.drag = null;
      this.hostPane = null;
    }

    refresh() {
      if (!this.hostPane) return;
      const host = this.hostPane, style = getComputedStyle(host);
      const width = host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const geometry = splitGeometry(this.name, width, window.innerWidth, this.preference, host.clientWidth);
      this.geometry = geometry;
      const mode = geometry.inline ? 'inline' : 'stacked';
      if (host.dataset.splitMode !== mode) host.dataset.splitMode = mode;
      this.hidden = !geometry.inline;
      this.tabIndex = geometry.inline ? 0 : -1;
      if (!geometry.inline) {
        if (this.drag) this.finish({pointerId:this.drag.id}, false);
        return;
      }
      host.style.setProperty('--folio-first', geometry.first + 'px');
      host.style.setProperty('--folio-gutter', geometry.gutter + 'px');
      host.style.setProperty('--folio-second-min', panels[this.name].minSecond + 'px');
      const zh = (this.lang || document.documentElement.lang).startsWith('zh');
      const label = panels[this.name].label[zh ? 1 : 0];
      this.title = label + (zh ? ' · 拖动调整，双击还原' : ' · Drag to resize, double-click to reset');
      this.setAttribute('aria-label', label);
      this.setAttribute('aria-valuemin', geometry.min);
      this.setAttribute('aria-valuemax', geometry.max);
      this.setAttribute('aria-valuenow', geometry.first);
      this.setAttribute('aria-valuetext', geometry.first + (zh ? ' 像素' : ' pixels'));
    }

    setWidth(width) {
      const {min, max, space} = this.geometry;
      const first = Math.min(max, Math.max(min, width));
      this.preference = this.name === 'sidebar' ? first : first / space;
      this.refresh();
    }
    reset() {
      this.preference = null;
      storePreference(this.name, null);
      this.refresh();
    }
    key(event) {
      if (!this.geometry.inline || event.altKey || event.metaKey || event.ctrlKey) return;
      const {min, max, first} = this.geometry;
      const step = event.shiftKey ? 48 : 16;
      const target = {ArrowLeft:first-step, ArrowRight:first+step, Home:min, End:max}[event.key];
      if (target === undefined && event.key !== 'Enter') return;
      event.preventDefault();
      if (event.key === 'Enter') this.reset();
      else {
        this.setWidth(target);
        storePreference(this.name, this.preference);
      }
    }
    start(event) {
      if (!this.geometry.inline || this.drag || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      // An explicit drag adjusts the layout without interrupting a text edit.
      const active = document.activeElement;
      if (!active?.matches('input,textarea,select') && !active?.isContentEditable) this.focus({preventScroll:true});
      this.drag = {id:event.pointerId, x:event.clientX, first:this.geometry.first, preference:this.preference};
      this.setPointerCapture(event.pointerId);
      this.toggleAttribute('data-dragging', true);
    }
    move(event) {
      if (this.drag?.id === event.pointerId && this.geometry.inline) {
        this.setWidth(this.drag.first + event.clientX - this.drag.x);
      }
    }
    finish(event, commit) {
      if (this.drag?.id !== event.pointerId) return;
      const drag = this.drag;
      this.drag = null;
      if (commit && this.geometry.inline && event.clientX !== drag.x) {
        this.setWidth(drag.first + event.clientX - drag.x);
        if (this.geometry.inline) storePreference(this.name, this.preference);
        else this.preference = drag.preference;
      } else {
        this.preference = drag.preference;
        this.refresh();
      }
      this.removeAttribute('data-dragging');
      if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    }
  });
}
