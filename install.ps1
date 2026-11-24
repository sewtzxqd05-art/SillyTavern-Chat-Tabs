param(
    [string]$TavernPath = 'D:\SillyTavern',
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
if ($FrontendOnly -and $BackendOnly) { throw 'Choose either FrontendOnly or BackendOnly, not both.' }
if ($Interactive) {
    $stChosenPath = Read-Host ('SillyTavern folder [Enter = ' + $TavernPath + ']')
    if (-not [string]::IsNullOrWhiteSpace($stChosenPath)) { $TavernPath = $stChosenPath.Trim().Trim('"') }
}
$stInstallRoot = (Resolve-Path -LiteralPath $TavernPath).Path
$stSourceRoot = $PSScriptRoot
$stPackageFile = Join-Path $stInstallRoot 'package.json'
if (-not (Test-Path -LiteralPath $stPackageFile -PathType Leaf)) {
    throw 'Select the SillyTavern folder that contains package.json and server.js.'
}
$stPackage = Get-Content -LiteralPath $stPackageFile -Raw | ConvertFrom-Json
if ($stPackage.name -ne 'sillytavern') { throw 'The selected folder is not SillyTavern.' }
if ([version]$stPackage.version -lt [version]'1.19.0') {
    throw 'Chat Tabs requires SillyTavern 1.19.0 or newer. Version 1.19.0 was tested.'
}
foreach ($stRequiredFile in @('server.js','src/server-startup.js','src/endpoints/secrets.js','public/index.html','config.yaml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stInstallRoot $stRequiredFile) -PathType Leaf)) {
        throw ('Required SillyTavern file is missing: ' + $stRequiredFile)
    }
}
$stConfig = Get-Content -LiteralPath (Join-Path $stInstallRoot 'config.yaml') -Raw
if (-not $FrontendOnly -and $stConfig -notmatch '(?m)^enableServerPlugins:\s*true\s*(?:#.*)?$') {
    throw 'Set enableServerPlugins: true in SillyTavern/config.yaml, then run this installer again.'
}

$stCopies = @(
    @{ Source = 'server/chat-tabs'; Target = 'plugins/chat-tabs'; Backup = 'server' },
    @{ Source = 'frontend/chat-tabs'; Target = 'public/scripts/extensions/third-party/chat-tabs'; Backup = 'frontend' }
)
if ($FrontendOnly) { $stCopies = @($stCopies | Where-Object { $_.Backup -eq 'frontend' }) }
if ($BackendOnly) { $stCopies = @($stCopies | Where-Object { $_.Backup -eq 'server' }) }
if (-not $BackendOnly) {
    $stCandidates = @((Join-Path $stInstallRoot 'public/scripts/extensions/third-party/SillyTavern-Chat-Tabs'))
    $stData = Join-Path $stInstallRoot 'data'
    if (Test-Path -LiteralPath $stData) {
        foreach ($stUser in Get-ChildItem -LiteralPath $stData -Directory) {
            foreach ($stName in @('chat-tabs', 'SillyTavern-Chat-Tabs', 'third-party/chat-tabs', 'third-party/SillyTavern-Chat-Tabs')) {
                $stCandidates += Join-Path $stUser.FullName ('extensions/' + $stName)
            }
        }
    }
    foreach ($stCandidate in $stCandidates) {
        if (Test-Path -LiteralPath $stCandidate) { throw ('Another Chat Tabs installation exists. Keep one frontend installation before continuing: ' + $stCandidate) }
    }
}
foreach ($stCopy in $stCopies) {
    $stSource = Join-Path $stSourceRoot $stCopy.Source
    if (-not (Test-Path -LiteralPath $stSource -PathType Container)) { throw ('Installation source missing: ' + $stSource) }
    $stTarget = [System.IO.Path]::GetFullPath((Join-Path $stInstallRoot $stCopy.Target))
    if ($stSourceRoot -eq $stTarget -or $stSourceRoot.StartsWith($stTarget + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Run the installer from a separate extracted package, outside the plugin destination.'
    }
}
$stBackupRoot = Join-Path $stInstallRoot ('.chat-tabs-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
foreach ($stCopy in $stCopies) {
    $stDestination = Join-Path $stInstallRoot $stCopy.Target
    if (Test-Path -LiteralPath $stDestination) {
        $stExisting = Get-Item -LiteralPath $stDestination
        if ($stExisting.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw ('Refusing to overwrite a link: ' + $stDestination)
        }
        New-Item -ItemType Directory -Path $stBackupRoot -Force | Out-Null
        $stResolved = (Resolve-Path -LiteralPath $stDestination).ProviderPath
        $stExpected = [System.IO.Path]::GetFullPath((Join-Path $stInstallRoot $stCopy.Target))
        if ($stResolved -ne $stExpected -or -not $stResolved.StartsWith($stInstallRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw ('Refusing unexpected installation path: ' + $stResolved)
        }
        Move-Item -LiteralPath $stResolved -Destination (Join-Path $stBackupRoot $stCopy.Backup)
    }
}
foreach ($stCopy in $stCopies) {
    $stDestination = Join-Path $stInstallRoot $stCopy.Target
    New-Item -ItemType Directory -Path $stDestination -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $stSourceRoot $stCopy.Source) | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $stDestination -Recurse -Force
    }
    Write-Output ('Installed: ' + $stCopy.Target)
}
Write-Output ('SillyTavern version: ' + $stPackage.version)
if ($FrontendOnly) { Write-Output 'Frontend installed. Refresh the page. Audio and screen wake lock are available without the server plugin.' }
elseif ($BackendOnly) { Write-Output 'Chat Tabs 1.6.0-beta.1 companion installed. Restart SillyTavern and refresh all pages.' }
else { Write-Output 'Chat Tabs 1.6.0-beta.1 installed. Restart SillyTavern and refresh all pages. Open the magic wand menu > Multi-chat.' }
if (Test-Path -LiteralPath $stBackupRoot) { Write-Output ('Previous plugin files backed up to: ' + $stBackupRoot) }
