param(
  [string]$Sdk,
  [string]$RuntimeCab,
  [string]$Output = "dist/BoidsWallpaper-win-x64",
  [switch]$NoArchive
)
$ErrorActionPreference = "Stop"

function Test-HasSdk([string]$Exe) {
  if (-not (Test-Path $Exe)) { return $false }
  $sdkList = & $Exe --list-sdks 2>$null
  return ($LASTEXITCODE -eq 0) -and ($sdkList -match '\d+\.\d+') -and ($sdkList -notmatch 'No SDKs were found')
}

function Resolve-DotnetSdk([string]$Explicit) {
  if ($Explicit) {
    if (-not (Test-HasSdk $Explicit)) { throw "'$Explicit' has no usable .NET SDK." }
    return $Explicit
  }
  $candidates = @(
    "$env:USERPROFILE\.dotnet\dotnet.exe",
    "$env:LOCALAPPDATA\Microsoft\dotnet\dotnet.exe",
    "$env:ProgramFiles\dotnet\dotnet.exe",
    "dotnet"
  )
  foreach ($candidate in $candidates) {
    if (Test-HasSdk $candidate) { return $candidate }
  }
  throw "No .NET SDK found. Install one (e.g. winget install Microsoft.DotNet.SDK.8) or pass -Sdk <path-to-dotnet.exe>."
}

$Sdk = Resolve-DotnetSdk $Sdk
Write-Host "Using SDK: $Sdk"
# dotnet publish never removes stale files: leftovers from a folder publish would shadow the bundle.
if (Test-Path $Output) {
  Get-ChildItem $Output -Force | Where-Object { $_.Name -ne 'runtime' } | Remove-Item -Recurse -Force
}
& $Sdk publish "windows/Boids.Desktop/Boids.Desktop.csproj" -c Release -r win-x64 --self-contained true -o $Output
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
if ($RuntimeCab) {
  $runtime = Join-Path $Output "runtime"
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  New-Item -ItemType Directory $runtime -Force | Out-Null
  & "$env:WINDIR\System32\expand.exe" $RuntimeCab -F:* $runtime | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WebView2 runtime extraction failed" }
  $exe = Get-ChildItem $runtime -Filter msedgewebview2.exe -Recurse | Select-Object -First 1
  if (-not $exe) { throw "Extracted runtime is missing msedgewebview2.exe" }
  if ($exe.Directory.FullName -ne (Resolve-Path $runtime).Path) {
    Get-ChildItem $exe.Directory.FullName -Force | Move-Item -Destination $runtime -Force
    Remove-Item $exe.Directory.FullName -Recurse -Force
  }
}
if (-not $NoArchive) {
  if (Test-Path "$Output.zip") { Remove-Item "$Output.zip" -Force }
  Compress-Archive "$Output/*" "$Output.zip"
}
