/* Works-in-Progress-style renderer.
   Three variants: Editorial (real geo, ivory), Schematic (hex dark),
   Dot (outlines + city dots only). All use d3-geo + the same subset GeoJSON. */

const PANELS = {
  edit: { id: "panel-edit", variant: "edit",  className: "v-edit" },
  hex:  { id: "panel-hex",  variant: "hex",   className: "v-hex"  },
  dot:  { id: "panel-dot",  variant: "dot",   className: "v-dot"  },
};

let GEO = null;         // FeatureCollection
let CITY_LL = null;     // lon/lat for cities (fallback to SVG coords until we geocode)

// City lon/lat (approximate, good enough for pin placement).
const CITY_LOCATIONS = {
  BER: [13.405, 52.520], HAM: [10.000, 53.551], MUC: [11.582, 48.135],
  FRA: [8.682, 50.110],  STU: [9.181, 48.775],  COL: [6.960, 50.937],
  LEI: [12.374, 51.340], DUS: [6.773, 51.227],  ESS: [7.012, 51.451],
  NUR: [11.077, 49.452], BRE: [8.801, 53.079],
  LUD: [8.438, 49.481],  // Ludwigshafen
  VIE: [16.373, 48.208], ZUR: [8.541, 47.376],  PAR: [2.352, 48.857],
  AMS: [4.900, 52.370],  BRU: [4.352, 50.850],  PRA: [14.438, 50.075],
  WAR: [21.012, 52.229], CPH: [12.568, 55.676],
  LON: [-0.118, 51.509], // London
};

// Map free-text city names (used in TSV rows) to city codes.
const CITY_NAME_TO_CODE = {
  "Berlin":"BER","Hamburg":"HAM","München":"MUC","Munich":"MUC",
  "Frankfurt":"FRA","Stuttgart":"STU","Köln":"COL","Cologne":"COL",
  "Leipzig":"LEI","Düsseldorf":"DUS","Essen":"ESS","Nürnberg":"NUR",
  "Bremen":"BRE","Ludwigshafen":"LUD",
  "Wien":"VIE","Vienna":"VIE","Amsterdam":"AMS","Paris":"PAR","London":"LON",
};

const COUNTRY_LABELS = {
  "Germany":"DEUTSCHLAND","France":"FRANKREICH","Poland":"POLEN",
  "Austria":"ÖSTERREICH","Switzerland":"SCHWEIZ","Czechia":"TSCHECHIEN",
  "Netherlands":"NIEDERLANDE","Belgium":"BELGIEN","Denmark":"DÄNEMARK",
  "Luxembourg":"LUXEMBURG","Italy":"ITALIEN","Slovakia":"SLOWAKEI",
  "Hungary":"UNGARN","Slovenia":"SLOWENIEN","Liechtenstein":"",
  "United Kingdom":"GROSSBRITANNIEN",
};

// ---------- boot ----------
(async function boot() {
  GEO = await (await fetch("europe-subset.json")).json();
  await window.loadCards();

  for (const key of Object.keys(PANELS)) renderPanel(PANELS[key]);

  // tabs
  document.querySelectorAll("#tabs button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      const tab = b.dataset.tab;
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      document.getElementById("panel-" + tab).classList.add("active");
    });
  });

  // drawer close
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
})();

// ---------- per-panel render ----------
function renderPanel(panel) {
  const el = document.getElementById(panel.id);
  const wasActive = el.classList.contains("active");
  el.className = "panel " + panel.className;
  if (wasActive || panel.variant === "edit") el.classList.add("active");
  el.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "map-wrap";
  el.appendChild(wrap);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "map-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  wrap.appendChild(svg);

  const leader = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leader.setAttribute("class", "leader");
  leader.setAttribute("preserveAspectRatio", "xMidYMid meet");
  wrap.appendChild(leader);

  // chrome
  wrap.appendChild(buildLayers(panel));
  wrap.appendChild(buildZoom());
  wrap.appendChild(buildNote(panel));
  wrap.appendChild(buildIntroChip(panel));

  // draw & layout on resize
  const draw = () => drawMap(panel, svg, leader, wrap);
  draw();
  new ResizeObserver(draw).observe(wrap);
}

function drawMap(panel, svg, leader, wrap) {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  leader.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  leader.innerHTML = "";

  // Projection — Lambert conformal conic centred on Germany, fit to Germany tightly.
  // We use d3.geoConicConformal and fit to DE bounds so DE fills ~60% of the canvas.
  const de = GEO.features.find(f => f.properties.name === "Germany");
  const proj = d3.geoConicConformal()
    .parallels([45, 54])
    .rotate([-10, 0]);

  // Fit projection so DE occupies ~60% of the viewport width.
  proj.fitExtent(
    [[W*0.20, H*0.14], [W*0.80, H*0.86]],
    de
  );
  const path = d3.geoPath(proj);

  // Graticule (editorial only)
  if (panel.variant === "edit") {
    const grat = d3.geoGraticule10();
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    p.setAttribute("class","graticule");
    p.setAttribute("d", path(grat));
    svg.appendChild(p);
  }

  // Countries
  for (const f of GEO.features) {
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    const isDe = f.properties.name === "Germany";
    p.setAttribute("class", "country-fill" + (isDe ? " de" : ""));
    p.setAttribute("d", path(f.geometry));
    svg.appendChild(p);
  }

  // Country labels (centroid)
  for (const f of GEO.features) {
    const lbl = COUNTRY_LABELS[f.properties.name];
    if (!lbl) continue;
    const c = path.centroid(f);
    if (!isFinite(c[0])) continue;
    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    const isDe = f.properties.name === "Germany";
    t.setAttribute("class", "country-label" + (isDe ? " de" : ""));
    t.setAttribute("text-anchor","middle");
    t.setAttribute("x", c[0]);
    t.setAttribute("y", c[1]);
    t.textContent = lbl;
    svg.appendChild(t);
  }

  // City dots + labels
  const cityScreen = {};
  for (const [code, ll] of Object.entries(CITY_LOCATIONS)) {
    const [cx, cy] = proj(ll);
    cityScreen[code] = [cx, cy];
    const city = window.CITIES[code];
    const dot = document.createElementNS("http://www.w3.org/2000/svg","circle");
    dot.setAttribute("class","city-dot");
    dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
    dot.setAttribute("r", panel.variant === "dot" ? 3.5 : 2);
    svg.appendChild(dot);

    // Label only in editorial & dot (skip tiny cities in editorial to reduce noise)
    if (panel.variant !== "hex") {
      const major = ["BER","HAM","MUC","FRA","COL","LEI","PAR","WAR","VIE","AMS","PRA","CPH","BRU","ZUR","STU","LON"];
      if (!major.includes(code)) continue;
      const t = document.createElementNS("http://www.w3.org/2000/svg","text");
      t.setAttribute("class","city-label");
      t.setAttribute("x", cx + 5); t.setAttribute("y", cy - 5);
      t.textContent = city.name;
      svg.appendChild(t);
    }
  }

  // Cards — anchor at city pin + fixed SVG offset (scaled down a bit).
  // Remove any old cards first.
  wrap.querySelectorAll(".card").forEach(x => x.remove());

  const placed = [];   // {el, x, y, w, h}
  for (const card of window.CARDS) {
    const anchor = cityScreen[card.city];
    if (!anchor) continue;
    const [ox, oy] = window.CARD_OFFSETS[card.id] || [0, -70];
    const refW = 1200;
    const scale = Math.max(0.55, Math.min(1, W / refW));
    let cx = anchor[0] + ox * scale;
    let cy = anchor[1] + oy * scale;

    const el = document.createElement("div");
    el.className = "card";
    el.dataset.cat = card.cat;
    el.style.left = cx + "px";
    el.style.top = cy + "px";
    el.innerHTML = `
      <div class="body">
        <div class="kicker">${card.kicker}</div>
        ${(card.val || card.unit) ? `
          <div class="headline">
            ${card.val ? `<div class="val">${card.val}</div>` : ""}
            ${card.unit ? `<div class="unit">${card.unit}</div>` : ""}
          </div>` : `<div class="card-title">${card.title || ""}</div>`}
        <div class="chart">${window.buildCardMini(card)}</div>
      </div>`;
    el.addEventListener("click", () => openDrawer(card));
    wrap.appendChild(el);

    // Measure & nudge away from overlaps / viewport edges
    const rect = el.getBoundingClientRect();
    const wR = rect.width, hR = rect.height;
    // Keep out of top bar (the panel's own top = 0, but topbar is 48px above it, so >=10 is fine) and edges
    const pad = 6;
    const minX = wR/2 + pad;
    const maxX = W - wR/2 - pad;
    const minY = hR/2 + pad;
    const maxY = H - hR/2 - pad;
    cx = Math.max(minX, Math.min(maxX, cx));
    cy = Math.max(minY, Math.min(maxY, cy));

    // Simple overlap resolver: iteratively push away from overlapping placed cards
    for (let iter = 0; iter < 20; iter++) {
      let moved = false;
      for (const p of placed) {
        const dx = cx - p.x, dy = cy - p.y;
        const minDx = (wR + p.w)/2 + 6;
        const minDy = (hR + p.h)/2 + 4;
        if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
          // Overlap — push in whichever axis has less penetration
          const penX = minDx - Math.abs(dx);
          const penY = minDy - Math.abs(dy);
          if (penY <= penX) {
            cy += (dy >= 0 ? 1 : -1) * (penY + 1);
          } else {
            cx += (dx >= 0 ? 1 : -1) * (penX + 1);
          }
          moved = true;
        }
      }
      cx = Math.max(minX, Math.min(maxX, cx));
      cy = Math.max(minY, Math.min(maxY, cy));
      if (!moved) break;
    }

    el.style.left = cx + "px";
    el.style.top = cy + "px";

    // For stacked-bars cards: collect unique city anchors from TSV rows.
    // Check for city column (explicit) or city names in first column.
    let extraAnchors = null;
    const chartType = card.chartType || card.render;
    if (chartType === "stacked-bars" && Array.isArray(card.rows)) {
      const seen = new Set();
      extraAnchors = [];
      const rowKey = Object.keys(card.rows[0])[0];

      for (const r of card.rows) {
        // Try explicit city column first, then first column value
        const name = (r.city || r[rowKey] || "").trim();
        if (!name) continue;
        const code = CITY_NAME_TO_CODE[name];
        if (!code || seen.has(code)) continue;
        const scr = cityScreen[code];
        if (!scr) continue;
        seen.add(code);
        extraAnchors.push(scr);
      }
      if (!extraAnchors.length) extraAnchors = null;
    }

    placed.push({ el, x: cx, y: cy, w: wR, h: hR, anchor, extraAnchors });
  }

  // Second pass: resolve any remaining overlaps by pushing BOTH cards apart,
  // iterating over ALL pairs. This catches cases where a later card pushed
  // into an earlier one that was already frozen.
  const pad = 6;
  const minX = (w) => w/2 + pad;
  const maxX = (w) => W - w/2 - pad;
  const minY = (h) => h/2 + pad;
  const maxY = (h) => H - h/2 - pad;
  for (let pass = 0; pass < 80; pass++) {
    let anyMoved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i+1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const minDx = (a.w + b.w)/2 + 8;
        const minDy = (a.h + b.h)/2 + 8;
        if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
          const penX = minDx - Math.abs(dx);
          const penY = minDy - Math.abs(dy);
          const sx = dx >= 0 ? 1 : -1;
          const sy = dy >= 0 ? 1 : -1;
          if (penY <= penX) {
            a.y -= sy * (penY/2 + 0.5);
            b.y += sy * (penY/2 + 0.5);
          } else {
            a.x -= sx * (penX/2 + 0.5);
            b.x += sx * (penX/2 + 0.5);
          }
          a.x = Math.max(minX(a.w), Math.min(maxX(a.w), a.x));
          a.y = Math.max(minY(a.h), Math.min(maxY(a.h), a.y));
          b.x = Math.max(minX(b.w), Math.min(maxX(b.w), b.x));
          b.y = Math.max(minY(b.h), Math.min(maxY(b.h), b.y));
          anyMoved = true;
        }
      }
    }
    if (!anyMoved) break;
  }

  // Commit positions + draw leaders
  leader.innerHTML = "";
  for (const p of placed) {
    p.el.style.left = p.x + "px";
    p.el.style.top = p.y + "px";
    const cat = p.el.dataset.cat || "";
    const anchors = p.extraAnchors && p.extraAnchors.length ? p.extraAnchors : [p.anchor];
    for (const a of anchors) {
      const ln = document.createElementNS("http://www.w3.org/2000/svg","line");
      ln.setAttribute("x1", a[0]); ln.setAttribute("y1", a[1]);
      ln.setAttribute("x2", p.x);  ln.setAttribute("y2", p.y);
      ln.dataset.cat = cat;
      leader.appendChild(ln);
      const dot = document.createElementNS("http://www.w3.org/2000/svg","circle");
      dot.setAttribute("cx", a[0]); dot.setAttribute("cy", a[1]); dot.setAttribute("r", 2.5);
      dot.dataset.cat = cat;
      leader.appendChild(dot);
    }
  }
}

// ---------- chrome ----------
function buildLayers(panel) {
  const el = document.createElement("div");
  el.className = "layers";
  el.innerHTML = `
    <h4>Layers</h4>
    <label><input type="checkbox" checked> <span class="sw" style="background:var(--spot-5)"></span> Industrie</label>
    <label><input type="checkbox" checked> <span class="sw" style="background:var(--spot-2)"></span> Arbeit</label>
    <label><input type="checkbox" checked> <span class="sw" style="background:var(--spot)"></span> Wohnen</label>
    <label><input type="checkbox" checked> <span class="sw" style="background:var(--spot-3)"></span> Staat</label>
    <label><input type="checkbox" checked> <span class="sw" style="background:var(--spot-4)"></span> Energie</label>
  `;
  el.addEventListener("change", () => {
    const checks = el.querySelectorAll("input");
    const cats = ["industrie","arbeit","wohnen","staat","energie"];
    const panelEl = el.closest(".panel");
    cats.forEach((c, i) => {
      // Categories that share a layer toggle with `c`
      const aliases = c === "arbeit" ? ["arbeit","gehalt"] : [c];
      const cardSel  = aliases.map(a => `.card[data-cat="${a}"]`).join(",");
      const leadSel  = aliases.map(a => `.leader [data-cat="${a}"]`).join(",");
      panelEl.querySelectorAll(cardSel).forEach(x => {
        x.style.display = checks[i].checked ? "" : "none";
      });
      panelEl.querySelectorAll(leadSel).forEach(x => {
        x.style.display = checks[i].checked ? "" : "none";
      });
    });
  });
  return el;
}
function buildZoom() {
  const el = document.createElement("div");
  el.className = "zoom";
  el.innerHTML = `<button>+</button><button>−</button>`;
  return el;
}
function buildNote(panel) {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = { edit:"Lambert Conformal · Natural Earth 1:50m",
                     hex:"Schematic — neighbours dimmed",
                     dot:"Dot map · cities only" }[panel.variant];
  return el;
}
function buildIntroChip(panel) {
  const el = document.createElement("div");
  el.className = "intro-chip";
  el.textContent = { edit:"Klicke eine Karte für Details",
                     hex:"Click a card for details",
                     dot:"Sparse view · cities only" }[panel.variant];
  return el;
}

// ---------- drawer ----------
window.openDrawer = function (card) {
  const dr = document.getElementById("drawer");
  document.getElementById("dr-title").textContent = card.title;
  document.getElementById("dr-content").innerHTML = window.buildDrawerContent(card);
  dr.classList.add("on");
};
window.closeDrawer = function () {
  document.getElementById("drawer").classList.remove("on");
};
