param(
  [switch]$NoSign,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$desktopRoot = Split-Path -Parent $PSScriptRoot
Push-Location $desktopRoot

try {
  Write-Host "[release-win] Desktop root: $desktopRoot"

  if (-not $SkipTests) {
    Write-Host "[release-win] Step 1/4: Running desktop tests..."
    cmd /c "set CI=true&&npm test -- --watch=false --runInBand"
  } else {
    Write-Host "[release-win] Step 1/4: Skipped tests (--SkipTests)."
  }

  Write-Host "[release-win] Step 2/4: Building Windows installer..."
  if ($NoSign) {
    cmd /c "set CSC_IDENTITY_AUTO_DISCOVERY=false&&npm run build:win:unsigned"
  } else {
    cmd /c "npm run build:win"
  }

  $outDir = Join-Path $desktopRoot "out"
  if (-not (Test-Path $outDir)) {
    throw "[release-win] Build output directory not found: $outDir"
  }

  $exeArtifacts = @(Get-ChildItem -Path $outDir -File -Filter *.exe)
  if ($exeArtifacts.Count -eq 0) {
    throw "[release-win] No .exe artifacts were generated in $outDir"
  }

  Write-Host "[release-win] Step 3/4: Generating SHA256 checksums..."
  $hashLines = @()
  foreach ($artifact in $exeArtifacts) {
    $hash = (Get-FileHash -Path $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashLines += "$hash *$($artifact.Name)"
  }
  $hashFile = Join-Path $outDir "SHA256SUMS.txt"
  Set-Content -Path $hashFile -Value $hashLines -Encoding Ascii
  Write-Host "[release-win] Wrote $hashFile"

  if ($NoSign) {
    Write-Host "[release-win] Step 4/4: Skipped signature verification (--NoSign)."
  } else {
    Write-Host "[release-win] Step 4/4: Verifying Authenticode signatures..."
    foreach ($artifact in $exeArtifacts) {
      $signature = Get-AuthenticodeSignature -FilePath $artifact.FullName
      if ($signature.Status -ne "Valid") {
        throw "[release-win] Signature check failed for $($artifact.Name): $($signature.Status)"
      }
      Write-Host "[release-win] Signature valid: $($artifact.Name)"
    }
  }

  Write-Host "[release-win] Completed."
  Write-Host "[release-win] Artifacts:"
  Get-ChildItem -Path $outDir -File | Where-Object { $_.Extension -in ".exe", ".yml", ".blockmap", ".txt" } | ForEach-Object {
    Write-Host "  - $($_.Name)"
  }
} finally {
  Pop-Location
}
