# Omni Link — one-line installer for Windows.
#
#   irm https://raw.githubusercontent.com/mill2nn/omni-link-releases/main/install.ps1 | iex
#
# Downloads the panel straight into Premiere's extensions folder. No zip and no
# unzip, so nothing gets blocked as a downloaded executable.
#
# No administrator rights needed: everything lives under the user profile and
# PlayerDebugMode is written to HKCU.

$ErrorActionPreference = "Stop"

$Owner  = "mill2nn"
$Repo   = "omni-link-releases"
$Branch = "main"
$Bundle = "com.bom.autoimport2"
$Raw    = "https://raw.githubusercontent.com/$Owner/$Repo/$Branch"

# Exactly the files the panel needs to run. Kept in step with the publish script.
$Files = @(
    "client/index.html",
    "client/main.js",
    "client/style.css",
    "client/CSInterface.js",
    "jsx/host.jsx",
    "CSXS/manifest.xml"
)

$Dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\$Bundle"

Write-Host ""
Write-Host "======================================"
Write-Host "  Installing Omni Link for Premiere"
Write-Host "======================================"
Write-Host ""

try {
    $latest = Invoke-RestMethod -Uri "$Raw/latest.json" -UseBasicParsing
    $ver = $latest.version
} catch {
    Write-Host "  ERROR: couldn't reach GitHub. Check your connection and try again."
    exit 1
}
if (-not $ver) { Write-Host "  ERROR: the release file is unreadable."; exit 1 }
Write-Host "  Version $ver"

if (Get-Process "Adobe Premiere Pro" -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "  NOTE: Premiere Pro is running. Panels are only loaded at startup,"
    Write-Host "        so quit and reopen it after this finishes."
}

# ---- 1. let Premiere load unsigned panels --------------------------------
Write-Host ""
Write-Host "  1/2  Enabling unsigned panels..."
Write-Host "       (this lets Premiere load UNSIGNED extensions - all of them, not"
Write-Host "        just this one.)"
# Must be a STRING "1", not a DWORD — Adobe reads it as text.
foreach ($v in 6..13) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -Type String
}

# ---- 2. download into a staging folder, then swap ------------------------
# Staged first so a dropped connection halfway through cannot leave a
# half-written panel where a working one used to be.
Write-Host "  2/2  Downloading the panel..."
$Stage = Join-Path ([System.IO.Path]::GetTempPath()) ("omnilink-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

foreach ($f in $Files) {
    $target = Join-Path $Stage ($f -replace "/", "\")
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    try {
        Invoke-WebRequest -Uri "$Raw/$f" -OutFile $target -UseBasicParsing
    } catch {
        Write-Host ""
        Write-Host "  ERROR: failed to download $f - nothing was changed."
        Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
        exit 1
    }
    if ((Get-Item $target).Length -eq 0) {
        Write-Host ""
        Write-Host "  ERROR: $f came back empty - nothing was changed."
        Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
        exit 1
    }
}

# Cheap sanity check: if this isn't the panel, don't install it.
if (-not (Select-String -Path (Join-Path $Stage "client\main.js") -Pattern "var VERSION" -Quiet)) {
    Write-Host ""
    Write-Host "  ERROR: that download doesn't look like Omni Link. Nothing was changed."
    Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
    exit 1
}

if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Path $Dest -Force | Out-Null
Copy-Item -Path (Join-Path $Stage "*") -Destination $Dest -Recurse -Force
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Done - Omni Link $ver installed."
Write-Host ""
Write-Host "  Next:"
Write-Host "   * Restart Premiere Pro."
Write-Host "   * Open it from  Window > Extensions > Omni Link"
Write-Host ""
Write-Host "  After that the panel updates itself: it checks on launch and offers"
Write-Host "  any newer version with a button."
Write-Host ""
Write-Host "  To remove it:"
Write-Host "    Remove-Item -Recurse -Force `"$Dest`""
Write-Host ""
