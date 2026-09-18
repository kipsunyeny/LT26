// Tiny DOM helpers for the HUD (no framework).
export type Attrs = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') n.className = String(v);
    else if (k === 'testid') n.setAttribute('data-testid', String(v));
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'testid') n.setAttribute('data-testid', String(v));
    else n.setAttribute(k, String(v));
  }
  return n;
}

export function button(label: string, testid: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, testid }, label);
  b.addEventListener('click', onClick);
  return b;
}
