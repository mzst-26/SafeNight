/**
 * Minimal DOM for running the real inline map scripts under jest (node env).
 * Supports what the route overlay code uses: element tree, classes, attributes,
 * style, text, listeners, class/tag/id selectors and outerHTML serialisation.
 */
export type Listener = (ev?: any) => void;

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

export class FakeEl {
  tagName: string;
  className = '';
  parentElement: FakeEl | null = null;
  children: FakeEl[] = [];
  listeners: Record<string, Listener[]> = {};
  attributes: Record<string, string> = {};
  style: Record<string, any> = {
    setProperty(key: string, value: string) {
      this[key] = value;
    },
  };
  private text = '';
  private raw = '';
  private _id = '';

  constructor(tag = 'div', id = '') {
    this.tagName = tag.toLowerCase();
    this._id = id;
  }

  get id(): string {
    return this._id;
  }

  set id(v: string) {
    this._id = String(v);
  }

  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(value: string) {
    this.text = String(value);
    this.raw = '';
    this.children = [];
  }

  get innerHTML(): string {
    return escapeText(this.text) + this.raw + this.children.map((c) => c.outerHTML).join('');
  }

  set innerHTML(value: string) {
    this.raw = String(value);
    this.text = '';
    this.children = [];
  }

  get outerHTML(): string {
    const attrs: string[] = [];
    if (this.className) attrs.push(`class="${escapeAttr(this.className)}"`);
    if (this._id) attrs.push(`id="${escapeAttr(this._id)}"`);
    Object.keys(this.attributes).forEach((k) => attrs.push(`${k}="${escapeAttr(this.attributes[k])}"`));
    const style = Object.keys(this.style)
      .filter((k) => typeof this.style[k] !== 'function' && this.style[k] !== '' && this.style[k] != null)
      .map((k) => `${kebab(k)}:${this.style[k]}`)
      .join(';');
    if (style) attrs.push(`style="${escapeAttr(style)}"`);
    return `<${this.tagName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${this.innerHTML}</${this.tagName}>`;
  }

  get classList() {
    const self = this;
    const classes = () => self.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]) => {
      self.className = Array.from(new Set(list)).join(' ');
    };
    return {
      contains: (c: string) => classes().includes(c),
      add: (...cs: string[]) => write([...classes(), ...cs]),
      remove: (...cs: string[]) => write(classes().filter((x) => !cs.includes(x))),
      toggle: (c: string, force?: boolean) => {
        const next = force === undefined ? !classes().includes(c) : force;
        write(next ? [...classes(), c] : classes().filter((x) => x !== c));
        return next;
      },
    };
  }

  setAttribute(key: string, value: string) {
    this.attributes[key] = String(value);
  }

  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }

  removeAttribute(key: string) {
    delete this.attributes[key];
  }

  addEventListener(ev: string, fn: Listener) {
    (this.listeners[ev] ??= []).push(fn);
  }

  appendChild(child: FakeEl) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeEl) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  private matches(sel: string): boolean {
    const m = sel.match(/^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)(#[\w-]+)?$/i);
    if (!m) return false;
    if (m[1] && m[1].toLowerCase() !== this.tagName) return false;
    const classes = this.className.split(/\s+/);
    if (!(m[2] ?? '').split('.').filter(Boolean).every((c) => classes.includes(c))) return false;
    return !m[3] || m[3].slice(1) === this._id;
  }

  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) =>
      el.children.forEach((c) => {
        if (c.matches(sel)) out.push(c);
        walk(c);
      });
    walk(this);
    return out;
  }

  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
