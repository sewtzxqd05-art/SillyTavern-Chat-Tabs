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
$stBackupRoot = Join-Path $stInstallRoot ('.chat-tabs-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
foreach ($stCopy in $stCopies) {
    $stDestination = Join-Path $stInstallRoot $stCopy.Target
    if (Test-Path -LiteralPath $stDestination) {
        $stExisting = Get-Item -LiteralPath $stDestination
        if ($stExisting.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw ('Refusing to overwrite a link: ' + $stDestination)
        }
        New-Item -ItemType Directory -Path $stBackupRoot -Force | Out-Null
        Copy-Item -LiteralPath $stDestination -Destination (Join-Path $stBackupRoot $stCopy.Backup) -Recurse
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
elseif ($BackendOnly) { Write-Output 'Chat Tabs 1.3.0 companion installed. Restart SillyTavern and refresh all pages.' }
else { Write-Output 'Chat Tabs 1.3.0 installed. Restart SillyTavern and refresh all pages. Open the magic wand menu > Multi-chat.' }
if (Test-Path -LiteralPath $stBackupRoot) { Write-Output ('Previous plugin files backed up to: ' + $stBackupRoot) }
