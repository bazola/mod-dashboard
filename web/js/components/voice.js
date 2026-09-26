// Voices (plan 57): hear a line said aloud, in a voice that belongs to whoever said it.
//
// The first time a character is heard they have no voice, so a caster opens: the gate writes a
// description of how they sound from their race, class, sex and personality, the player edits it, hears
// a sample, and accepts or declines. An accepted sample IS the voice -- every later line is cloned from
// that clip -- so it is locked from then on and the caster never opens for them again.
//
// Everything goes through the lore gate (it holds the speech key; mod-dashboard caps a body at 1024
// bytes and answers no preflight). The audio itself is read from the static /data mount, no token.
import { localGet } from "../state.js";
import { h, icon } from "../lib/dom.js";
import { capital } from "../lib/format.js";
import { toast } from "./toast.js";

const GATE = `${location.protocol}//${location.hostname}:8788`;
const token = () => (localGet("loreToken") || "").trim();

let player = null;         // the one line playing now; a second click stops the first
let playingBtn = null;
let queue = null;          // a whole section playing: { items, at, onEnd }

// ---- what has been recorded ----
//
// The gate publishes voices/index.json after every cast and every line: who has a voice, and every line
// said aloud keyed by its exact words, so the page can tell a recorded line from an unrecorded one with
// no token and no round trip.
const index = { enabled: false, voices: new Map(), names: new Map(), lines: new Map() };
const buttons = new Set();     // every speaker drawn, so a new recording can light it up
const listeners = new Set();

async function loadIndex() {
  try {
    const res = await fetch("data/voices/index.json", { cache: "no-store" });
    if (!res.ok) return;
    const doc = await res.json();
    // Voices are optional. A realm with no speech key (or VOICE_ENABLED=0) publishes enabled: false, and a
    // realm whose gate never ran has no file at all: either way the page shows no speaker anywhere.
    index.enabled = doc.enabled === true;
    index.voices = new Map(Object.entries(doc.voices || {}).map(([g, n]) => [Number(g), n]));
    index.names = new Map([...index.voices].map(([g, n]) => [n.toLowerCase(), g]));
    index.lines = new Map(Object.entries(doc.lines || {}).map(([g, m]) => [Number(g), new Map(Object.entries(m))]));
    changed();
  } catch { /* nobody has been voiced yet */ }
}
loadIndex();

export const voicesOn = () => index.enabled;
const guidOf = who => who.guid != null ? Number(who.guid) : index.names.get(String(who.name || "").toLowerCase());
export const hasVoice = who => { const g = guidOf(who); return g != null && index.voices.has(g); };
export const clipOf = (who, text) => { const g = guidOf(who); return g == null ? null : index.lines.get(g)?.get(text) || null; };
export function onVoices(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function changed() {
  for (const b of buttons) {
    if (!b.btn.isConnected) { buttons.delete(b); continue; }
    paint(b);
  }
  for (const fn of listeners) fn();
}

function paint({ btn, who, text }) {
  const done = !!clipOf(who, text), cast = hasVoice(who);
  btn.classList.toggle("done", done);
  btn.classList.toggle("none", !cast);
  const name = who.name || index.voices.get(guidOf(who)) || "them";
  btn.title = done ? "Play the recorded line"
    : cast ? "Record this line in their voice, and play it"
    : `Give ${name} a voice first`;
}

async function gate(path, body) {
  const res = await fetch(`${GATE}${path}`, body === undefined
    ? { headers: { "X-Lore-Token": token() }, cache: "no-store" }
    : { method: "POST", headers: { "Content-Type": "application/json", "X-Lore-Token": token() },
        body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) throw new Error(out.message || `HTTP ${res.status}`);
  return out;
}

function stopLine() {
  if (player) { player.pause(); player = null; }
  if (playingBtn) { playingBtn.classList.remove("playing"); playingBtn = null; }
  document.querySelectorAll(".bubble.speaking").forEach(b => b.classList.remove("speaking"));
}

export function stop() {
  const q = queue;
  queue = null;
  stopLine();
  q?.onEnd?.();
}

function play(url, btn, next) {
  stopLine();
  player = new Audio(url);
  playingBtn = btn || null;
  btn?.classList.add("playing");
  btn?.closest(".bubble")?.classList.add("speaking");
  const mine = player;
  const done = () => { if (player !== mine) return; stopLine(); next ? next() : stop(); };
  player.addEventListener("ended", done);
  player.addEventListener("error", () => { done(); toast({ ok: false, title: "The line would not play" }); });
  player.play().catch(() => { if (player === mine) stop(); });
}

// The speaker drawn for a line, if it is on screen, so a section playing through can show where it is.
const buttonFor = (who, text) => {
  const g = guidOf(who);
  for (const b of buttons) if (b.text === text && guidOf(b.who) === g && b.btn.isConnected) return b.btn;
  return null;
};

// Play every line in order, each in its own voice. `items` are { who, text }, oldest first. Every line
// must already be recorded; the caller shows the button only then.
export function playAll(items, onEnd) {
  stop();
  const q = { items, at: -1, onEnd };
  queue = q;
  const step = () => {
    if (queue !== q) return;
    q.at++;
    if (q.at >= items.length) return stop();
    const { who, text } = items[q.at];
    const url = clipOf(who, text);
    if (!url) return step();
    const btn = buttonFor(who, text);
    btn?.closest(".bubble")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    play(url, btn, step);
  };
  step();
  return q;
}
export const playingQueue = () => queue;

// ---- the caster ----
let modal = null;
const ui = {};
let cast = null;           // { who, guid, sample, onKeep }

export const voiceOpen = () => !!modal && !modal.hidden;

function build() {
  ui.title = h("div.vc-title");
  ui.sub = h("div.vc-sub");
  ui.queue = h("div.vc-queue", { hidden: true });
  ui.persona = h("div.vc-persona");
  ui.style = h("textarea.input.vc-style", { rows: 4, maxlength: 380,
    placeholder: "How they sound: pitch, age, texture, accent, pace…",
    on: { input: () => { discardSample(); draw(); } } });
  ui.suggest = h("button.btn.vc-suggest", { type: "button", title: "Write another description from who they are",
    on: { click: () => suggest() } }, icon("sparkle", 13), "Suggest again");
  ui.line = h("input.input.vc-line", { type: "text", maxlength: 300,
    on: { input: () => { discardSample(); draw(); } } });
  ui.hear = h("button.btn.btn-primary", { type: "button", on: { click: () => makeSample() } });
  ui.replay = h("button.btn", { type: "button", on: { click: () => cast?.sample && play(cast.sample.url, ui.replay) } },
    icon("play", 13), "Play again");
  ui.accept = h("button.btn.btn-primary", { type: "button", on: { click: () => accept() } }, icon("check", 13), "Accept this voice");
  ui.decline = h("button.btn", { type: "button", on: { click: () => { discardSample(); draw(); } } }, icon("x", 13), "Decline");
  ui.status = h("div.vc-status");
  ui.close = h("button.icon-btn", { type: "button", title: "Close (Esc)", on: { click: () => closeCaster() } }, icon("x", 18));

  modal = h("div.vc-modal", { role: "dialog", "aria-modal": "true", "aria-label": "Give them a voice", hidden: true,
    on: { click: e => { if (e.target === modal) closeCaster(); } } },
    h("div.vc-sheet",
      h("div.vc-head", icon("volume", 18), h("div.vc-head-text", ui.title, ui.sub, ui.queue), ui.close),
      h("div.vc-body",
        ui.persona,
        h("label.vc-label", "How they sound", ui.suggest),
        ui.style,
        h("label.vc-label", "What the sample says"),
        ui.line,
        h("div.vc-note", icon("info", 12),
          h("span", "Once you accept, this voice is theirs for good: every line they say is cloned from this sample.")),
        ui.status,
        h("div.vc-actions", ui.hear, ui.replay, ui.decline, ui.accept))));
  document.body.append(modal);

  window.addEventListener("keydown", e => {
    if (voiceOpen() && e.key === "Escape") { e.preventDefault(); closeCaster(); }
  }, true);
}

function draw() {
  if (!cast) return;
  const w = cast.who;
  ui.title.textContent = `Give ${w.name} a voice`;
  ui.sub.textContent = [`${capital(w.race)} ${w.cls}`, w.sex, `level ${w.level}`].join(" · ");
  ui.persona.replaceChildren(
    w.temperament ? h("span.pill", capital(w.temperament)) : null,
    w.personality ? h("span.vc-quote", w.personality) : h("span.muted", "No personality has been written for them."));
  const busy = !!cast.busy;
  ui.style.disabled = busy && cast.busy === "suggest";
  ui.suggest.disabled = busy;
  ui.line.disabled = busy;
  ui.hear.disabled = busy || ui.style.value.trim().split(/\s+/).length < 3;
  ui.hear.classList.toggle("btn-primary", !cast.sample);
  ui.hear.replaceChildren(icon(cast.busy === "sample" ? "activity" : "volume", 13),
    cast.busy === "sample" ? "Making a sample…" : cast.sample ? "Try again" : "Hear a sample");
  ui.replay.hidden = !cast.sample;
  ui.decline.hidden = !cast.sample;
  ui.accept.hidden = !cast.sample;
  ui.accept.disabled = busy;
  ui.status.textContent = cast.status || "";
  ui.status.className = "vc-status" + (cast.bad ? " bad" : "");
}

async function suggest() {
  cast.busy = "suggest"; cast.status = "Writing a description from who they are…"; cast.bad = false;
  discardSample();
  draw();
  try {
    const r = await gate("/voice-suggest", { guid: cast.guid });
    ui.style.value = r.style;
    cast.status = "A suggestion. Change anything you like before you hear it.";
  } catch (e) {
    cast.status = e.message; cast.bad = true;
  }
  cast.busy = null;
  draw();
}

async function makeSample() {
  discardSample();
  cast.busy = "sample"; cast.status = ""; cast.bad = false;
  draw();
  try {
    const r = await gate("/voice-sample", { guid: cast.guid, style: ui.style.value, text: ui.line.value });
    cast.sample = r;
    ui.style.value = r.style;
    cast.status = r.warning || "Listen. Accept it, or change the description and try again.";
    cast.bad = !!r.warning;
    play(r.url, ui.replay);
  } catch (e) {
    cast.status = e.message; cast.bad = true;
  }
  cast.busy = null;
  draw();
}

function discardSample() {
  if (!cast?.sample) return;
  const id = cast.sample.sample;
  cast.sample = null;
  stop();
  gate("/voice-decline", { guid: cast.guid, sample: id }).catch(() => {});
}

async function accept() {
  if (!cast?.sample) return;
  cast.busy = "accept"; draw();
  try {
    const r = await gate("/voice-accept", { guid: cast.guid, sample: cast.sample.sample });
    cast.sample = null;                       // kept now, so closing must not decline it
    index.voices.set(cast.guid, cast.who.name);
    index.names.set(cast.who.name.toLowerCase(), cast.guid);
    changed();
    const done = cast.onKeep;
    cast.onCancel = null;
    toast({ ok: true, title: `${cast.who.name} has a voice`, text: "It is theirs now, and it will not change." });
    closeCaster();
    done?.(r.voice);
  } catch (e) {
    cast.busy = null; cast.status = e.message; cast.bad = true; draw();
  }
}

function openCaster(state, onKeep, onCancel, note) {
  if (!modal) build();
  cast = { who: state.who, guid: state.who.guid, sample: null, onKeep, onCancel };
  ui.queue.hidden = !note;
  ui.queue.textContent = note || "";
  ui.style.value = "";
  ui.line.value = state.sample_text || "";
  modal.hidden = false;
  draw();
  suggest();
  ui.style.focus();
}

function closeCaster() {
  discardSample();
  stop();
  const cancelled = cast?.onCancel;
  cast = null;
  if (modal) modal.hidden = true;
  cancelled?.();
}

// The caster as a question with an answer: the voice when one is accepted, null when it is closed.
const castAndWait = (state, note) => new Promise(resolve => openCaster(state, v => resolve(v), () => resolve(null), note));

// ---- a line, said ----
async function speak(who, text, btn) {
  if (btn === playingBtn) return stop();
  const recorded = clipOf(who, text);
  if (recorded) { stop(); return play(recorded, btn); }      // already paid for: no gate, no token
  if (!token()) return toast({ ok: false, title: "No gate token",
    text: "Voices are made by the lore gate. Open the Lore panel and enter its token first." });
  btn.classList.add("busy");
  try {
    const q = who.guid != null ? `guid=${who.guid}` : `name=${encodeURIComponent(who.name)}`;
    const state = await gate(`/voice?${q}`);
    const say = async () => {
      btn.classList.add("busy");
      try {
        const r = await gate("/voice-line", { guid: state.who.guid, text });
        const g = Number(r.guid ?? state.who.guid);
        if (!index.lines.has(g)) index.lines.set(g, new Map());
        index.lines.get(g).set(text, r.url);
        changed();
        stop();
        play(r.url, btn);
      } catch (e) {
        toast({ ok: false, title: "It could not be said", text: e.message });
      } finally {
        btn.classList.remove("busy");
      }
    };
    if (state.voice) await say();
    else openCaster(state, say);
  } catch (e) {
    toast({ ok: false, title: "No voice", text: e.message });
  } finally {
    btn.classList.remove("busy");
  }
}

// A small speaker on a line of talk. `who` is { guid } when the record has one, else { name }.
// Three looks: no voice cast yet (faint), a voice but this line unrecorded (plain), recorded (gold).
export function sayButton(who, text) {
  if (!index.enabled) return null;
  const btn = h("button.vc-say", { type: "button",
    on: { click: e => { e.stopPropagation(); speak(who, text, btn); } } }, icon("volume", 12));
  const b = { btn, who, text };
  buttons.add(b);
  paint(b);
  return btn;
}


// ---- a whole section, recorded ----
//
// Everyone who speaks in it and has no voice is cast first, one at a time and by hand: a voice is locked
// for good, so none is ever made without being heard. Anyone whose caster is closed is skipped, and their
// lines stay unrecorded. Then every missing line is recorded, a few at once (the gate holds one render per
// speaker at a time, so different speakers run side by side).
const RECORD_AT_ONCE = 3;

export async function recordAll(lines, progress) {
  if (!token()) {
    toast({ ok: false, title: "No gate token", text: "Voices are made by the lore gate. Open the Lore panel and enter its token first." });
    return null;
  }
  const job = { lines, done: 0, total: 0, failed: 0, skipped: 0, cancelled: false, stage: "cast" };
  const report = () => progress?.(job);

  // who still needs a voice, in the order they first speak
  const speakers = new Map();
  for (const l of lines) {
    if (clipOf(l.who, l.text) || hasVoice(l.who)) continue;
    const key = l.who.guid != null ? `g${l.who.guid}` : `n${String(l.who.name).toLowerCase()}`;
    if (!speakers.has(key)) speakers.set(key, l.who);
  }
  const refused = new Set();
  let n = 0;
  for (const [key, who] of speakers) {
    n++;
    if (job.cancelled) break;
    job.casting = who.name || index.voices.get(guidOf(who)) || "";
    report();
    try {
      const q = who.guid != null ? `guid=${who.guid}` : `name=${encodeURIComponent(who.name)}`;
      const state = await gate(`/voice?${q}`);
      if (state.voice) {                        // cast elsewhere since the index was read
        index.voices.set(state.who.guid, state.who.name);
        index.names.set(state.who.name.toLowerCase(), state.who.guid);
        continue;
      }
      job.casting = state.who.name;
      report();
      const v = await castAndWait(state, `Recording this section · voice ${n} of ${speakers.size} still to cast`);
      if (!v) refused.add(key);
    } catch (e) {
      refused.add(key);
      toast({ ok: false, title: "No voice", text: e.message });
    }
  }
  job.casting = null;
  changed();

  const keyOf = who => who.guid != null ? `g${who.guid}` : `n${String(who.name).toLowerCase()}`;
  const todo = lines.filter(l => !clipOf(l.who, l.text) && hasVoice(l.who) && !refused.has(keyOf(l.who)));
  job.skipped = lines.filter(l => !clipOf(l.who, l.text)).length - todo.length;
  job.total = todo.length;
  job.stage = "record";
  report();

  let next = 0;
  const worker = async () => {
    while (!job.cancelled && next < todo.length) {
      const l = todo[next++];
      try {
        const r = await gate("/voice-line", { guid: guidOf(l.who), text: l.text });
        const g = Number(r.guid ?? guidOf(l.who));
        if (!index.lines.has(g)) index.lines.set(g, new Map());
        index.lines.get(g).set(l.text, r.url);
        job.done++;
        changed();
      } catch {
        job.failed++;
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(RECORD_AT_ONCE, todo.length) }, worker));
  job.stage = "finished";
  report();
  const said = [`${job.done} recorded`, job.failed && `${job.failed} failed`,
    job.skipped && `${job.skipped} skipped (no voice)`].filter(Boolean).join(", ");
  toast({ ok: !job.failed, title: job.cancelled ? "Recording stopped" : "Section recorded", text: said });
  return job;
}

// ---- a section, downloaded ----
// The gate packs it (it has ffmpeg and the files); the zip is then fetched from the /data mount.
export async function exportSection(lines, title) {
  if (!token()) {
    toast({ ok: false, title: "No gate token", text: "Open the Lore panel and enter the gate token first." });
    return;
  }
  try {
    const r = await gate("/voice-export", { title, lines: lines.map(l => ({
      guid: l.who.guid ?? null, name: l.who.name ?? null, text: l.text, ts: l.ts ?? null })) });
    const a = h("a", { href: r.url, download: r.file, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    toast({ ok: true, title: "Downloading", text: `${r.file} · ${r.lines} lines, ${Math.round(r.seconds)} s`
      + (r.missing ? ` · ${r.missing} not recorded, left out` : "") });
  } catch (e) {
    toast({ ok: false, title: "It could not be packed", text: e.message });
  }
}
