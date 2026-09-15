import { ICONS } from "./icons.js";

// h("div.a.b", { title, on: { click }, style: { "--x": 1 }, dataset, html }, ...children)
// Props may be omitted. Children: nodes, strings, numbers, arrays; null/false/true are skipped.
// `html` is for trusted markup built in this codebase only (icons, sparklines).
export function h(sel, props, ...children) {
  const [tag, ...classes] = sel.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") { if (v) el.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith("--") ? p : p.replace(/[A-Z]/g, m => "-" + m.toLowerCase()), val);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

// Replace el's children only when the signature changed; keeps hover, focus and scroll steady on polls.
export function render(el, sig, build) {
  if (el._sig === sig) return false;
  el._sig = sig;
  const out = [build()].flat(Infinity).filter(x => x != null && x !== false && x !== true);
  el.replaceChildren(...out);
  return true;
}

export function icon(name, size = 16) {
  return h("span.ico", {
    "aria-hidden": "true",
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`,
  });
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);
