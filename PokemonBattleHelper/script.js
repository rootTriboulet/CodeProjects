/* script.js - VGC Battle Helper (PokéAPI + Showdown gifs)
   Features:
   - 4 uniform team slots (top)
   - save/load teams to localStorage
   - case-insensitive search, Tab autocomplete, Enter add
   - opponent columns w/ weaknesses/resists/counters/threat visuals
*/

const POKEAPI_BASE = "https://pokeapi.co/api/v2";
const SHOWDOWN_ANIM_BASE = "https://play.pokemonshowdown.com/sprites/ani";

const cache = { pokemon: {}, type: {}, allNames: [] };

// default teams (names should be PokeAPI-friendly where possible)
const builtinTeams = {
  soulcrusher: ["calyrex-ice", "indeedee-f", "hatterene", "smeargle"],
  shadowDream: ["calyrex-shadow", "raging-bolt", "zamazenta", "rillaboom"]
};

// state
let activeTeam = ["", "", "", ""]; // 4 empty slots
let activeSlotIndex = 0;
let currentOpponents = []; // array of simplified objects { name, types[], sprite, pokeApiSprite }

// DOM
const teamSlotsNode = document.getElementById("teamSlots");
const slotInput = document.getElementById("slotInput");
const putSlotBtn = document.getElementById("putSlotBtn");
const slotSuggestions = document.getElementById("slotSuggestions");
const teamNameInput = document.getElementById("teamNameInput");
const saveTeamBtn = document.getElementById("saveTeamBtn");
const savedTeamsSelect = document.getElementById("savedTeamsSelect");
const loadTeamBtn = document.getElementById("loadTeamBtn");
const deleteTeamBtn = document.getElementById("deleteTeamBtn");

const input = document.getElementById("opponentPokemon");
const addBtn = document.getElementById("addOpponent");
const suggestionsNode = document.getElementById("suggestions");
const columnsContainer = document.getElementById("columnsContainer");

// type-to-css map
const typeClassMap = {
  normal: "type-normal", fire: "type-fire", water: "type-water", electric: "type-electric",
  grass: "type-grass", ice: "type-ice", fighting: "type-fighting", poison: "type-poison",
  ground: "type-ground", flying: "type-flying", psychic: "type-psychic", bug: "type-bug",
  rock: "type-rock", ghost: "type-ghost", dragon: "type-dragon", dark: "type-dark",
  steel: "type-steel", fairy: "type-fairy"
};

// helpers
const toKey = s => (s || "").toString().trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g,"");
const showGif = name => `${SHOWDOWN_ANIM_BASE}/${toKey(name)}.gif`;
const prettyName = s => (s || "").toString().replace(/-/g," ").split(' ').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');

// fetch all names for autocomplete
async function fetchAllPokemonNames(){
  if(cache.allNames.length) return cache.allNames;
  try{
    const r = await fetch(`${POKEAPI_BASE}/pokemon?limit=200000`);
    const j = await r.json();
    cache.allNames = j.results.map(x => x.name); // lowercase
    return cache.allNames;
  }catch(e){
    console.warn("fetch names error", e);
    return [];
  }
}

// fetch pokemon by name-ish (tries a few normalized forms)
async function fetchPokemon(name){
  if(!name) return null;
  const tries = [ name, toKey(name), name.toLowerCase(), name.toLowerCase().replace(/\s+/g,'-') ];
  for(const t of tries){
    if(!t) continue;
    if(cache.pokemon[t]) return cache.pokemon[t];
    try{
      const r = await fetch(`${POKEAPI_BASE}/pokemon/${t}`);
      if(!r.ok) continue;
      const j = await r.json();
      cache.pokemon[t] = j;
      return j;
    }catch(e){}
  }
  return null;
}

async function fetchType(name){
  if(!name) return null;
  const key = name.toLowerCase();
  if(cache.type[key]) return cache.type[key];
  try{
    const r = await fetch(`${POKEAPI_BASE}/type/${key}`);
    if(!r.ok) return null;
    const j = await r.json();
    cache.type[key] = j;
    return j;
  }catch(e){
    return null;
  }
}

// compute effectiveness: attackerTypes[] vs defenderTypes[] -> multiplier
async function getEffectiveness(attackerTypes, defenderTypes){
  let multiplier = 1;
  for(const a of attackerTypes){
    const typeData = await fetchType(a.toLowerCase());
    if(!typeData) continue;
    const dr = typeData.damage_relations;
    for(const d of defenderTypes){
      const dl = d.toLowerCase();
      if(dr.double_damage_to.some(x => x.name === dl)) multiplier *= 2;
      if(dr.half_damage_to.some(x => x.name === dl)) multiplier *= 0.5;
      if(dr.no_damage_to.some(x => x.name === dl)) multiplier *= 0;
    }
  }
  return Math.round(multiplier*100)/100;
}

// compute weaknesses/resistances arrays
async function computeWeakRes(defTypes){
  const types = Object.keys(typeClassMap);
  const weak = [], resist = [];
  for(const t of types){
    const mult = await getEffectiveness([t], defTypes);
    if(mult > 1) weak.push({type:t, mult});
    else if(mult > 0 && mult < 1) resist.push({type:t, mult});
  }
  return {weak, resist};
}

// poke sprite from pokeapi object
function pokeApiSpriteUrl(pokeData){
  if(!pokeData) return "";
  try {
    const anim = pokeData.sprites.versions['generation-v']['black-white'].animated.front_default;
    if(anim) return anim;
  } catch(e){}
  if(pokeData.sprites.front_default) return pokeData.sprites.front_default;
  try { return pokeData.sprites.other['official-artwork'].front_default || ""; } catch(e){}
  return "";
}

// load saved teams from localStorage
function loadSavedTeams(){
  try{
    const raw = localStorage.getItem("vgc_saved_teams_v1");
    if(!raw) return {};
    return JSON.parse(raw);
  }catch(e){ return {} }
}

function saveSavedTeams(obj){
  localStorage.setItem("vgc_saved_teams_v1", JSON.stringify(obj));
}

// UI: render team slots (4)
async function renderTeamSlots(){
  teamSlotsNode.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    slot.className = "slot" + (i === activeSlotIndex ? " selected" : "");
    slot.dataset.index = i;

    const nameKey = activeTeam[i] || "";
    const display = prettyName(nameKey);
    const title = document.createElement("h4");
    title.textContent = display || `Slot ${i + 1}`;
    slot.appendChild(title);

    // if no name, just show placeholder
    if (!nameKey) {
      const img = document.createElement("img");
      img.alt = "empty";
      slot.appendChild(img);
      slot.addEventListener("click", () => {
        activeSlotIndex = i;
        renderTeamSlots();
      });
      teamSlotsNode.appendChild(slot);
      continue;
    }

    // ensure Pokémon data is loaded
    let p = cache.pokemon[toKey(nameKey)];
    if (!p) {
      p = await fetchPokemon(nameKey);
    }

    // sprite
    const img = document.createElement("img");
    if (p) {
      img.src = showGif(p.name);
      img.onerror = () => {
        img.src = pokeApiSpriteUrl(p);
        img.onerror = null;
      };
    } else {
      img.src = showGif(nameKey);
      img.onerror = () => { img.src = ""; img.onerror = null; };
    }
    slot.appendChild(img);

    // types (always after we’re sure data is loaded)
    if (p && p.types && p.types.length > 0) {
      const typeRow = document.createElement("div");
      typeRow.className = "type-row";
      for (const t of p.types) {
        const badge = document.createElement("span");
        badge.className = `type-badge ${typeClassMap[t.type.name] || ""}`;
        badge.textContent = prettyName(t.type.name);
        typeRow.appendChild(badge);
      }
      slot.appendChild(typeRow);
    }

    // click to select slot
    slot.addEventListener("click", () => {
      activeSlotIndex = i;
      renderTeamSlots();
    });

    teamSlotsNode.appendChild(slot);
  }
}



// add or replace slot with name (case-insensitive resolution using PokeAPI if possible)
async function putIntoSlot(name){
  if(!name) return;
  const p = await fetchPokemon(name);
  const key = p ? p.name : toKey(name);
  activeTeam[activeSlotIndex] = key;
  renderTeamSlots();
  renderAllColumns(); // update counters
}

// Save team to localStorage
function populateSavedTeamsSelect(){
  const saved = loadSavedTeams();
  savedTeamsSelect.innerHTML = '<option value="">-- Saved teams --</option>';
  for(const k of Object.keys(saved)){
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    savedTeamsSelect.appendChild(opt);
  }
}

saveTeamBtn.addEventListener("click", ()=>{
  const nm = (document.getElementById("teamNameInput").value||"").trim();
  if(!nm){ alert("Enter a team name to save"); return; }
  const saved = loadSavedTeams();
  saved[nm] = [...activeTeam];
  saveSavedTeams(saved);
  populateSavedTeamsSelect();
  alert(`Team "${nm}" saved.`);
});

loadTeamBtn.addEventListener("click", ()=>{
  const sel = savedTeamsSelect.value;
  if(!sel) return;
  const saved = loadSavedTeams();
  if(saved[sel]) {
    activeTeam = [...saved[sel]];
    renderTeamSlots();
    renderAllColumns();
  }
});

deleteTeamBtn.addEventListener("click", ()=>{
  const sel = savedTeamsSelect.value;
  if(!sel) return;
  const saved = loadSavedTeams();
  if(saved[sel]) {
    delete saved[sel];
    saveSavedTeams(saved);
    populateSavedTeamsSelect();
    alert(`Deleted ${sel}`);
  }
});

// autocomplete helpers for both slotInput and main input use same name list
let allNames = [];
(async()=>{ allNames = await fetchAllPokemonNames(); populateSavedTeamsSelect(); renderTeamSlots(); })();

// --- Autocomplete UI for slotInput
slotInput.addEventListener("input", ()=>{
  const q = slotInput.value.trim().toLowerCase();
  slotSuggestions.innerHTML = "";
  if(!q) return;
  const matches = (allNames.length? allNames : Object.keys(cache.pokemon)).filter(n=> n.includes(q)).slice(0,12);
  for(const m of matches){
    const li = document.createElement("div");
    li.textContent = prettyName(m);
    li.addEventListener("click", ()=> { slotInput.value = m; slotSuggestions.innerHTML=""; });
    slotSuggestions.appendChild(li);
  }
});
slotInput.addEventListener("keydown", (e)=>{
  if(e.key === "Tab"){ e.preventDefault(); const f = slotSuggestions.querySelector("div"); if(f) { slotInput.value = f.textContent; slotSuggestions.innerHTML=""; } }
  if(e.key === "Enter"){ e.preventDefault(); putSlotBtn.click(); }
});
putSlotBtn.addEventListener("click", ()=>{ putIntoSlot(slotInput.value); slotInput.value=""; slotSuggestions.innerHTML=""; });

// ---------------- Opponent autocomplete and input (main)
input.addEventListener("input", onType);
input.addEventListener("keydown", onKeyDown);
addBtn.addEventListener("click", onAddClicked);

async function onType(){
  const val = input.value.trim().toLowerCase();
  suggestionsNode.innerHTML = "";
  if(!val) return;
  const matches = (allNames.length? allNames : Object.keys(cache.pokemon)).filter(n=> n.includes(val)).slice(0,12);
  for(const m of matches){
    const li = document.createElement("li");
    li.textContent = m;
    li.addEventListener("click", ()=>{ input.value = m; suggestionsNode.innerHTML=""; addOpponent(); });
    suggestionsNode.appendChild(li);
  }
}

function onKeyDown(e){
  if(e.key === "Tab"){ e.preventDefault(); const first = suggestionsNode.querySelector("li"); if(first){ input.value = first.textContent; suggestionsNode.innerHTML=""; } }
  else if(e.key === "Enter"){ e.preventDefault(); addOpponent(); }
}

function onAddClicked(){ addOpponent(); }

// add opponent: fetch via PokeAPI, store simplified object
async function addOpponent(){
  const raw = input.value.trim();
  if(!raw) return;
  const data = await fetchPokemon(raw);
  if(!data){ alert(`Pokémon "${raw}" not found`); return; }
  // check duplicate by name
  if(currentOpponents.some(o=>o.name === data.name)) { input.value=""; suggestionsNode.innerHTML=""; return; }
  const obj = {
    name: data.name,
    types: data.types.map(t => t.type.name), // lowercase
    rawData: data,
    sprite: showGif(data.name),
    pokeApiSprite: pokeApiSpriteUrl(data)
  };
  currentOpponents.push(obj);
  input.value=""; suggestionsNode.innerHTML="";
  await renderAllColumns();
}

// render columns (uses activeTeam)
async function renderAllColumns(){
  columnsContainer.innerHTML = "";
  // build your team data array with types and sprites (resolve PokeAPI if possible)
  const yourTeam = [];
  for(const tname of activeTeam){
    if(!tname){ yourTeam.push({name: tname || "", types: [], sprite: "", pokeApiSprite: ""}); continue; }
    let p = cache.pokemon[toKey(tname)];
    if(!p) p = await fetchPokemon(tname);
    if(!p){ yourTeam.push({name: tname, types: [], sprite: showGif(tname), pokeApiSprite: ""}); continue; }
    yourTeam.push({
      name: p.name,
      types: p.types.map(x=>x.type.name),
      sprite: showGif(p.name),
      pokeApiSprite: pokeApiSpriteUrl(p)
    });
  }

  for(const opp of currentOpponents){
    const col = document.createElement("div"); col.className = "column";
    const h = document.createElement("h3"); h.textContent = prettyName(opp.name); col.appendChild(h);

    // Pokemon card
    const card = document.createElement("div"); card.className = "pokemon-card";
    const img = document.createElement("img"); img.src = opp.sprite;
    img.onerror = ()=>{ if(opp.pokeApiSprite) img.src = opp.pokeApiSprite; img.onerror=null; };
    card.appendChild(img);
    const meta = document.createElement("div"); meta.className = "pokemon-meta";
    const typeRow = document.createElement("div"); typeRow.className = "type-row";
    for(const t of opp.types){ const b = document.createElement("span"); b.className = `type-badge ${typeClassMap[t]||""}`; b.textContent = prettyName(t); typeRow.appendChild(b); }
    meta.appendChild(typeRow); card.appendChild(meta); col.appendChild(card);

    // Weaknesses/resists
    const {weak, resist} = await computeWeakRes(opp.types);
    const wkDiv = document.createElement("div"); wkDiv.innerHTML = `<h4>Weak to:</h4>`;
    weak.forEach(w=>{ const b = document.createElement("span"); b.className = `type-badge ${typeClassMap[w.type]||""}`; b.textContent = `${prettyName(w.type)} ×${w.mult}`; wkDiv.appendChild(b); });
    col.appendChild(wkDiv);
    const rsDiv = document.createElement("div"); rsDiv.innerHTML = `<h4>Resists:</h4>`;
    resist.forEach(r=>{ const b = document.createElement("span"); b.className = `type-badge ${typeClassMap[r.type]||""}`; b.textContent = `${prettyName(r.type)} ×${r.mult}`; rsDiv.appendChild(b); });
    col.appendChild(rsDiv);

    // Counters (your team -> opponent)
    const counterSect = document.createElement("div"); counterSect.innerHTML = `<h4>Counters (your team):</h4>`;
    for(const yt of yourTeam){
      if(!yt.types || !yt.types.length) continue;
      const mult = await getEffectiveness(yt.types, opp.types);
      if(mult > 1){
        const cc = document.createElement("div"); cc.className = "counter-card";
        const cimg = document.createElement("img"); cimg.src = yt.sprite; cimg.onerror = ()=>{ if(yt.pokeApiSprite) cimg.src = yt.pokeApiSprite; cimg.onerror=null; };
        cc.appendChild(cimg);
        const txt = document.createElement("div"); txt.innerHTML = `<strong>${prettyName(yt.name)}</strong><div style="font-size:13px;color:#bbb">x${mult}</div>`;
        cc.appendChild(txt);
        counterSect.appendChild(cc);
      }
    }
    col.appendChild(counterSect);

    // Threats (opponent -> your team) with GIF vs GIF visual
    const threatSect = document.createElement("div"); threatSect.innerHTML = `<h4>Be careful:</h4>`;
    for(const yt of yourTeam){
      if(!yt.types || !yt.types.length) continue;
      const mult = await getEffectiveness(opp.types, yt.types);
      if(mult > 1){
        const tcard = document.createElement("div"); tcard.className = "threat-card";
        const left = document.createElement("img"); left.src = opp.sprite; left.onerror = ()=>{ if(opp.pokeApiSprite) left.src = opp.pokeApiSprite; left.onerror=null; };
        const right = document.createElement("img"); right.src = yt.sprite; right.onerror = ()=>{ if(yt.pokeApiSprite) right.src = yt.pokeApiSprite; right.onerror=null; };
        const vis = document.createElement("div"); vis.className = "threat-visual"; vis.appendChild(left);
        const arrow = document.createElement("div"); arrow.className = "arrow"; arrow.textContent = "→"; vis.appendChild(arrow); vis.appendChild(right);
        const label = document.createElement("div"); label.innerHTML = `<strong>${prettyName(opp.name)}</strong> → <strong>${prettyName(yt.name)}</strong><div style="font-size:12px;color:#bbb">x${mult}</div>`;
        tcard.appendChild(vis); tcard.appendChild(label);
        threatSect.appendChild(tcard);
      }
    }
    col.appendChild(threatSect);

    // remove button
    const rem = document.createElement("button"); rem.className = "remove-btn"; rem.textContent = "Remove";
    rem.addEventListener("click", ()=>{ currentOpponents = currentOpponents.filter(x => x !== opp); renderAllColumns(); });
    col.appendChild(rem);

    columnsContainer.appendChild(col);
  }
}

// init persisted saved teams into savedTeamsSelect
(function init(){
  const saved = loadSavedTeams();
  // ensure builtins present if not already
  localStorage.setItem("vgc_builtin_teams", JSON.stringify(builtinTeams));
  populateSavedTeamsSelect();
  renderTeamSlots();
})();

function populateSavedTeamsSelect(){
  const saved = loadSavedTeams();
  savedTeamsSelect.innerHTML = '<option value="">-- Saved teams --</option>';
  for(const k of Object.keys(saved)) {
    const o = document.createElement("option"); o.value = k; o.textContent = k; savedTeamsSelect.appendChild(o);
  }
}

// local storage functions reused
function loadSavedTeams(){ try{ return JSON.parse(localStorage.getItem("vgc_saved_teams_v1")||"{}"); }catch(e){ return {}; } }
function saveSavedTeams(obj){ localStorage.setItem("vgc_saved_teams_v1", JSON.stringify(obj)); }

// small convenience: save current activeTeam as named team
saveTeamBtn.addEventListener("click", ()=>{
  const nm = (teamNameInput.value||"").trim();
  if(!nm){ alert("Enter team name"); return; }
  const s = loadSavedTeams(); s[nm] = [...activeTeam]; saveSavedTeams(s); populateSavedTeamsSelect(); alert("Saved " + nm);
});

// ensure initial activeTeam has 4 slots
if(activeTeam.length < 4) while(activeTeam.length < 4) activeTeam.push("");

// expose debug reload if needed
window.renderAllColumns = renderAllColumns;
window.renderTeamSlots = renderTeamSlots;
