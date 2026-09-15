// Entry point: mount every component, load the static world data, start polling.
import { state, emit } from "./state.js";
import { loadStatic, startPolling } from "./api.js";
import { setContinent, setPanel, clearSelection } from "./actions.js";
import { mountTopbar } from "./components/topbar.js";
import { mountRail } from "./components/rail.js";
import { mountMap } from "./components/mapview.js";
import { mountRoster } from "./components/roster.js";
import { mountFeelings } from "./components/feelings.js";
import { mountCompanies } from "./components/companies.js";
import { mountChronicle } from "./components/chronicle.js";
import { mountCommands } from "./components/commands.js";
import { mountInspector } from "./components/inspector.js";

const $ = id => document.getElementById(id);

document.documentElement.dataset.theme = state.theme;

mountTopbar($("topbar"));
const panels = mountRail($("rail"), $("dock"));
mountRoster(panels.roster);
mountFeelings(panels.feelings);
mountCompanies(panels.companies);
mountChronicle(panels.chronicle);
mountCommands(panels.commands);
mountInspector($("inspector"));
mountMap($("stage"));

// "/" finds a character, Esc closes the inspector.
document.addEventListener("keydown", e => {
  const typing = e.target.closest("input, textarea, [contenteditable]");
  if (e.key === "/" && !typing) {
    e.preventDefault();
    if (state.panel !== "roster" || !state.dockOpen) setPanel("roster");
    emit("focus-search");
  } else if (e.key === "Escape") {
    if (typing) e.target.blur();
    else clearSelection();
  }
});

await loadStatic();
setContinent(state.continent);
startPolling();
