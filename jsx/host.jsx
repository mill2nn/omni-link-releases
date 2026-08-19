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

/* One shape for a media path, so two spellings of the same file compare equal.
 *
 * macOS is case-insensitive by default, and getMediaPath() has been seen to come
 * back percent-encoded on some builds - the same trap that made the panel store
 * file:// URLs and call working folders missing. Trailing slashes and doubled
 * separators are folded too. ES3 only in here: no arrow functions, no JSON, no
 * Array methods. */
function aip_normPath(p) {
    var t = String(p == null ? "" : p);
    if (t === "") return "";
    if (t.indexOf("file://") === 0) t = t.substring(7);
    if (t.indexOf("%") >= 0) { try { t = decodeURI(t); } catch (eN) {} }
    t = t.replace(/\\/g, "/");
    while (t.indexOf("//") >= 0) t = t.replace("//", "/");
    t = t.replace(/\/+$/, "");
    return t.toLowerCase();
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
    /* ...and by the file each clip actually points at.
     *
     * The name is a label, and Premiere lets you change it. Rename a clip in the
     * bin and its name stops matching the file on disk, so the next Import saw a
     * new file and brought in a second copy of the same media under a different
     * name. The media path is the identity, and it survives a rename.
     *
     * Both indexes are consulted, not one instead of the other: a file MOVED on
     * disk keeps its name and would otherwise come back as new. Skipping on
     * either match can only ever skip more than before, never less.
     *
     * A sequence, title or colour matte has no media path and is not indexed -
     * it can never be a duplicate of a file. */
    var existingPaths = {};
    for (var i = 0; i < bin.children.numItems; i++) {
        var it = bin.children[i];
        /* A bin is not a file and must not enter EITHER index. It used to be
         * indexed by name, and aip_getExt() is "" for any dotless name, so a
         * sub-bin called "v1" put "v1" in the stem index and blocked v1.mp4 in
         * the same folder for ever - exactly the shape mirroring produces. The
         * zero-report then counted it as a duplicate, so the log said "already
         * in this bin" about a file that was not in it. */
        if (it.type == 2) continue;
        var nm = String(it.name);
        existing[nm.toLowerCase()] = true;
        if (aip_getExt(nm) === "") existingStems[nm.toLowerCase()] = true;
        var mp = "";
        try { if (typeof it.getMediaPath === "function") mp = aip_normPath(it.getMediaPath()); }
        catch (eM) { mp = ""; }
        if (mp !== "") existingPaths[mp] = true;
    }

    // Build a quick lookup of allowed extensions.
    var allowed = {};
    var parts = String(extCsv).toLowerCase().split(",");
    for (var p = 0; p < parts.length; p++) allowed[aip_trim(parts[p])] = true;

    var folder = new Folder(folderPath);
    if (!folder.exists) {
        // Naming the path matters: it usually arrived from a Finder drag, and
        // the difference between a missing volume, an escaped character and a
        // file-instead-of-folder is invisible without seeing the string.
        var alt = "";
        try { alt = decodeURI(String(folderPath)); } catch (eD) { alt = ""; }
        return "ERR:Folder not found: " + folderPath +
               ((alt && alt !== String(folderPath)) ? "  (decoded: " + alt + ")" : "");
    }
    if (!(folder instanceof Folder)) return "ERR:Not a folder: " + folderPath;

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
        // Already in under another name: renamed in the bin after being imported.
        if (existingPaths[aip_normPath(file.fsName)]) continue;
        toImport.push(file.fsName);
    }

    if (toImport.length === 0) {
        /* Zero is a legitimate answer — everything was already in. But zero also
         * comes back when the folder holds nothing this panel recognises, and
         * the two are indistinguishable from the outside. Report the counts so
         * the panel can tell them apart. */
        var seen = 0, wrongExt = 0, renamed = 0;
        for (var z = 0; z < files.length; z++) {
            var zf = files[z];
            if (!(zf instanceof File)) continue;
            var zb = decodeURI(zf.name);
            if (zb.charAt(0) === ".") continue;
            seen++;
            if (!allowed[aip_getExt(zb).toLowerCase()]) { wrongExt++; continue; }
            /* Counted separately so the panel can say "already in, under another
             * name" rather than leaving it to look like a plain duplicate. */
            if (!existing[zb.toLowerCase()] && existingPaths[aip_normPath(zf.fsName)]) renamed++;
        }
        return "0" + AIP_FIELD_SEP + "seen=" + seen + " skipped-type=" + wrongExt +
               (renamed ? " renamed-in-bin=" + renamed : "");
    }

    var root = app.project.rootItem;
    // Snapshot the root's items first. Some Premiere builds ignore importFiles'
    // target-bin argument and drop everything at the root, so we detect what's
    // new at root afterwards and move it into the bin ourselves.
    var beforeAtRoot = {};
    for (var b = 0; b < root.children.numItems; b++) {
        beforeAtRoot[root.children[b].nodeId] = true;
    }
    /* And snapshot the TARGET bin, so the count returned below can be measured
     * rather than assumed.
     *
     * This used to return toImport.length — what the import was asked to bring
     * in, not what arrived. When Premiere silently refuses a file the panel
     * therefore reported success, the file never landed in the bin, the dedupe
     * never saw it, and the next press tried again: "imported 1 new file",
     * forever, with nothing to show for it. */
    var beforeInBin = {};
    for (var q2 = 0; q2 < bin.children.numItems; q2++) {
        beforeInBin[bin.children[q2].nodeId] = true;
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

    /* What actually arrived, measured against the snapshot.
     *
     * Both callers read this with parseInt, which stops at the separator — so
     * appending the filenames costs nothing on the old path while giving the
     * import log and the "3 new" badges something to actually show. A count
     * alone can tell you something arrived but never what.
     */
    var names = [], landed = {};
    for (var a = 0; a < bin.children.numItems; a++) {
        var ai = bin.children[a];
        if (beforeInBin[ai.nodeId]) continue;
        var an = String(ai.name);
        names.push(an.replace(/[\t\r\n\u0001]/g, " "));
        landed[an.toLowerCase()] = true;
        // Premiere drops the extension on some formats, so the stem counts too.
        landed[aip_stripExt(an).toLowerCase()] = true;
    }

    /* Anything asked for that cannot be found in the bin afterwards. Named, not
     * counted: "1 file would not import" is not actionable, and the whole point
     * of this branch is that pressing Import again will not help. */
    var refused = [];
    for (var m = 0; m < toImport.length; m++) {
        var mn = String(toImport[m]).replace(/^.*[\/\\]/, "");
        if (landed[mn.toLowerCase()] || landed[aip_stripExt(mn).toLowerCase()]) continue;
        refused.push(mn.replace(/[\t\r\n\u0001]/g, " "));
    }

    var out = "" + names.length + AIP_FIELD_SEP + names.join("\n");
    if (refused.length) out += AIP_FIELD_SEP + "refused=" + refused.join(" | ");
    return out;
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
 * Select a bin in Premiere's Project panel, so clicking a pinned tile jumps
 * there instead of making anyone navigate by hand.
 *
 * ProjectItem.select() is the only reveal-shaped call the API offers, and what
 * it actually does is not guaranteed: on some builds it highlights the item AND
 * scrolls the panel to it, on others it only sets the selection while the panel
 * stays put. There is no API at all for expanding a collapsed bin, so a bin
 * nested inside a closed parent may end up selected but still out of sight.
 * Selecting each ancestor on the way down costs nothing and improves the odds;
 * the target goes last so it is the one left selected.
 *
 * Returns "OK", "NOBIN" (the panel and the project disagree about what exists),
 * "NOSUPPORT" (this Premiere has no select()), or "ERR:...".
 */
/*
 * Force Premiere's Project panel back to the top level.
 *
 * When a bin is opened, the panel is SCOPED to it — it shows that bin and
 * nothing else. Selecting an item outside that scope does select the item, but
 * the panel has no reason to move, so from the outside it looks like nothing
 * happened. Navigating out is not in the API either.
 *
 * The way out is the same trick as the way in: reveal something that can only
 * be shown from the top level, and the panel has to go there. A loose FILE at
 * the project root is that something — a bin is not, because selecting a bin
 * only highlights it.
 *
 * Returns "file" (climbed out), "root" (fell back to selecting the root, which
 * may or may not move anything), or "" (nothing here can do it).
 */
/*
 * Every Project VIEW belonging to the current project.
 *
 * This is the piece that was missing. A bin opened by double-click becomes its
 * own tab, and a tab is a separate project view. ProjectItem.select() does not
 * say which view it means, so a selection made while a second tab is in front
 * lands somewhere the user cannot see — which is exactly the "nothing happens"
 * Bom kept reporting. app.setProjectViewSelection takes a view ID, so the
 * selection can be applied to every view including the one actually in front.
 *
 * Returns an array of view IDs, empty if this Premiere has no such API.
 */
function aip_projectViews() {
    var ids = [];
    try {
        if (typeof app.getProjectViewIDs !== "function") return ids;
        var all = app.getProjectViewIDs();
        if (!all) return ids;
        for (var i = 0; i < all.length; i++) {
            var id = all[i];
            // Other open projects have views too; setting selection in those
            // would reach into a project the user is not working in.
            try {
                var proj = app.getProjectFromViewID(id);
                if (proj && String(proj.name) !== String(app.project.name)) continue;
            } catch (e1) {}
            ids.push(id);
        }
    } catch (e) { return []; }
    return ids;
}

/* Select one item in every view of this project, then READ THE SELECTION BACK.
 *
 * Setting a selection and seeing nothing move has two very different causes:
 * the call was ignored, or the call worked and Premiere simply does not scroll
 * its Project panel for a scripted selection. Those need opposite responses, so
 * guessing between them is worthless. Reading it back separates them.
 *
 * Returns "<applied>/<confirmed>" — how many views accepted the call, and how
 * many actually report the item as selected afterwards.
 */
function aip_selectInViews(item, ids) {
    var applied = 0, confirmed = 0;
    if (typeof app.setProjectViewSelection !== "function") return "0/0/1";
    var wantId = "";
    try { wantId = String(item.nodeId); } catch (e0) { wantId = ""; }

    for (var i = 0; i < ids.length; i++) {
        try { app.setProjectViewSelection([item], ids[i]); applied++; } catch (e1) { continue; }
        try {
            if (typeof app.getProjectViewSelection !== "function") continue;
            var sel = app.getProjectViewSelection(ids[i]);
            if (!sel) continue;
            for (var j = 0; j < sel.length; j++) {
                var got = "";
                try { got = String(sel[j].nodeId); } catch (e2) { got = ""; }
                if (got !== "" && got === wantId) { confirmed++; break; }
            }
        } catch (e3) {}
    }
    /* And now the question that actually matters to the user: is the item
     * selected in the view they are LOOKING AT?
     *
     * getCurrentProjectViewSelection reports the frontmost view, including one
     * this code cannot enumerate — a bin opened as its own "Bin: X" tab is not
     * a project view, so setProjectViewSelection can never reach it. If the
     * front view does not hold what we just selected, the user is parked inside
     * a bin and nothing we do will move them out. That is worth saying instead
     * of appearing to work.
     *
     * Reported as a third field, and only ever "0" when we positively saw a
     * different selection in front. Unknown counts as fine — a warning that
     * fires when we cannot tell is a warning people learn to ignore. */
    var current = "1";
    try {
        if (typeof app.getCurrentProjectViewSelection === "function") {
            var cur = app.getCurrentProjectViewSelection();
            if (cur) {
                var found = false;
                for (var c = 0; c < cur.length; c++) {
                    var cid = "";
                    try { cid = String(cur[c].nodeId); } catch (e4) { cid = ""; }
                    if (cid !== "" && cid === wantId) { found = true; break; }
                }
                // An empty selection in front tells us nothing useful; only a
                // front view holding something ELSE is evidence.
                if (!found && cur.length > 0) current = "0";
            }
        }
    } catch (e5) {}

    return applied + "/" + confirmed + "/" + current;
}

function aip_climbOut() {
    var root = app.project.rootItem, kids;
    try { kids = root.children; } catch (e) { return ""; }
    if (kids) {
        for (var i = 0; i < kids.numItems; i++) {
            var it;
            try { it = kids[i]; } catch (e1) { continue; }
            if (!it || it.type == 2) continue;              // needs to be a file
            try {
                if (typeof it.select !== "function") break;
                it.select();
                return "file";
            } catch (e2) { break; }
        }
    }
    try {
        if (typeof root.select === "function") { root.select(); return "root"; }
    } catch (e3) {}
    return "";
}

function aip_revealBin(binPath) {
    var segs = String(binPath).split("\t");
    var bin = aip_findBinPath(segs);
    if (bin === null) return "NOBIN";
    if (bin == app.project.rootItem) return "NOBIN";       // empty path — nothing to show

    /* What to land on. Selecting the BIN only ever highlighted it; selecting
     * something INSIDE it is what makes a panel open the bin to show it. A bin
     * holding nothing but sub-bins has no such anchor, and falls back to itself. */
    var target = bin, landed = "";
    var kids = null;
    try { kids = bin.children; } catch (e0) { kids = null; }
    if (kids) {
        for (var k = 0; k < kids.numItems; k++) {
            var it;
            try { it = kids[k]; } catch (e1) { continue; }
            if (!it || it.type == 2) continue;             // 2 = bin, not a file
            target = it;
            landed = aip_trim(String(it.name)).replace(/[\t\r\n\u0001]/g, " ");
            break;
        }
    }

    /* Preferred path: address every project VIEW explicitly.
     *
     * ProjectItem.select() does not say which view it means. With a bin opened
     * in its own tab — Premiere's default for double-click — the selection can
     * land in a view that is not in front, which looks exactly like nothing
     * happening. setProjectViewSelection takes a view ID, so every tab of this
     * project gets it, including whichever one the user is looking at. */
    var ids = aip_projectViews();
    var tally = "0/0/1";
    if (ids.length) {
        // Select the bin first: on a bin, select() is also what sets the import
        // target, and that is worth keeping.
        try { if (typeof bin.select === "function") bin.select(); } catch (e2) {}
        tally = aip_selectInViews(target, ids);
    }
    if (tally.indexOf("0/0/") !== 0) return "OKVIEW:" + tally + ":" + landed;

    /* Fallback for a Premiere without the view API: the old behaviour. */
    var can = false;
    try { can = (typeof bin.select === "function"); } catch (e3) { can = false; }
    if (!can) return "NOSUPPORT";
    var climbed = aip_climbOut();
    var stuck = (climbed === "file") ? "" : "|noout";
    try {
        for (var i = 1; i < segs.length; i++) {
            var part = [];
            for (var j = 0; j < i; j++) part.push(segs[j]);
            var anc = aip_findBinPath(part);
            if (anc === null || anc == app.project.rootItem) continue;
            try { anc.select(); } catch (e4) {}
        }
        bin.select();
        if (target !== bin && typeof target.select === "function") {
            target.select();
            return "OKIN" + stuck + ":" + landed;
        }
    } catch (e5) {
        return "ERR:" + e5.toString();
    }
    return "OK" + stuck;
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
 * Re-apply every bin's colour in one pass.
 *
 * blob = one line per bin, "binPath<TAB>labelIndex". Bins are addressed by the
 * same tab-joined path as everywhere else, so the last field is the index.
 *
 * One call instead of one per bin: the panel used to fire these in parallel,
 * which meant a project with twenty coloured bins opened twenty concurrent
 * ExtendScript calls, each walking a subtree. Sequential inside a single call
 * is both faster and impossible to interleave with an import.
 *
 * Returns "OK:<coloured>/<asked>" — a bin that no longer exists is skipped
 * rather than failing the batch, and the difference is worth reporting.
 */
function aip_recolorAll(blob) {
    if (!app.project) return "ERR:No project open";
    var lines = String(blob).split("\n");
    var done = 0, asked = 0;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line === "") continue;
        var cut = line.lastIndexOf("\t");
        if (cut <= 0) continue;
        var idx = parseInt(line.substring(cut + 1), 10);
        if (isNaN(idx)) continue;
        asked++;
        var bin = aip_findBinPath(line.substring(0, cut).split("\t"));
        if (bin === null) continue;                     // renamed or deleted since
        try {
            if (typeof bin.setColorLabel === "function") bin.setColorLabel(idx);
            aip_colorClips(bin, idx);
            done++;
        } catch (e) {}
    }
    return "OK:" + done + "/" + asked;
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
 * Read the bin structure that ALREADY exists in the project, AND work out which
 * disk folder each bin is fed from.
 *
 * The structure half is the exact inverse of aip_createStructure. The folder half
 * is the useful part: every footage item remembers the file it came from, so a
 * bin's clips point at the folder that bin is really tracking. That turns "scan
 * the project" into a complete setup — structure and links — instead of a tree
 * you still have to wire up by hand.
 *
 * A folder is only reported when EVERY clip directly in that bin agrees on it.
 * A wrong link is worse than no link: Import would start pulling unrelated files
 * into that bin, which is more work to undo than just linking it yourself.
 *
 * Returns one record per line:  binPath \u0001 folder     (folder may be empty)
 * Tab already separates path segments, so it cannot also separate fields.
 *
 * Label colours are still not read — Premiere exposes setColorLabel but no
 * reliable getter, so the panel would be inventing values.
 */
var AIP_READ_MAX_DEPTH = 8;      // pathological nesting guard
var AIP_READ_MAX_BINS = 400;     // don't try to swallow a monster project
// Written as an escape, never a literal control character: a raw 0x01 in
// source is invisible in every editor and does not survive copy-paste. Same
// reason q() spells out its line terminators instead of embedding them.
var AIP_FIELD_SEP = "\u0001";

// Everything up to the last separator. Premiere hands back native paths, so both
// separators have to be honoured: / on macOS, \ on Windows.
function aip_dirOf(p) {
    var s = String(p);
    var cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return cut > 0 ? s.substring(0, cut) : "";
}

// The folder every clip in this bin shares, or "" if they disagree or there are
// none. Only direct children — a sub-bin has its own row and its own answer.
function aip_binFolder(bin) {
    var seen = "", kids;
    try { kids = bin.children; } catch (e) { return ""; }
    if (!kids) return "";
    for (var i = 0; i < kids.numItems; i++) {
        var it;
        try { it = kids[i]; } catch (e2) { continue; }
        if (!it) continue;
        if (it.type == 2) continue;                     // sub-bin: not this bin's media
        var mp = "";
        // Offline clips, proxies, titles and colour mattes can throw here or hand
        // back nothing. Any of those means "no opinion", not "link to nowhere".
        try { if (typeof it.getMediaPath === "function") mp = String(it.getMediaPath()); } catch (e3) { mp = ""; }
        if (mp === "") continue;
        var dir = aip_dirOf(mp);
        if (dir === "") continue;
        if (seen === "") seen = dir;
        else if (seen != dir) return "";                // disagreement → leave unlinked
    }
    if (seen === "") return "";
    // A link to a folder that no longer exists would make Import fail later with
    // a confusing error. Better to hand back nothing and let Bom point at it.
    try { if (!(new Folder(seen)).exists) return ""; } catch (e4) { return ""; }
    return seen;
}

var AIP_SURVEY_MAX = 5000;       // a project this size is already unusual

/* Every clip in the project, and the file it points at.
 *
 * One record per clip, fields separated by AIP_FIELD_SEP because the bin path
 * itself is tab-joined and a tab here would split it:
 *
 *     nodeId | binPath | name | isSequence | mediaPath
 *
 * Bins are walked but not reported - the panel already knows the structure. A
 * sequence, title or colour matte has no file, so it is flagged and the panel
 * leaves it where it is. An item whose nodeId cannot be read is skipped: it
 * could not be addressed again afterwards, so proposing to move it would be
 * proposing something that cannot be carried out.
 */
function aip_surveyClips() {
    if (!app.project) return "ERR:No project open";
    var out = [], hit = false;
    function walk(parent, prefix, depth) {
        /* Truncation, exactly like the count cap below. Returning quietly
         * here reported a partial answer with an OK: prefix, and the panel
         * then presented it as the whole project. */
        if (depth > AIP_READ_MAX_DEPTH) { hit = true; return; }
        var kids;
        try { kids = parent.children; } catch (e) { return; }
        if (!kids) return;
        for (var i = 0; i < kids.numItems; i++) {
            if (out.length >= AIP_SURVEY_MAX) { hit = true; return; }
            var item;
            try { item = kids[i]; } catch (e2) { continue; }
            if (!item) continue;
            var nm = aip_trim(String(item.name)).replace(/[\t\r\n]/g, " ");
            if (item.type == 2) {                       // a bin: go into it
                if (nm === "") continue;
                walk(item, prefix === "" ? nm : prefix + "\t" + nm, depth + 1);
                continue;
            }
            var id = "";
            try { id = String(item.nodeId); } catch (e3) { id = ""; }
            if (id === "") continue;
            var mp = "";
            try { if (typeof item.getMediaPath === "function") mp = String(item.getMediaPath()); }
            catch (e4) { mp = ""; }
            var seq = false;
            try { if (typeof item.isSequence === "function") seq = !!item.isSequence(); }
            catch (e5) { seq = false; }
            out.push(id + AIP_FIELD_SEP + prefix + AIP_FIELD_SEP + nm + AIP_FIELD_SEP +
                     (seq ? "1" : "0") + AIP_FIELD_SEP + mp);
        }
    }
    try { walk(app.project.rootItem, "", 1); }
    catch (e6) { return "ERR:" + e6.toString(); }
    if (out.length === 0) return "OK:";
    return (hit ? "TRUNC:" : "OK:") + out.join("\n");
}

/* Move clips, one per line: nodeId | targetBinPath.
 *
 * Every item is indexed by nodeId in ONE walk first, so moving two hundred clips
 * is one pass over the project rather than two hundred. The moves happen after
 * that walk finishes, never during it - reparenting while iterating children is
 * how a loop starts skipping items.
 *
 * Returns moved-count | the names it could not move, so the panel can say which
 * rather than reporting a number that quietly does not add up.
 */
function aip_moveClips(blob) {
    if (!app.project) return "ERR:No project open";
    var byId = {};
    (function index(parent, depth) {
        if (depth > AIP_READ_MAX_DEPTH) return;
        var kids;
        try { kids = parent.children; } catch (e) { return; }
        if (!kids) return;
        for (var i = 0; i < kids.numItems; i++) {
            var it;
            try { it = kids[i]; } catch (e2) { continue; }
            if (!it) continue;
            var id = "";
            try { id = String(it.nodeId); } catch (e3) { id = ""; }
            if (id !== "") byId[id] = it;
            if (it.type == 2) index(it, depth + 1);
        }
    })(app.project.rootItem, 1);

    var lines = String(blob).split("\n"), moved = 0, failed = [];
    for (var L = 0; L < lines.length; L++) {
        if (lines[L] === "") continue;
        var parts = lines[L].split(AIP_FIELD_SEP);
        var item = byId[parts[0]];
        if (!item) { failed.push("(a clip that is no longer there)"); continue; }
        var bin = aip_ensureBinPath(String(parts[1] || "").split("\t"));
        if (bin === null) { failed.push(String(item.name)); continue; }
        try { item.moveBin(bin); moved++; }
        catch (eM) { failed.push(String(item.name)); }
    }
    return "" + moved + AIP_FIELD_SEP + failed.join(" | ");
}

function aip_scanProject() {
    if (!app.project) return "ERR:No project open";
    var out = [], hit = false;

    function walk(parent, prefix, depth) {
        /* Truncation, exactly like the count cap below. Returning quietly
         * here reported a partial answer with an OK: prefix, and the panel
         * then presented it as the whole project. */
        if (depth > AIP_READ_MAX_DEPTH) { hit = true; return; }
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
            // A tab or the field separator in a bin name would corrupt the record
            // format, which is the contract with the panel. Fold them to a space
            // rather than emit a record that silently splits.
            name = name.replace(/[\t\r\n\u0001]/g, " ");
            var path = prefix === "" ? name : prefix + "\t" + name;
            out.push(path + AIP_FIELD_SEP + aip_binFolder(item));
            walk(item, path, depth + 1);
        }
    }

    try { walk(app.project.rootItem, "", 1); }
    catch (e3) { return "ERR:" + e3.toString(); }

    if (out.length === 0) return "OK:";                     // valid, just no bins
    return (hit ? "TRUNC:" : "OK:") + out.join("\n");
}

// Kept so an older installed panel talking to a newer host still works.

/*
 * List what is directly inside one bin, so the panel can show a bin's contents
 * without anyone scrolling Premiere's Project panel. Adobe exposes no way to
 * open or scroll to a bin (select() only highlights it), so the contents come
 * here instead of the user going there.
 *
 * One record per line. Fields, separated by U+0001:
 *   0  kind    "B" for a sub-bin, "C" for a clip
 *   1  index   position in this bin's children — how the panel names an item
 *              later, since two clips may share a name but not an index
 *   2  name
 *   3  meta    sub-bins: how many items inside. Clips: the file extension.
 *   4  offline "1" when the media is missing, "" otherwise
 *
 * Index is the identifier on purpose: it survives duplicate names, and it stays
 * valid as long as the bin is not reordered between listing and clicking. If it
 * is, aip_childOf checks the name it was given still matches before acting.
 */
var AIP_MAX_ITEMS = 800;

function aip_extOf(name) {
    var s = String(name), dot = s.lastIndexOf(".");
    if (dot <= 0 || dot === s.length - 1) return "";
    var ext = s.substring(dot + 1);
    if (ext.length > 5 || /[^A-Za-z0-9]/.test(ext)) return "";
    return ext.toUpperCase();
}

function aip_isOffline(item) {
    // isOffline() is the direct answer but is not on every build, so fall back
    // to asking the file system. A clip with no path at all (titles, colour
    // mattes, sequences) is not offline — it has no media to lose.
    try { if (typeof item.isOffline === "function") return item.isOffline() ? "1" : ""; } catch (e) {}
    var mp = "";
    try { if (typeof item.getMediaPath === "function") mp = String(item.getMediaPath()); } catch (e2) { mp = ""; }
    if (mp === "") return "";
    try { return (new File(mp)).exists ? "" : "1"; } catch (e3) { return ""; }
}

function aip_binContents(binPath) {
    if (!app.project) return "ERR:No project open";
    var segs = String(binPath).split("\t");
    var bin = aip_findBinPath(segs);
    if (bin === null) return "NOBIN";
    var kids;
    try { kids = bin.children; } catch (e) { return "ERR:" + e.toString(); }
    if (!kids) return "OK:";

    var out = [], hit = false;
    for (var i = 0; i < kids.numItems; i++) {
        if (out.length >= AIP_MAX_ITEMS) { hit = true; break; }
        var item;
        try { item = kids[i]; } catch (e2) { continue; }
        if (!item) continue;
        var name = aip_trim(String(item.name));
        if (name === "") continue;
        name = name.replace(/[\t\r\n\u0001]/g, " ");        // never break the record format
        var kind = (item.type == 2) ? "B" : "C";
        var meta = "";
        if (kind === "B") {
            try { meta = String(item.children ? item.children.numItems : 0); } catch (e3) { meta = "0"; }
        } else {
            meta = aip_extOf(name);
        }
        var off = (kind === "B") ? "" : aip_isOffline(item);
        /* The source in and out points, in seconds.
         *
         * A clip nobody has trimmed still answers: in is 0 and out is its whole
         * length, which is the clip's duration and worth showing on its own. Sent
         * as raw seconds because formatting mm:ss in ES3 is more string work than
         * it is worth, and the panel has to decide what to draw anyway.
         *
         * Every accessor here is behind a typeof test and a try. A still, a
         * synthetic, an offline clip and a bin all answer differently or not at
         * all, and one throwing must not cost the whole listing. */
        /* In, out, duration — AND a note saying where each number came from.
         *
         * I have now guessed at this API twice and been wrong twice. ProjectItem's
         * time accessors are not documented consistently across Premiere versions:
         * getInPoint/getOutPoint take an optional mediaType and may answer
         * differently with none, and getDuration may not exist on a ProjectItem at
         * all — in which case my last "fix" did nothing, because it was behind a
         * typeof test that silently failed.
         *
         * So this stops guessing and reports. Each value carries a one-letter tag
         * saying which accessor produced it, and the panel puts the lot in the
         * tooltip. One hover tells us what Premiere really said.
         */
        var tin = "", tout = "", tdur = "", dbg = "";
        if (kind === "C") {
            // in / out, no mediaType — what the panel has been using.
            try {
                if (typeof item.getInPoint === "function") {
                    var ip = item.getInPoint();
                    if (ip && typeof ip.seconds !== "undefined") { tin = String(ip.seconds); dbg += "i"; }
                    else if (ip && typeof ip.ticks !== "undefined") { tin = String(Number(ip.ticks) / 254016000000); dbg += "I"; }
                } else { dbg += "-"; }
            } catch (eI) { dbg += "x"; }
            try {
                if (typeof item.getOutPoint === "function") {
                    var op = item.getOutPoint();
                    if (op && typeof op.seconds !== "undefined") { tout = String(op.seconds); dbg += "o"; }
                    else if (op && typeof op.ticks !== "undefined") { tout = String(Number(op.ticks) / 254016000000); dbg += "O"; }
                } else { dbg += "-"; }
            } catch (eO) { dbg += "x"; }
            /* Duration, three ways. getDuration first, then the projectItem's own
             * duration property, then the video stream's out point — whichever
             * answers first wins and the tag says which. */
            try {
                if (typeof item.getDuration === "function") {
                    var dr = item.getDuration();
                    if (dr && typeof dr.seconds !== "undefined") { tdur = String(dr.seconds); dbg += "d"; }
                    else if (dr && typeof dr.ticks !== "undefined") { tdur = String(Number(dr.ticks) / 254016000000); dbg += "D"; }
                }
            } catch (eD) { dbg += "x"; }
            if (tdur === "") {
                try {
                    if (item.duration && typeof item.duration.seconds !== "undefined") {
                        tdur = String(item.duration.seconds); dbg += "p";
                    }
                } catch (eP) { dbg += "x"; }
            }
            if (tdur === "") {
                try {
                    if (typeof item.getOutPoint === "function") {
                        var ov = item.getOutPoint(1);          // 1 = video stream
                        if (ov && typeof ov.seconds !== "undefined") { tdur = String(ov.seconds); dbg += "v"; }
                    }
                } catch (eV) { dbg += "x"; }
            }
            if (tdur === "") dbg += "?";
        }
        out.push(kind + AIP_FIELD_SEP + i + AIP_FIELD_SEP + name + AIP_FIELD_SEP + meta +
                 AIP_FIELD_SEP + off + AIP_FIELD_SEP + tin + AIP_FIELD_SEP + tout +
                 AIP_FIELD_SEP + tdur + AIP_FIELD_SEP + dbg);
    }
    if (out.length === 0) return "OK:";
    return (hit ? "TRUNC:" : "OK:") + out.join("\n");
}

/*
 * Resolve one child of a bin by index, refusing if the name no longer matches.
 * The panel lists a bin once and then acts on it later; if the project changed
 * underneath, acting on whatever now sits at that index would select the wrong
 * clip silently. Better to fail and let the panel re-list.
 */
function aip_childOf(binPath, index, expectName) {
    var bin = aip_findBinPath(String(binPath).split("\t"));
    if (bin === null) return null;
    var kids;
    try { kids = bin.children; } catch (e) { return null; }
    if (!kids) return null;
    var i = parseInt(index, 10);
    if (isNaN(i) || i < 0 || i >= kids.numItems) return null;
    var item;
    try { item = kids[i]; } catch (e2) { return null; }
    if (!item) return null;
    var have = aip_trim(String(item.name)).replace(/[\t\r\n\u0001]/g, " ");
    if (have != String(expectName)) return null;
    return item;
}

/*
 * Put a clip into the open sequence at the playhead.
 *
 * This is the point of the contents list: Premiere's Project panel cannot be
 * navigated from here (see aip_revealBin), so the way to make that not matter
 * is to remove the reason to go there. Sequence editing IS scriptable, so the
 * clip can go straight from the list into the timeline.
 *
 * insertClip, not overwriteClip: insert ripples what is already on the track
 * along, overwrite destroys whatever sits under the playhead. Nothing here
 * should be able to silently delete part of an edit.
 *
 * Returns "OK:<track>", or STALE / ISBIN / NOSEQ / NOTRACK / ERR:...
 */
/* What the open sequence has to offer, so the panel can draw a track picker
 * without guessing. One call, not one per track.
 *
 * Returns  videoCount | audioCount | sequenceName  — or NOSEQ.
 */
function aip_seqTracks() {
    if (!app.project) return "ERR:No project open";
    var seq = null;
    try { seq = app.project.activeSequence; } catch (e) { seq = null; }
    if (!seq) return "NOSEQ";
    var v = 0, a = 0, nm = "";
    try { v = seq.videoTracks.numTracks; } catch (e1) { v = 0; }
    try { a = seq.audioTracks.numTracks; } catch (e2) { a = 0; }
    try { nm = String(seq.name); } catch (e3) { nm = ""; }
    return "OK:" + v + AIP_FIELD_SEP + a + AIP_FIELD_SEP + nm;
}

/* Put a clip on the timeline at the playhead.
 *
 * trackIdx is ZERO-BASED, the way videoTracks[] is indexed, while the panel shows
 * it one-based as V1/A1 — the conversion happens there so this stays the same
 * shape as the API it calls.
 *
 * mode is "over" for overwriteClip, anything else for insertClip. Insert ripples
 * everything to the right to make room; overwrite replaces whatever is under the
 * playhead and is the destructive one, which is why the panel keeps it behind a
 * modifier rather than making it the default.
 */
function aip_insertToTimeline(binPath, index, expectName, isAudio, trackIdx, mode) {
    var item = aip_childOf(binPath, index, expectName);
    if (item === null) return "STALE";
    if (item.type == 2) return "ISBIN";

    var seq = null;
    try { seq = app.project.activeSequence; } catch (e) { seq = null; }
    if (!seq) return "NOSEQ";

    var at = null;
    try { at = seq.getPlayerPosition(); } catch (e1) { at = null; }
    if (at === null) return "ERR:could not read the playhead";

    var wantAudio = (String(isAudio) === "1");
    var tracks = null, kind = wantAudio ? "A" : "V";
    try { tracks = wantAudio ? seq.audioTracks : seq.videoTracks; }
    catch (e2) { tracks = null; }
    if (!tracks || tracks.numTracks < 1) return "NOTRACK";

    /* Clamp rather than fail. The panel remembers a chosen track per project, and
     * the sequence you open next may have fewer — silently using the last one is
     * better than refusing, and the reply says which it used either way. */
    var idx = parseInt(trackIdx, 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx > tracks.numTracks - 1) idx = tracks.numTracks - 1;

    var over = (String(mode) === "over");
    try {
        if (over) tracks[idx].overwriteClip(item, at);
        else tracks[idx].insertClip(item, at);
    } catch (e3) {
        return "ERR:" + e3.toString();
    }
    // The panel reports what actually happened, not what was asked for.
    return "OK:" + kind + (idx + 1) + AIP_FIELD_SEP + (over ? "over" : "insert");
}

function aip_selectChild(binPath, index, expectName) {
    var item = aip_childOf(binPath, index, expectName);
    if (item === null) return "STALE";
    try {
        if (typeof item.select !== "function") return "NOSUPPORT";
        item.select();
    } catch (e) { return "ERR:" + e.toString(); }
    return "OK";
}

/*
 * Open a clip in the Source Monitor. This is the one piece of real navigation
 * Adobe does expose, which is why it is worth having: it previews a clip
 * without the Project panel being involved at all.
 */
function aip_openChildInSource(binPath, index, expectName) {
    var item = aip_childOf(binPath, index, expectName);
    if (item === null) return "STALE";
    if (item.type == 2) return "ISBIN";
    try {
        if (!app.sourceMonitor || typeof app.sourceMonitor.openProjectItem !== "function") return "NOSUPPORT";
        app.sourceMonitor.openProjectItem(item);
    } catch (e) { return "ERR:" + e.toString(); }
    return "OK";
}

// The active project's key: its file path if saved, else its name.
function aip_projectKey() {
    if (!app.project) return "";
    try { if (app.project.path && String(app.project.path) !== "") return String(app.project.path); } catch (e) {}
    try { if (app.project.name) return String(app.project.name); } catch (e2) {}
    return "";
}
