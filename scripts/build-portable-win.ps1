param(
  [switch]$SkipNextBuild
)

$ErrorActionPreference = "Stop"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pkg = Get-Content (Join-Path $repoRoot "package.json") -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
$pkgName = "TradeLoom-v$version-win-x64"
$distDir = Join-Path $repoRoot "dist"
$stageDir = Join-Path $distDir $pkgName
$appDir = Join-Path $stageDir "app"
$zipPath = Join-Path $distDir "$pkgName.zip"

Write-Host "=== Building $pkgName (Symlink-Free Windows Portable) ===" -ForegroundColor Cyan

# 1. Production build
if (-not $SkipNextBuild) {
  Write-Host "[1/6] Running pnpm run build..."
  & pnpm --dir $repoRoot run build
  if ($LASTEXITCODE -ne 0) { throw "Next.js build failed ($LASTEXITCODE)" }
}
if (-not (Test-Path (Join-Path $repoRoot ".next\BUILD_ID"))) {
  throw ".next\BUILD_ID missing. Run without -SkipNextBuild."
}

# 2. Clean staging directory
Write-Host "[2/6] Preparing clean staging directory: $stageDir"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Force -Path $stageDir, $appDir, "$stageDir\runtime", "$stageDir\workspace" | Out-Null

# 3. Copy production Next.js output (excluding .next\cache!), skills, samples, minimal package.json
Write-Host "[3/6] Copying production .next output, skills, samples, and server.js..."
New-Item -ItemType Directory -Force -Path "$appDir\.next" | Out-Null
Get-ChildItem (Join-Path $repoRoot ".next") | Where-Object { $_.Name -notin @("cache", "standalone", "trace") } | ForEach-Object {
  Copy-Item $_.FullName "$appDir\.next" -Recurse -Force
}
Copy-Item (Join-Path $repoRoot "skills") "$appDir\skills" -Recurse -Force
Copy-Item (Join-Path $repoRoot "samples") "$appDir\samples" -Recurse -Force
New-Item -ItemType Directory -Force -Path "$appDir\scripts", "$appDir\docs\tradeloom-agent-skill" | Out-Null
Copy-Item (Join-Path $repoRoot "scripts\tradeloom-mcp-server.mjs") "$appDir\scripts\tradeloom-mcp-server.mjs" -Force
Copy-Item (Join-Path $repoRoot "docs\tradeloom-agent-skill\SKILL.md") "$appDir\docs\tradeloom-agent-skill\SKILL.md" -Force
Copy-Item (Join-Path $repoRoot "scripts\portable-templates\next.config.mjs") "$appDir\next.config.mjs" -Force
Copy-Item (Join-Path $repoRoot "scripts\portable-templates\app-server.js") "$appDir\server.js" -Force

# Write minimal prod-only package.json for hoisted flat install
$prodPkg = [ordered]@{
  name = $pkg.name
  version = $pkg.version
  private = $true
  dependencies = $pkg.dependencies
}
[System.IO.File]::WriteAllText("$appDir\package.json", ($prodPkg | ConvertTo-Json -Depth 5), $utf8NoBom)

Write-Host "    Installing flat symlink-free production dependencies..."
& pnpm --dir $appDir install --prod --config.node-linker=hoisted --config.symlink=false --config.package-import-method=copy --no-frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Hoisted production dependency install failed ($LASTEXITCODE)" }
# Trim unused TypeScript / map / large doc bloat if any
Remove-Item "$appDir\pnpm-lock.yaml","$appDir\node_modules\.modules.yaml" -Force -ErrorAction SilentlyContinue
# Prune build-only / client-bundled bloat to keep portable ZIP sleek (~70 MB)
foreach ($prune in @("@next\swc-win32-x64-msvc", "lucide-react", "@napi-rs", "@img", ".bin")) {
  $pp = Join-Path "$appDir\node_modules" $prune
  if (Test-Path $pp) { Remove-Item $pp -Recurse -Force -ErrorAction SilentlyContinue }
}
# Also trim huge dev/source-map/types files inside next & pdfjs-dist
Get-ChildItem "$appDir\node_modules" -Recurse -Include "*.map","*.d.ts","*.d.mts" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# 4. Bundle portable node.exe
$nodeExe = (Get-Command node).Source
Write-Host "[4/6] Bundling portable Node runtime: $nodeExe"
Copy-Item $nodeExe "$stageDir\runtime\node.exe" -Force

# 5. Generate branded .ico & compile native zero-console TradeLoom.exe launcher
Write-Host "[5/6] Compiling native Windows launcher TradeLoom.exe..."
Add-Type -AssemblyName System.Drawing
$icoPath = Join-Path $distDir "tradeloom.ico"
$bmp = New-Object System.Drawing.Bitmap(64, 64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(24, 25, 27))
$borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 95, 139), 3.5)
$g.DrawRectangle($borderPen, 4, 4, 55, 55)
$ivoryPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(247, 246, 243), 4.8)
$ivoryPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$ivoryPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($ivoryPen, 16, 20, 48, 20)
$g.DrawLine($ivoryPen, 32, 20, 32, 44)
$linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(91, 155, 213), 4.5)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pts = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point(15, 42)),
  (New-Object System.Drawing.Point(25, 33)),
  (New-Object System.Drawing.Point(35, 39)),
  (New-Object System.Drawing.Point(49, 26))
)
$g.DrawLines($linePen, $pts)
$ivoryPen.Dispose(); $borderPen.Dispose(); $linePen.Dispose()
$g.Dispose()
$pngStream = New-Object System.IO.MemoryStream
$bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$bmp.Dispose(); $pngStream.Dispose()
$icoStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoStream)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([byte]64); $bw.Write([byte]64); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length); $bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())
$bw.Dispose(); $icoStream.Dispose()

$csc = Get-ChildItem 'C:\Windows\Microsoft.NET\Framework64\v4.*\csc.exe' | Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) { throw "Windows .NET csc.exe not found" }
$launcherSrc = Join-Path $repoRoot "scripts\launcher\TradeLoomLauncher.cs"
$exeOut = Join-Path $stageDir "TradeLoom.exe"
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$icoPath" /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$exeOut" $launcherSrc
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exeOut)) { throw "Failed to compile TradeLoom.exe" }
Remove-Item $icoPath -Force -ErrorAction SilentlyContinue

# Copy Agent scripts & quickstart docs
$tplDir = Join-Path $repoRoot "scripts\portable-templates"
Get-ChildItem $tplDir -File | Where-Object { $_.Name -notin @("app-server.js", "next.config.mjs") } | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $stageDir $_.Name) -Force
}

# Strict Privacy Gate BEFORE zipping
$wsFiles = @(Get-ChildItem "$stageDir\workspace" -Force -ErrorAction SilentlyContinue)
if ($wsFiles.Count -gt 0) { throw "PRIVACY GATE FAILED: workspace/ is not empty!" }
$leakedKey = Select-String -Path "$appDir\*.json" -Pattern 'sk-[a-zA-Z0-9]{20,}' -ErrorAction SilentlyContinue
if ($leakedKey) { throw "PRIVACY GATE FAILED: Possible API key found in staging dir!" }
$symlinks = @(Get-ChildItem $stageDir -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
Write-Host "    Privacy gate passed (workspace=0 files, symlinks=$($symlinks.Count))"

# 6. Compress into portable ZIP
Write-Host "[6/6] Compressing portable archive -> $zipPath"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)

$zipSizeMb = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "SUCCESS! Portable release ready:" -ForegroundColor Green
Write-Host "  Folder: $stageDir"
Write-Host "  ZIP:    $zipPath ($zipSizeMb MB)"