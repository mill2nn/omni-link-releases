/*
 * Omni Link — panel logic.
 *
 * One bin TREE per PROJECT, stored in localStorage under "aip_tree::<projectKey>".
 * Each node is { name, folder, color, pinned, children:[] } and everything on
 * screen derives from it:
 *   - Pinned tiles  = nodes with pinned === true
 *   - Bin structure = the whole tree (editable; drop a folder on a row to link it)
 *   - Import (↑)    = scaffold every bin, push colours, then import only new
 *                     files into the linked ones. There is no separate
 *                     "create bins" step — importing always had to make them.
 *
 * Reusable "presets" (structure + colors, no links) live in "aip_presets" and
 * are built/applied from the Preset builder (gear ▸ Customize presets…).
 *
 * A node's bin PATH = the chain of names from root to node, tab-joined
 * ("Footage\tKling"). That feeds jsx/host.jsx.
 */

var cs = new CSInterface();

// Bump this AND ExtensionBundleVersion in CSXS/manifest.xml together — the
// shareable-zip script fails the build if the two ever disagree, because
// "which version are you on?" has to have one answer.
var VERSION = "1.3.5";

/*
 * What Import picks up. A format missing from here is skipped in silence — the
 * file simply never appears in the bin and nothing says why — so the list is
 * worth being generous with.
 *
 * Everything here is a format Premiere reads natively. Camera formats that need
 * a manufacturer plug-in are deliberately absent, .braw above all: aip_import
 * hands the whole batch to importFiles in one call, so a single file Premiere
 * cannot open fails the entire bin's import rather than just itself.
 */
var EXTENSIONS =
    "mp4,mov,m4v,avi,mxf,mkv,wmv,mts,m2ts,mpg,mpeg,3gp," +   // video
    "r3d,ari,dpx,exr,dng," +                                 // camera / frame sequences
    "png,jpg,jpeg,tif,tiff,psd,gif,bmp,webp,heic,heif,ai," + // images
    "wav,mp3,aac,aif,aiff,m4a,flac";                         // audio

var PRESETS_KEY = "aip_presets";
var COLLAPSE_KEY = "aip2_collapsed";
// Once per machine, not once per project — a teammate should meet the
// explainer on their first project and never again.
var SEEN_KEY = "aip_seen";
function treeKey(k) { return "aip_tree::" + k; }
function initKey(k) { return "aip_init::" + k; }

// What a fresh install starts from. Deliberately flat and minimal — the old
// default baked one editor's nesting (Kling / B-roll / VO / Music) into everyone's
// first run. Three root bins, nothing to delete before you start.
var DEFAULT_TEMPLATE = [
    { name: "Footage", children: [] },
    { name: "Images", children: [] },
    { name: "Audio", children: [] }
];

var treeData = null;            // current project's working tree
var presets = [];               // saved presets [{name, tree}]
var currentProjectKey = null;
var currentProjectName = "";
var pinDrag = null;             // custom drag state while dragging a bin to Pinned
var builderTree = null;         // tree being edited in the Preset builder
var builderPresetName = "";     // name of the preset loaded in the builder ("" = new)
var chooserOpen = false;

// ---------- inline SVG icons ----------
var ICON_FOLDER =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
var ICON_PLUS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
var ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
var ICON_DOTS =
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';
var ICON_XSMALL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>';
var ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5"/></svg>';
var ICON_LINK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>';
var ICON_STACK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/></svg>';
var ICON_CHEV =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
var ICON_FOLDER_FILLED =
    '<svg viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
var ICON_GRIP =
    '<svg viewBox="0 0 10 16" fill="currentColor">' +
    '<circle cx="3" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/>' +
    '<circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/>' +
    '<circle cx="3" cy="12" r="1.1"/><circle cx="7" cy="12" r="1.1"/></svg>';

// All 16 Premiere label colours. `idx` is the 0-based Premiere label index and is
// the ONLY part the project sees — `hex` just tints the panel.
//
// Listed in Premiere's own Preferences ▸ Labels order so the palette on screen
// reads like the list you already know. The eight that were here before keep
// their exact indices, so bins already coloured don't shift.
//
// ⚠️ Adobe has reordered this list between versions. If a colour comes out wrong
// in Premiere, fix `idx` here — check Edit ▸ Preferences ▸ Labels, counting from 0.
var PALETTE = [
    { hex: "#a884d8", name: "Violet", idx: 0 },
    { hex: "#8b7cd9", name: "Iris", idx: 1 },
    { hex: "#4fbeb6", name: "Caribbean", idx: 2 },
    { hex: "#b9b0e0", name: "Lavender", idx: 3 },
    { hex: "#5a9bd8", name: "Cerulean", idx: 4 },
    { hex: "#5aa65e", name: "Forest", idx: 5 },
    { hex: "#e1706b", name: "Rose", idx: 6 },
    { hex: "#e0a05e", name: "Mango", idx: 7 },
    { hex: "#8f63c4", name: "Purple", idx: 8 },
    { hex: "#4470c4", name: "Blue", idx: 9 },
    { hex: "#3f9e97", name: "Teal", idx: 10 },
    { hex: "#c566a6", name: "Magenta", idx: 11 },
    { hex: "#c9a884", name: "Tan", idx: 12 },
    { hex: "#4f9e5c", name: "Green", idx: 13 },
    { hex: "#8a6a4f", name: "Brown", idx: 14 },
    { hex: "#d6c24e", name: "Yellow", idx: 15 }
];
var LABEL_INDEX = {};
function rebuildLabelIndex() {
    LABEL_INDEX = {};
    for (var i = 0; i < PALETTE.length; i++) LABEL_INDEX[PALETTE[i].hex] = PALETTE[i].idx;
}
rebuildLabelIndex();

/*
 * Read the REAL label colours out of Premiere's own preferences.
 *
 * Hand-picked hexes never matched what Bom saw in Premiere, and they never could:
 * the labels are editable, so the only correct source is his own prefs file.
 * Reading them also picks up renamed labels, so the tooltips match his Premiere.
 *
 * Format (found by inspection, undocumented):
 *   <BE.Prefs.LabelNames.6>Rose</BE.Prefs.LabelNames.6>
 *   <BE.Prefs.LabelColors.6>3474060</BE.Prefs.LabelColors.6>
 * The integer is 24-bit 0x00BBGGRR — blue in the high byte, not red — and each
 * byte is LINEAR light, so it has to be gamma-encoded or every swatch comes out
 * far too dark (Rose reads #8c0235 raw, #c4167e once encoded).
 *
 * Any failure leaves the built-in table in place. This is cosmetic: `idx` is what
 * the project actually sees, and those indices are already correct.
 */
function labelsFromPrefsText(text) {
    var names = {}, colors = {}, m;
    var reN = /<BE\.Prefs\.LabelNames\.(\d+)>([^<]*)<\//g;
    while ((m = reN.exec(text)) !== null) names[parseInt(m[1], 10)] = m[2];
    var reC = /<BE\.Prefs\.LabelColors\.(\d+)>(\d+)<\//g;
    while ((m = reC.exec(text)) !== null) colors[parseInt(m[1], 10)] = parseInt(m[2], 10);

    function enc(b) {                       // linear byte → sRGB byte
        var v = b / 255;
        v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        v = Math.round(Math.max(0, Math.min(1, v)) * 255);
        return (v < 16 ? "0" : "") + v.toString(16);
    }
    var out = [];
    for (var i = 0; i < 16; i++) {
        if (!(i in colors) || !(i in names)) continue;
        var n = colors[i];
        var b = (n >> 16) & 255, g = (n >> 8) & 255, r = n & 255;
        out.push({ hex: "#" + enc(r) + enc(g) + enc(b), name: String(names[i]).replace(/[<>]/g, ""), idx: i });
    }
    return out.length === 16 ? out : null;
}

// Newest version folder wins; Windows keeps the same layout under the user profile.
function premierePrefsPath() {
    var fs = nodeFs(), pathMod = nodeReq("path"), os = nodeReq("os");
    if (!fs || !pathMod || !os) return null;
    var base = pathMod.join(os.homedir(), "Documents", "Adobe", "Premiere Pro");
    var vers;
    try { vers = fs.readdirSync(base); } catch (e) { return null; }
    // "26.0" beats "25.3"; anything non-numeric (Auto-Save, Audio Previews) is skipped
    vers = vers.filter(function (v) { return /^\d+(\.\d+)*$/.test(v); })
        .sort(function (a, b) {
            var A = a.split("."), B = b.split(".");
            for (var i = 0; i < Math.max(A.length, B.length); i++) {
                var x = parseInt(A[i], 10) || 0, y = parseInt(B[i], 10) || 0;
                if (x !== y) return y - x;
            }
            return 0;
        });
    for (var v = 0; v < vers.length; v++) {
        var vdir = pathMod.join(base, vers[v]);
        var profiles;
        try { profiles = fs.readdirSync(vdir); } catch (e2) { continue; }
        for (var p = 0; p < profiles.length; p++) {
            if (profiles[p].indexOf("Profile-") !== 0) continue;
            var f = pathMod.join(vdir, profiles[p], "Adobe Premiere Pro Prefs");
            try { if (fs.existsSync(f)) return f; } catch (e3) {}
        }
    }
    return null;
}

function loadPremiereLabels() {
    var fs = nodeFs();
    if (!fs) return false;
    var f = premierePrefsPath();
    if (!f) return false;
    var text;
    try { text = fs.readFileSync(f, "utf8"); } catch (e) { return false; }
    var got = labelsFromPrefsText(text);
    if (!got) return false;
    PALETTE = got;
    rebuildLabelIndex();
    return true;
}

/*
 * How this Premiere is set to open a bin on double-click.
 *
 * 0 = in place, 1 = new tab, 2 = new window (BE.Prefs.Flexbin.*).
 *
 * This matters because a bin opened as its OWN TAB is not a project view:
 * app.getProjectViewIDs() reports one view while a "Bin: X" tab is in front.
 * Scripting cannot see that tab, select into it, or bring the real Project
 * panel forward. So with the default setting, jumping to a bin can appear to
 * do nothing — and four rounds went into chasing that before we knew why.
 *
 * Read from the same prefs file the 16 label colours come from. Returns -1 when
 * it cannot be read, which means "say nothing" rather than "assume the worst".
 */
var binOpenPref = -1;
function loadBinOpenPref() {
    var fs = nodeFs();
    if (!fs) return;
    var f = premierePrefsPath();
    if (!f) return;
    var text;
    try { text = fs.readFileSync(f, "utf8"); } catch (e) { return; }
    var m = /<BE\.Prefs\.Flexbin\.DoubleClickBehavior>(\d+)</.exec(text);
    if (m) binOpenPref = parseInt(m[1], 10);
}
/* Appended to a jump's status when bins open as tabs. Not a popup and not a
 * blocker: the jump may well be landing correctly in the main Project panel,
 * and the only thing wrong is which panel is in front. */
function binTabNote() {
    if (binOpenPref <= 0) return "";
    return " (Bins open in a " + (binOpenPref === 2 ? "new window" : "new tab") +
        " — a bin tab can’t be jumped to. Alt-double-click a bin, or set" +
        " Settings ▸ General ▸ Bins ▸ Double-click to Open in Place.)";
}

// Tint helpers: pinned tiles and row rails are drawn from the bin's own colour.
function hexToRgba(hex, a) {
    hex = String(hex).replace("#", "");
    if (hex.length < 6) return "rgba(139,124,246," + a + ")";
    return "rgba(" + parseInt(hex.substr(0, 2), 16) + "," + parseInt(hex.substr(2, 2), 16) +
        "," + parseInt(hex.substr(4, 2), 16) + "," + a + ")";
}
function readableInk(hex) {
    hex = String(hex).replace("#", "");
    if (hex.length < 6) return "#ffffff";
    var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    var L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return L > 0.62 ? "#2a2010" : "#ffffff";
}

// ---------- small helpers ----------
function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Quote a string for embedding in an ExtendScript call. Newlines MUST be escaped:
// a raw one inside a string literal is a syntax error, which is what silently
// broke "Create bins" for any tree with more than one bin path.
function q(s) {
    return '"' + String(s)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
        // U+2028/U+2029 are line terminators in ExtendScript's ES3-era parser, so a
        // folder or bin name containing one would break out of this string literal and
        // run as code. (Modern V8 legalised them in ES2019, which is why a Node-based
        // test can't catch this — it has to be escaped on the way out.)
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029") + '"';
}
// Paths must survive both platforms: macOS gives "/Volumes/Work/Kling",
// Windows gives "C:\Work\Kling". Splitting on "/" alone made folderLeaf return
// the entire Windows path, so a dropped folder became a bin named "C:\Work\Kling".
function folderLeaf(path) {
    var parts = String(path).replace(/[\/\\]+$/, "").split(/[\/\\]/);
    return parts[parts.length - 1] || path;
}
function baseName(p) { return String(p).replace(/[\/\\]+$/, "").split(/[\/\\]/).pop(); }
function joinPath(folder, name) {
    var f = String(folder).replace(/[\/\\]+$/, "");
    var sep = (f.indexOf("\\") >= 0 && f.indexOf("/") < 0) ? "\\" : "/";
    return f + sep + name;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function colorIdxOf(node) { return (node.color && LABEL_INDEX[node.color] != null) ? LABEL_INDEX[node.color] : ""; }

// ---------- tree helpers ----------
function normalize(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (typeof n.name !== "string") n.name = "New bin";
        if (typeof n.folder !== "string") n.folder = "";
        if (typeof n.color !== "string") n.color = "";
        if (typeof n.pinned !== "boolean") n.pinned = false;
        if (n.pinIdx != null && typeof n.pinIdx !== "number") delete n.pinIdx;
        if (!n.children) n.children = [];
        normalize(n.children);
    }
    return nodes;
}
// Depth-first over an arbitrary tree; cb(node, nameArray).
function walkTree(nodes, cb) {
    (function rec(list, prefix) {
        for (var i = 0; i < list.length; i++) {
            var np = prefix.concat([list[i].name]);
            cb(list[i], np);
            if (list[i].children && list[i].children.length) rec(list[i].children, np);
        }
    })(nodes, []);
}
function forEachNode(cb) { walkTree(treeData, cb); }
function binPathOf(target) {
    var res = null;
    forEachNode(function (n, np) { if (n === target) res = np; });
    return res;
}
// Find a node's parent array + index inside `root` (by object identity).
function findParentIn(root, target) {
    var res = null;
    (function rec(arr) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === target) { res = { arr: arr, idx: i }; return true; }
            if (arr[i].children && rec(arr[i].children)) return true;
        }
        return false;
    })(root);
    return res;
}

// ---------- storage: presets + per-project tree ----------
function loadPresets() {
    try { var p = JSON.parse(localStorage.getItem(PRESETS_KEY)); if (p && p.length) return p; } catch (e) {}
    return [];
}
function savePresets() { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); }

function loadProjectTree(key) {
    if (localStorage.getItem(initKey(key)) !== "1") return null;   // never initialised
    try { return normalize(JSON.parse(localStorage.getItem(treeKey(key))) || []); }
    catch (e) { return normalize([]); }
}
function saveTree() {
    localStorage.setItem(treeKey(currentProjectKey), JSON.stringify(treeData));
    localStorage.setItem(initKey(currentProjectKey), "1");
}

// ---------- collapsible bin-structure section ----------
function isCollapsed() { return localStorage.getItem(COLLAPSE_KEY) === "1"; }
function applyCollapsed() {
    var c = isCollapsed();
    var h = document.getElementById("treeHeader"); if (h) h.classList.toggle("collapsed", c);
    var l = document.getElementById("treeList"); if (l) l.style.display = c ? "none" : "";
    // The search belongs to this section now, so it folds away with it — a
    // filter box floating above a collapsed list has nothing to filter.
    var sr = document.querySelector(".searchRow"); if (sr) sr.style.display = c ? "none" : "flex";
    var ab = document.getElementById("addBinBtn"); if (ab) ab.style.display = c ? "none" : "";
    // collapsing frees the lower half, so the shelf gets roomier tiles
    document.body.classList.toggle("treeCollapsed", c);
    if (treeData) renderPinned();
}
function toggleCollapsed() { localStorage.setItem(COLLAPSE_KEY, isCollapsed() ? "0" : "1"); applyCollapsed(); }

// ---------- pinned grid: columns work themselves out ----------
// Driven by how many bins are pinned, then clamped by how much room there is.
// Below MIN_TILE the ⋮ button and the bin name stop being usable, so the grid
// drops a column rather than shrinking past it.
// 78px is about where a tile stops holding its icon, a readable name and the ⋮.
// A 300px dock gives ~87px tiles at 3 columns, so the clamp only bites when the
// panel is genuinely too narrow for the count.
var MIN_TILE = 78;
var GRID_GAP = 8;

// Pure on purpose: `collapsed` is passed in rather than read from storage, so
// the sizing rule can be reasoned about and tested on its own.
function pinColsFor(count, gridWidth, collapsed) {
    if (count <= 1) return 1;
    // never strand a single tile alone on the last row: 4 reads better as 2x2
    var want = (count === 2) ? 2 : (count === 4 ? 2 : 3);
    // with the tree collapsed there is room to spare, so go one column wider
    if (collapsed && want > 1) want--;
    if (gridWidth > 0) {
        while (want > 1 && (gridWidth - GRID_GAP * (want - 1)) / want < MIN_TILE) want--;
    }
    return want;
}

// Tiles are flex items; the basis is what decides how many fit per row. Setting
// it to an exact share makes them wrap at `cols`, and flex-grow lets a short
// final row spread across the full width rather than leaving a gap.
function setTileBasis(grid, cols) {
    var want = "calc((100% - " + (GRID_GAP * (cols - 1)) + "px) / " + cols + ")";
    if (grid.style.getPropertyValue("--basis") !== want) grid.style.setProperty("--basis", want);
}

// Re-fit the columns without rebuilding any tiles. Safe to call repeatedly:
// changing the column count doesn't change the GRID's width, only each tile's,
// so an observer watching the grid can't drive itself in a loop.
function refitPinnedColumns() {
    var grid = document.getElementById("pinnedGrid");
    if (!grid || !treeData) return;
    var n = 0;
    forEachNode(function (x) { if (x.pinned) n++; });
    setTileBasis(grid, pinColsFor(n, grid.clientWidth || 0, isCollapsed()));
}

// Premiere resizes the panel's host window, and whether that surfaces as a
// window "resize" event in CEP varies by version. Observing the element itself
// is version-independent, with the window event kept as a fallback.
function watchPanelWidth() {
    var grid = document.getElementById("pinnedGrid");
    if (grid && typeof ResizeObserver === "function") {
        try { new ResizeObserver(refitPinnedColumns).observe(grid); return; } catch (e) {}
    }
    var t = null;
    window.addEventListener("resize", function () {
        if (t) clearTimeout(t);
        t = setTimeout(refitPinnedColumns, 120);
    });
}
function expandTree() { localStorage.setItem(COLLAPSE_KEY, "0"); applyCollapsed(); }

// ====================================================================
//  RENDER (main view)
// ====================================================================
function renderAll() {
    renderPinned();
    renderTree();
    applyCollapsed();
    syncContentsView();
    var total = 0;
    forEachNode(function () { total++; });
    syncSearchCount(flatRows.length, total);
}

/* ============================ BIN CONTENTS ============================
 *
 * Premiere exposes no way to open a bin, expand one, or scroll the Project
 * panel to it — select() only highlights it, which still left the bin to be
 * found by hand. So the contents are brought here instead.
 *
 * contentsPath is the bin being shown, as an array of names, or null when the
 * bin structure is showing instead. Everything else derives from it.
 */
var contentsPath = null;
var contentsRoot = null;            // the path the view was opened at — where back returns to
var contentsRows = [];              // the listing as Premiere gave it — never reordered
var contentsShown = [];             // what is on screen, after sorting
var TILECLICK_KEY = "aip_tileclick";

/* What a plain click on a pinned tile does. Kept switchable because it changes
 * a habit: anyone who preferred the old behaviour can have it back from the
 * gear menu without reinstalling anything. */
function tileClickMode() {
    return localStorage.getItem(TILECLICK_KEY) === "reveal" ? "reveal" : "contents";
}
function setTileClickMode(mode) {
    localStorage.setItem(TILECLICK_KEY, mode === "reveal" ? "reveal" : "contents");
    if (mode === "reveal") closeContents();
    syncTileModeLabel();
    renderAll();
}
/* The gear item names what the click WILL do after pressing it, not what it
 * does now — a menu item that describes the current state reads as a status
 * line and gets clicked by accident. */
function syncTileModeLabel() {
    var el = document.getElementById("giTileModeLabel");
    if (el) el.textContent = tileClickMode() === "contents"
        ? "Pinned click: highlight instead"
        : "Pinned click: show contents";
}

function syncContentsView() {
    var cv = document.getElementById("contentsView");
    var sw = document.getElementById("structWrap");
    if (!cv || !sw) return;
    var on = !!contentsPath;
    cv.style.display = on ? "flex" : "none";
    sw.style.display = on ? "none" : "flex";
}

function closeContents() {
    contentsPath = null;
    contentsRoot = null;
    contentsRows = [];
    contentsShown = [];
    syncContentsView();
}

/* Records are kind ⁠| index ⁠| name ⁠| meta ⁠| offline, one per line — see
 * aip_binContents. A short record is skipped rather than half-read. */
function parseContents(body) {
    var out = [];
    if (body === "") return out;
    var lines = body.split("\n");
    for (var i = 0; i < lines.length; i++) {
        if (lines[i] === "") continue;
        var f = lines[i].split(FIELD_SEP);
        if (f.length < 5) continue;
        out.push({ kind: f[0], idx: f[1], name: f[2], meta: f[3], off: f[4] === "1" });
    }
    return out;
}

var C_ICONS = {
    bin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 10h18M3 15h18"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
    img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 4 4 2-2 3 3"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z"/></svg>'
};
var C_AUDIO = ["WAV", "MP3", "AIF", "AIFF", "M4A", "AAC", "FLAC"];
var C_IMAGE = ["PNG", "JPG", "JPEG", "TIF", "TIFF", "PSD", "AI", "EXR", "GIF", "WEBP", "SVG"];

/* Extension → type. Anything with no extension is a sequence, title or colour
 * matte: real items, but not a file kind, so they group as "other" rather than
 * being guessed at as video. */
var C_VIDEO = ["MP4", "MOV", "MXF", "AVI", "MKV", "M4V", "WMV", "R3D", "BRAW", "ARI", "MTS", "M2TS", "WEBM", "PRORES"];
function contentsType(rec) {
    if (rec.kind === "B") return "Bin";
    if (rec.meta === "") return "Other";
    if (C_AUDIO.indexOf(rec.meta) >= 0) return "Audio";
    if (C_IMAGE.indexOf(rec.meta) >= 0) return "Image";
    if (C_VIDEO.indexOf(rec.meta) >= 0) return "Video";
    return "Other";
}
function contentsIcon(rec) {
    if (rec.off) return C_ICONS.warn;
    var t = contentsType(rec);
    if (t === "Bin") return C_ICONS.bin;
    if (t === "Audio") return C_ICONS.audio;
    if (t === "Image") return C_ICONS.img;
    return C_ICONS.film;
}

/* --- sorting ---
 *
 * Sorting only changes what is DRAWN. Every row keeps rec.idx, the item's real
 * position in Premiere's bin, so clicking a row after re-sorting still acts on
 * the right clip. Sub-bins stay at the top in every mode: they are containers,
 * not contents, and mixing them into a filename sort buries them.
 */
/* Direction, shared by both sort controls.
 *
 * Every mode reverses, not just the alphabetical one: "biggest bins last",
 * "offline last", "the end of the project first" are all reasonable things to
 * want, and a reverse that only worked on one mode would be a trap. */
function sortDir(key) { return localStorage.getItem(key) === "desc" ? "desc" : "asc"; }
function flipDir(key) { localStorage.setItem(key, sortDir(key) === "desc" ? "asc" : "desc"); }
var SORT_DIR_KEY = "aip_contentsSortDir";
var TREE_DIR_KEY = "aip_treeSortDir";

var SORT_KEY = "aip_contentsSort";
var SORT_MODES = ["order", "name", "type", "offline"];
var SORT_LABELS = { order: "Project order", name: "Name A–Z", type: "File type", offline: "Offline first" };

function closeSortPop() {
    var all = document.querySelectorAll(".cSortWrap");
    for (var i = 0; i < all.length; i++) {
        all[i].classList.remove("open");
        var pop = all[i].querySelector(".cSortPop");
        if (pop) pop.style.display = "none";
    }
}
/* Both sort controls behave identically; only where they read and write
 * differs. Wiring them from one place keeps them that way. */
function wireSortControl(wrap, onPick) {
    if (!wrap || wrap.__wired) return;
    wrap.__wired = true;
    var btn = wrap.querySelector(".cSort");
    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        // The bin-structure one lives inside the collapse header; without this
        // opening the menu would also fold the tree away underneath it.
        e.preventDefault();
        var open = wrap.classList.contains("open");
        closeSortPop();
        if (!open) { wrap.classList.add("open"); wrap.querySelector(".cSortPop").style.display = "flex"; }
    });
    var opts = wrap.querySelectorAll(".cSortOpt");
    for (var i = 0; i < opts.length; i++) {
        opts[i].addEventListener("click", function (e) {
            e.stopPropagation();
            e.preventDefault();
            closeSortPop();
            onPick(this.getAttribute("data-sort"));
        });
    }
    document.addEventListener("click", closeSortPop);
}
/* One implementation for both reverse buttons: the arrow rotation IS the
 * state, so there is no second icon to keep in step with what is stored. */
function wireRev(btn, key, after) {
    if (!btn || btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        flipDir(key);
        syncRev(btn, key);
        after();
    });
    syncRev(btn, key);
}
function syncRev(btn, key) {
    if (!btn) return;
    var desc = sortDir(key) === "desc";
    btn.classList.toggle("desc", desc);
    btn.setAttribute("data-tip", desc
        ? "Currently reversed. Click for normal order.<i>Applies to whichever order is chosen, not just A–Z.</i>"
        : "Reverse the order.<i>Applies to whichever order is chosen, not just A–Z.</i>");
}

function syncTreeSortControl() {
    var wrap = document.querySelector(".tSortWrap");
    if (!wrap) return;
    var mode = treeSort();
    var now = wrap.querySelector(".tSortNow");
    if (now) now.textContent = TREE_SORT_LABELS[mode] || TREE_SORT_LABELS.manual;
    var opts = wrap.querySelectorAll(".tSortOpt");
    for (var i = 0; i < opts.length; i++) {
        opts[i].classList.toggle("on", opts[i].getAttribute("data-sort") === mode);
    }
    syncRev(document.querySelector(".tRev"), TREE_DIR_KEY);
}
/* Keep the button label and the tick in step with the stored value. Called on
 * every paint so a mode restored from a previous session shows correctly. */
function syncSortControl() {
    var cv = document.getElementById("contentsView");
    if (!cv) return;
    var mode = contentsSort();
    var now = cv.querySelector(".cSortNow");
    if (now) now.textContent = SORT_LABELS[mode] || SORT_LABELS.order;
    var opts = cv.querySelectorAll(".cSortOpt");
    for (var i = 0; i < opts.length; i++) {
        opts[i].classList.toggle("on", opts[i].getAttribute("data-sort") === mode);
    }
}
function contentsSort() {
    var v = localStorage.getItem(SORT_KEY);
    return SORT_MODES.indexOf(v) >= 0 ? v : "order";
}
function sortContents(rows, mode) {
    // Decorate with the original position so every comparison can fall back to
    // project order — a sort with no tiebreak reshuffles equal rows on redraw.
    var dec = [];
    for (var i = 0; i < rows.length; i++) dec.push({ r: rows[i], at: i });
    var byName = function (a, b) {
        var x = a.r.name.toLowerCase(), y = b.r.name.toLowerCase();
        return x < y ? -1 : (x > y ? 1 : a.at - b.at);
    };
    var flip = (sortDir(SORT_DIR_KEY) === "desc") ? -1 : 1;
    dec.sort(function (a, b) {
        var ab = a.r.kind === "B", bb = b.r.kind === "B";
        // Bins first is structural, not part of the ordering, so reversing the
        // sort must not bury the folders at the bottom.
        if (ab !== bb) return ab ? -1 : 1;
        return flip * cmp(a, b);
    });
    function cmp(a, b) {
        if (mode === "name") return byName(a, b);
        if (mode === "type") {
            var at = contentsType(a.r), bt = contentsType(b.r);
            if (at !== bt) return at < bt ? -1 : 1;
            return byName(a, b);
        }
        if (mode === "offline") {
            if (a.r.off !== b.r.off) return a.r.off ? -1 : 1;
            return a.at - b.at;
        }
        return a.at - b.at;                               // project order
    }
    var out = [];
    for (var j = 0; j < dec.length; j++) out.push(dec[j].r);
    return out;
}

/* The node in treeData matching a bin path, if the panel knows about it. Used
 * for the colour dot and the folder button — a bin can exist in Premiere and
 * not be in the panel's structure, which is fine, it just has less to show. */
function nodeAtBinPath(path) {
    var res = null;
    forEachNode(function (n, np) {
        if (np.length !== path.length) return;
        for (var i = 0; i < np.length; i++) if (np[i] !== path[i]) return;
        res = n;
    });
    return res;
}

/* reveal: also select the bin and its first file in Premiere, so the Project
 * panel ends up inside the same bin the list is showing. Off for a refresh
 * after a stale click — that is the panel catching up, not a place to go. */
function openContents(path, root, reveal) {
    if (reveal) revealBinPath(path, path[path.length - 1] || "");
    contentsPath = path.slice();
    contentsRoot = root ? root.slice() : path.slice();
    contentsRows = [];
    contentsShown = [];
    syncContentsView();
    var cv = document.getElementById("contentsView");
    if (!cv) return;

    var node = nodeAtBinPath(contentsPath);
    var name = contentsPath[contentsPath.length - 1] || "";
    cv.querySelector(".cName").textContent = name;
    cv.querySelector(".cPath").textContent = contentsPath.join(" › ") + " · loading…";
    var dot = cv.querySelector(".cDot");
    dot.style.display = (node && node.color) ? "block" : "none";
    if (node && node.color) dot.style.background = node.color;
    var fol = cv.querySelector(".cFolder");
    fol.style.display = (node && node.folder) ? "flex" : "none";
    fol.__folder = node ? node.folder : "";
    cv.querySelector(".cList").innerHTML = "";
    cv.querySelector(".cFoot").textContent = "";

    var asked = contentsPath.join("\t");
    cs.evalScript("aip_binContents(" + q(asked) + ")", function (res) {
        // A second click while this was in flight wins; drop the stale answer
        // rather than painting one bin's contents under another bin's name.
        if (!contentsPath || contentsPath.join("\t") !== asked) return;
        renderContents(String(res == null ? "" : res));
    });
}

function renderContents(res) {
    var cv = document.getElementById("contentsView");
    if (!cv) return;
    var list = cv.querySelector(".cList");
    var foot = cv.querySelector(".cFoot");
    var crumb = contentsPath.join(" › ");

    if (res === "NOBIN") {
        cv.querySelector(".cPath").textContent = crumb;
        list.innerHTML = '<div class="cEmpty">This bin isn’t in the project yet.<br>' +
            '<span style="font-size:10px">Import or Create structure will add it.</span></div>';
        return;
    }
    if (res.indexOf("ERR:") === 0) {
        cv.querySelector(".cPath").textContent = crumb;
        list.innerHTML = '<div class="cEmpty">Couldn’t read this bin.</div>';
        setStatus(res.substring(4), "error");
        return;
    }

    var trunc = res.indexOf("TRUNC:") === 0;
    var body = res.substring(res.indexOf(":") + 1);
    contentsRows = parseContents(body);

    var bins = 0, offline = 0;
    for (var i = 0; i < contentsRows.length; i++) {
        if (contentsRows[i].kind === "B") bins++;
        if (contentsRows[i].off) offline++;
    }
    var count = contentsRows.length === 0 ? "empty"
        : contentsRows.length + (contentsRows.length === 1 ? " item" : " items");
    cv.querySelector(".cPath").textContent = crumb + " · " + count + (offline ? " · " + offline + " offline" : "");

    contentsTrunc = trunc;
    contentsHasBins = bins > 0;
    paintContents();
}

/* Drawing is separate from fetching so changing the sort is instant and does
 * not ask Premiere for the same bin again. */
var contentsTrunc = false, contentsHasBins = false;

function paintContents() {
    var cv = document.getElementById("contentsView");
    if (!cv || !contentsPath) return;
    var list = cv.querySelector(".cList"), foot = cv.querySelector(".cFoot");
    var bar = cv.querySelector(".cBar");

    if (contentsRows.length === 0) {
        list.innerHTML = '<div class="cEmpty">This bin is empty.<br>' +
            '<span style="font-size:10px">Drop files on its tile to fill it.</span></div>';
        foot.textContent = "";
        if (bar) bar.style.display = "none";       // nothing to order
        return;
    }
    if (bar) bar.style.display = "flex";
    syncSortControl();
    syncRev(cv.querySelector(".cRev"), SORT_DIR_KEY);

    // Sort a copy. Overwriting contentsRows would make each sort build on the
    // last one, so "project order" would stop meaning project order after the
    // first time anything else was chosen.
    contentsShown = sortContents(contentsRows, contentsSort());

    var html = "";
    for (var j = 0; j < contentsShown.length; j++) {
        var r = contentsShown[j];
        var cls = "cRow t" + contentsType(r) +
            (r.kind === "B" ? " isBin" : "") + (r.off ? " off" : "");
        var meta = r.off ? "offline" : r.meta;
        html += '<div class="' + cls + '" data-row="' + j + '">' +
            '<span class="cIco">' + contentsIcon(r) + '</span>' +
            '<span class="cItem">' + esc(r.name) + '</span>' +
            (r.kind === "B" ? ""
                : '<span class="cIns" data-tip="Drop this clip into the open sequence at the playhead, on ' +
                  (contentsType(r) === "Audio" ? "A1" : "V1") +
                  '.<i>Clips already there ripple right — nothing is overwritten.</i>">' + C_ICONS.plus + '</span>' +
                  '<span class="cPlay" data-tip="Preview it in the Source Monitor, without touching the timeline.">' +
                  C_ICONS.play + '</span>') +
            '<span class="cMeta">' + esc(meta) + '</span></div>';
    }
    list.innerHTML = html;
    foot.textContent = contentsTrunc
        ? "Showing the first " + contentsShown.length + " — this bin has more."
        : (contentsHasBins ? "click a clip to select it · double-click opens the Source Monitor"
                           : "double-click a clip to open it in the Source Monitor");
}

function contentsRowAt(el) {
    var row = el && el.closest ? el.closest(".cRow") : null;
    if (!row) return null;
    var i = parseInt(row.getAttribute("data-row"), 10);
    if (isNaN(i) || !contentsShown[i]) return null;
    return { rec: contentsShown[i], el: row };
}

function contentsClick(hit) {
    var r = hit.rec;
    if (r.kind === "B") { openContents(contentsPath.concat([r.name]), contentsRoot, true); return; }
    var list = hit.el.parentNode;
    var was = list.querySelectorAll(".cRow.sel");
    for (var i = 0; i < was.length; i++) was[i].classList.remove("sel");
    hit.el.classList.add("sel");
    cs.evalScript("aip_selectChild(" + q(contentsPath.join("\t")) + "," + r.idx + "," + q(r.name) + ")",
        function (res) {
            res = String(res == null ? "" : res);
            if (res === "OK") setStatus("Selected “" + r.name + "” in the project.", "ok");
            else if (res === "STALE") { setStatus("This bin changed in Premiere — refreshed.", ""); openContents(contentsPath, contentsRoot); }
            else if (res === "NOSUPPORT") setStatus("This Premiere build can’t select a clip.", "error");
            else setStatus("Couldn’t select “" + r.name + "”.", "error");
        });
}

/* Send a clip to the timeline. The Project panel cannot be driven from here, so
 * the useful answer is to make going there unnecessary. */
function insertToTimeline(hit) {
    var r = hit.rec;
    if (r.kind === "B") return;
    if (r.off) { setStatus("“" + r.name + "” is offline — relink it in Premiere first.", "error"); return; }
    var isAudio = contentsType(r) === "Audio" ? "1" : "0";
    cs.evalScript("aip_insertToTimeline(" + q(contentsPath.join("\t")) + "," + r.idx + "," +
                  q(r.name) + "," + q(isAudio) + ")", function (res) {
        res = String(res == null ? "" : res);
        if (res.indexOf("OK:") === 0) {
            setStatus("Inserted “" + r.name + "” at the playhead on " + res.substring(3) + ".", "ok");
        } else if (res === "NOSEQ") {
            setStatus("No sequence open — open one and put the playhead where you want it.", "error");
        } else if (res === "NOTRACK") {
            setStatus("That sequence has no track of the right kind for “" + r.name + "”.", "error");
        } else if (res === "STALE") {
            setStatus("This bin changed in Premiere — refreshed.", ""); openContents(contentsPath, contentsRoot);
        } else {
            setStatus("Couldn’t insert “" + r.name + "”.", "error");
        }
    });
}

function contentsDblClick(hit) {
    var r = hit.rec;
    if (r.kind === "B") return;                  // the single click already drilled in
    if (r.off) { setStatus("“" + r.name + "” is offline — relink it in Premiere first.", "error"); return; }
    cs.evalScript("aip_openChildInSource(" + q(contentsPath.join("\t")) + "," + r.idx + "," + q(r.name) + ")",
        function (res) {
            res = String(res == null ? "" : res);
            if (res === "OK") setStatus("Opened “" + r.name + "” in the Source Monitor.", "ok");
            else if (res === "STALE") { setStatus("This bin changed in Premiere — refreshed.", ""); openContents(contentsPath, contentsRoot); }
            else if (res === "NOSUPPORT") setStatus("This Premiere build has no scriptable Source Monitor.", "error");
            else setStatus("Couldn’t open “" + r.name + "”.", "error");
        });
}

/*
 * Wiring must survive being called twice. The rest of boot uses `onclick =`,
 * which overwrites; addEventListener stacks, and a second back-handler made one
 * click walk up two levels. Guarding here rather than relying on boot running
 * exactly once, because a listener that silently doubles is invisible until it
 * does something absurd.
 */
function wireContents() {
    var cv = document.getElementById("contentsView");
    if (!cv || cv.__wired) return;
    cv.__wired = true;
    cv.querySelector(".cBack").addEventListener("click", function () {
        // Back to where you came in, not to the top of the tree. Opening the
        // "Footage › Kling AI" tile and pressing back should return to the bin
        // structure — walking up to Footage would show a bin you never asked
        // for. Only sub-bins you drilled into are worth popping one at a time.
        if (contentsPath && contentsRoot && contentsPath.length > contentsRoot.length) {
            openContents(contentsPath.slice(0, -1), contentsRoot);
        } else {
            closeContents();
        }
    });
    cv.querySelector(".cFolder").addEventListener("click", function () {
        var f = this.__folder;
        if (f) openInFinder(f);
    });
    wireRev(cv.querySelector(".cRev"), SORT_DIR_KEY, paintContents);
    wireSortControl(cv.querySelector(".cSortWrap"), function (mode) {
        localStorage.setItem(SORT_KEY, mode);
        // Redraw only. The rows are already in hand, and every one keeps the
        // item's real position in Premiere, so re-ordering what is drawn can
        // never make a click act on the wrong clip.
        paintContents();
    });
    var list = cv.querySelector(".cList");
    list.addEventListener("click", function (e) {
        var hit = contentsRowAt(e.target);
        if (!hit) return;
        // The two hover buttons act instead of the row, not as well as it.
        if (e.target.closest && e.target.closest(".cIns")) { e.stopPropagation(); insertToTimeline(hit); return; }
        if (e.target.closest && e.target.closest(".cPlay")) { e.stopPropagation(); contentsDblClick(hit); return; }
        contentsClick(hit);
    });
    list.addEventListener("dblclick", function (e) {
        var hit = contentsRowAt(e.target);
        if (hit) contentsDblClick(hit);
    });
}

function paletteHTML() {
    var h = "";
    for (var i = 0; i < PALETTE.length; i++) {
        // data-name feeds the instant hover label. The title stays too — it costs
        // nothing and is what shows if someone hovers and waits.
        h += '<button class="sw" data-color="' + PALETTE[i].hex +
            '" data-name="' + esc(PALETTE[i].name) + '" title="' + esc(PALETTE[i].name) +
            '" style="background:' + PALETTE[i].hex + '"></button>';
    }
    // 16 swatches fill two rows of eight exactly, so the clear can't share the
    // grid without leaving an orphan circle. It gets its own slim labelled strip.
    h += '<button class="sw clear" data-color="" data-name="Clear colour" title="Clear colour">' + ICON_XSMALL + '<span>Clear colour</span></button>';
    return h;
}
// No ⋮ button any more — right-clicking the tile or row opens this. The wrapper
// stays as the positioning anchor for the palette.
/*
 * Actions sit two per row, so an odd number leaves a visible hole — the pinned
 * tile's menu was one lonely "Unpin" beside an empty half. Pad the row with
 * Cancel, but only when there IS a hole: adding it unconditionally would just
 * move the gap to the next row.
 *
 * Cancel is handled in wireMenu, not by any action handler — it closes the menu
 * and touches nothing.
 */
function menuActs(list, wantCancel) {
    var half = 0, lastHalf = -1;
    for (var i = 0; i < list.length; i++) {
        if (!list[i].wide) { half++; lastHalf = i; }
    }
    if (half % 2 === 0) return list;

    var out = list.slice();
    if (wantCancel) {
        // Only the pinned tile. Its menu is a lone "Unpin", so a second button is
        // the only way to fill that row. Red because Bom asked for red — note
        // Remove is red too, so red here reads as "the button that ends this".
        out.push({ act: "cancel", label: "Cancel", icon: ICON_X, danger: true });
        return out;
    }
    // Bin rows already have the ✕ in the header, so a Cancel here is a second way
    // to do the same thing. Widen the last half-width action instead — same
    // result, no extra button, one row shorter.
    if (lastHalf >= 0) {
        out[lastHalf] = {};
        for (var k in list[lastHalf]) out[lastHalf][k] = list[lastHalf][k];
        out[lastHalf].wide = true;
    }
    return out;
}

function menuHTML(actions, title, wantCancel) {
    actions = menuActs(actions, wantCancel);
    var h = '<div class="tileMenu">' +
        '<div class="tilePalette">' +
        // A header, for two reasons: right-click menus give no clue which bin they
        // belong to once the popup covers the row, and there was no visible way to
        // dismiss one — clicking away worked but nothing said so.
        '<div class="menuHead"><span class="mhName">' + esc(title || "") + '</span>' +
        '<button class="swClose" title="Close">' + ICON_X + '</button></div>' +
        paletteHTML();
    for (var i = 0; i < actions.length; i++) {
        h += '<button class="swAct' + (actions[i].wide ? " wide" : "") + (actions[i].danger ? " danger" : "") +
            '" data-act="' + actions[i].act + '">' + actions[i].icon + ' ' + esc(actions[i].label) + '</button>';
    }
    h += '</div></div>';
    return h;
}
// The tile/row owning an open menu needs its own z-index, otherwise the palette
// is painted under everything that comes later in the DOM (the bin rows).
function menuHostOf(menu) {
    var el = menu.parentNode;
    while (el && el.classList) {
        if (el.classList.contains("pinTile") || el.classList.contains("trow")) return el;
        el = el.parentNode;
    }
    return null;
}
function closeAllMenus(except) {
    var open = document.querySelectorAll(".tileMenu.open");
    for (var i = 0; i < open.length; i++) {
        if (open[i] === except) continue;
        open[i].classList.remove("open");
        var h = menuHostOf(open[i]);
        if (h) h.classList.remove("menuHost");
    }
}
// Wire a ⋮ menu in `scope` to operate on `node`. `onColor`/`onAct` handle the clicks.
function wireMenu(scope, node, onColor, onAct, actsFn) {
    var menu = scope.querySelector(".tileMenu");
    if (!menu) return;
    menu.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });

    // Rebuild the action buttons from the CURRENT state. Needed because the
    // selection now changes without re-rendering the rows, so a menu built at
    // render time would show stale labels.
    function refreshActs() {
        if (!actsFn) return;
        var pal = menu.querySelector(".tilePalette");
        if (!pal) return;
        var old = pal.querySelectorAll(".swAct");
        for (var i = 0; i < old.length; i++) pal.removeChild(old[i]);
        var list = menuActs(actsFn(node), false), h = "";
        for (var j = 0; j < list.length; j++) {
            h += '<button class="swAct' + (list[j].wide ? " wide" : "") + (list[j].danger ? " danger" : "") +
                '" data-act="' + list[j].act + '">' + list[j].icon + " " + esc(list[j].label) + "</button>";
        }
        pal.insertAdjacentHTML("beforeend", h);
        bindActs();
    }
    // paintSelection() calls this so the buttons are never stale, not even while
    // the menu is closed — a hidden DOM that disagrees with the state is a trap.
    scope.__refreshMenu = refreshActs;
    function openMenu(open) {
        closeAllMenus(menu);
        if (open) refreshActs();
        menu.classList.toggle("open", open);
        var host = menuHostOf(menu);
        if (host) host.classList.toggle("menuHost", open);
        // so a menu closed while a swatch was hovered doesn't reopen showing a
        // colour name where the bin name belongs
        if (!open) menu.dispatchEvent(new Event("aipMenuClosed"));
    }
    var closeBtn = menu.querySelector(".swClose");
    if (closeBtn) closeBtn.addEventListener("click", function (e) { e.stopPropagation(); openMenu(false); });

    var dots = menu.querySelector(".dots");
    if (dots) dots.addEventListener("click", function (e) {
        e.stopPropagation();
        openMenu(!menu.classList.contains("open"));
    });
    // right-click anywhere on the tile/row opens the same menu — at small tile
    // sizes the ⋮ becomes too small to hit, and this doesn't depend on hitting it
    scope.addEventListener("contextmenu", function (e) {
        if (e.target && e.target.tagName === "INPUT") return;   // leave rename fields alone
        e.preventDefault(); e.stopPropagation();
        // right-clicking a bin that isn't in the selection selects it instead,
        // so the menu never acts on something you can't see highlighted
        // Right-clicking a bin that isn't in the selection selects it instead, so
        // the menu never acts on something you can't see highlighted. This used to
        // renderTree() and then hunt for the replacement element; the selection no
        // longer rebuilds the DOM, so this row IS still the row.
        if (scope.classList.contains("trow") && selection.length && !isSelected(node)) {
            selection = [node]; selAnchor = node; paintSelection();
        }
        openMenu(true);
    });
    /*
     * Name the colour you're hovering, instantly.
     *
     * Every swatch already carried title="Rose", but CEF's native tooltip takes
     * about a second to appear and you cross a 20px circle faster than that, so
     * in practice the names were invisible. The header line borrows itself for
     * the job — no extra height, and that menu has twice been asked to get
     * shorter, not taller.
     *
     * The name is NOT painted in the swatch colour. Violet on the #26262b menu
     * measures about 3:1, and this session already shipped one contrast fix for
     * exactly that mistake. A dot carries the colour; the text stays readable.
     */
    var head = menu.querySelector(".mhName");
    var headText = head ? head.textContent : "";
    function nameColour(sw) {
        if (!head) return;
        var col = sw.getAttribute("data-color") || "";
        var nm = sw.getAttribute("data-name") || "";
        head.innerHTML = (col ? '<span class="mhDot" style="background:' + esc(col) + '"></span>' : "") + esc(nm);
    }
    function restoreHead() { if (head) head.textContent = headText; }

    var sws = menu.querySelectorAll(".tilePalette .sw");
    for (var s = 0; s < sws.length; s++) {
        (function (sw) {
            sw.addEventListener("click", function (e) { e.stopPropagation(); onColor(node, sw.getAttribute("data-color") || ""); });
            sw.addEventListener("mouseenter", function () { nameColour(sw); });
            sw.addEventListener("mouseleave", restoreHead);
        })(sws[s]);
    }
    // Leaving the palette entirely must also restore it — mouseleave on a swatch
    // doesn't fire if the pointer exits fast enough to skip the event.
    var pal = menu.querySelector(".tilePalette");
    if (pal) pal.addEventListener("mouseleave", restoreHead);
    // and closing the menu mid-hover must not leave the bin name replaced
    menu.addEventListener("aipMenuClosed", restoreHead);
    function bindActs() {
        var acts = menu.querySelectorAll(".swAct");
        for (var a = 0; a < acts.length; a++) {
            (function (btn) {
                if (btn.__bound) return;
                btn.__bound = true;
                btn.addEventListener("click", function (e) {
                    e.stopPropagation();
                    var act = btn.getAttribute("data-act");
                    // Cancel never reaches an action handler — nothing to undo,
                    // nothing to mirror to Premiere. It just shuts the menu.
                    if (act === "cancel") { openMenu(false); return; }
                    onAct(act, node);
                });
            })(acts[a]);
        }
    }
    bindActs();
}

/*
 * FLIP: measure where things are, let `mutate` change the data, re-render, then
 * put every surviving element back where it was and let CSS carry it to its new
 * home. Elements are matched by node identity because the render rebuilds them.
 * The transform is cleared afterwards — a lingering one would create a stacking
 * context and trap any open menu behind later rows, which bit us before.
 */
/*
 * Hit-testing during a FLIP can't use elementFromPoint: mid-animation the
 * elements are transformed back to where they WERE, so the cursor appears to be
 * over the old layout. Every render caches each element's settled rect instead,
 * which is transform-independent — so a drag stays responsive with no lockout.
 */
function cacheRects(container) {
    Array.prototype.forEach.call(container.children, function (el) {
        if (el.__node) el.__rect = el.getBoundingClientRect();
    });
}
function elAtPoint(container, x, y) {
    var kids = container.children;
    for (var i = 0; i < kids.length; i++) {
        var el = kids[i], r = el.__rect;
        if (!el.__node || !r) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
}

var FLIP_MS = 200;
var FLIP_EASE = "cubic-bezier(.2,.8,.2,1)";

function flipRender(container, render, mutate) {
    var before = [];
    Array.prototype.forEach.call(container.children, function (el) {
        if (el.__node) before.push({ node: el.__node, rect: el.getBoundingClientRect() });
    });
    if (mutate) mutate();
    render();

    // Read every new position first, then write every style. Interleaving them —
    // in particular forcing a reflow per element — makes the browser lay out once
    // per tile instead of once per frame, which is what made this stutter.
    var moves = [];
    Array.prototype.forEach.call(container.children, function (el) {
        if (!el.__node) return;
        var prev = null;
        for (var i = 0; i < before.length; i++) if (before[i].node === el.__node) { prev = before[i].rect; break; }
        if (!prev) return;
        var now = el.getBoundingClientRect();
        var dx = prev.left - now.left, dy = prev.top - now.top;
        if (dx || dy) moves.push({ el: el, dx: dx, dy: dy });
    });
    if (!moves.length) return;

    for (var m = 0; m < moves.length; m++) {
        var el = moves[m].el;
        el.style.willChange = "transform";                       // hint the compositor
        el.style.transition = "none";
        el.style.transform = "translate(" + moves[m].dx + "px," + moves[m].dy + "px)";
    }
    void container.offsetWidth;                                  // exactly ONE reflow

    for (var k = 0; k < moves.length; k++) {
        moves[k].el.style.transition = "transform " + FLIP_MS + "ms " + FLIP_EASE;
        moves[k].el.style.transform = "";
    }
    setTimeout(function () {
        for (var j = 0; j < moves.length; j++) {
            var e2 = moves[j].el;
            e2.style.transition = ""; e2.style.transform = ""; e2.style.willChange = "";
        }
    }, FLIP_MS + 30);
}

// ---- dragging a pinned tile to reorder ----
var tileDrag = null;
var tileDragMoved = false;      // set on a real drag so the click doesn't also fire

function startTileDrag(node, tile, e) {
    tileDrag = {
        node: node, el: tile, dragging: false,
        sx: e.clientX, sy: e.clientY,
        // where inside the tile the grab happened, so the ghost doesn't jump
        ox: e.clientX - tile.getBoundingClientRect().left,
        oy: e.clientY - tile.getBoundingClientRect().top,
        ghost: null
    };
}

// iOS-style lift: the tile itself detaches and follows the cursor as a floating
// ghost while its slot stays behind as an outline and the others shuffle around.
function makeTileGhost(tile, e) {
    var r = tile.getBoundingClientRect();
    var g = tile.cloneNode(true);
    g.className = "pinTile tileGhost";
    g.style.width = r.width + "px";
    g.style.height = r.height + "px";
    g.style.left = (e.clientX - tileDrag.ox) + "px";
    g.style.top = (e.clientY - tileDrag.oy) + "px";
    document.body.appendChild(g);
    void g.offsetWidth;
    g.classList.add("lifted");        // scale + shadow animate in
    return g;
}

function tileDragMove(e) {
    if (!tileDrag) return;
    if (!tileDrag.dragging) {
        var dx = e.clientX - tileDrag.sx, dy = e.clientY - tileDrag.sy;
        if (dx * dx + dy * dy < 25) return;                    // <5px is still a click
        tileDrag.dragging = true;
        tileDragMoved = true;
        closeAllMenus(null);
        tileDrag.ghost = makeTileGhost(tileDrag.el, e);
        tileDrag.el.classList.add("tileSlot");
    }
    tileDrag.ghost.style.left = (e.clientX - tileDrag.ox) + "px";
    tileDrag.ghost.style.top = (e.clientY - tileDrag.oy) + "px";

    var grid = document.getElementById("pinnedGrid");
    var over = elAtPoint(grid, e.clientX, e.clientY);
    if (!over || !over.__node || over.__node === tileDrag.node) return;

    var pins = pinnedNodes();
    var from = pins.indexOf(tileDrag.node), to = pins.indexOf(over.__node);
    if (from < 0 || to < 0 || from === to) return;

    // Reorder the existing tiles rather than calling renderPinned(): rebuilding
    // every tile's markup on each mousemove was the other half of the stutter,
    // and keeping the same elements means FLIP has something stable to animate.
    flipRender(grid, function () {
        for (var i = 0; i < pins.length; i++) {
            var el = tileElFor(grid, pins[i]);
            if (el) grid.appendChild(el);                  // appendChild moves it
        }
        cacheRects(grid);
    }, function () {
        pins.splice(to, 0, pins.splice(from, 1)[0]);
        for (var j = 0; j < pins.length; j++) pins[j].pinIdx = j;
    });
}
function tileElFor(grid, node) {
    var kids = grid.children;
    for (var i = 0; i < kids.length; i++) if (kids[i].__node === node) return kids[i];
    return null;
}

function tileDragUp() {
    if (!tileDrag) return;
    var d = tileDrag; tileDrag = null;
    if (!d.dragging) { if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost); return; }

    // drop the ghost back into its slot rather than letting it vanish mid-air
    var slot = d.el && d.el.getBoundingClientRect ? d.el.getBoundingClientRect() : null;
    if (d.ghost) {
        var g = d.ghost;
        g.classList.remove("lifted");                 // always settle, even if the
        if (slot && slot.width) {                     // slot can't be measured
            g.style.left = slot.left + "px";
            g.style.top = slot.top + "px";
        }
        // reveal the slot only once the ghost is gone, or you briefly see both
        var slotEl = d.el;
        setTimeout(function () {
            if (g.parentNode) g.parentNode.removeChild(g);
            if (slotEl) slotEl.classList.remove("tileSlot");
        }, 140);
    } else if (d.el) {
        d.el.classList.remove("tileSlot");
    }
    saveTree();
}

// ---------- multi-select ----------
// Click selects, shift-click takes the range in visible order, Cmd/Ctrl-click
// toggles one. A menu opened from inside the selection acts on all of it.
var selection = [];
var selAnchor = null;
var suppressRowClick = false;     // set when a mousedown turned into a drag

function isSelected(node) { return selection.indexOf(node) >= 0; }

/*
 * Repaint the selection by TOGGLING A CLASS, never by re-rendering.
 *
 * This used to call renderTree(), and renderTree() starts with
 * host.innerHTML = "". So the first click of a double-click destroyed the very
 * row that was holding the dblclick listener, the second click landed on a
 * brand-new element, and the browser never fired dblclick at all — which is why
 * double-click-to-rename did nothing, every single time. Multi-select was added
 * after rename and silently killed it.
 *
 * Nothing about a selection changes the tree's shape, so there was never a
 * reason to rebuild it.
 */
/*
 * A row's menu depends on the SELECTION, which now changes without a re-render.
 * So the actions are computed here and regenerated when the menu opens, rather
 * than baked in at render time — otherwise selecting five bins and right-clicking
 * still offered "Add sub-bin" instead of "Remove 5".
 */
function rowActionsFor(node) {
    var hasFolder = !!node.folder;
    var many = (selection.length > 1 && isSelected(node)) ? selection.length : 0;
    var acts = [];
    if (!many) {
        // Full width, at the top: it is the primary action now, and keeping it out
        // of the half-width run leaves the rest of the grid's parity as it was.
        acts.push({ act: "reveal", label: "Show in project", icon: ICON_STACK, wide: true });
        // short labels: at half width "Change folder…" would only ellipsis
        acts.push({ act: "link", label: hasFolder ? "Change…" : "Link…", icon: ICON_LINK });
        if (hasFolder) acts.push({ act: "unlink", label: "Unlink", icon: ICON_XSMALL });
        acts.push({ act: node.pinned ? "unpin" : "pin", label: node.pinned ? "Unpin" : "Pin", icon: ICON_PIN });
        acts.push({ act: "addsub", label: "Add sub-bin", icon: ICON_PLUS });
        acts.push({ act: "remove", label: "Remove", icon: ICON_X, wide: true, danger: true });
    } else {
        acts.push({ act: "unlink", label: "Unlink " + many, icon: ICON_XSMALL });
        acts.push({ act: "remove", label: "Remove " + many, icon: ICON_X, danger: true });
    }
    return acts;
}

function rowElFor(node) {
    for (var i = 0; i < rowEls.length; i++) if (rowEls[i] && rowEls[i].__node === node) return rowEls[i];
    return null;
}
function paintSelection() {
    for (var i = 0; i < rowEls.length; i++) {
        var el = rowEls[i];
        if (!el || !el.__node) continue;
        var on = isSelected(el.__node);
        if (el.classList.contains("selected") !== on) el.classList.toggle("selected", on);
        if (el.__refreshMenu) el.__refreshMenu();
    }
}
function clearSelection() { if (!selection.length) return; selection = []; selAnchor = null; paintSelection(); }
function selectionFor(node) {
    // acting on a bin inside the selection acts on the whole selection
    return (selection.length > 1 && isSelected(node)) ? selection.slice() : [node];
}
function handleRowClick(node, e) {
    if (suppressRowClick) { suppressRowClick = false; return; }
    var flatIdx = function (n) {
        for (var i = 0; i < flatRows.length; i++) if (flatRows[i].node === n) return i;
        return -1;
    };
    if (e.shiftKey && selAnchor) {
        var a = flatIdx(selAnchor), b = flatIdx(node);
        if (a >= 0 && b >= 0) {
            selection = [];
            for (var i = Math.min(a, b); i <= Math.max(a, b); i++) selection.push(flatRows[i].node);
        }
    } else if (e.metaKey || e.ctrlKey) {           // Cmd on macOS, Ctrl on Windows
        var at = selection.indexOf(node);
        if (at >= 0) selection.splice(at, 1); else selection.push(node);
        selAnchor = node;
    } else {
        selection = [node];
        selAnchor = node;
    }
    paintSelection();
}

// ---- pinned tiles ----
// Tiles carry their own order (node.pinIdx), independent of the bin structure —
// Pinned is a quick-access shelf, so it's arranged by how you work, not by the
// tree. Anything pinned before this existed gets an index in tree order.
function pinnedNodes() {
    var pins = [];
    forEachNode(function (n) { if (n.pinned) pins.push(n); });
    var next = 0;
    for (var i = 0; i < pins.length; i++) if (typeof pins[i].pinIdx === "number") next = Math.max(next, pins[i].pinIdx + 1);
    for (var j = 0; j < pins.length; j++) if (typeof pins[j].pinIdx !== "number") pins[j].pinIdx = next++;
    pins.sort(function (a, b) { return a.pinIdx - b.pinIdx; });
    return pins;
}
function nextPinIdx() {
    var next = 0;
    forEachNode(function (n) { if (typeof n.pinIdx === "number") next = Math.max(next, n.pinIdx + 1); });
    return next;
}

function renderPinned() {
    var grid = document.getElementById("pinnedGrid");
    grid.innerHTML = "";
    var pins = pinnedNodes();
    var w = grid.clientWidth || (grid.getBoundingClientRect ? grid.getBoundingClientRect().width : 0);
    setTileBasis(grid, pinColsFor(pins.length, w, isCollapsed()));

    if (pins.length === 0) {
        grid.innerHTML = '<div class="pinEmpty">' + ICON_PIN + '<span>' +
            "Nothing pinned — drag a bin up here, or right-click a bin." +
            '</span></div>';
        return;
    }

    for (var i = 0; i < pins.length; i++) {
        (function (node) {
            var tile = document.createElement("div");
            tile.className = "pinTile";
            // The modifier is invisible unless it is written down somewhere.
            tile.setAttribute("data-tip",
                "<b>" + esc(node.name) + "</b>" +
                (tileClickMode() === "contents"
                    ? "Click to see what’s inside, without hunting for it in the Project panel."
                    : "Click to select it in Premiere and open it on its first clip.") +
                "<i>" + modKeyName() + "-click " +
                (node.folder ? "opens " + esc(folderLeaf(node.folder)) + " in Finder"
                             : "to link a folder to it") + "</i>");

            var sub = node.folder ? folderLeaf(node.folder) : "no folder";
            // How many files the last Import put in here — marked until the
            // next run, so a glance answers "did anything actually arrive".
            var fresh = freshRollup(node, binPathOf(node), true);
            tile.innerHTML =
                menuHTML([{ act: "unpin", label: "Unpin", icon: ICON_PIN }], node.name, true) +
                '<div class="pinTop"><span class="pinIco">' + ICON_FOLDER_FILLED + '</span>' +
                '<span class="pinName">' + esc(node.name) + '</span></div>' +
                '<div class="pinSub">' + esc(sub) + '</div>' +
                (fresh ? '<span class="newBadge" data-tip="' +
                    freshTip(node, binPathOf(node), true).replace(/"/g, "&quot;") +
                    '">+' + fresh + '</span>' : '');
            if (fresh) tile.classList.add("hasNew");

            // the whole tile carries the bin's colour — that glance is the point of pinning
            if (node.color) {
                tile.style.background = "linear-gradient(180deg," + hexToRgba(node.color, 0.13) + "," + hexToRgba(node.color, 0.05) + ")";
                tile.style.borderColor = hexToRgba(node.color, 0.28);
                tile.querySelector(".pinIco").style.color = node.color;
            }

            tile.__node = node;                 // FLIP matches old/new positions by node
            wireMenu(tile, node, setColor, handleAct);
            tile.addEventListener("click", function (e) {
                if (tileDragMoved) { tileDragMoved = false; return; }   // that was a drag
                // Plain click jumps to the bin in Premiere — the reason to pin a bin
                // is to get to it fast. The folder is still one modifier away.
                // Cmd is the Mac key and Alt the Windows one; accept either on both,
                // since guessing wrong just means nothing happens and the user has
                // no way to find out which one this build wanted.
                if (e && (e.metaKey || e.altKey)) {
                    if (node.folder) openInFinder(node.folder); else linkFolder(node);
                    return;
                }
                if (tileClickMode() === "contents") { openContents(binPathOf(node) || [node.name], null, true); return; }
                revealBin(node);
            });
            tile.addEventListener("mousedown", function (e) {
                if (e.button !== 0) return;
                if (e.target && e.target.closest && e.target.closest(".tileMenu")) return;
                e.preventDefault();
                startTileDrag(node, tile, e);
            });
            // drop files here → copy into the bin's folder, then auto-import
            tile.addEventListener("dragover", function (e) { e.preventDefault(); tile.classList.add("fileOver"); });
            tile.addEventListener("dragleave", function () { tile.classList.remove("fileOver"); });
            tile.addEventListener("drop", function (e) {
                e.preventDefault(); e.stopPropagation();
                tile.classList.remove("fileOver");
                var paths = filePathsFromDrop(e);
                if (!paths.length) { setStatus("Couldn’t read the dropped file(s).", "error"); return; }
                onFileDropToPin(node, paths);
            });
            grid.appendChild(tile);
        })(pins[i]);
    }
    cacheRects(grid);
}

// ====================================================================
//  bin structure tree — rows separated by gaps that double as insertion
//  points. Every render rebuilds three parallel arrays: the flattened
//  visible rows, their DOM elements, and the gaps (gapEls[i] precedes
//  flatRows[i], so there is always one more gap than row).
// ====================================================================
var INDENT = 16;
var flatRows = [];
var rowEls = [];
var gapEls = [];
var activeDrop = null;      // {kind:"gap", index, depth} | {kind:"row", index}
var dupNodes = [];          // bins whose name clashes with a sibling's

// Sibling names must be distinct: a bin's tab-joined path is its only address in
// Premiere, so two same-named siblings resolve to one bin and quietly merge.
function computeDupNodes() {
    dupNodes = [];
    (function rec(arr) {
        var seen = {};
        for (var i = 0; i < arr.length; i++) {
            var key = String(arr[i].name).replace(/^\s+|\s+$/g, "").toLowerCase();
            if (key) {
                if (seen[key]) {
                    if (dupNodes.indexOf(seen[key]) < 0) dupNodes.push(seen[key]);
                    dupNodes.push(arr[i]);
                } else seen[key] = arr[i];
            }
            if (arr[i].children && arr[i].children.length) rec(arr[i].children);
        }
    })(treeData);
}

// Visible rows in draw order. Each entry carries `chain` — the links from
// root down to itself, indexed by depth — which is what lets a gap resolve
// "insert at depth 1" into a concrete array and index.
/* ============ import log, "new" badges, and search ============ */

var LOG_KEY_BASE = "aip_log::";
var LOG_MAX = 60;                 // runs kept; a few hundred KB at the very worst
var LOG_FILES_MAX = 400;          // names kept per run

function logKey() { return LOG_KEY_BASE + (currentProjectKey || "__none__"); }
function loadLog() {
    try { return JSON.parse(localStorage.getItem(logKey()) || "[]"); } catch (e) { return []; }
}
/* One entry per Import press, newest first. Stamped when the run finishes, so
 * the time shown is when the files were actually in, not when the button was
 * pressed — on a big import those differ by more than a moment. */
function appendLog(entry) {
    var log = loadLog();
    log.unshift(entry);
    while (log.length > LOG_MAX) log.pop();
    try { localStorage.setItem(logKey(), JSON.stringify(log)); } catch (e) {}
}
function clearLog() { try { localStorage.removeItem(logKey()); } catch (e) {} }

/* Which bins just received files, and how many. Held in memory only: it marks
 * "since the last import", which stops meaning anything once the panel reloads.
 * Keyed by tab-joined bin path, because that is what an import job carries. */
var freshCounts = {};
var freshFiles = {};              // same keys — the names behind each count
function clearFresh() { freshCounts = {}; freshFiles = {}; }
function freshFor(np) { return np ? (freshCounts[np.join("\t")] || 0) : 0; }
/* What to show on ONE row.
 *
 * A collapsed bin hides its children, so a badge sitting on a hidden sub-bin is
 * a badge nobody sees — which is the whole point of the badge. A folded bin
 * therefore carries the total from everything beneath it; an open one shows
 * only its own, because its children are on screen carrying theirs.
 *
 * Pinned tiles always roll up: a tile has no folded state, and "Footage" should
 * account for everything that landed under it.
 */
/* The names behind a badge, gathered the same way its number is — so a folded
 * parent showing "+5" lists all five, and an open bin lists only its own. A
 * count tells you something arrived; this tells you what. */
function freshNames(node, np, alwaysRollUp) {
    var out = (freshFiles[(np || []).join("\t")] || []).slice();
    if (alwaysRollUp || node.open === false) {
        (function rec(n, prefix) {
            if (!n.children) return;
            for (var i = 0; i < n.children.length; i++) {
                var cp = prefix.concat([n.children[i].name]);
                out = out.concat(freshFiles[cp.join("\t")] || []);
                rec(n.children[i], cp);
            }
        })(node, np || []);
    }
    return out;
}
function freshTip(node, np, alwaysRollUp) {
    var names = freshNames(node, np, alwaysRollUp);
    if (!names.length) return "";
    var shown = names.slice(0, 10);
    var body = "";
    for (var i = 0; i < shown.length; i++) body += esc(shown[i]) + "<br>";
    if (names.length > shown.length) body += "<i>…and " + (names.length - shown.length) + " more</i>";
    return "<b>" + names.length + " new file" + (names.length === 1 ? "" : "s") + "</b>" + body;
}

function freshRollup(node, np, alwaysRollUp) {
    var sum = freshFor(np);
    if (!alwaysRollUp && node.open !== false) return sum;
    (function rec(n, prefix) {
        if (!n.children) return;
        for (var i = 0; i < n.children.length; i++) {
            var cp = prefix.concat([n.children[i].name]);
            sum += freshFor(cp);
            rec(n.children[i], cp);
        }
    })(node, np || []);
    return sum;
}

/* ---- search ---- */
function wireSearch() {
    var inp = document.getElementById("searchInput");
    var clr = document.getElementById("searchClear");
    if (!inp || inp.__wired) return;
    inp.__wired = true;
    var list = document.getElementById("treeList");
    /* Typing must not move the panel under you.
     *
     * Filtering makes the list shorter, the page shorter with it, and the
     * browser then clamps scrollTop — so the whole panel lurches upward while
     * you are mid-word, and the box you are typing into can leave the screen.
     *
     * Holding the list at the height it had when the search began keeps the
     * page the same length however few rows survive, so there is nothing for
     * the browser to clamp. The floor is released the moment the box is empty.
     * scrollTop is restored as well, for the cases the floor cannot cover —
     * the results growing past it, or the section being folded.
     */
    var heldHeight = 0;
    function apply() {
        var se = document.scrollingElement || document.documentElement;
        var y = se ? se.scrollTop : 0;
        var was = searchTerm;
        searchTerm = inp.value.replace(/^\s+|\s+$/g, "").toLowerCase();

        if (!was && searchTerm && list) heldHeight = list.offsetHeight;
        if (!searchTerm) heldHeight = 0;

        clr.style.display = searchTerm ? "flex" : "none";
        renderAll();

        if (list) list.style.minHeight = heldHeight ? (heldHeight + "px") : "";
        if (se) se.scrollTop = y;
    }
    inp.addEventListener("input", apply);
    inp.addEventListener("keydown", function (e) {
        // Escape clears rather than just blurring: a filter left on after you
        // have stopped looking is a panel that appears to have lost your bins.
        if (e.key === "Escape") { e.preventDefault(); inp.value = ""; apply(); inp.blur(); }
    });
    clr.addEventListener("click", function () { inp.value = ""; apply(); inp.focus(); });
}
function syncSearchCount(shownBins, totalBins) {
    var el = document.getElementById("searchCount");
    if (!el) return;
    el.textContent = searchTerm ? (shownBins + " of " + totalBins) : "";
}


var searchTerm = "";
function matchesSearch(name) {
    if (!searchTerm) return true;
    return String(name).toLowerCase().indexOf(searchTerm) >= 0;
}
/* A node survives the filter if it matches, or if anything beneath it does —
 * otherwise searching for a sub-bin would hide the parents and leave the result
 * floating at the wrong indent, which reads as the wrong bin entirely. */
function subtreeMatches(node) {
    if (matchesSearch(node.name)) return true;
    if (!node.children) return false;
    for (var i = 0; i < node.children.length; i++) {
        if (subtreeMatches(node.children[i])) return true;
    }
    return false;
}

/* ---- bin structure order ----
 *
 * Display only. Every row still carries the REAL array and the REAL index it
 * occupies in treeData, because drag-and-drop moves bins by position — hand it
 * a position from a sorted copy and it would drop things in the wrong place.
 * So the order changes, the addressing does not.
 *
 * Dragging is disabled while a sort is active: "insert between these two rows"
 * has no meaning when the rows are not in stored order.
 */
var TREE_SORT_KEY = "aip_treeSort";
var TREE_SORT_MODES = ["manual", "name", "color", "linked"];
var TREE_SORT_LABELS = {
    manual: "Manual order", name: "Name A–Z", color: "Colour", linked: "Linked first"
};
function treeSort() {
    var v = localStorage.getItem(TREE_SORT_KEY);
    return TREE_SORT_MODES.indexOf(v) >= 0 ? v : "manual";
}
function setTreeSort(mode) {
    localStorage.setItem(TREE_SORT_KEY, TREE_SORT_MODES.indexOf(mode) >= 0 ? mode : "manual");
    syncTreeSortControl();
    renderTree();
}
/* Pairs of {node, idx} in display order. idx is always the position in `arr`. */
function orderedChildren(arr, mode) {
    var dec = [], i;
    for (i = 0; i < arr.length; i++) dec.push({ node: arr[i], idx: i });
    if (dec.length < 2) return dec;
    // Manual is not exempt from reversing: "the stored order, backwards" is a
    // real thing to want, and a reverse that quietly skipped one mode would be
    // worse than not offering it. Only the no-op case short-circuits.
    if (mode === "manual" && sortDir(TREE_DIR_KEY) !== "desc") return dec;
    var byName = function (a, b) {
        var x = String(a.node.name).toLowerCase(), y = String(b.node.name).toLowerCase();
        return x < y ? -1 : (x > y ? 1 : a.idx - b.idx);
    };
    var flip = (sortDir(TREE_DIR_KEY) === "desc") ? -1 : 1;
    dec.sort(function (a, b) { return flip * tcmp(a, b); });
    function tcmp(a, b) {
        if (mode === "name") return byName(a, b);
        if (mode === "linked") {
            var al = !!a.node.folder, bl = !!b.node.folder;
            if (al !== bl) return al ? -1 : 1;
            return a.idx - b.idx;          // stored order inside each group
        }
        if (mode === "color") {
            // Grouped by colour, in palette order so the grouping matches the
            // swatch row people already know. Uncoloured bins last: they are
            // the absence of a choice, not a colour that sorts before red.
            var ai = colorRank(a.node.color), bi = colorRank(b.node.color);
            if (ai !== bi) return ai - bi;
            return byName(a, b);
        }
        return a.idx - b.idx;
    }
    return dec;
}
function colorRank(hex) {
    if (!hex) return 9999;                            // no colour sorts last
    for (var i = 0; i < PALETTE.length; i++) {
        if (String(PALETTE[i].hex).toLowerCase() === String(hex).toLowerCase()) return i;
    }
    return 9998;                                      // a colour not in the palette
}

function flattenVisible() {
    var out = [], mode = treeSort();
    /* `under` means an ancestor already matched, so everything below it is part
     * of the result: finding a bin should hand you the bin AND its contents,
     * not the bin with its sub-bins mysteriously filtered out of it. */
    (function walk(arr, depth, chain, under) {
        var ord = orderedChildren(arr, mode);
        for (var k = 0; k < ord.length; k++) {
            var node = ord[k].node, i = ord[k].idx;    // i is the position in arr, not on screen
            var hit = under || (searchTerm ? matchesSearch(node.name) : false);
            if (searchTerm && !hit && !subtreeMatches(node)) continue;
            // While filtering, a bin with a match inside is forced open — the
            // point of a search is to show you the hit, not where it is hidden.
            var forceOpen = searchTerm && node.children && node.children.length;
            var myChain = chain.concat([{ node: node, arr: arr, idx: i }]);
            out.push({ node: node, depth: depth, arr: arr, idx: i, chain: myChain });
            if (node.children && node.children.length && (forceOpen || node.open !== false)) {
                walk(node.children, depth + 1, myChain, hit);
            }
        }
    })(treeData, 0, [], false);
    return out;
}

// A gap can go one level inside the bin above it, and no shallower than the
// bin below it. Where min === max there is only one possible answer and the
// left/right nudge has nothing to do.
function gapDepthRange(gapIdx) {
    var above = gapIdx > 0 ? flatRows[gapIdx - 1] : null;
    var below = gapIdx < flatRows.length ? flatRows[gapIdx] : null;
    var max = above ? above.depth + 1 : 0;
    var min = below ? below.depth : 0;
    if (min > max) min = max;
    return { min: min, max: max };
}

// Non-mutating: `childOf` means "becomes the first child of this node", and
// the array only gets created at commit time (see materialize).
function resolveInsert(gapIdx, depth) {
    var above = gapIdx > 0 ? flatRows[gapIdx - 1] : null;
    if (!above) return { arr: treeData, idx: 0, parent: null };
    if (depth > above.depth) return { childOf: above.node, idx: 0, parent: above.node };
    var link = above.chain[depth];
    return { arr: link.arr, idx: link.idx + 1, parent: depth > 0 ? above.chain[depth - 1].node : null };
}
function materialize(res) {
    if (res.childOf && !res.arr) {
        if (!res.childOf.children) res.childOf.children = [];
        res.arr = res.childOf.children;
    }
    return res;
}

// Which gap or row the cursor is over. Rows own the hit-testing and the gaps
// are pointer-transparent, so an open gap can never steal the event from the
// row that opened it. Live rects are safe here: opening a gap only ever moves
// rows *below* the cursor, so the zone the cursor sits in can grow but never
// slide out from under it.
/* Which gap the cursor is nearest, for a folder dragged in from Finder.
 *
 * Rows hit-test themselves now (see makeRow), so this is only reached when the
 * cursor is between rows or past the last one. That removes the band arithmetic
 * this used to need — measuring how much of a row counted as "the gap beside
 * it" was guesswork, and it guessed wrong often enough that dropping a folder
 * on a bin made a new bin instead of linking it.
 */
function nearestGap(x, y) {
    if (!rowEls.length) return gapTarget(0, x);
    for (var i = 0; i < rowEls.length; i++) {
        var r = rowEls[i].getBoundingClientRect();
        if (y < r.top) return gapTarget(i, x);
        if (y <= r.bottom) return gapTarget(i + (y > (r.top + r.bottom) / 2 ? 1 : 0), x);
    }
    return gapTarget(rowEls.length, x);
}

// The level starts at whatever is most likely — the level of the bin above the
// gap — and only changes if the cursor is deliberately dragged sideways. Absolute
// cursor X used to decide it, which made the level feel random on arrival.
var NUDGE = 24;             // px of horizontal travel per level
var dragAnchor = null;      // { gapIdx, x, depth }; reset whenever the gap changes
function gapTarget(i, x) {
    var rng = gapDepthRange(i);
    if (!dragAnchor || dragAnchor.gapIdx !== i) {
        // A folder arriving from disk defaults to a SUB-bin of the bin above it —
        // that's what you almost always want when linking a folder into a
        // structure. Slide left to pull it out to its own root bin. (Reordering
        // an existing bin is unaffected; that keeps the level you hover at.)
        var above = i > 0 ? flatRows[i - 1] : null;
        var start = above ? above.depth + 1 : 0;
        if (start < rng.min) start = rng.min;
        if (start > rng.max) start = rng.max;
        dragAnchor = { gapIdx: i, x: x, depth: start };
    }
    var travel = (x - dragAnchor.x) / NUDGE;
    var steps = travel > 0 ? Math.floor(travel) : Math.ceil(travel);   // a full NUDGE per step
    var d = dragAnchor.depth + steps;
    if (d < rng.min) d = rng.min;
    if (d > rng.max) d = rng.max;
    return { kind: "gap", index: i, depth: d };
}

function clearDropVisuals() {
    for (var i = 0; i < gapEls.length; i++) if (gapEls[i]) gapEls[i].classList.remove("open", "bad");
    for (var j = 0; j < rowEls.length; j++) if (rowEls[j]) rowEls[j].classList.remove("dropOver", "noDrop");
}
function clearDropTarget() { clearDropVisuals(); activeDrop = null; dragAnchor = null; }

// mode "new" = a disk folder arriving, "move" = an existing bin being dragged.
// `bad` still draws the target, just as a refusal — showing nothing at all read
// as "reordering is broken" when in fact the drop was simply illegal.
function showDropTarget(t, mode, name, count, bad) {
    clearDropVisuals();
    activeDrop = t ? { kind: t.kind, index: t.index, depth: t.depth, bad: !!bad } : null;
    if (!t) return;
    if (t.kind === "row") {
        rowEls[t.index].classList.add(bad ? "noDrop" : "dropOver");
        return;
    }
    var g = gapEls[t.index];
    if (!g) return;
    if (bad) {
        g.querySelector(".tgLabel").textContent = "Can’t move “" + name + "” inside itself";
        g.querySelector(".tgapGhost").style.marginLeft = (t.depth * INDENT) + "px";
        g.classList.add("open", "bad");
        return;
    }
    var res = resolveInsert(t.index, t.depth);
    // A disk drag never exposes the folder's name until the drop, so "new"
    // can only report how many bins are coming, not what they'll be called.
    var text;
    if (mode === "move") {
        text = "Move “" + name + "” " + (res.parent ? "into " + res.parent.name : "to top level");
    } else {
        var where = res.parent ? "in " + res.parent.name : "at top level";
        text = count > 1 ? count + " new bins " + where : "New bin " + where;
    }
    g.querySelector(".tgLabel").textContent = text;
    g.querySelector(".tgapGhost").style.marginLeft = (t.depth * INDENT) + "px";
    g.classList.add("open");
}

function renderTree() {
    var host = document.getElementById("treeList");
    host.innerHTML = "";
    computeDupNodes();
    flatRows = flattenVisible();
    rowEls = []; gapEls = []; activeDrop = null;

    for (var i = 0; i < flatRows.length; i++) {
        gapEls[i] = host.appendChild(makeGap());
        rowEls[i] = host.appendChild(makeRow(flatRows[i]));
    }
    gapEls[flatRows.length] = host.appendChild(makeGap());
    cacheRects(host);
    syncDropZone();
}

function makeGap() {
    var g = document.createElement("div");
    g.className = "tgap";
    g.innerHTML = '<div class="tgapGhost">' + ICON_FOLDER + '<span class="tgLabel"></span></div>';
    return g;
}
// Swap the label for a real input, focused and selected. Enter or clicking away
// commits (and mirrors the rename into Premiere); Escape puts the old name back.
function beginRename(row, node, oldName) {
    var span = row.querySelector(".tname");
    if (!span || span.tagName === "INPUT") return;
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "tname editing";
    inp.value = node.name;
    span.parentNode.replaceChild(inp, span);
    inp.focus();
    inp.select();
    // Enter and Escape commit directly rather than going through blur(). Routing
    // them through blur made the outcome depend on whether the field still held
    // focus, which is a fragile thing to hang a rename on.
    var closed = false;
    function commit() {
        if (closed) return;
        closed = true;
        mirrorRenameToPremiere(node, oldName);
        renderTree();
    }
    inp.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    inp.addEventListener("input", function () { node.name = inp.value; saveTree(); });
    inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); node.name = oldName; saveTree(); commit(); }
    });
    inp.addEventListener("blur", commit);        // clicking away commits too
}

function makeRow(entry) {
    var node = entry.node, depth = entry.depth;
    return (function () {
            var kids = (node.children && node.children.length) ? node.children.length : 0;
            var open = (node.open !== false);
            var hasFolder = !!node.folder;

            var row = document.createElement("div");
            row.className = "trow" + (hasFolder ? " linked" : " unlinked") +
                (dupNodes.indexOf(node) >= 0 ? " dupName" : "") +
                (isSelected(node) ? " selected" : "");
            row.style.marginLeft = (depth * INDENT) + "px";
            // depth as an attribute, so the tree guide lines can be pure CSS
            row.setAttribute("data-depth", depth);
            // a linked bin gets a 2px rail in its own colour (grey if uncoloured)
            if (hasFolder) row.style.setProperty("--rail", node.color || "rgba(255,255,255,0.22)");
            if (dupNodes.indexOf(node) >= 0) row.setAttribute("data-tip",
                "<b>Two bins here share this name</b>Bins are found by name, so the panel cannot tell them apart — rename one of them.");

            // fold/unfold parents; leaves get a spacer so names stay aligned
            var chev = kids
                ? '<button class="tchev' + (open ? "" : " closed") + '" data-tip="Fold or unfold this bin\'s sub-bins.">' + ICON_CHEV + '</button>'
                : '<span class="tchev spacer"></span>';
            // linked bins name their folder; unlinked ones say so in words —
            // a dashed border had to compete with three other dashed meanings
            // Root bins are usually just containers, so "not linked" on them is noise.
            // Sub-bins are where a missing link actually matters.
            var chip = hasFolder
                ? '<span class="tchip" data-tip="Linked to <b>' + esc(node.folder) + '</b>Import pulls new files from here into this bin.<i>Click to open it in Finder.</i>">' + esc(folderLeaf(node.folder)) + '</span>'
                : (depth > 0 ? '<span class="tnolink">not linked</span>' : '');
            var pinDot = node.pinned ? '<span class="pinDot" data-tip="Pinned"></span>' : '';
            var freshN = freshRollup(node, binPathOf(node), false);
            var freshBadge = freshN ? '<span class="newBadge" data-tip="' +
                freshTip(node, binPathOf(node), false).replace(/"/g, "&quot;") +
                '">+' + freshN + '</span>' : '';
            var pinLabel = node.pinned ? "Unpin" : "Pin";
            var pinAct = node.pinned ? "unpin" : "pin";

            // Unlink only shows on a bin that HAS a link, so an unlinked bin's
            // menu is shorter than before despite the extra option existing.
            var acts = rowActionsFor(node);

            row.innerHTML =
                '<span class="tgrip" data-tip="Drag to reorder or re-nest.<i>Drag it up into PINNED to pin it.</i>">' + ICON_GRIP + '</span>' +
                chev +
                '<span class="ticon">' + ICON_FOLDER + '</span>' +
                '<span class="tname"></span>' +
                '<span class="tspacer"></span>' +
                freshBadge + chip + pinDot +
                '<div class="rowMenu">' + menuHTML(acts, node.name) + '</div>';
            if (freshN) row.classList.add("hasNew");

            /* The row hit-tests itself for a folder dragged in from Finder.
             *
             * This used to be arithmetic: the host measured the cursor against
             * cached rectangles and decided whether it was over a row or in the
             * gap beside it. Getting that split right by hand is guesswork, and
             * it guessed wrong often enough that linking a bin looked broken.
             * The browser already knows what is under the cursor — so the whole
             * row is "link to this bin", the dashed line between rows (which is
             * pointer-transparent, so the event reaches the host) is "insert
             * here", and there is no band to tune.
             *
             * Internal bin reordering is mouse-based, not HTML5 drag, so none of
             * this can reach it.
             */
            row.addEventListener("dragover", function (e) {
                e.preventDefault();
                e.stopPropagation();          // the host must not overrule with a gap
                var n = (e.dataTransfer && e.dataTransfer.items) ? e.dataTransfer.items.length : 1;
                showDropTarget({ kind: "row", index: rowEls.indexOf(row) }, "new", "", n);
            });
            row.addEventListener("dragleave", function (e) {
                if (e.relatedTarget && row.contains(e.relatedTarget)) return;
                clearDropTarget();
            });
            row.addEventListener("drop", function (e) {
                e.preventDefault();
                e.stopPropagation();
                clearDropTarget();
                var paths = filePathsFromDrop(e);
                if (!paths.length) {
                    setStatus("Couldn’t read that folder — right-click the bin and use Link…", "error");
                    return;
                }
                node.folder = ensureFolder(paths[0]);
                saveTree(); renderAll();
                setStatus("✓ Linked “" + folderLeaf(node.folder) + "” to " + node.name + ".", "ok");
            });

            if (kids) {
                row.querySelector(".tchev").addEventListener("click", function (e) {
                    e.stopPropagation();
                    node.open = !open;
                    saveTree(); renderTree();
                });
            }

            var ticon = row.querySelector(".ticon");
            if (node.color) ticon.style.color = node.color;

            // The whole row is the drag handle. The chevron folds, the chip opens
            // Finder and the palette has its own clicks, so those keep their jobs.
            row.addEventListener("click", function (e) {
                var t = e.target;
                if (t && t.closest && (t.closest(".tchev") || t.closest(".tchip") || t.closest(".tileMenu"))) return;
                if (t && t.tagName === "INPUT") return;
                handleRowClick(node, e);
            });
            row.addEventListener("mousedown", function (e) {
                if (e.button !== 0) return;
                var t = e.target;
                if (t && t.closest && (t.closest(".tchev") || t.closest(".tchip") || t.closest(".tileMenu"))) return;
                if (t && t.tagName === "INPUT") return;      // mid-rename
                e.preventDefault();
                startPinDrag(node, e, row);
            });

            var dot = row.querySelector(".pinDot");
            if (dot && node.color) dot.style.background = node.color;

            // Name is a label, not a live input: an input spanning the row swallowed
            // right-click and mousedown, which killed both the context menu and the
            // whole-row drag. Double-click swaps it for a real field.
            var nameAtRender = node.name;
            var nameEl = row.querySelector(".tname");
            nameEl.textContent = node.name;
            nameEl.title = "Double-click to rename";
            nameEl.addEventListener("dblclick", function (e) {
                e.stopPropagation();
                beginRename(row, node, nameAtRender);
            });

            var chipEl = row.querySelector(".tchip");
            if (chipEl) chipEl.addEventListener("click", function (e) { e.stopPropagation(); openInFinder(node.folder); });

            wireMenu(row, node, setColor, handleAct, rowActionsFor);
            row.__node = node;                  // FLIP + hit-testing match on identity
            if (rowDrag && rowDrag.node === node) row.classList.add("dragging");
            return row;
    })();
}

/*
 * Live sortable. Instead of opening a gap and showing a placeholder, the node is
 * genuinely moved in the tree as you drag and the rows FLIP into place, so what
 * you see at every moment is the result. Nothing is persisted until mouseup, and
 * Escape restores the tree exactly as it was.
 *
 * It settles rather than oscillating because after a move the dragged row sits
 * under the cursor, and a row hovering over itself is a no-op.
 */
function insertionFor(entry, after, depth) {
    if (depth > entry.depth) {
        if (!after) return null;                       // only "below X" can mean "inside X"
        if (!entry.node.children) entry.node.children = [];
        return { arr: entry.node.children, idx: 0, parent: entry.node };
    }
    var link = entry.chain[depth];
    if (!link) return null;
    return {
        arr: link.arr,
        idx: link.idx + (after ? 1 : 0),
        parent: depth > 0 ? entry.chain[depth - 1].node : null
    };
}
function applyMove(node, res) {
    var p = findParentIn(treeData, node);
    if (!p) return false;
    p.arr.splice(p.idx, 1);
    var at = res.idx;
    if (p.arr === res.arr && p.idx < res.idx) at--;
    if (at < 0) at = 0;
    if (at > res.arr.length) at = res.arr.length;
    res.arr.splice(at, 0, node);
    if (res.parent) res.parent.open = true;
    return true;
}
function liveSortMove(e) {
    if (!rowDrag) return;
    var rowEl = elAtPoint(document.getElementById("treeList"), e.clientX, e.clientY);
    if (!rowEl || !rowEl.__node) return;
    var over = rowEl.__node;
    if (over === rowDrag.node) return;                 // sitting on ourselves: settled
    if (isDescendant(rowDrag.node, over)) return;      // can't land inside our own subtree

    var entry = null;
    for (var i = 0; i < flatRows.length; i++) if (flatRows[i].node === over) { entry = flatRows[i]; break; }
    if (!entry) return;

    // the cached rect, not getBoundingClientRect — mid-FLIP the live one reports
    // where the row is animating from, which flips "above" and "below"
    var r = rowEl.__rect || rowEl.getBoundingClientRect();
    var after = e.clientY > r.top + r.height / 2;
    var travel = (e.clientX - rowDrag.sx) / NUDGE;
    var steps = travel > 0 ? Math.floor(travel) : Math.ceil(travel);
    var depth = entry.depth + steps;
    var maxD = entry.depth + (after ? 1 : 0);
    if (depth < 0) depth = 0;
    if (depth > maxD) depth = maxD;

    var res = insertionFor(entry, after, depth);
    if (!res || arrIsWithin(rowDrag.node, res.arr)) return;

    flipRender(document.getElementById("treeList"), renderTree, function () {
        applyMove(rowDrag.node, res);
    });
}

// The big zone only exists while there are no bins; once there is a row to aim
// between, the gaps are the precise target and this would just be in the way.
function syncDropZone() {
    var dz = document.getElementById("dropZone");
    if (dz) dz.style.display = treeData && treeData.length ? "none" : "";
}

// "+ Add bin" and the empty-state zone both accept a folder drop → top-level bins
// appended at the end. Neither needs the gap machinery: there is only one answer.
function wireBigDrops() {
    ["dropZone", "addBinBtn"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("fileOver"); });
        el.addEventListener("dragleave", function (e) {
            if (e.relatedTarget && el.contains(e.relatedTarget)) return;
            el.classList.remove("fileOver");
        });
        el.addEventListener("drop", function (e) {
            e.preventDefault(); e.stopPropagation();
            el.classList.remove("fileOver");
            var paths = filePathsFromDrop(e);
            if (!paths.length) { setStatus("Couldn’t read the dropped folder(s).", "error"); return; }
            dropFoldersAtGap(flatRows.length, 0, paths);      // last gap, top level
        });
    });
}

// ---- drops arriving from disk (wired once onto #treeList) ----
function wireTreeDrops() {
    var host = document.getElementById("treeList");
    host.addEventListener("dragover", function (e) {
        e.preventDefault();
        var n = (e.dataTransfer && e.dataTransfer.items) ? e.dataTransfer.items.length : 1;
        // Rows stop propagation, so reaching here means the cursor is NOT over
        // one — between rows, or past the last. Only a gap can be meant.
        showDropTarget(nearestGap(e.clientX, e.clientY), "new", "", n);
    });
    host.addEventListener("dragleave", function (e) {
        if (e.relatedTarget && host.contains(e.relatedTarget)) return;
        clearDropTarget();
    });
    host.addEventListener("drop", function (e) {
        e.preventDefault(); e.stopPropagation();
        var t = activeDrop;
        clearDropTarget();
        if (!t) return;
        var paths = filePathsFromDrop(e);
        if (t.kind === "row") {
            var node = flatRows[t.index].node;
            var raw = paths.length ? paths[0] : "";
            if (!raw) { setStatus("Couldn’t read that folder — use the ⋮ menu › Link folder.", "error"); return; }
            node.folder = ensureFolder(raw);
            saveTree(); renderAll();
            setStatus("✓ Linked “" + folderLeaf(node.folder) + "” to " + node.name + ".", "ok");
        } else {
            dropFoldersAtGap(t.index, t.depth, paths);
        }
    });
}

// ---- custom drag: bin → Pinned (folder chip follows the cursor) ----
var rowDrag = null;     // set once a tree drag is genuinely under way

function startPinDrag(node, e, rowEl) {
    pinDrag = { node: node, sx: e.clientX, sy: e.clientY, dragging: false, ghost: null, over: false, row: rowEl || null };
}
function pinDragMove(e) {
    if (!pinDrag) return;
    if (!pinDrag.dragging) {
        var dx = e.clientX - pinDrag.sx, dy = e.clientY - pinDrag.sy;
        if (dx * dx + dy * dy < 25) return;         // <5px → not a drag yet
        pinDrag.dragging = true;
        suppressRowClick = true;
        var g = document.createElement("div");
        g.className = "dragGhost";
        g.innerHTML = '<span class="dgIcon">' + ICON_FOLDER + '</span><span class="dgName">' + esc(pinDrag.node.name) + '</span>';
        if (pinDrag.node.color) g.querySelector(".dgIcon").style.color = pinDrag.node.color;
        document.body.appendChild(g);
        pinDrag.ghost = g;
        if (pinDrag.row) pinDrag.row.classList.add("dragging");
        var pg0 = document.getElementById("pinnedGrid"); if (pg0) pg0.classList.add("pinDropHint");
    }
    pinDrag.ghost.style.left = (e.clientX + 12) + "px";
    pinDrag.ghost.style.top = (e.clientY + 12) + "px";
    var pg = document.getElementById("pinnedGrid");
    var el = document.elementFromPoint(e.clientX, e.clientY);
    pinDrag.over = !!(pg && el && (el === pg || pg.contains(el)));
    if (pg) pg.classList.toggle("pinDropActive", pinDrag.over);

    // up to Pinned pins it; anywhere in the tree live-sorts it
    if (pinDrag.over) { cancelRowDrag(); return; }
    var host = document.getElementById("treeList");
    var hr = host.getBoundingClientRect();
    if (e.clientX < hr.left - 24 || e.clientX > hr.right + 24 ||
        e.clientY < hr.top - 24 || e.clientY > hr.bottom + 24) { cancelRowDrag(); return; }

    if (!rowDrag) {
        // first move inside the tree: remember how to put everything back
        closeAllMenus(null);
        // Remember where it came from by POSITION, not by cloning the tree.
        // A clone mints new node objects, so restoring it would leave the drag
        // holding a reference that is no longer in the tree — which silently
        // broke pinning a bin you'd dragged across the list on the way up.
        // "Insert between these two rows" means nothing when the rows are not
        // in stored order, so reordering is off while a sort is applied.
        if (treeSort() !== "manual") {
            setStatus("Set the bin order to Manual to rearrange bins.", "");
            cancelRowDrag();
            return;
        }
        var home = findParentIn(treeData, pinDrag.node);
        rowDrag = {
            node: pinDrag.node,
            sx: pinDrag.sx,
            homeArr: home ? home.arr : treeData,
            homeIdx: home ? home.idx : 0,
            startPath: binPathOf(pinDrag.node)
        };
        renderTree();
    }
    liveSortMove(e);
}

// Put the tree back exactly as it was — used when the drag leaves for Pinned,
// and on Escape.
function cancelRowDrag() {
    if (!rowDrag) return;
    var d = rowDrag; rowDrag = null;
    if (!d.homeArr) { renderAll(); return; }        // nothing to restore to
    var at = findParentIn(treeData, d.node);
    if (at) at.arr.splice(at.idx, 1);                       // lift it out of wherever it drifted
    var idx = Math.min(d.homeIdx, d.homeArr.length);
    d.homeArr.splice(idx, 0, d.node);                       // and put the same object back
    renderAll();
}
function pinDragUp() {
    if (!pinDrag) return;
    var d = pinDrag; pinDrag = null;
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.row) d.row.classList.remove("dragging");
    var pg = document.getElementById("pinnedGrid"); if (pg) pg.classList.remove("pinDropHint", "pinDropActive");
    clearDropTarget();
    if (!d.dragging) { rowDrag = null; return; }

    if (d.over) {
        cancelRowDrag();                       // the tree goes back; we're pinning instead
        if (!d.node.pinned) { d.node.pinned = true; d.node.pinIdx = nextPinIdx(); saveTree(); renderAll(); setStatus("✓ Pinned “" + d.node.name + "”.", "ok"); }
        else setStatus("“" + d.node.name + "” is already pinned.", "");
        return;
    }

    // the tree already shows the result — commit it
    if (!rowDrag) return;
    var startPath = rowDrag.startPath;
    rowDrag = null;
    renderTree();                              // drop the .dragging styling
    var endPath = binPathOf(d.node);
    if (!startPath || !endPath || startPath.join("\t") === endPath.join("\t")) return;   // nothing moved
    expandTree(); saveTree(); renderAll();
    // Only speak up when the bin changed PARENT, because that is the case that
    // also has to reach Premiere. A plain reorder is visible on screen and does
    // nothing to the project, so announcing it is just noise.
    var sameParent = startPath.slice(0, -1).join("\t") === endPath.slice(0, -1).join("\t");
    if (sameParent) return;
    var parentName = endPath.length > 1 ? endPath[endPath.length - 2] : "";
    var msg = "✓ Moved “" + d.node.name + "” " + (parentName ? "into " + parentName : "to top level") + ".";
    setStatus(msg, "ok");
    mirrorMoveToPremiere(d.node, startPath, msg);
}

// ---- reordering ----
function isDescendant(root, target) {
    if (!root.children) return false;
    for (var i = 0; i < root.children.length; i++) {
        if (root.children[i] === target) return true;
        if (isDescendant(root.children[i], target)) return true;
    }
    return false;
}
function arrIsWithin(node, arr) {
    if (!node.children) return false;
    if (node.children === arr) return true;
    for (var i = 0; i < node.children.length; i++) if (arrIsWithin(node.children[i], arr)) return true;
    return false;
}
// A bin can't be dropped into itself or into anything it contains.
function moveTargetOk(node, t) {
    if (!t) return false;
    if (t.kind === "row") {
        var target = flatRows[t.index].node;
        return target !== node && !isDescendant(node, target);
    }
    var res = resolveInsert(t.index, t.depth);
    if (res.childOf) return res.childOf !== node && !isDescendant(node, res.childOf);
    return !arrIsWithin(node, res.arr);
}
function doMove(node, res) {
    if (res.childOf && (res.childOf === node || isDescendant(node, res.childOf))) {
        setStatus("Can’t move “" + node.name + "” inside itself.", "error"); return;
    }
    materialize(res);
    if (arrIsWithin(node, res.arr)) {
        setStatus("Can’t move “" + node.name + "” inside itself.", "error"); return;
    }
    var p = findParentIn(treeData, node);
    if (!p) return;
    if (p.arr === res.arr && (res.idx === p.idx || res.idx === p.idx + 1)) {
        setStatus("“" + node.name + "” is already there.", ""); return;
    }
    var fromPath = binPathOf(node);          // capture before the tree changes
    p.arr.splice(p.idx, 1);
    var at = res.idx;
    if (p.arr === res.arr && p.idx < res.idx) at--;
    if (at < 0) at = 0;
    if (at > res.arr.length) at = res.arr.length;
    res.arr.splice(at, 0, node);
    if (res.parent) res.parent.open = true;
    expandTree(); saveTree(); renderAll();

    var base = "✓ Moved “" + node.name + "” " + (res.parent ? "into " + res.parent.name : "to top level") + ".";
    setStatus(base, "ok");
    mirrorMoveToPremiere(node, fromPath, base);
}

/*
 * Mirror a rename into the project. Same drift problem as a move: rename here,
 * import, and Premiere would build a second bin under the new name while the
 * original kept the clips. Fires on blur, not per keystroke.
 */
function mirrorRenameToPremiere(node, oldName) {
    var fresh = String(node.name).replace(/^\s+|\s+$/g, "");
    if (!fresh || fresh === oldName) return;
    // don't push a name that's already clashing in the panel — the row is flagged red
    computeDupNodes();
    if (dupNodes.indexOf(node) >= 0) return;

    var np = binPathOf(node);
    if (!np) return;
    var oldPath = np.slice(0, -1).concat([oldName]);
    cs.evalScript("aip_renameBin(" + q(oldPath.join("\t")) + "," + q(fresh) + ")", function (res) {
        if (res === "OK") { setStatus("✓ Renamed to “" + fresh + "” here and in Premiere.", "ok"); return; }
        if (res === "NOBIN") return;                 // not created in the project yet
        if (res === "EXISTS") {
            setStatus("⚠ Premiere already has a bin called “" + fresh + "” there — rename it by hand.", "error");
            return;
        }
        if (res && String(res).indexOf("ERR:") === 0) setStatus("⚠ Premiere: " + String(res).substring(4), "error");
    });
}

/*
 * Mirror a re-parent into the project so the panel and Premiere don't drift —
 * without this, moving a bin here and then importing would build a NEW bin at
 * the new path and strand the old one with its clips still inside.
 * Sibling reordering is skipped: Premiere exposes no API for the order of bins
 * within a parent (and the Project panel sorts by its own column anyway).
 */
function mirrorMoveToPremiere(node, fromPath, baseMsg) {
    if (!fromPath) return;
    var toPath = binPathOf(node);
    if (!toPath) return;
    var oldParent = fromPath.slice(0, -1).join("\t");
    var newParent = toPath.slice(0, -1).join("\t");
    if (oldParent === newParent) return;     // reorder only — nothing Premiere can do

    cs.evalScript("aip_moveBin(" + q(fromPath.join("\t")) + "," + q(newParent) + ")", function (res) {
        if (res === "OK") { setStatus(baseMsg + " Updated in Premiere too.", "ok"); return; }
        if (res === "NOBIN" || res === "NOPARENT") return;   // not created in the project yet
        if (res === "EXISTS") {
            setStatus(baseMsg + " ⚠ Premiere already has a “" + node.name + "” there — move it by hand.", "error");
            return;
        }
        if (res && String(res).indexOf("ERR:") === 0) setStatus(baseMsg + " ⚠ Premiere: " + String(res).substring(4), "error");
    });
}

// ---- mutations (current project tree) ----
function handleAct(act, node) {
    var group = selectionFor(node);
    if (act === "pin") { node.pinned = true; node.pinIdx = nextPinIdx(); saveTree(); renderAll(); }
    else if (act === "unpin") { node.pinned = false; saveTree(); renderAll(); }
    else if (act === "link") { linkFolder(node); }
    else if (act === "reveal") { revealBin(node); }
    else if (act === "addsub") { addChild(node); }
    else if (act === "unlink") { unlinkBins(group); }
    else if (act === "remove") { removeBins(group); }
}
function unlinkBins(group) {
    var n = 0;
    for (var i = 0; i < group.length; i++) if (group[i].folder) { group[i].folder = ""; n++; }
    if (!n) return;
    clearSelection(); saveTree(); renderAll();
    setStatus(n === 1 ? "Unlinked “" + group[0].name + "”." : "Unlinked " + n + " bins.", "");
}
function removeBins(group) {
    if (group.length === 1) { removeNodeGuarded(group[0]); return; }
    var kids = 0, links = 0;
    for (var i = 0; i < group.length; i++) { kids += countKids(group[i]); if (group[i].folder) links++; }
    var bits = [];
    if (kids) bits.push(kids + " sub-bin" + (kids === 1 ? "" : "s"));
    if (links) bits.push(links + " folder link" + (links === 1 ? "" : "s"));
    confirmModal("Remove " + group.length + " bins?",
        (bits.length ? "This also removes " + bits.join(" and ") + ". " : "") + "It can’t be undone.",
        "Remove", true, function (ok) {
            if (!ok) return;
            for (var j = 0; j < group.length; j++) {
                var p = findParentIn(treeData, group[j]);
                if (p) p.arr.splice(p.idx, 1);
            }
            clearSelection(); saveTree(); renderAll();
            setStatus("Removed " + group.length + " bins.", "");
        });
}

// Count every descendant bin under a node.
function countKids(node) {
    var n = 0;
    (function rec(list) { for (var i = 0; i < list.length; i++) { n++; if (list[i].children) rec(list[i].children); } })(node.children || []);
    return n;
}

// Removing an empty, unlinked bin is harmless; anything else asks first.
function removeNodeGuarded(node) {
    function drop() {
        var p = findParentIn(treeData, node);
        if (p) { p.arr.splice(p.idx, 1); saveTree(); renderAll(); setStatus("Removed “" + node.name + "”.", ""); }
    }
    var kids = countKids(node);
    if (kids === 0 && !node.folder) { drop(); return; }
    var bits = [];
    if (kids) bits.push(kids + " sub-bin" + (kids === 1 ? "" : "s"));
    if (node.folder) bits.push("its folder link");
    confirmModal("Remove “" + node.name + "”?", "This also removes " + bits.join(" and ") + ". It can’t be undone.",
        "Remove", true, function (ok) { if (ok) drop(); });
}
function setColor(node, color) {
    var group = selectionFor(node);
    for (var i = 0; i < group.length; i++) group[i].color = color || "";
    saveTree(); renderAll();
    if (group.length > 1) {
        if (color) for (var j = 0; j < group.length; j++) syncBinColor(group[j]);
        setStatus((color ? "Coloured " : "Cleared colour on ") + group.length + " bins.", color ? "ok" : "");
        return;
    }
    if (color) { syncBinColor(node); return; }
    // Premiere has no "no label" state, so a clear can't be pushed across —
    // say so instead of letting the panel and the project silently disagree.
    setStatus("Colour cleared here — Premiere keeps its last label until you pick a new one.", "");
}
function addChild(node) {
    if (!node.children) node.children = [];
    node.children.push({ name: "New bin", folder: "", color: "", pinned: false, children: [] });
    node.open = true;                 // unfold so the new sub-bin is visible
    expandTree(); saveTree(); renderAll();
}
function addTopBin() {
    treeData.push({ name: "New bin", folder: "", color: "", pinned: false, children: [] });
    expandTree(); saveTree(); renderAll();
}

// ---- drop disk folders into a gap → a linked bin per folder, at that spot ----
var MIRROR_MAX_DEPTH = 6;         // safety valve on pathological folder trees

// Immediate subfolders, visible ones only (skips .DS_Store & friends).
function subfoldersOf(path) {
    var fs = nodeFs();
    if (!fs) return [];
    var out = [];
    try {
        var names = fs.readdirSync(path);
        for (var i = 0; i < names.length; i++) {
            if (names[i].charAt(0) === ".") continue;
            var full = joinPath(path, names[i]);
            try { if (fs.statSync(full).isDirectory()) out.push(full); } catch (e) {}
        }
    } catch (e2) {}
    return out;
}
function countSubfoldersDeep(path, depth) {
    if ((depth || 0) >= MIRROR_MAX_DEPTH) return 0;
    var subs = subfoldersOf(path), n = subs.length;
    for (var i = 0; i < subs.length; i++) n += countSubfoldersDeep(subs[i], (depth || 0) + 1);
    return n;
}

// A bin named after the folder, linked to it. Re-dropping a folder whose name is
// already taken re-links that bin instead of making a duplicate.
// `at` is where a genuinely new bin goes; a name that already exists in this
// array is re-linked where it sits instead of being duplicated or moved.
function placeLinkedBin(arr, folder, mirror, depth, tally, at) {
    var leaf = folderLeaf(folder), node = null, existed = false;
    for (var i = 0; i < arr.length; i++) if (arr[i].name === leaf) { node = arr[i]; existed = true; break; }
    if (existed) {
        if (node.folder !== folder) { node.folder = folder; tally.relinked++; }
        if (!node.children) node.children = [];
    } else {
        node = { name: leaf, folder: folder, color: "", pinned: false, open: true, children: [] };
        if (at == null || at > arr.length) arr.push(node); else arr.splice(at, 0, node);
        tally.added++;
    }
    if (mirror && depth < MIRROR_MAX_DEPTH) {
        var subs = subfoldersOf(folder);
        for (var s = 0; s < subs.length; s++) placeLinkedBin(node.children, subs[s], true, depth + 1, tally, null);
        if (subs.length) node.open = true;
    }
    return { node: node, inserted: !existed };
}
function insertLinkedBins(res, folders, mirror) {
    materialize(res);
    var tally = { added: 0, relinked: 0 };
    var at = res.idx;
    for (var i = 0; i < folders.length; i++) {
        if (placeLinkedBin(res.arr, folders[i], mirror, 0, tally, at).inserted) at++;
    }
    if (res.parent) res.parent.open = true;
    expandTree(); saveTree(); renderAll();

    var bits = [];
    if (tally.added) bits.push("Added " + tally.added + " bin" + (tally.added === 1 ? "" : "s"));
    if (tally.relinked) bits.push(tally.relinked + " re-linked");
    if (!bits.length) { setStatus("Already linked — nothing to add.", ""); return; }
    setStatus("✓ " + bits.join(" · ") + (res.parent ? " in " + res.parent.name : " at top level") + ".", "ok");
}
function dropFoldersAtGap(gapIdx, depth, paths) {
    var folders = [], files = 0;
    for (var i = 0; i < paths.length; i++) { if (isDirPath(paths[i])) folders.push(paths[i]); else files++; }
    if (!folders.length) {
        setStatus(files
            ? "Drop folders here — files go onto a pinned tile."
            : "Couldn’t read that folder — use the ⋮ menu › Add sub-bin.", "error");
        return;
    }
    // resolve against the current render before anything mutates the tree
    var res = resolveInsert(gapIdx, depth);
    var subTotal = 0;
    for (var f = 0; f < folders.length; f++) subTotal += countSubfoldersDeep(folders[f], 0);
    if (!subTotal) { insertLinkedBins(res, folders, false); return; }
    askMirrorDialog(subTotal, folders.length, function (choice) {
        if (choice === null) { setStatus("Cancelled.", ""); return; }
        insertLinkedBins(res, folders, choice === "mirror");
    });
}
function linkFolder(node) {
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialog) { setStatus("The folder picker only works inside Premiere.", "error"); return; }
    var result = window.cep.fs.showOpenDialog(false, true, "Choose a folder to link", "");
    if (result && result.data && result.data.length > 0) {
        node.folder = result.data[0];
        saveTree(); renderAll();
        setStatus("✓ Linked “" + folderLeaf(node.folder) + "” to " + node.name + ".", "ok");
    }
}

/*
 * Re-apply every coloured bin's label, and every clip inside it, in one call.
 *
 * Run before an import (so bins exist and are right) and again after (so files
 * that just arrived carry the colour, whatever each individual import call did
 * with it). One evalScript rather than one per bin: firing twenty concurrent
 * ExtendScript calls at Premiere while it is importing is asking for exactly
 * the kind of intermittent nothing-happened this project has spent days on.
 *
 * Only bins the panel has actually been given a colour are touched. A clip in
 * an uncoloured bin keeps whatever label it has, so a label set by hand in
 * Premiere is never overwritten by a bin that has no opinion.
 */
function recolorAll(cb) {
    var lines = [];
    forEachNode(function (n, np) {
        if (!n.color) return;
        var idx = LABEL_INDEX[n.color];
        if (idx == null) return;
        lines.push(np.join("\t") + "\t" + idx);
    });
    if (!lines.length) { if (cb) cb(0); return; }
    cs.evalScript("aip_recolorAll(" + q(lines.join("\n")) + ")", function (res) {
        var n = 0;
        var m = /^OK:(\d+)\/(\d+)$/.exec(String(res == null ? "" : res));
        if (m) n = parseInt(m[1], 10);
        if (cb) cb(n);
    });
}

// Push a bin's label color (and its clips') into Premiere.
function syncBinColor(node) {
    var idx = LABEL_INDEX[node.color];
    if (idx == null) return;
    var np = binPathOf(node);
    if (!np) return;
    cs.evalScript("aip_setBinColor(" + q(np.join("\t")) + "," + idx + ")", function (res) {
        if (res === "NOAPI") setStatus("Color set in panel — this Premiere build can’t label bins.", "");
    });
}

// ====================================================================
//  IMPORT + CREATE STRUCTURE
// ====================================================================
// A blank name or two same-named siblings both produce a bin path that addresses
// the wrong thing in Premiere, so both are refused up front rather than silently
// mangling the project.
function treeProblem() {
    var blank = 0;
    forEachNode(function (n) { if (!String(n.name).replace(/^\s+|\s+$/g, "")) blank++; });
    if (blank) return "Name every bin first — " + blank + (blank === 1 ? " bin has" : " bins have") + " no name.";
    computeDupNodes();
    if (dupNodes.length) return "Two bins under the same parent are both called “" + dupNodes[0].name + "” — rename one first.";
    return "";
}

/*
 * One button does the lot: scaffold every bin in the structure, push the label
 * colours, then import only new files into the linked ones. Creating bins isn't a
 * separate step — importing already had to create the bins it targets, and doing
 * the whole tree first means bins with no folder linked still get made.
 */
function importAll() {
    var bad = treeProblem();
    if (bad) { setStatus(bad, "error"); return; }

    var paths = [];
    forEachNode(function (n, np) { paths.push(np.join("\t")); });
    if (!paths.length) { setStatus("Structure is empty — add a bin first.", "error"); return; }

    var jobs = [];
    forEachNode(function (n, np) { if (n.folder) jobs.push({ bin: np.join("\t"), folder: n.folder, ci: colorIdxOf(n) }); });

    setStatus("Creating bins…", "");
    cs.evalScript("aip_createStructure(" + q(paths.join("\n")) + ")", function (res) {
        if (!res || String(res).indexOf("OK:") !== 0) {
            var msg = (res && String(res).indexOf("ERR:") === 0)
                ? String(res).substring(4)
                : "Premiere didn’t run the script (" + (res || "no response") + ")";
            setStatus("⚠ " + msg, "error");
            return;
        }
        var made = parseInt(String(res).substring(3), 10);
        var madeBit = (!isNaN(made) && made > 0) ? (made + " bin" + (made === 1 ? "" : "s") + " created · ") : "";
        recolorAll();
        if (!jobs.length) {
            setStatus(madeBit ? ("✓ " + madeBit.replace(" · ", ".")) : "Bins are already there — link a folder to import files.", "ok");
            return;
        }
        runImports(jobs, madeBit);
    });
}

function runImports(jobs, madeBit) {
    var total = 0, errors = [], i = 0;
    var got = [];                     // { bin, files[] } for the log and the badges
    clearFresh();
    function next() {
        if (i >= jobs.length) {
            var files = total + " new file" + (total === 1 ? "" : "s");
            /* Log the run before the colour pass, so a slow recolour cannot lose
             * the record of what arrived. Only runs that brought something in:
             * a log full of "imported 0" entries buries the ones that matter. */
            if (total > 0) {
                appendLog({ at: new Date().toISOString(), total: total, bins: got });
            }
            recolorAll(function () {
                renderAll();          // paint the "new" badges
                if (!errors.length) { setStatus("✓ " + madeBit + "imported " + files + ".", "ok"); return; }
                setStatus(madeBit + (total ? "imported " + files + " · " : "") +
                    errors.length + " bin" + (errors.length === 1 ? "" : "s") + " failed — " + errors[0], "error");
            });
            return;
        }
        var j = jobs[i];
        setStatus("Importing " + (i + 1) + " of " + jobs.length + "…", "");
        cs.evalScript("aip_import(" + q(j.bin) + "," + q(j.folder) + "," + q(EXTENSIONS) + "," + q(String(j.ci)) + ")", function (res) {
            var leaf = j.bin.split("\t").pop();
            if (res && String(res).indexOf("ERR:") === 0) errors.push(leaf + ": " + String(res).substring(4));
            else {
                var txt = String(res == null ? "" : res);
                var n = parseInt(txt, 10);
                if (isNaN(n)) errors.push(leaf + ": Premiere didn’t run the import (" + (res || "no response") + ")");
                else {
                    total += n;
                    if (n > 0) {
                        // Names arrive after the field separator; an older host
                        // that only returns a count still logs the bin and total.
                        var cut = txt.indexOf(FIELD_SEP);
                        var list = cut < 0 ? [] : txt.substring(cut + 1).split("\n");
                        var keep = [];
                        for (var f2 = 0; f2 < list.length && keep.length < LOG_FILES_MAX; f2++) {
                            if (list[f2] !== "") keep.push(list[f2]);
                        }
                        got.push({ bin: j.bin, n: n, files: keep });
                        freshCounts[j.bin] = (freshCounts[j.bin] || 0) + n;
                        freshFiles[j.bin] = (freshFiles[j.bin] || []).concat(keep);
                    }
                }
            }
            i++; next();
        });
    }
    next();
}

function filePathsFromDrop(e) {
    var dt = e.dataTransfer, out = [];
    if (dt.files && dt.files.length) { for (var i = 0; i < dt.files.length; i++) if (dt.files[i].path) out.push(dt.files[i].path); }
    if (out.length) return out;
    var uris = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split("\n");
    for (var j = 0; j < uris.length; j++) {
        var u = uris[j].replace(/^\s+|\s+$/g, "");
        if (u.indexOf("file://") !== 0) continue;
        var raw = decodeURIComponent(u.substring(7));
        if (raw.indexOf("localhost/") === 0) raw = raw.substring(9);
        // Windows arrives as file:///C:/Work/Kling → strip the leading slash
        if (/^\/[A-Za-z]:/.test(raw)) raw = raw.substring(1);
        if (raw.indexOf("/.file/id=") >= 0) { var fs = nodeFs(); if (fs) { try { raw = fs.realpathSync(raw); } catch (e2) {} } }
        if (raw) out.push(raw);
    }
    return out;
}
function uniqueName(fs, folder, base) {
    var dot = base.lastIndexOf(".");
    var stem = dot > 0 ? base.substr(0, dot) : base;
    var ext = dot > 0 ? base.substr(dot) : "";
    var n = 1, candidate;
    do { candidate = stem + " (" + n + ")" + ext; n++; } while (fs.existsSync(joinPath(folder, candidate)));
    return candidate;
}
function copyOne(fs, src, dest, done) {
    try {
        var rd = fs.createReadStream(src), wr = fs.createWriteStream(dest);
        rd.on("error", function (e) { done(e); });
        wr.on("error", function (e) { done(e); });
        wr.on("close", function () { done(null); });
        rd.pipe(wr);
    } catch (e) { done(e); }
}
function onFileDropToPin(node, filePaths) {
    if (!node.folder) { setStatus("Link a folder to “" + node.name + "” first.", "error"); return; }
    var fs = nodeFs();
    if (!fs) { setStatus("Copying needs Node — unavailable.", "error"); return; }
    var files = [];
    for (var i = 0; i < filePaths.length; i++) { try { if (fs.statSync(filePaths[i]).isFile()) files.push(filePaths[i]); } catch (e) {} }
    if (!files.length) { setStatus("Drop files (not folders) onto a pinned bin.", "error"); return; }
    var dups = [], fresh = [];
    for (var k = 0; k < files.length; k++) {
        if (fs.existsSync(joinPath(node.folder, baseName(files[k])))) dups.push(files[k]); else fresh.push(files[k]);
    }
    if (dups.length) {
        showDupDialog(dups.length, function (choice) {
            // Cancel cancels the drop, not just the duplicates. This used to go
            // ahead and copy the non-duplicate files anyway: drop ten, three
            // clash, press Cancel, and seven land in the folder regardless.
            // A button labelled Cancel that still does most of the work is
            // worse than no button.
            if (!choice) { setStatus("Cancelled — nothing was copied.", ""); return; }
            performCopy(node, fresh, dups, choice);
        });
    } else { performCopy(node, fresh, [], null); }
}
function performCopy(node, fresh, dups, choice) {
    var fs = nodeFs();
    var tasks = [];
    for (var i = 0; i < fresh.length; i++) tasks.push({ src: fresh[i], dest: joinPath(node.folder, baseName(fresh[i])) });
    for (var j = 0; j < dups.length; j++) {
        var base = baseName(dups[j]);
        var dest = (choice === "replace") ? joinPath(node.folder, base) : joinPath(node.folder, uniqueName(fs, node.folder, base));
        tasks.push({ src: dups[j], dest: dest });
    }
    if (!tasks.length) { setStatus("Nothing to copy.", ""); return; }
    setStatus("Copying " + tasks.length + " file" + (tasks.length === 1 ? "" : "s") + "…", "");
    var idx = 0, copied = 0, errs = [];
    (function next() {
        if (idx >= tasks.length) {
            setStatus("Copied " + copied + " → importing…", "");
            importOneBin(node, function (res) {
                if (res && res.indexOf("ERR:") === 0) { setStatus("Copied " + copied + ", import failed: " + res.substring(4), "error"); return; }
                var n = parseInt(res, 10);
                var msg = "✓ Copied " + copied + " → imported " + (isNaN(n) ? 0 : n) + " new.";
                if (errs.length) msg += " (" + errs.length + " copy error" + (errs.length === 1 ? "" : "s") + ")";
                setStatus(msg, errs.length ? "error" : "ok");
                renderAll();
            });
            return;
        }
        var t = tasks[idx];
        copyOne(fs, t.src, t.dest, function (err) { if (err) errs.push(err); else copied++; idx++; next(); });
    })();
}
function importOneBin(node, cb) {
    var np = binPathOf(node);
    if (!np) { cb("ERR:bin not found"); return; }
    cs.evalScript("aip_import(" + q(np.join("\t")) + "," + q(node.folder) + "," + q(EXTENSIONS) + "," + q(String(colorIdxOf(node))) + ")", cb);
}

// ====================================================================
//  modals: duplicate dialog, name prompt
// ====================================================================
function showDupDialog(count, cb) {
    var ov = document.createElement("div");
    ov.className = "modalOv";
    ov.innerHTML =
        '<div class="modal">' +
            '<div class="modalTitle">' + count + ' file' + (count === 1 ? "" : "s") + ' already there</div>' +
            '<div class="modalBody">A file with the same name is already in this bin’s folder.</div>' +
            '<div class="modalBtns"><button class="mbtn keep">Keep both</button><button class="mbtn replace">Replace</button></div>' +
            '<button class="modalCancel">Cancel</button>' +
        '</div>';
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector(".keep").onclick = function () { close(); cb("keepboth"); };
    ov.querySelector(".replace").onclick = function () { close(); cb("replace"); };
    ov.querySelector(".modalCancel").onclick = function () { close(); cb(null); };
    ov.addEventListener("click", function (e) { if (e.target === ov) { close(); cb(null); } });
}
// Asked once per drop when any dropped folder has subfolders inside it.
function askMirrorDialog(subCount, folderCount, cb) {
    var subject = folderCount === 1 ? "this folder" : "these " + folderCount + " folders";
    var ov = document.createElement("div");
    ov.className = "modalOv";
    ov.innerHTML =
        '<div class="modal">' +
            '<div class="modalTitle">Include subfolders?</div>' +
            '<div class="modalBody">' + subCount + ' subfolder' + (subCount === 1 ? "" : "s") +
                ' inside. Mirroring makes a linked sub-bin for every one of them.</div>' +
            '<div class="modalBtns">' +
                '<button class="mbtn cancel just">Just ' + subject + '</button>' +
                '<button class="mbtn ok mirror">Mirror ' + subCount + '</button>' +
            '</div>' +
            '<button class="modalCancel">Cancel</button>' +
        '</div>';
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector(".just").onclick = function () { close(); cb("just"); };
    ov.querySelector(".mirror").onclick = function () { close(); cb("mirror"); };
    ov.querySelector(".modalCancel").onclick = function () { close(); cb(null); };
    ov.addEventListener("click", function (e) { if (e.target === ov) { close(); cb(null); } });
}

// Yes/no confirm using the panel's own dialog (window.confirm is jarring in CEP).
function confirmModal(title, body, okLabel, danger, cb) {
    var ov = document.createElement("div");
    ov.className = "modalOv";
    ov.innerHTML =
        '<div class="modal">' +
            '<div class="modalTitle">' + esc(title) + '</div>' +
            '<div class="modalBody">' + esc(body) + '</div>' +
            '<div class="modalBtns"><button class="mbtn cancel">Cancel</button>' +
            '<button class="mbtn ' + (danger ? "replace" : "ok") + '">' + esc(okLabel) + '</button></div>' +
        '</div>';
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector(danger ? ".replace" : ".ok").onclick = function () { close(); cb(true); };
    ov.querySelector(".cancel").onclick = function () { close(); cb(false); };
    ov.addEventListener("click", function (e) { if (e.target === ov) { close(); cb(false); } });
}

function promptModal(title, initial, cb) {
    var ov = document.createElement("div");
    ov.className = "modalOv";
    ov.innerHTML =
        '<div class="modal">' +
            '<div class="modalTitle">' + esc(title) + '</div>' +
            '<input class="modalInput" type="text" />' +
            '<div class="modalBtns"><button class="mbtn cancel">Cancel</button><button class="mbtn ok">Save</button></div>' +
        '</div>';
    document.body.appendChild(ov);
    var input = ov.querySelector(".modalInput");
    input.value = initial || "";
    setTimeout(function () { input.focus(); input.select(); }, 20);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    function ok() { var v = input.value.replace(/^\s+|\s+$/g, ""); close(); cb(v || null); }
    ov.querySelector(".ok").onclick = ok;
    ov.querySelector(".cancel").onclick = function () { close(); cb(null); };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") ok(); if (e.key === "Escape") { close(); cb(null); } });
    ov.addEventListener("click", function (e) { if (e.target === ov) { close(); cb(null); } });
}

// ====================================================================
//  NODE / FILESYSTEM helpers (CEP with Node enabled)
// ====================================================================
function nodeReq(mod) {
    try {
        if (typeof require === "function") return require(mod);
        if (window.cep_node && window.cep_node.require) return window.cep_node.require(mod);
    } catch (e) {}
    return null;
}
function nodeFs() { return nodeReq("fs"); }
function openInFinder(path) {
    var cp = nodeReq("child_process");
    if (!cp) { setStatus("Can’t open the folder — Node unavailable.", "error"); return; }
    try { if (isWindows()) cp.execFile("explorer", [path]); else cp.execFile("open", [path]); }
    catch (e) { setStatus("Couldn’t open the folder.", "error"); }
}
/* ====================== hover explanations ======================
 *
 * One tooltip element, driven by data-tip on whatever is hovered. Native
 * title= was doing this job badly: about a second of delay, a pale system box
 * that looks nothing like Premiere, and no way to give the modifier hint its
 * own line.
 *
 * data-tip, not title, so the two never both appear. Icon-only buttons keep an
 * aria-label for anyone not using a mouse.
 */
var tipEl = null, tipTimer = null, tipFor = null;
var TIP_DELAY = 380;          // long enough not to flash while crossing the panel

function tipNode() {
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = "tip";
        document.body.appendChild(tipEl);
    }
    return tipEl;
}
function hideTip() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    tipFor = null;
    if (tipEl) { tipEl.classList.remove("on"); tipEl.style.left = "-9999px"; }
}
function placeTip(el) {
    var t = tipNode(), r = el.getBoundingClientRect();
    t.style.left = "0px"; t.style.top = "0px";        // measure unclamped
    var w = t.offsetWidth, h = t.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;

    var left = r.left + r.width / 2 - w / 2;
    // The panel can be 300px wide, so a centred tooltip runs off the edge more
    // often than not. Clamp rather than let it clip.
    if (left < 6) left = 6;
    if (left + w > vw - 6) left = Math.max(6, vw - 6 - w);

    var top = r.bottom + 7;
    if (top + h > vh - 6) top = r.top - h - 7;        // no room below: go above
    if (top < 6) top = 6;

    t.style.left = Math.round(left) + "px";
    t.style.top = Math.round(top) + "px";
    t.classList.add("on");
}
function showTipFor(el) {
    var txt = el.getAttribute("data-tip");
    if (!txt) return;
    tipFor = el;
    tipNode().innerHTML = txt;                        // data-tip is ours, never user input
    placeTip(el);
}
function wireTips() {
    document.addEventListener("mouseover", function (e) {
        var el = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
        if (!el || el === tipFor) return;
        hideTip();
        tipTimer = setTimeout(function () { showTipFor(el); }, TIP_DELAY);
    });
    document.addEventListener("mouseout", function (e) {
        var el = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
        if (!el) return;
        // Moving onto a child of the same control is not leaving it.
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        hideTip();
    });
    // Anything that moves the layout under the cursor invalidates the position.
    document.addEventListener("mousedown", hideTip, true);
    document.addEventListener("scroll", hideTip, true);
    window.addEventListener("blur", hideTip);
}

/* ---- the import log view ---- */
function fmtWhen(iso) {
    var d;
    try { d = new Date(iso); } catch (e) { return String(iso); }
    if (!d || isNaN(d.getTime())) return String(iso);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var time = two(d.getHours()) + ":" + two(d.getMinutes());
    // Today's imports are the ones being checked; a date on those is noise.
    if (sameDay) return "Today " + time;
    return two(d.getDate()) + "/" + two(d.getMonth() + 1) + " " + time;
}

function renderLog() {
    var host = document.getElementById("logList");
    if (!host) return;
    var log = loadLog();
    if (!log.length) {
        host.innerHTML = '<div class="logEmpty">Nothing imported yet.<br>' +
            '<span style="font-size:10px">Runs that bring files in are recorded here.</span></div>';
        return;
    }
    var h = "";
    for (var i = 0; i < log.length; i++) {
        var run = log[i] || {};
        var bins = run.bins || [];
        h += '<div class="logRun">' +
             '<div class="logWhen">' + esc(fmtWhen(run.at)) + '</div>' +
             '<div class="logTotal">' + (run.total || 0) + " file" + ((run.total === 1) ? "" : "s") + '</div>';
        for (var b = 0; b < bins.length; b++) {
            var bin = bins[b] || {};
            var leaf = String(bin.bin || "").split("\t").pop();
            h += '<div class="logBin"><div class="logBinName">' +
                 '<span class="newBadge">+' + (bin.n || 0) + '</span>' + esc(leaf) + '</div>';
            var files = bin.files || [];
            for (var f = 0; f < files.length && f < 12; f++) {
                h += '<div class="logFile">' + esc(files[f]) + '</div>';
            }
            // A run that pulled in two hundred clips should not need two hundred
            // rows to say so; the count above already carries the number.
            if (files.length > 12) h += '<div class="logMore">…and ' + (files.length - 12) + ' more</div>';
            else if (!files.length && bin.n) h += '<div class="logMore">(names not recorded)</div>';
            h += '</div>';
        }
        h += '</div>';
    }
    host.innerHTML = h;
}

function openLog() { renderLog(); showView("log"); }

function isWindows() { return /win/i.test(navigator.platform || ""); }
function modKeyName() { return isWindows() ? "Alt" : "⌘"; }

/*
 * Jump to a bin in Premiere's Project panel.
 *
 * Every outcome gets a status line, including success. Selecting a bin is a
 * quiet thing to happen in another window — without confirmation here, a click
 * that worked and a click that silently did nothing look identical, and there
 * would be no way to tell which one you got.
 */
function revealBin(node) {
    var np = binPathOf(node);
    if (!np) { setStatus("Couldn’t work out where “" + node.name + "” sits.", "error"); return; }
    revealBinPath(np, node.name);
}
/* Same thing, addressed by path. A sub-bin reached by drilling into the
 * contents view has no node in the panel's own tree, so it can only be named
 * this way. */
function revealBinPath(np, label) {
    var node = { name: label };
    cs.evalScript("aip_revealBin(" + q(np.join("\t")) + ")", function (res) {
        res = String(res == null ? "" : res);
        var stuck = res.indexOf("|noout") >= 0;

        /* Short line, action first. The old messages ran to three clauses and
         * the status bar truncated them mid-sentence — losing exactly the part
         * that said what to do. Counts and codes go to the hover box. */
        var why = binOpenPref > 0
            ? "Bins are set to open in a " + (binOpenPref === 2 ? "new window" : "new tab") +
              ". A bin tab is not something a panel can reach — set Settings ▸ General ▸ " +
              "Bins ▸ Double-click to Open in Place, or Alt-double-click bins."
            : "";

        if (res.indexOf("OKVIEW:") === 0) {
            var parts = res.substring(7).split(":");
            var tally = String(parts.shift());              // applied/confirmed/front
            var clip = parts.join(":");
            var half = tally.split("/");
            var applied = half[0], confirmed = half[1], front = half[2];
            var diag = "Premiere reported: selection applied to " + applied +
                " view(s), confirmed in " + confirmed + ", frontmost view " +
                (front === "0" ? "holding something else" : "consistent") + "." +
                (why ? " " + why : "");

            if (front === "0") {
                setStatus("Return to the main bin, then try again.", "error", diag);
            } else if (confirmed !== applied) {
                /* The call ran and the selection did not stick. In practice that
                 * means the Project panel is inside a bin, so the instruction is
                 * the same as the front-view case — one thing to learn, not two
                 * near-identical sentences. Which of the two it was stays in the
                 * hover detail, where it is useful to me and out of his way. */
                setStatus("Return to the main bin, then try again.", "error", diag);
            } else {
                setStatus("Opened “" + node.name + "”" + (clip ? " — " + clip : ""), "ok", diag);
            }
        } else if (res.indexOf("OKIN") === 0) {
            setStatus("Opened “" + node.name + "” — " + res.substring(res.indexOf(":") + 1),
                stuck ? "" : "ok",
                stuck ? ("Could not return the Project panel to the top level first." + (why ? " " + why : "")) : why);
        } else if (res === "OK" || res === "OK|noout") {
            setStatus("“" + node.name + "” has no files to open it with.", "",
                "A bin holding only sub-bins cannot be opened by selecting something inside it." + (why ? " " + why : ""));
        } else if (res === "NOBIN") {
            setStatus("“" + node.name + "” isn’t in this project yet.", "error",
                "Import, or Create structure, will add it.");
        } else if (res === "NOSUPPORT") {
            setStatus("This Premiere can’t jump to a bin.", "error",
                "ProjectItem.select is missing on this build. " + modKeyName() + "-click opens the folder instead.");
        } else {
            setStatus("Couldn’t show “" + node.name + "”.", "error", "Premiere returned: " + (res || "nothing"));
        }
    });
}

function isDirPath(path) {
    var fs = nodeFs();
    if (fs) { try { return fs.statSync(path).isDirectory(); } catch (e) { return false; } }
    try {
        var st = window.cep.fs.stat(path);
        if (st && st.data && typeof st.data.isDirectory === "function") return st.data.isDirectory();
    } catch (e2) {}
    return false;
}
function ensureFolder(path) {
    try {
        var st = window.cep.fs.stat(path);
        if (st && st.data && typeof st.data.isDirectory === "function" && !st.data.isDirectory()) path = path.replace(/[\/\\][^\/\\]*$/, "");
    } catch (e) {}
    return path;
}

// ====================================================================
//  status + gear + views + project
// ====================================================================
/* msg is what to DO, kept short enough to read at a glance. detail is the
 * diagnostic — view counts, host return codes, the long explanation — parked in
 * the hover box where it is available without being in the way. Putting both in
 * the line itself is what made the last one truncate before it reached the
 * instruction. */
function setStatus(msg, kind, detail) {
    var el = document.getElementById("status");
    el.textContent = msg;
    el.className = "status" + (kind ? (" " + kind) : "");
    if (detail) el.setAttribute("data-tip", detail); else el.removeAttribute("data-tip");
    if (kind === "ok" || kind === "error") {     // brief flash so it's noticed
        void el.offsetWidth;                     // restart the animation
        el.classList.add("flash");
        setTimeout(function () { el.classList.remove("flash"); }, 700);
    }
}
function setBuilderStatus(msg, kind) {
    var el = document.getElementById("builderStatus");
    el.textContent = msg;
    el.className = "status" + (kind ? (" " + kind) : "");
}
function toggleGear() {
    var pop = document.getElementById("gearPop");
    pop.style.display = (pop.style.display === "none" || !pop.style.display) ? "flex" : "none";
}
function closeGear() { document.getElementById("gearPop").style.display = "none"; }
function resetStructure() {
    confirmModal("Reset this project’s structure?",
        "Back to the built-in default. Clears this project’s bins, folder links, colors and pins.",
        "Reset", true, function (ok) {
            if (!ok) return;
            treeData = normalize(clone(DEFAULT_TEMPLATE));
            saveTree(); renderAll();
            setStatus("Structure reset to default.", "ok");
        });
}
function showView(v) {
    document.getElementById("mainView").style.display = (v === "main") ? "flex" : "none";
    document.getElementById("builderView").style.display = (v === "builder") ? "flex" : "none";
    document.getElementById("logView").style.display = (v === "log") ? "flex" : "none";
}

function setProjectLabel(key) {
    currentProjectName = (key === "__noproject__") ? "No project open" : baseName(key).replace(/\.prproj$/i, "");
    var el = document.getElementById("projName");
    if (!el) return;
    // textContent for the name (it comes from a file path), a real element for
    // the version — so a project literally named "<b>" can't inject anything.
    el.textContent = currentProjectName;
    var tag = document.createElement("span");
    tag.className = "verTag";
    tag.textContent = "v" + VERSION;
    el.appendChild(tag);
}

// ---------- first-run explainer ----------
function onboardSeen() { return localStorage.getItem(SEEN_KEY) === "1"; }
function initOnboard() {
    var box = document.getElementById("onboard");
    if (!box) return;
    if (onboardSeen()) { box.parentNode.removeChild(box); return; }
    box.style.display = "";
    document.getElementById("onboardGo").onclick = function () {
        localStorage.setItem(SEEN_KEY, "1");
        box.parentNode.removeChild(box);
    };
}

// Check the active project and load its memory; run the chooser if it's new.
//
// The in-flight guard matters. currentProjectKey is only assigned inside the
// callback, so two calls arriving before the first reply BOTH saw "never set up"
// and both ran the scan — the second adopted nothing and overwrote the first's
// status with "Every one of those was already here." The panel calls this on
// launch, on window focus and on mouseenter, so overlapping calls are normal.
var projectQueryBusy = false;
function refreshProject(force) {
    if (projectQueryBusy) return;
    projectQueryBusy = true;
    cs.evalScript("aip_projectKey()", function (key) {
        projectQueryBusy = false;
        key = (key && key !== "") ? key : "__noproject__";
        if (!force && key === currentProjectKey) return;
        currentProjectKey = key;
        setProjectLabel(key);
        var t = loadProjectTree(key);
        if (t === null) {           // never set up → adopt what's there, or ask
            treeData = normalize([]);
            renderAll();
            autoAdoptOrChoose(key);
        } else {
            treeData = t;
            renderAll();
        }
    });
}

/*
 * First time the panel meets a project: look in Premiere before asking anything.
 *
 * Opening a project that is already organised used to hand you a blank template
 * and a modal, so you rebuilt by hand a structure sitting right there in the
 * Project panel. If bins exist, they come straight in.
 *
 * Runs ONLY when there is no saved tree for this project, so it can never
 * overwrite work: the moment bins are adopted, saveTree() marks the project set
 * up and this never fires for it again. Bins added in Premiere later are pulled
 * in on demand with ⚙ ▸ Read bins from project.
 */
var adoptScanKey = null;        // second belt: one scan per project, ever
function autoAdoptOrChoose(key) {
    if (adoptScanKey === key) return;
    adoptScanKey = key;
    // With no project open, anything saved lands under aip_tree::__noproject__ and
    // is stranded there forever. Don't scan, and don't offer a chooser that would
    // write into that orphan.
    if (key === "__noproject__") {
        setStatus("Open a project in Premiere to set up its bins.", "");
        return;
    }
    cs.evalScript("aip_scanProject()", function (res) {
        res = res === null || res === undefined ? "" : String(res);
        var trunc = res.indexOf("TRUNC:") === 0;
        if (!trunc && res.indexOf("OK:") !== 0) {
            // ERR, or Premiere didn't run it. Fall back to the normal question
            // rather than leaving an empty panel and no way forward.
            showBlankChooser();
            return;
        }
        var recs = parseScan(res.substring(trunc ? 6 : 3));
        if (!recs.length) { showBlankChooser(); return; }    // nothing to adopt → ask
        adoptPaths(recs, trunc ? "trunc" : "auto");
    });
}

// Chooser shown for a project with no saved memory.
function showBlankChooser() {
    if (chooserOpen) return;
    chooserOpen = true;
    var h = '<div class="modal chooser"><div class="modalTitle">Set up “' + esc(currentProjectName) + '”</div>' +
        '<div class="modalBody">Start this project’s bins from…</div><div class="chooserList">';
    for (var i = 0; i < presets.length; i++) h += '<button class="chItem" data-kind="preset" data-i="' + i + '"><span class="chIco">' + ICON_STACK + '</span>' + esc(presets[i].name) + '</button>';
    h += '<button class="chItem" data-kind="default"><span class="chIco">' + ICON_FOLDER + '</span>Built-in default</button>';
    h += '<button class="chItem" data-kind="empty"><span class="chIco">' + ICON_XSMALL + '</span>Empty</button>';
    // Dismissable: opening the panel on a project you didn't mean to set up
    // used to trap you in this modal with no way out.
    h += '</div><button class="modalCancel chCancel">Not now</button></div>';
    var ov = document.createElement("div");
    ov.className = "modalOv";
    ov.innerHTML = h;
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); chooserOpen = false; }
    function pick(tree) { treeData = normalize(tree); saveTree(); close(); renderAll(); }
    // "Not now" leaves the project uninitialised on purpose — nothing is saved,
    // so the chooser comes back next time rather than silently picking Empty.
    ov.querySelector(".chCancel").onclick = function () {
        close();
        setStatus("Set up later from ⚙ ▸ Reload for this project.", "");
    };
    var btns = ov.querySelectorAll(".chItem");
    for (var b = 0; b < btns.length; b++) {
        (function (btn) {
            btn.onclick = function () {
                var k = btn.getAttribute("data-kind");
                if (k === "preset") pick(clone(presets[parseInt(btn.getAttribute("data-i"), 10)].tree));
                else if (k === "default") pick(clone(DEFAULT_TEMPLATE));
                else pick([]);
            };
        })(btns[b]);
    }
}

// ====================================================================
//  PRESET BUILDER
// ====================================================================
function stripToPreset(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) out.push({ name: nodes[i].name, color: nodes[i].color || "", children: stripToPreset(nodes[i].children || []) });
    return out;
}
/* One preset, not many.
 *
 * The picker could only ever offer a single entry, and Save prompting for a
 * name made a two-step job out of "keep this". The stored shape stays an array
 * so nothing about the saved data changes — presets[0] is simply the only one
 * the UI knows about, and a machine already carrying several keeps them on disk
 * rather than having them thrown away by an update.
 */
var THE_PRESET = "My structure";

function openBuilder() {
    if (presets.length) { builderPresetName = presets[0].name; builderTree = normalize(clone(presets[0].tree)); }
    else { builderPresetName = ""; builderTree = normalize(clone(DEFAULT_TEMPLATE)); }
    renderBuilder();
    setBuilderStatus("", "");
    showView("builder");
}
function savePreset() {
    var tree = stripToPreset(builderTree);
    var name = builderPresetName || (presets.length ? presets[0].name : THE_PRESET);
    var found = false;
    for (var i = 0; i < presets.length; i++) if (presets[i].name === name) { presets[i].tree = tree; found = true; break; }
    if (!found) presets.unshift({ name: name, tree: tree });
    savePresets();
    builderPresetName = name;
    setBuilderStatus("✓ Saved.", "ok");
}
/* Clear resets the STRUCTURE, not the saved preset — a destructive-sounding
 * button in a builder should undo your editing, not silently drop something
 * every project depends on. Saving afterwards is what makes it stick. */
function clearPreset() {
    confirmModal("Reset the structure?", "Back to the built-in default. Nothing in your project is touched, and the saved preset only changes if you Save afterwards.", "Reset", true, function (ok) {
        if (!ok) return;
        builderTree = normalize(clone(DEFAULT_TEMPLATE));
        renderBuilder();
        setBuilderStatus("Reset to the default structure — Save to keep it.", "");
    });
}
// Apply builderTree into the current project, keeping links/pins where names match.
function applyPresetToProject() {
    var keep = {};
    forEachNode(function (n, np) { keep[np.join("\t")] = { folder: n.folder, pinned: n.pinned }; });
    function build(nodes, prefix) {
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var p = prefix.concat([n.name]);
            var k = keep[p.join("\t")];
            out.push({ name: n.name, color: n.color || "", folder: k ? k.folder : "", pinned: k ? k.pinned : false, children: build(n.children || [], p) });
        }
        return out;
    }
    treeData = build(builderTree, []);
    saveTree();
    showView("main");
    renderAll();
    setStatus("✓ Applied preset" + (builderPresetName ? " “" + builderPresetName + "”" : "") + ".", "ok");
}

// builder tree render (structure + color only)
function renderBuilder() {
    var host = document.getElementById("builderList");
    host.innerHTML = "";
    buildBuilderLevel(host, builderTree, 0);
}
function buildBuilderLevel(host, nodes, depth) {
    for (var i = 0; i < nodes.length; i++) {
        (function (node) {
            var row = document.createElement("div");
            row.className = "trow";
            row.style.marginLeft = (depth * 16) + "px";
            // every bin adds sub-bins from its own menu (no inline "+" anywhere now)
            var bActs = [
                { act: "addsub", label: "Add sub-bin", icon: ICON_PLUS },
                { act: "remove", label: "Remove", icon: ICON_X }
            ];

            row.innerHTML =
                '<span class="tchev spacer"></span>' +
                '<span class="ticon">' + ICON_FOLDER + '</span>' +
                '<input class="tname" type="text" />' +
                '<div class="rowMenu">' + menuHTML(bActs, node.name) + '</div>';
            if (node.color) row.querySelector(".ticon").style.color = node.color;
            var inp = row.querySelector(".tname");
            inp.value = node.name;
            inp.addEventListener("input", function () { node.name = inp.value; });
            /* Enter finishes the name. The field writes straight through on every
             * keystroke, so there is nothing to commit — but leaving focus in it
             * means the next Enter or keystroke goes somewhere unexpected, and
             * "done" should feel done. Escape puts the previous name back. */
            var wasNamed = node.name;
            inp.addEventListener("keydown", function (e) {
                if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
                else if (e.key === "Escape") { e.preventDefault(); node.name = wasNamed; inp.value = wasNamed; inp.blur(); }
            });
            inp.addEventListener("focus", function () { wasNamed = node.name; });
            wireMenu(row, node, builderSetColor, builderAct);
            host.appendChild(row);
            /* A bin added a moment ago opens ready to type, with "New bin"
             * selected so the first keystroke replaces it. Without this every
             * new bin needs a click into a field you are already looking at. */
            if (node === builderFocusNode) {
                builderFocusNode = null;
                setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 0);
            }

            if (node.children && node.children.length) buildBuilderLevel(host, node.children, depth + 1);
        })(nodes[i]);
    }
}
var builderFocusNode = null;      // the bin added last, to be focused once drawn
function builderSetColor(node, color) { node.color = color || ""; renderBuilder(); }
function builderAct(act, node) {
    if (act === "addsub") { builderAddChild(node); }
    else if (act === "remove") { var p = findParentIn(builderTree, node); if (p) { p.arr.splice(p.idx, 1); renderBuilder(); } }
}
function builderAddChild(node) {
    if (!node.children) node.children = [];
    var kid = { name: "New bin", color: "", children: [] };
    node.children.push(kid);
    builderFocusNode = kid;
    renderBuilder();
}
function builderAddTop() {
    var top = { name: "New bin", color: "", children: [] };
    builderTree.push(top);
    builderFocusNode = top;
    renderBuilder();
}

// ====================================================================
//  READ THE PROJECT'S EXISTING BINS
// ====================================================================
/*
 * A CEP panel cannot receive a drag out of Premiere's Project panel — that drag
 * is handled in native code and Adobe delivers nothing to the Chromium side, so
 * "drag a bin from the project into the plugin" is not buildable as a drag.
 *
 * This is the same job done the way the API allows: ask ExtendScript for the bin
 * structure that already exists, and let you tick what to adopt. Better than a
 * drag for the actual use case, which is a project already half organised.
 */

// "Footage", "Footage\tKling", … → nested nodes. Parents always precede their
// children in the input, but a tick-list can omit a parent, so any missing
// ancestor is created as a plain unlinked bin.
// Accepts either plain path strings or {path, folder} records — the folder is the
// disk folder aip_scanProject worked out from the clips inside that bin.
function treeFromPaths(recs) {
    var roots = [], index = {};
    for (var i = 0; i < recs.length; i++) {
        var rec = (typeof recs[i] === "string") ? { path: recs[i], folder: "" } : recs[i];
        var segs = rec.path.split("\t");
        var arr = roots, keyPrefix = "", node = null;
        for (var s = 0; s < segs.length; s++) {
            var name = segs[s];
            if (name === "") continue;
            keyPrefix = keyPrefix === "" ? name : keyPrefix + "\t" + name;
            node = index[keyPrefix];
            if (!node) {
                node = { name: name, folder: "", color: "", pinned: false, open: true, children: [] };
                index[keyPrefix] = node;
                arr.push(node);
            }
            arr = node.children;
        }
        // The folder belongs to the leaf only. An ancestor invented to hold a
        // child must not inherit that child's folder.
        if (node && rec.folder) node.folder = rec.folder;
    }
    return roots;
}

// One record per line: binPath \u0001 folder. The folder half is what makes this
// a real setup rather than a bare tree — see aip_scanProject.
// Escape, not a literal control character — a raw 0x01 is invisible in every
// editor and does not survive copy-paste.
var FIELD_SEP = "\u0001";
function parseScan(body) {
    var out = [];
    if (body === "") return out;
    var lines = body.split("\n");
    for (var i = 0; i < lines.length; i++) {
        if (lines[i] === "") continue;
        var cut = lines[i].indexOf(FIELD_SEP);
        // A host that predates the folder half sends the path alone. Read it
        // rather than mangling every bin name with a stray separator.
        out.push(cut < 0
            ? { path: lines[i], folder: "" }
            : { path: lines[i].substring(0, cut), folder: lines[i].substring(cut + 1) });
    }
    return out;
}

function readProjectBins() {
    setStatus("Reading the project…", "");
    cs.evalScript("aip_scanProject()", function (res) {
        res = res === null || res === undefined ? "" : String(res);
        if (res.indexOf("ERR:") === 0) { setStatus("⚠ " + res.substring(4), "error"); return; }
        var trunc = res.indexOf("TRUNC:") === 0;
        if (!trunc && res.indexOf("OK:") !== 0) {
            setStatus("⚠ Premiere didn’t run the script (" + (res || "no response") + ")", "error");
            return;
        }
        var recs = parseScan(res.substring(trunc ? 6 : 3));
        if (!recs.length) { setStatus("This project has no bins yet.", ""); return; }
        setStatus("", "");
        showAdoptDialog(recs, trunc);
    });
}

// Tick-list of what the project already has. Ticking a child ticks its parents,
// because a bin can't be adopted without the path that addresses it.
function showAdoptDialog(recs, trunc) {
    var chosen = {}, folderOf = {}, paths = [];
    for (var i = 0; i < recs.length; i++) {
        paths.push(recs[i].path);
        folderOf[recs[i].path] = recs[i].folder;
        chosen[recs[i].path] = true;
    }

    var ov = document.createElement("div");
    ov.className = "modalOv";
    var h = '<div class="modal adopt"><div class="modalTitle">Bins in this project</div>' +
        '<div class="modalBody">Tick the ones to bring into the panel.' +
        (trunc ? " Showing the first " + paths.length + "." : "") + '</div>' +
        '<div class="adoptList">';
    for (var j = 0; j < paths.length; j++) {
        var segs = paths[j].split("\t");
        var fol = folderOf[paths[j]];
        // Show what each bin will be linked to. A bin with no folder is the one
        // you'll have to finish by hand, so it says so rather than looking blank.
        h += '<label class="adoptRow" style="padding-left:' + ((segs.length - 1) * 14) + 'px">' +
            '<input type="checkbox" checked data-path="' + esc(paths[j]) + '">' +
            '<span>' + esc(segs[segs.length - 1]) + '</span>' +
            (fol ? '<span class="adoptFol" title="' + esc(fol) + '">' + esc(folderLeaf(fol)) + '</span>'
                 : '<span class="adoptFol none">no folder</span>') +
            '</label>';
    }
    h += '</div><div class="modalBtns">' +
        '<button class="mbtn ghost adoptNone">Untick all</button>' +
        '<button class="mbtn adoptGo">Add</button></div>' +
        '<button class="modalCancel">Cancel</button></div>';
    ov.innerHTML = h;
    document.body.appendChild(ov);

    var boxes = ov.querySelectorAll(".adoptList input");
    function setBox(path, on) {
        for (var b = 0; b < boxes.length; b++) {
            if (boxes[b].getAttribute("data-path") === path) { boxes[b].checked = on; chosen[path] = on; return; }
        }
    }
    for (var k = 0; k < boxes.length; k++) {
        (function (box) {
            box.addEventListener("change", function () {
                var path = box.getAttribute("data-path");
                chosen[path] = box.checked;
                if (box.checked) {
                    // tick every ancestor — the path is the address
                    var segs = path.split("\t");
                    for (var d = 1; d < segs.length; d++) setBox(segs.slice(0, d).join("\t"), true);
                } else {
                    // unticking a parent unticks everything beneath it
                    for (var c = 0; c < boxes.length; c++) {
                        var p = boxes[c].getAttribute("data-path");
                        if (p.indexOf(path + "\t") === 0) { boxes[c].checked = false; chosen[p] = false; }
                    }
                }
            });
        })(boxes[k]);
    }

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector(".modalCancel").onclick = close;
    ov.querySelector(".adoptNone").onclick = function () {
        for (var n = 0; n < boxes.length; n++) { boxes[n].checked = false; chosen[boxes[n].getAttribute("data-path")] = false; }
    };
    ov.querySelector(".adoptGo").onclick = function () {
        var keep = [];
        for (var m = 0; m < paths.length; m++) {
            if (chosen[paths[m]]) keep.push({ path: paths[m], folder: folderOf[paths[m]] });
        }
        close();
        if (!keep.length) { setStatus("Nothing selected.", ""); return; }
        adoptPaths(keep);
    };
}

// Merge into the existing tree rather than replacing it: a bin that's already
// there keeps its folder link, its colour and its pinned state.
function adoptPaths(paths, mode) {
    var incoming = treeFromPaths(paths), added = 0, linked = 0, unlinked = [];

    (function merge(src, destArr) {
        for (var i = 0; i < src.length; i++) {
            var match = null;
            for (var j = 0; j < destArr.length; j++) {
                if (String(destArr[j].name).toLowerCase() === String(src[i].name).toLowerCase()) { match = destArr[j]; break; }
            }
            if (!match) {
                match = { name: src[i].name, folder: "", color: "", pinned: false, open: true, children: [] };
                destArr.push(match);
                added++;
                if (src[i].folder) { match.folder = src[i].folder; linked++; }
                else if (!src[i].children.length) unlinked.push(src[i].name);
            } else if (!match.folder && src[i].folder) {
                // An existing bin with no link gains one; a bin already linked keeps
                // the folder Bom chose, which outranks anything inferred.
                match.folder = src[i].folder;
                linked++;
            }
            if (!match.children) match.children = [];
            merge(src[i].children, match.children);
        }
    })(incoming, treeData);

    expandTree(); saveTree(); renderAll();

    if (!added && !linked) { setStatus("Every one of those was already set up.", ""); return; }

    // Name the bins that still need a folder. Without that you'd have to hunt for
    // the ones missing a folder name, which is the whole point of the flag.
    var msg = "✓ Set up " + added + " bin" + (added === 1 ? "" : "s");
    if (mode === "trunc") msg += " (first " + paths.length + ")";
    msg += ", " + linked + " linked";
    if (unlinked.length) {
        msg += " — " + (unlinked.length > 3
            ? unlinked.length + " need a folder"
            : unlinked.join(", ") + " need" + (unlinked.length === 1 ? "s" : "") + " a folder");
    }
    setStatus(msg + ".", "ok");
}

// ====================================================================
//  UPDATER
// ====================================================================
// Updates come from a small PUBLIC repo holding only the built panel files;
// the source repo stays private. Public because the alternative — a private
// repo — needs an access token, and a token shipped inside the panel is a
// credential handed to everyone who installs it, not an update mechanism.
//
// Understand what this is: whatever sits at that URL gets downloaded and run
// on every machine with the panel installed, with Node enabled. The account
// that can write to the repo is the account that controls those machines.
// Keep 2FA on it.
var UPDATE_OWNER = "mill2nn";
var UPDATE_REPO = "omni-link-releases";
var UPDATE_BRANCH = "main";
// Fallback list, used only if latest.json doesn't name its own files.
var UPDATE_FILES = ["client/index.html", "client/main.js", "client/style.css", "jsx/host.jsx", "CSXS/manifest.xml"];
var MAX_FILE_BYTES = 2 * 1024 * 1024;
var HTTP_TIMEOUT_MS = 15000;

var updateInfo = null;          // parsed latest.json once a newer version is seen

function updateUrl(rel) {
    return "https://raw.githubusercontent.com/" + UPDATE_OWNER + "/" + UPDATE_REPO +
        "/" + UPDATE_BRANCH + "/" + rel;
}

// Where are we installed? The panel is served from <extension>/client/index.html,
// so its own URL is the pointer. The bundled CSInterface here is a 13-line stub
// with no getSystemPath, and hardcoding the path would break the moment the
// bundle id changes.
function panelHref() { return (window.location && window.location.href) || ""; }
function extensionDir() {
    var href = panelHref();
    var m = /^file:\/\/(.*)\/client\/[^\/]*$/.exec(href);
    if (!m) return null;
    var p = decodeURIComponent(m[1]);
    if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1);      // file:///C:/… on Windows
    return p;
}

// "1.10.0" must beat "1.9.0" — string compare gets that backwards.
function cmpVersion(a, b) {
    var A = String(a).split("."), B = String(b).split(".");
    var n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
        var x = parseInt(A[i], 10) || 0, y = parseInt(B[i], 10) || 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

// The file list arrives over the network, so it is untrusted input that is
// about to be turned into a write path. "../../../.bash_profile" must not
// resolve to anything outside the extension folder.
function safeRelPath(rel) {
    if (typeof rel !== "string" || !rel) return false;
    if (/^[\/\\]/.test(rel) || /^[A-Za-z]:/.test(rel)) return false;   // absolute
    var parts = rel.split(/[\/\\]/);
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "" || parts[i] === "." || parts[i] === "..") return false;
    }
    return true;
}

function httpsGet(url, cb, depth) {
    var https = nodeReq("https");
    if (!https) { cb("Node unavailable"); return; }
    if ((depth || 0) > 3) { cb("too many redirects"); return; }
    var req, done = false;
    function finish(err, buf) { if (done) return; done = true; cb(err, buf); }
    try {
        req = https.get(url, { headers: { "User-Agent": "OmniLink/" + VERSION } }, function (res) {
            var code = res.statusCode;
            if ((code === 301 || code === 302 || code === 307 || code === 308) && res.headers.location) {
                res.resume();
                httpsGet(res.headers.location, cb, (depth || 0) + 1);
                done = true;
                return;
            }
            if (code !== 200) { res.resume(); finish("HTTP " + code); return; }
            var chunks = [], total = 0, tooBig = false;
            res.on("data", function (c) {
                total += c.length;
                if (total > MAX_FILE_BYTES) { tooBig = true; try { req.destroy(); } catch (e) {} return; }
                chunks.push(c);
            });
            res.on("end", function () { tooBig ? finish("file too large") : finish(null, Buffer.concat(chunks)); });
            res.on("error", function (e) { finish(String((e && e.message) || e)); });
        });
    } catch (e) { finish(String((e && e.message) || e)); return; }
    req.on("error", function (e) { finish(String((e && e.message) || e)); });
    req.setTimeout(HTTP_TIMEOUT_MS, function () { try { req.destroy(); } catch (e) {} finish("timed out"); });
}

// ---------- the bar ----------
var ICON_DL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>';
var ICON_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
var ICON_WAIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';

var updHideTimer = null;
// `html` is trusted markup built here; anything from the network must be
// esc()'d by the caller before it reaches this.
function showUpdateBar(kind, html, btnLabel, onClick, autoHideMs) {
    var bar = document.getElementById("updBar");
    if (!bar) return;
    bar.className = "updBar" + (kind ? " " + kind : "");
    bar.style.display = "";
    bar.querySelector(".updIco").innerHTML =
        kind === "ok" ? ICON_TICK : kind === "bad" ? ICON_WARN : kind === "busy" ? ICON_WAIT : ICON_DL;
    bar.querySelector(".updText").innerHTML = html;
    var btn = bar.querySelector(".updBtn");
    btn.style.display = btnLabel ? "" : "none";
    btn.textContent = btnLabel || "";
    btn.onclick = onClick || null;
    if (updHideTimer) { clearTimeout(updHideTimer); updHideTimer = null; }
    if (autoHideMs) updHideTimer = setTimeout(hideUpdateBar, autoHideMs);
}
function hideUpdateBar() {
    var bar = document.getElementById("updBar");
    if (bar) bar.style.display = "none";
}

// ---------- check ----------
// Silent unless there is something to say. A teammate with no internet, or on
// a locked-down network, should never see an error they can't act on — so
// failures only surface when they asked for the check themselves.
function checkForUpdate(manual) {
    if (manual) showUpdateBar("busy", "Checking for updates…", "", null);
    httpsGet(updateUrl("latest.json"), function (err, buf) {
        if (err) {
            if (manual) showUpdateBar("bad", "Couldn’t check for updates — " + esc(err), "Retry", function () { checkForUpdate(true); });
            return;
        }
        var info = null;
        try { info = JSON.parse(String(buf)); } catch (e) {}
        if (!info || !info.version) {
            if (manual) showUpdateBar("bad", "The update file couldn’t be read.", "", null);
            return;
        }
        if (cmpVersion(info.version, VERSION) <= 0) {
            if (manual) showUpdateBar("ok", "You’re on the latest version (" + esc(VERSION) + ").", "", null, 4000);
            else hideUpdateBar();
            return;
        }
        updateInfo = info;
        var note = info.notes ? " — " + esc(String(info.notes).substring(0, 90)) : "";
        showUpdateBar("", "<b>" + esc(info.version) + "</b> available" + note, "Update", applyUpdate);
    });
}

// ---------- apply ----------
function applyUpdate() {
    var fs = nodeFs(), dir = extensionDir();
    if (!fs || !dir) { showUpdateBar("bad", "Can’t find the installed panel on disk.", "", null); return; }
    if (!updateInfo) return;

    var files = (updateInfo.files && updateInfo.files.length) ? updateInfo.files : UPDATE_FILES;
    for (var i = 0; i < files.length; i++) {
        if (!safeRelPath(files[i])) {
            showUpdateBar("bad", "Update refused — it tried to write outside the panel folder.", "", null);
            return;
        }
    }

    var got = {}, n = files.length, idx = 0;
    showUpdateBar("busy", "Downloading " + esc(updateInfo.version) + "… <span class=\"updProg\">0 / " + n + "</span>", "", null);

    // Download everything into memory FIRST. Nothing on disk is touched until
    // every file is in hand and has passed its sanity check — a half-downloaded
    // update must not be able to half-replace an install.
    (function next() {
        if (idx >= n) { verifyThenSwap(); return; }
        var rel = files[idx];
        httpsGet(updateUrl(rel), function (err, buf) {
            if (err || !buf || !buf.length) {
                showUpdateBar("bad", "Download failed (" + esc(rel) + ") — nothing was changed.", "Retry", applyUpdate);
                return;
            }
            got[rel] = buf;
            idx++;
            showUpdateBar("busy", "Downloading " + esc(updateInfo.version) + "… <span class=\"updProg\">" + idx + " / " + n + "</span>", "", null);
            next();
        });
    })();

    function verifyThenSwap() {
        // Cheap shape checks. They won't stop a determined attacker who owns the
        // repo — nothing here can — but they do stop a mangled or truncated
        // upload from bricking every panel on the team.
        var js = got["client/main.js"], xml = got["CSXS/manifest.xml"];
        if (js && String(js).indexOf("var VERSION") < 0) { fail("the downloaded panel looks corrupt"); return; }
        if (xml) {
            var xs = String(xml);
            if (xs.indexOf("ExtensionManifest") < 0) { fail("the downloaded manifest looks corrupt"); return; }
            var mv = /ExtensionBundleVersion="([^"]+)"/.exec(xs);
            if (mv && mv[1] !== updateInfo.version) { fail("the download says " + esc(mv[1]) + ", not " + esc(updateInfo.version)); return; }
        }

        var backup = dir + "/.backup", written = [], saved = [];
        try {
            rmrf(backup);
            for (var i = 0; i < files.length; i++) {
                var abs = dir + "/" + files[i];
                if (fs.existsSync(abs)) {
                    var b = backup + "/" + files[i];
                    mkdirp(parentOf(b));
                    fs.writeFileSync(b, fs.readFileSync(abs));
                    saved.push(files[i]);
                }
            }
        } catch (e) { fail("couldn’t back up the current version"); return; }

        try {
            for (var j = 0; j < files.length; j++) {
                var target = dir + "/" + files[j];
                mkdirp(parentOf(target));
                fs.writeFileSync(target, got[files[j]]);
                written.push(files[j]);
            }
        } catch (e) {
            // Put it back exactly as it was, then say so plainly.
            for (var k = 0; k < saved.length; k++) {
                try { fs.writeFileSync(dir + "/" + saved[k], fs.readFileSync(backup + "/" + saved[k])); } catch (e2) {}
            }
            showUpdateBar("bad", "Update failed — rolled back, still on " + esc(VERSION) + ".", "Retry", applyUpdate);
            return;
        }

        /* Keep what was just replaced, rather than deleting it.
         *
         * The rollback above only covers an update that FAILS. An update that
         * succeeds and is simply worse than what it replaced had no way back at
         * all — and that is the likelier problem. Promoting the backup into the
         * same folder the Revert script reads means one revert path covers both
         * the installer and the in-panel updater. */
        try {
            var home = (typeof process !== "undefined" && process.env &&
                        (process.env.HOME || process.env.USERPROFILE)) || "";
            if (home) {
                var root = /^win/i.test(navigator.platform || "")
                    ? home + "/AppData/Roaming/Omni Link Backups"
                    : home + "/Library/Application Support/Omni Link Backups";
                var stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+$/, "");
                var snap = root + "/" + stamp, bump = 2;
                while (fs.existsSync(snap)) { snap = root + "/" + stamp + "-" + bump; bump++; }
                for (var s = 0; s < saved.length; s++) {
                    var to = snap + "/" + saved[s];
                    mkdirp(parentOf(to));
                    fs.writeFileSync(to, fs.readFileSync(backup + "/" + saved[s]));
                }
                fs.writeFileSync(snap + "/SNAPSHOT.txt",
                    "Omni Link snapshot\ntaken: " + new Date().toString() +
                    "\nversion: " + VERSION + "\nkind: partial (in-panel update)\n");
                // Five is plenty, and each holds only the files an update touches.
                try {
                    var all = fs.readdirSync(root).sort();
                    while (all.length > 5) rmrf(root + "/" + all.shift());
                } catch (eTrim) {}
            }
        } catch (eSnap) { /* a missing safety net must never fail the update itself */ }

        rmrf(backup);
        showUpdateBar("ok", "Updated to <b>" + esc(updateInfo.version) + "</b> — restart Premiere", "", null);
    }

    function fail(msg) { showUpdateBar("bad", "Update refused — " + msg + ". Nothing was changed.", "", null); }

    function parentOf(p) { return p.replace(/[\/\\][^\/\\]*$/, ""); }
    function mkdirp(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (e) {} }
    function rmrf(p) {
        try { if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true }); else fs.rmdirSync(p, { recursive: true }); } catch (e) {}
    }
}

// ====================================================================
//  wire up
// ====================================================================
document.addEventListener("DOMContentLoaded", function () {
    presets = loadPresets();
    // Before anything renders, so the first paint already uses his real labels.
    loadPremiereLabels();
    initOnboard();

    // main view
    document.getElementById("importBtn").onclick = importAll;
    document.getElementById("setupBtn").onclick = readProjectBins;
    document.getElementById("addBinBtn").onclick = addTopBin;
    document.getElementById("treeHeader").onclick = toggleCollapsed;

    document.getElementById("gearBtn").onclick = function (e) { e.stopPropagation(); toggleGear(); };
    document.getElementById("giPresets").onclick = function () { closeGear(); openBuilder(); };

    document.getElementById("giReset").onclick = function () { closeGear(); resetStructure(); };
    // the toolbar
    document.getElementById("tbAddTop").onclick = addTopBin;
    document.getElementById("tbRead").onclick = readProjectBins;
    document.getElementById("tbReload").onclick = function () {
        refreshProject(true); setStatus("Reloaded for this project.", "");
    };
    document.getElementById("tbRecolor").onclick = function () {
        setStatus("Re-applying colours…", "");
        recolorAll(function (n) {
            setStatus(n ? ("Coloured " + n + " bin" + (n === 1 ? "" : "s") + " and their clips.")
                        : "No bins have a colour set.", n ? "ok" : "");
        });
    };
    document.getElementById("giLog").onclick = function () { closeGear(); openLog(); };
    document.getElementById("logBack").onclick = function () { showView("main"); };
    document.getElementById("logClear").onclick = function () {
        confirmModal("Clear the import log?", "Only the record goes. Your files, bins and links are untouched.", "Clear", true, function (ok) {
            if (!ok) return;
            clearLog();
            renderLog();
        });
    };
    wireSearch();
    document.getElementById("giUpdate").onclick = function () { closeGear(); checkForUpdate(true); };
    // The escape hatch for the new tile-click behaviour: anyone who preferred
    // the old one gets it back here, with no reinstall and no restart.
    document.getElementById("giTileMode").onclick = function () {
        closeGear();
        var next = tileClickMode() === "contents" ? "reveal" : "contents";
        setTileClickMode(next);
        setStatus(next === "contents"
            ? "Clicking a pinned bin now shows what’s inside it."
            : "Clicking a pinned bin now just highlights it in Premiere.", "ok");
    };
    syncTileModeLabel();

    // builder view
    document.getElementById("builderBack").onclick = function () { showView("main"); };
    document.getElementById("builderAddBin").onclick = builderAddTop;
    document.getElementById("savePresetBtn").onclick = savePreset;
    document.getElementById("clearPresetBtn").onclick = clearPreset;
    document.getElementById("applyPresetBtn").onclick = applyPresetToProject;

    // click elsewhere closes menus / gear
    document.addEventListener("click", function (e) {
        closeAllMenus(null); closeGear();
        var t = e.target;
        if (t && t.closest && (t.closest(".trow") || t.closest(".modalOv"))) return;
        clearSelection();
    });

    // custom bin-drag (folder chip follows the cursor) + never navigate on drop
    document.addEventListener("mousemove", pinDragMove);
    document.addEventListener("mousemove", tileDragMove);
    document.addEventListener("mouseup", pinDragUp);
    document.addEventListener("mouseup", tileDragUp);
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && rowDrag) { pinDrag = null; cancelRowDrag(); setStatus("Move cancelled.", ""); return; }
        // F2 or Enter renames the selected bin. Double-click still works, but it
        // was the only way in, so when it broke there was no way to rename at all.
        if ((e.key === "F2" || e.key === "Enter") && selection.length === 1) {
            // Never while typing. Without this, Enter to FINISH a rename bubbled
            // up here and instantly reopened the editor on the same bin.
            var tgt = e.target;
            if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT")) return;
            if (document.querySelector(".tname.editing")) return;      // already renaming
            if (document.querySelector(".modalOv")) return;            // a dialog owns the keyboard
            var el = rowElFor(selection[0]);
            if (!el) return;
            e.preventDefault();
            beginRename(el, selection[0], selection[0].name);
        }
    });
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) { e.preventDefault(); });
    wireTreeDrops();
    wireBigDrops();
    wireContents();
    wireTips();
    wireRev(document.querySelector(".tRev"), TREE_DIR_KEY, renderTree);
    wireSortControl(document.querySelector(".tSortWrap"), setTreeSort);
    syncTreeSortControl();
    loadBinOpenPref();

    watchPanelWidth();

    // auto-switch to the active project when the panel is touched
    window.addEventListener("focus", function () { refreshProject(false); });
    document.addEventListener("mouseenter", function () { refreshProject(false); });

    showView("main");
    refreshProject(true);

    // One quiet check shortly after launch, so it never competes with the panel
    // drawing itself. Nothing downloads here — this reads latest.json and, only
    // if it names a newer version, shows a bar with an Update button. Applying
    // is always a deliberate click. Failures are silent; see checkForUpdate.
    setTimeout(function () { checkForUpdate(false); }, 1200);
});
