// Card loader: fetch YAML-header+TSV-body files listed in cards/index.txt,
// parse them, expose window.CARDS + window.CARD_OFFSETS, and provide
// data-driven buildCardMini / buildDrawerContent.

// ---------- tiny YAML + TSV parser (our subset only) ----------
function parseCardFile(text) {
  // Expect: ---\nYAML\n---\nTSV
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) throw new Error("Card file missing YAML front-matter");
  const meta = parseYaml(m[1]);
  const rows = parseTsv(m[2]);
  return { ...meta, rows };
}

function parseYaml(src) {
  const out = {};
  const lines = src.split(/\n/).map(l => l.replace(/\s+$/, ""));

  // Helper to parse a simple value
  function parseValue(v) {
    v = v.trim();
    if (/^\[.*\]$/.test(v)) {
      return v.slice(1,-1).split(",").map(s => {
        const t = s.trim();
        return isFinite(+t) && t !== "" ? +t : stripQuotes(t);
      });
    }
    if (/^["'].*["']$/.test(v)) return v.slice(1,-1);
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return +v;
    return v;
  }

  // Helper to get indentation level (number of leading spaces)
  function indent(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) continue;

    // Top-level key: value
    const mm = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!mm) continue;
    let [, k, v] = mm;
    v = v.trim();

    // Accept `type:` as alias for `render:` (only if render not already set)
    if (k === "type") {
      if (out.render !== undefined) continue;
      k = "render";
    }
    // Duplicate `dek:` → first is dek, subsequent go to axis/subtitle.
    if (k === "dek" && out.dek !== undefined) {
      if (out.axis === undefined) k = "axis";
      else continue;
    }

    // Block syntax: `key:` on its own line
    if (v === "") {
      // Check for block-list syntax: `- item` lines
      if (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        const items = [];
        let j = i + 1;
        while (j < lines.length) {
          const bm = lines[j].match(/^\s+-\s+(.*)$/);
          if (!bm) break;
          items.push(stripQuotes(bm[1].trim()));
          j++;
        }
        out[k] = items;
        i = j - 1;
        continue;
      }

      // Check for nested object syntax (indented key: value pairs)
      if (i + 1 < lines.length && indent(lines[i + 1]) > 0) {
        const obj = {};
        let j = i + 1;
        const baseIndent = indent(lines[j]);
        let currentSubKey = null;
        let currentSubObj = null;

        while (j < lines.length) {
          const subLine = lines[j];
          if (!subLine.trim() || /^\s*#/.test(subLine)) { j++; continue; }

          const subIndent = indent(subLine);
          if (subIndent < baseIndent) break;  // End of block

          // Sub-object key (at base indent level)
          const subMatch = subLine.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
          if (!subMatch) { j++; continue; }

          const [, subK, subV] = subMatch;

          if (subIndent === baseIndent) {
            // This is a category key like "steuern:"
            if (subV.trim() === "") {
              currentSubKey = subK;
              currentSubObj = {};
              obj[currentSubKey] = currentSubObj;
            } else {
              // Simple nested value like "scale: absolute"
              obj[subK] = parseValue(subV);
              currentSubKey = null;
              currentSubObj = null;
            }
          } else if (subIndent > baseIndent && currentSubObj) {
            // Property of current sub-object like "label: ..."
            currentSubObj[subK] = parseValue(subV);
          }
          j++;
        }
        out[k] = obj;
        i = j - 1;
        continue;
      }
    }

    // Simple value
    out[k] = parseValue(v);
  }
  return out;
}
function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}

function parseTsv(src) {
  const lines = src.split(/\n/).map(l => l.replace(/\s+$/,"")).filter(l => l.length);
  if (!lines.length) return [];
  const header = lines[0].split("\t").map(s => s.trim());
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const row = {};
    header.forEach((h, j) => {
      const v = (cols[j] ?? "").trim();
      row[h] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v;
    });
    out.push(row);
  }
  return out;
}

// ---------- city directory ----------
window.CITIES = {
  BER: { name: "Berlin",     country: "DE" },
  HAM: { name: "Hamburg",    country: "DE" },
  MUC: { name: "München",    country: "DE" },
  FRA: { name: "Frankfurt",  country: "DE" },
  STU: { name: "Stuttgart",  country: "DE" },
  COL: { name: "Köln",       country: "DE" },
  LEI: { name: "Leipzig",    country: "DE" },
  DUS: { name: "Düsseldorf", country: "DE" },
  ESS: { name: "Essen",      country: "DE" },
  NUR: { name: "Nürnberg",   country: "DE" },
  BRE: { name: "Bremen",     country: "DE" },
  VIE: { name: "Wien",       country: "AT" },
  ZUR: { name: "Zürich",     country: "CH" },
  PAR: { name: "Paris",      country: "FR" },
  AMS: { name: "Amsterdam",  country: "NL" },
  BRU: { name: "Brüssel",    country: "BE" },
  PRA: { name: "Prag",       country: "CZ" },
  WAR: { name: "Warschau",   country: "PL" },
  CPH: { name: "Kopenhagen", country: "DK" },
  LON: { name: "London",     country: "UK" },
};

// ---------- loader ----------
// Index file lists one card filename per line.
window.loadCards = async function () {
  const idx = await (await fetch("cards/index.txt")).text();
  const files = idx.split(/\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  const cards = [];
  for (const f of files) {
    const text = await (await fetch("cards/" + f)).text();
    cards.push(parseCardFile(text));
  }
  window.CARDS = cards;
  window.CARD_OFFSETS = Object.fromEntries(
    cards.filter(c => c.offset).map(c => [c.id, c.offset])
  );
};

// ---------- helpers for declarative cards ----------

// Get category definitions from card.categories (new) or return empty
function getCategories(card) {
  return card.categories || {};
}

// Get segment keys from TSV (skip label column and meta columns like 'city', 'short')
const META_COLS = new Set(["city", "short"]);
function getSegmentKeys(card) {
  if (!card.rows || !card.rows.length) return [];
  const keys = Object.keys(card.rows[0]);
  return keys.slice(1).filter(k => !META_COLS.has(k));
}

// Get the row label column name (first column in TSV)
function getLabelKey(card) {
  if (!card.rows || !card.rows.length) return "label";
  return Object.keys(card.rows[0])[0];
}

// Format a value according to card.valueFormat
function formatCardValue(v, card) {
  const fmt = card.valueFormat;
  if (!fmt) {
    // Default: use k suffix for large numbers
    if (v >= 10000) return Math.round(v / 1000) + "k";
    return v.toLocaleString("de-DE");
  }
  if (fmt === "currency") return v.toLocaleString("de-DE") + " €";
  if (fmt === "percent") return v + "%";
  // Template: "{{v}}k" → "80k"
  if (fmt.includes("{{v}}")) {
    return fmt.replace("{{v}}", Math.round(v / 1000));
  }
  return v.toString();
}

// Get background style for a category color
function getCategoryStyle(cat) {
  if (!cat || !cat.color) return "background:var(--ink-3)";
  if (cat.color.startsWith("#")) return `background:${cat.color}`;
  return `background:var(--${cat.color})`;
}

// ---------- Generic chart builders ----------

// Horizontal bars (for wage-comparison, col, wages, rent, etc.)
function buildHorizontalBarsMini(card) {
  const rows = card.rows.slice(0, 5);
  const labelKey = getLabelKey(card);
  // Determine value key: prefer "value", else second column
  const valueKey = card.rows[0].value !== undefined ? "value" : Object.keys(card.rows[0])[1];
  const max = Math.max(...rows.map(r => +r[valueKey] || 0));

  return `<div class="mini-bars">` + rows.map(r => {
    const v = +r[valueKey] || 0;
    const pct = Math.round(100 * v / max);
    const valTxt = formatCardValue(v, card);
    // Use "short" column if available, else full label
    const lbl = r.short || r[labelKey] || "";
    return `<div class="mb-row"><span class="mb-lbl">${lbl}</span><span class="mb-track"><i style="width:${pct}%"></i></span><span class="mb-val">${valTxt}</span></div>`;
  }).join("") + `</div>`;
}

// Stacked bars (for cost-structure, city-comparison, etc.)
function buildStackedBarsMini(card) {
  const labelKey = getLabelKey(card);
  const segKeys = getSegmentKeys(card);
  const cats = getCategories(card);
  const isAbsolute = card.scale === "absolute";
  const showTotal = card.showTotal !== false && isAbsolute;

  // Calculate totals for each row
  const totals = card.rows.map(r => segKeys.reduce((s, k) => s + (+r[k] || 0), 0));
  const maxTotal = Math.max(...totals);

  const barsHtml = card.rows.map((r, i) => {
    const total = totals[i];
    const remainder = isAbsolute ? maxTotal - total : 0;

    const segs = segKeys.map(k => {
      const v = +r[k] || 0;
      const cat = cats[k] || {};
      const style = getCategoryStyle(cat);
      const title = cat.label ? `${cat.label} ${v}` : k;
      return `<div style="${style}; flex:${v}" title="${title}"></div>`;
    }).join("");

    const emptySpace = remainder > 0 ? `<div style="flex:${remainder}"></div>` : "";
    const lbl = r.short || r[labelKey] || "";
    const totalHtml = showTotal ? `<span class="mb-val">${formatCardValue(total, card)}</span>` : "";

    return `
      <div class="cs-row">
        <span class="cs-lbl">${lbl}</span>
        <div class="mini-stack cs-bar">${segs}${emptySpace}</div>
        ${totalHtml}
      </div>`;
  }).join("");

  // Legend
  const legend = segKeys.map(k => {
    const cat = cats[k] || { label: k };
    const style = getCategoryStyle(cat);
    return `<span class="pair"><span class="sw" style="${style}"></span>${cat.label || k}</span>`;
  }).join("");

  return `
    <div class="cs-grid">${barsHtml}</div>
    <div class="mini-legend cs-legend">${legend}</div>`;
}

// Stacked columns (vertical, for stacked-column)
function buildStackedColumnMini(card) {
  const rowKey = getLabelKey(card);
  const segKeys = getSegmentKeys(card).filter(k => k !== "brutto");
  const cats = getCategories(card);
  const totals = card.rows.map(r => segKeys.reduce((s, k) => s + (+r[k] || 0), 0));
  const maxTotal = Math.max(...totals);

  const cols = card.rows.map((r, i) => {
    const total = totals[i];
    const hPct = Math.round(100 * total / maxTotal);
    const segs = segKeys.map(k => {
      const v = +r[k] || 0;
      const cat = cats[k] || {};
      const style = getCategoryStyle(cat);
      return `<div style="${style}; flex:${v}" title="${cat.label || k} ${v}"></div>`;
    }).join("");
    const lbl = r.short || r[rowKey] || "";
    return `
      <div class="sc-col">
        <div class="sc-total">${formatCardValue(total, card)}</div>
        <div class="sc-stack" style="height:${hPct}%">${segs}</div>
        <div class="sc-lbl">${lbl}</div>
      </div>`;
  }).join("");

  const legend = segKeys.map(k => {
    const cat = cats[k] || { label: k };
    const style = getCategoryStyle(cat);
    return `<span class="pair"><span class="sw" style="${style}"></span>${cat.label || k}</span>`;
  }).join("");

  return `
    <div class="sc-wrap">${cols}</div>
    <div class="mini-legend cs-legend">${legend}</div>`;
}

// Chart type mapping
const MINI_BUILDERS = {
  "horizontal-bars": buildHorizontalBarsMini,
  "stacked-bars": buildStackedBarsMini,
  "stacked-column": buildStackedColumnMini,
};

window.buildCardMini = function (card) {
  const chartType = card.chartType || card.render;
  const builder = MINI_BUILDERS[chartType];
  if (builder) return builder(card);
  return "";
};

// ---------- data-driven drawer ----------

// Drawer: Horizontal bars
function buildHorizontalBarsDrawer(card, head, src) {
  const labelKey = getLabelKey(card);
  const valueKey = card.rows[0].value !== undefined ? "value" : Object.keys(card.rows[0])[1];
  const max = Math.max(...card.rows.map(r => +r[valueKey] || 0));

  // Use drawerFormat if specified, otherwise valueFormat
  const drawerFmt = card.drawerFormat || card.valueFormat;

  const body = card.rows.map(r => {
    const v = +r[valueKey] || 0;
    const pct = Math.round(100 * v / max);
    let val;
    if (drawerFmt === "currency") {
      val = v.toLocaleString("de-DE") + " €";
    } else {
      val = formatCardValue(v, card);
    }
    return `<div class="prof"><span>${r[labelKey]}</span><div class="bar"><span style="width:${pct}%"></span></div><span class="v">${val}</span></div>`;
  }).join("");

  return head + body + src;
}

// Drawer: Stacked bars
function buildStackedBarsDrawer(card, head, src) {
  const labelKey = getLabelKey(card);
  const segKeys = getSegmentKeys(card);
  const cats = getCategories(card);
  const isAbsolute = card.scale === "absolute";

  const totals = card.rows.map(r => segKeys.reduce((s, k) => s + (+r[k] || 0), 0));
  const maxTotal = Math.max(...totals);

  const bars = card.rows.map((r, i) => {
    const total = totals[i];
    const remainder = isAbsolute ? maxTotal - total : 0;

    const segs = segKeys.map(k => {
      const v = +r[k] || 0;
      const cat = cats[k] || {};
      const style = getCategoryStyle(cat);
      const valTxt = isAbsolute ? formatCardValue(v, card) : (v > 0 ? v + "%" : "");
      return `<div style="${style}; flex:${v}">${valTxt}</div>`;
    }).join("");

    const emptySpace = remainder > 0 ? `<div style="flex:${remainder}"></div>` : "";

    return `
      <div class="cs-drow">
        <span class="cs-dlbl">${r[labelKey]}</span>
        <div class="stackbar">${segs}${emptySpace}</div>
      </div>`;
  }).join("");

  const legend = segKeys.map(k => {
    const cat = cats[k] || { label: k };
    const style = getCategoryStyle(cat);
    return `<div class="k"><span class="sw" style="${style}"></span>${cat.label || k}</div>`;
  }).join("");

  const title = card.drawerTitle || "";
  return head + (title ? `<h4>${title}</h4>` : "") + bars + `<div class="legend">${legend}</div>` + src;
}

// Drawer: Stacked columns (vertical)
function buildStackedColumnDrawer(card, head, src) {
  const rowKey = getLabelKey(card);
  const segKeys = getSegmentKeys(card).filter(k => k !== "brutto");
  const cats = getCategories(card);
  const totals = card.rows.map(r => segKeys.reduce((s, k) => s + (+r[k] || 0), 0));
  const maxTotal = Math.max(...totals);
  const niceMax = Math.ceil(maxTotal / 10000) * 10000;

  const fmt = n => n.toLocaleString("de-DE") + " €";
  const cols = card.rows.map((r, i) => {
    const total = totals[i];
    const netto = +r.netto || 0;
    const hPct = Math.round(1000 * total / niceMax) / 10;
    const nettoPct = total > 0 ? Math.round(1000 * netto / total) / 10 : 0;

    const segs = segKeys.map(k => {
      const v = +r[k] || 0;
      const cat = cats[k] || {};
      const style = getCategoryStyle(cat);
      return `<div style="${style}; flex:${v}"></div>`;
    }).join("");

    return `
      <div class="sc-dcol">
        <div class="sc-dframe">
          <div class="sc-dstack" style="height:${hPct}%">${segs}
            <div class="sc-dtotmark">
              <span class="num">${fmt(total)}</span><span class="lbl">Brutto</span>
            </div>
            <div class="sc-dnetmark" style="bottom:${nettoPct}%">
              <span class="num">${fmt(netto)}</span><span class="lbl">Netto</span>
            </div>
          </div>
        </div>
        <div class="sc-dlbl">${r[rowKey]}</div>
      </div>`;
  }).join("");

  const axis = card.axis ? `<div class="axis-lbl">${card.axis}</div>` : "";
  const title = card.drawerTitle || "Brutto vs. Netto · Jahresgehalt";
  return head + `<h4>${title}</h4>${axis}<div class="sc-dwrap">${cols}</div>${src}`;
}

// Drawer type mapping
const DRAWER_BUILDERS = {
  "horizontal-bars": buildHorizontalBarsDrawer,
  "stacked-bars": buildStackedBarsDrawer,
  "stacked-column": buildStackedColumnDrawer,
};

window.buildDrawerContent = function (card) {
  let notesHtml = "";
  if (Array.isArray(card.notes) && card.notes.length) {
    notesHtml = `<div class="notes"><h5>Anmerkungen:</h5>${
      card.notes.map(n => `<p>${n}</p>`).join("")
    }</div>`;
  } else if (typeof card.notes === "string" && card.notes) {
    notesHtml = `<div class="notes"><h5>Anmerkungen:</h5><p>${card.notes}</p></div>`;
  }
  const src = notesHtml + `<div class="source">${card.source || "Quelle folgt."}</div>`;
  const head = `
    <div class="kicker">${card.kicker}</div>
    ${card.val ? `<div class="big">${card.val}</div>` : ""}
    ${card.unit ? `<div class="unit">${card.unit}</div>` : ""}
    <div class="dek">${card.dek || ""}</div>
  `;

  const chartType = card.chartType || card.render;
  const builder = DRAWER_BUILDERS[chartType];
  if (builder) return builder(card, head, src);

  return head + src;
};
