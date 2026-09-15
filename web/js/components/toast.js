import { h, icon } from "../lib/dom.js";

// toast({ ok, tone: "info", title, text }) — a short notice at the bottom of the screen.
export function toast({ ok = true, tone, title, text }) {
  const box = document.getElementById("toasts");
  const kind = tone || (ok ? "ok" : "bad");
  const el = h("div.toast", { class: kind, role: "status" },
    icon(kind === "info" ? "info" : ok ? "check" : "alert", 16),
    h("div", title && h("b", title), text && h("span", text)));
  box.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 300);
  }, 4500);
}
