param(
  [string]$Sdk = "dotnet",
  [string]$RuntimeCab,
  [string]$Output = "dist/BoidsWallpaper-win-x64",
  [switch]$NoArchive
)
$ErrorActionPreference = "Stop"
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
