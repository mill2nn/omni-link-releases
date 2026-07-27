/*
 * Omni Link — ExtendScript host (the part that talks to Premiere Pro).
 * The panel loads this automatically (see manifest ScriptPath) and calls
 * these functions with CSInterface.evalScript().
 *
 * ExtendScript is an old flavour of JavaScript, so we keep the code basic
 * (no modern JSON/array helpers, no let/const).
 */

// ---------- small helpers ----------

function aip_trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
}

function aip_stripExt(name) {
    var dot = String(name).lastIndexOf(".");
    return (dot > 0) ? String(name).substring(0, dot) : String(name);
}

function aip_getExt(name) {
    var dot = String(name).lastIndexOf(".");
    return (dot >= 0) ? String(name).substring(dot + 1) : "";
}

// ---------- bins ----------

// Bins are addressed by a nested PATH, tab-joined (e.g. "Footage\tKling"),
// so we can point at a sub-bin, not just top-level ones.

// Counts bins actually created by aip_ensureBinPath; reset before each batch.
var aip_madeCount = 0;

// Find or create the bin at a nested path (array of names). Returns the leaf bin.
function aip_ensureBinPath(segs) {
    var parent = app.project.rootItem;
    for (var s = 0; s < segs.length; s++) {
        var name = aip_trim(segs[s]);
        if (name === "") continue;
        var found = null;
        for (var i = 0; i < parent.children.numItems; i++) {
            var item = parent.children[i];
            if (item.type == 2 && item.name == name) { found = item; break; }
        }
        if (found === null) {
            found = parent.createBin(name);
            if (found === null) return null;
            aip_madeCount++;
        }
        parent = found;
    }
    return parent;
}

// Build a whole structure. blob = newline-separated, tab-joined bin paths.
// Idempotent: only creates bins that don't already exist. Returns "OK:<count>",
// where count is how many bins were actually NEW (not how many paths we walked).
function aip_createStructure(blob) {
    if (!app.project) return "ERR:No project open";
    var lines = String(blob).split("\n");
    aip_madeCount = 0;
    for (var i = 0; i < lines.length; i++) {
        var line = aip_trim(lines[i]);
        if (line === "") continue;
        var bin = aip_ensureBinPath(line.split("\t"));
        if (bin === null) return "ERR:Could not create '" + line + "'";
    }
    return "OK:" + aip_madeCount;
}

// ---------- the actual import ----------

/*
 * Import every NEW top-level file from folderPath into the bin called binName.
 *   "New" = no clip with the same FILENAME is in the bin yet. Extensions count,
 *   so K1.mp4 and K1.wav are different files and both get imported.
 *   extCsv = comma-separated allowed extensions, e.g. "mp4,mov,png,wav".
 * Returns the number of files imported (as text), or "ERR:<message>".
 */
function aip_import(binPath, folderPath, extCsv, colorIndex) {
    if (!app.project) return "ERR:No project open";

    // binPath is a tab-joined nested path; find it or create it.
    var bin = aip_ensureBinPath(String(binPath).split("\t"));
    if (bin === null) return "ERR:Could not open bin '" + binPath + "'";

    /*
     * Collect names already in the bin so we can skip duplicates.
     * Match on the FULL filename. The old code also registered every name with
     * its extension stripped, which meant a bin holding "K1.mp4" would silently
     * refuse "K1.wav" and "K1.mov" forever. The stem is still checked, but only
     * against items that carry no extension at all — the case where Premiere
     * itself dropped it on import.
     */
    var existing = {};
    var existingStems = {};
    for (var i = 0; i < bin.children.numItems; i++) {
        var nm = String(bin.children[i].name);
        existing[nm.toLowerCase()] = true;
        if (aip_getExt(nm) === "") existingStems[nm.toLowerCase()] = true;
    }

    // Build a quick lookup of allowed extensions.
    var allowed = {};
    var parts = String(extCsv).toLowerCase().split(",");
    for (var p = 0; p < parts.length; p++) allowed[aip_trim(parts[p])] = true;

    var folder = new Folder(folderPath);
    if (!folder.exists) return "ERR:Folder not found";

    var files = folder.getFiles(); // top-level only (does not recurse)
    var toImport = [];
    for (var f = 0; f < files.length; f++) {
        var file = files[f];
        if (!(file instanceof File)) continue;              // skip subfolders
        var base = decodeURI(file.name);                    // e.g. "K1.mp4"
        if (base.charAt(0) === ".") continue;               // skip hidden files
        var ext = aip_getExt(base).toLowerCase();
        if (!allowed[ext]) continue;                        // not a media type we want
        var noExt = aip_stripExt(base).toLowerCase();
        if (existing[base.toLowerCase()]) continue;      // same file already in the bin
        if (existingStems[noExt]) continue;              // in as an extension-less item
        toImport.push(file.fsName);
    }

    if (toImport.length === 0) return "0";

    var root = app.project.rootItem;
    // Snapshot the root's items first. Some Premiere builds ignore importFiles'
    // target-bin argument and drop everything at the root, so we detect what's
    // new at root afterwards and move it into the bin ourselves.
    var beforeAtRoot = {};
    for (var b = 0; b < root.children.numItems; b++) {
        beforeAtRoot[root.children[b].nodeId] = true;
    }

    try {
        // importFiles(paths, suppressUI, targetBin, importAsNumberedStills)
        app.project.importFiles(toImport, true, bin, false);
    } catch (e) {
        return "ERR:" + e.toString();
    }

    // Move any freshly-imported clips that landed at root into the target bin.
    for (var r = root.children.numItems - 1; r >= 0; r--) {
        var child = root.children[r];
        if (child.type != 2 && !beforeAtRoot[child.nodeId]) {
            try { child.moveBin(bin); } catch (e2) {}
        }
    }

    // If the bin has a color, label the clips now sitting in it (color-on-import).
    var ci = parseInt(colorIndex, 10);
    if (!isNaN(ci)) {
        for (var c = 0; c < bin.children.numItems; c++) {
            var it = bin.children[c];
            if (it.type != 2) { try { if (typeof it.setColorLabel === "function") it.setColorLabel(ci); } catch (e3) {} }
        }
    }

    return "" + toImport.length;
}

// ---------- bin label color ----------

// Find the bin at a nested path WITHOUT creating it. Returns the bin or null.
function aip_findBinPath(segs) {
    var parent = app.project.rootItem;
    for (var s = 0; s < segs.length; s++) {
        var name = aip_trim(segs[s]);
        if (name === "") continue;
        var found = null;
        for (var i = 0; i < parent.children.numItems; i++) {
            var item = parent.children[i];
            if (item.type == 2 && item.name == name) { found = item; break; }
        }
        if (found === null) return null;
        parent = found;
    }
    return parent;
}

/*
 * Rename an existing bin so a rename in the panel is mirrored in the project.
 * Without this, renaming here and then importing builds a NEW bin at the new
 * path and leaves the old one behind with all its clips still inside.
 * Sub-bins follow automatically — renameBin renames in place.
 * Returns "OK", "NOBIN", "EXISTS" (a sibling already has that name), "ERR:...".
 */
function aip_renameBin(binPath, newName) {
    if (!app.project) return "ERR:No project open";
    var name = aip_trim(String(newName));
    if (name === "") return "ERR:Empty name";

    var segs = String(binPath).split("\t");
    var bin = aip_findBinPath(segs);
    if (bin === null) return "NOBIN";
    if (String(bin.name) === name) return "OK";      // nothing to do

    // the parent is the path minus the leaf ("" = project root)
    var parent;
    if (segs.length <= 1) parent = app.project.rootItem;
    else {
        parent = aip_findBinPath(segs.slice(0, segs.length - 1));
        if (parent === null) return "NOBIN";
    }
    for (var i = 0; i < parent.children.numItems; i++) {
        var it = parent.children[i];
        if (it.type == 2 && it.name == name && it.nodeId != bin.nodeId) return "EXISTS";
    }

    try { bin.renameBin(name); } catch (e) { return "ERR:" + e.toString(); }
    return "OK";
}

/*
 * Re-parent an existing bin so a move made in the panel is mirrored in the
 * project. toParentPath = "" means the project root. The bin keeps its name and
 * everything inside it — this is Premiere's own moveBin, not a copy.
 * Returns "OK", "NOBIN" (not in the project yet — nothing to move),
 * "NOPARENT", "EXISTS" (destination already has a bin with that name), "ERR:...".
 *
 * Note: there is no ExtendScript API for the ORDER of bins within a parent, so
 * only re-parenting can be mirrored, never sibling reordering.
 */
function aip_moveBin(fromPath, toParentPath) {
    if (!app.project) return "ERR:No project open";
    var bin = aip_findBinPath(String(fromPath).split("\t"));
    if (bin === null) return "NOBIN";

    var parent;
    var tp = aip_trim(String(toParentPath));
    if (tp === "") parent = app.project.rootItem;
    else {
        parent = aip_findBinPath(tp.split("\t"));
        if (parent === null) return "NOPARENT";
    }

    for (var i = 0; i < parent.children.numItems; i++) {
        var it = parent.children[i];
        if (it.type == 2 && it.name == bin.name && it.nodeId != bin.nodeId) return "EXISTS";
    }

    try { bin.moveBin(parent); } catch (e) { return "ERR:" + e.toString(); }
    return "OK";
}

// Recursively set the label color of every CLIP inside a bin (and its sub-bins).
function aip_colorClips(bin, idx) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var it = bin.children[i];
        if (it.type == 2) { aip_colorClips(it, idx); }        // recurse into sub-bins
        else { try { if (typeof it.setColorLabel === "function") it.setColorLabel(idx); } catch (e) {} }
    }
}

/*
 * Set the Project-panel label color of the bin at binPath to labelIndex
 * (0-based index into Premiere's label list) AND every clip inside it and its
 * sub-bins. We don't create the bin — if it isn't there yet, report "NOBIN".
 * Returns "OK", "NOBIN", "NOAPI" (this build lacks setColorLabel), or "ERR:...".
 */
function aip_setBinColor(binPath, labelIndex) {
    if (!app.project) return "ERR:No project open";
    var bin = aip_findBinPath(String(binPath).split("\t"));
    if (bin === null) return "NOBIN";
    var idx = parseInt(labelIndex, 10);
    if (isNaN(idx)) return "ERR:bad index";
    var hasApi = (typeof bin.setColorLabel === "function");
    try {
        if (hasApi) bin.setColorLabel(idx);   // color the bin itself
        aip_colorClips(bin, idx);              // color all clips inside (recursive)
    } catch (e) {
        return "ERR:" + e.toString();
    }
    return hasApi ? "OK" : "NOAPI";
}

/*
 * Read the bin structure that ALREADY exists in the project.
 *
 * The exact inverse of aip_createStructure: returns newline-separated,
 * tab-joined bin paths in project order, so a project someone has already been
 * working in can be pulled into the panel instead of retyped by hand.
 *
 * Bins only (type 2) — clips, sequences and captions are not structure. Label
 * colours are deliberately not read: Premiere exposes setColorLabel but no
 * reliable getter, so the panel would be inventing values.
 */
var AIP_READ_MAX_DEPTH = 8;      // pathological nesting guard
var AIP_READ_MAX_BINS = 400;     // don't try to swallow a monster project

function aip_readProject() {
    if (!app.project) return "ERR:No project open";
    var out = [], hit = false;

    function walk(parent, prefix, depth) {
        if (depth > AIP_READ_MAX_DEPTH) return;
        var kids;
        try { kids = parent.children; } catch (e) { return; }
        if (!kids) return;
        for (var i = 0; i < kids.numItems; i++) {
            if (out.length >= AIP_READ_MAX_BINS) { hit = true; return; }
            var item;
            try { item = kids[i]; } catch (e2) { continue; }
            if (!item || item.type != 2) continue;          // 2 = bin
            var name = aip_trim(String(item.name));
            if (name === "") continue;
            // A tab in a bin name would corrupt the path format, which is the
            // contract with the panel. Fold it to a space rather than emit a
            // path that would silently split into two bins.
            name = name.replace(/[\t\r\n]/g, " ");
            var path = prefix === "" ? name : prefix + "\t" + name;
            out.push(path);
            walk(item, path, depth + 1);
        }
    }

    try { walk(app.project.rootItem, "", 1); }
    catch (e3) { return "ERR:" + e3.toString(); }

    if (out.length === 0) return "OK:";                     // valid, just no bins
    return (hit ? "TRUNC:" : "OK:") + out.join("\n");
}

// The active project's key: its file path if saved, else its name.
function aip_projectKey() {
    if (!app.project) return "";
    try { if (app.project.path && String(app.project.path) !== "") return String(app.project.path); } catch (e) {}
    try { if (app.project.name) return String(app.project.name); } catch (e2) {}
    return "";
}
