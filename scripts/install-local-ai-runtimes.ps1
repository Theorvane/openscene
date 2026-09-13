$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.local-runtimes'))
if (-not $localRoot.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The managed runtime directory escaped the OpenScene checkout.'
}

$whisperTag = 'b4938'
$whisperArchiveSha256 = 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d'
$whisperCudaArchiveSha256 = 'c1b17166e1e31a91cc8e9c1f910d3785e3ce757bb2958bf9dce13fdb4880005f'
$whisperModelCommit = '5359861c739e955e79d9a303bcbc70fb988958b1'
$whisperModelSha256 = '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
$whisperRoot = Join-Path $localRoot "whisper.cpp\$whisperTag"
$archivePath = Join-Path $whisperRoot 'whisper-bin-x64.zip'
$binaryRoot = Join-Path $whisperRoot 'bin'
$cudaArchivePath = Join-Path $whisperRoot 'whisper-cublas-12.4.0-bin-x64.zip'
$cudaBinaryRoot = Join-Path $whisperRoot 'bin-cuda'
$modelRoot = Join-Path $whisperRoot 'models'
$modelPath = Join-Path $modelRoot 'ggml-small.bin'

function Test-Sha256([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() -eq $Expected
}

function Get-VerifiedFile([string]$Url, [string]$Destination, [string]$ExpectedSha256) {
  if (Test-Sha256 $Destination $ExpectedSha256) {
    Write-Host "Verified existing $([System.IO.Path]::GetFileName($Destination))"
    return
  }
  $partial = "$Destination.download"
  if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  Write-Host "Downloading $([System.IO.Path]::GetFileName($Destination))..."
  & curl.exe -fL --retry 3 --output $partial $Url
  if ($LASTEXITCODE -ne 0) { throw "Download failed with exit code $LASTEXITCODE." }
  if (-not (Test-Sha256 $partial $ExpectedSha256)) {
    Remove-Item -LiteralPath $partial -Force
    throw "Checksum verification failed for $Destination"
  }
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Expand-WhisperArchive([string]$Archive, [string]$Destination) {
  $existingCli = Get-ChildItem -LiteralPath $Destination -Recurse -File -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $existingCli) { return $existingCli }
  $extractRoot = "$Destination-extracting"
  $resolvedExtractRoot = [System.IO.Path]::GetFullPath($extractRoot)
  if (-not $resolvedExtractRoot.StartsWith($whisperRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The temporary extraction directory escaped the managed Whisper directory.'
  }
  if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $Archive -DestinationPath $extractRoot
  $extractedCli = Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter 'whisper-cli.exe' | Select-Object -First 1
  if ($null -eq $extractedCli) { throw 'The official archive did not contain whisper-cli.exe.' }
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  Move-Item -LiteralPath $extractRoot -Destination $Destination
  return Get-ChildItem -LiteralPath $Destination -Recurse -File -Filter 'whisper-cli.exe' | Select-Object -First 1
}

New-Item -ItemType Directory -Path $whisperRoot, $modelRoot -Force | Out-Null
Get-VerifiedFile `
  "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperTag/whisper-bin-x64.zip" `
  $archivePath `
  $whisperArchiveSha256

$cpuWhisperCli = Expand-WhisperArchive $archivePath $binaryRoot
$whisperCli = $cpuWhisperCli

$installCuda = [Environment]::GetEnvironmentVariable('OPENSCENE_WHISPER_CUDA') -match '^(1|true|yes|on)$'
if ($installCuda) {
  Write-Host 'OPENSCENE_WHISPER_CUDA is enabled; installing the official CUDA 12.4 Whisper runtime...'
  Get-VerifiedFile `
    "https://github.com/ggml-org/whisper.cpp/releases/download/$whisperTag/whisper-cublas-12.4.0-bin-x64.zip" `
    $cudaArchivePath `
    $whisperCudaArchiveSha256
  $whisperCli = Expand-WhisperArchive $cudaArchivePath $cudaBinaryRoot
}

Get-VerifiedFile `
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/$whisperModelCommit/ggml-small.bin" `
  $modelPath `
  $whisperModelSha256

& $whisperCli.FullName --version
if ($LASTEXITCODE -ne 0) { throw 'whisper-cli health check failed.' }

$configuredVieNeu = [Environment]::GetEnvironmentVariable('OPENSCENE_VIENEU_PROJECT_DIR')
$vieNeuRoot = if (-not [string]::IsNullOrWhiteSpace($configuredVieNeu)) {
  [System.IO.Path]::GetFullPath($configuredVieNeu)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repoRoot '..\VieNeu-TTS'))
}
$uv = Get-Command uv -ErrorAction SilentlyContinue
if ((Test-Path -LiteralPath (Join-Path $vieNeuRoot 'pyproject.toml') -PathType Leaf) -and $null -ne $uv) {
  Write-Host 'Synchronizing the VieNeu-TTS CPU/ONNX environment...'
  & $uv.Source sync --directory $vieNeuRoot
  if ($LASTEXITCODE -ne 0) { throw "VieNeu-TTS uv sync failed with exit code $LASTEXITCODE." }
} elseif (-not (Test-Path -LiteralPath (Join-Path $vieNeuRoot '.venv\Scripts\python.exe') -PathType Leaf)) {
  Write-Warning 'VieNeu-TTS was not found. Clone it beside OpenScene or set OPENSCENE_VIENEU_PROJECT_DIR, install uv, then run this command again.'
}

Write-Host "Local AI runtime setup complete. Whisper: $($whisperCli.FullName)"
Write-Host "Whisper model: $modelPath"
Write-Host "VieNeu checkout: $vieNeuRoot"
