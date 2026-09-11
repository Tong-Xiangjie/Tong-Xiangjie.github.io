<#
.SYNOPSIS
    为 collection 站生成图片缩略图。

.DESCRIPTION
    把   <图片根目录>/<相对路径>.<ext>
    生成到 <图片根目录>/thumb/<相对路径>.jpg

    图片根目录（自动发现）：
      notecollection/image
      coincollection/image
      funcollection/*/images

    行为：
      * 默认宽度 320px、JPEG 质量 80（-Width / -Quality 可调）
      * 默认增量：缩略图已存在且不比原图旧就跳过；-Force 强制重建
      * 自动跳过 thumb/ 目录本身，可重复运行
      * 自动按 EXIF Orientation 纠正方向（浏览器会纠正、GDI+ 不会，
        不处理会导致缩略图相对原图"躺着"）
      * 跳过 .svg（矢量图不需要缩略图）

    前端约定见 collection/core.js 的 getThumbUrl()：
    缩略图加载失败时会自动回退到原图，所以漏生成不会导致图片显示不出来。

.EXAMPLE
    pwsh -File collection/tools/make-thumbs.ps1
    pwsh -File collection/tools/make-thumbs.ps1 -Force
    pwsh -File collection/tools/make-thumbs.ps1 -Limit 20      # 试跑前 20 张
#>
param(
    [int]$Width = 320,
    [int]$Quality = 80,
    [switch]$Force,
    [int]$Limit = 0,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# ---------- 发现图片根目录 ----------
$imageRoots = @()
foreach ($p in @('notecollection\image', 'coincollection\image')) {
    $full = Join-Path $repoRoot $p
    if (Test-Path $full) { $imageRoots += (Resolve-Path $full).Path }
}
$funDir = Join-Path $repoRoot 'funcollection'
if (Test-Path $funDir) {
    Get-ChildItem $funDir -Directory | ForEach-Object {
        $imgDir = Join-Path $_.FullName 'images'
        if (Test-Path $imgDir) { $imageRoots += (Resolve-Path $imgDir).Path }
    }
}

if ($imageRoots.Count -eq 0) { Write-Error '没有找到任何图片根目录'; exit 1 }

Write-Output ("仓库根目录 : " + $repoRoot)
Write-Output ("图片根目录 : " + $imageRoots.Count + " 个")
foreach ($r in $imageRoots) { Write-Output ("  - " + $r.Replace($repoRoot + '\', '')) }
Write-Output ("参数       : width=$Width quality=$Quality force=$Force")
Write-Output ''

# ---------- JPEG 编码器 ----------
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)

# EXIF Orientation -> RotateFlip
$orientationMap = @{
    2 = [System.Drawing.RotateFlipType]::RotateNoneFlipX
    3 = [System.Drawing.RotateFlipType]::Rotate180FlipNone
    4 = [System.Drawing.RotateFlipType]::RotateNoneFlipY
    5 = [System.Drawing.RotateFlipType]::Rotate90FlipX
    6 = [System.Drawing.RotateFlipType]::Rotate90FlipNone
    7 = [System.Drawing.RotateFlipType]::Rotate270FlipX
    8 = [System.Drawing.RotateFlipType]::Rotate270FlipNone
}

function Get-ExifOrientation($img) {
    try {
        if ($img.PropertyIdList -contains 0x0112) {
            $item = $img.GetPropertyItem(0x0112)
            if ($item -and $item.Value.Length -ge 2) {
                return [int][System.BitConverter]::ToUInt16($item.Value, 0)
            }
        }
    } catch { }
    return 1
}

# ---------- 收集待处理文件 ----------
$targets = @()
foreach ($root in $imageRoots) {
    $files = Get-ChildItem $root -Recurse -File | Where-Object {
        $_.Extension -notmatch '^\.svg$' -and
        $_.FullName -notmatch '\\thumb\\'
    }
    foreach ($f in $files) { $targets += [pscustomobject]@{ Root = $root; File = $f } }
}

$total = $targets.Count
if ($Limit -gt 0 -and $Limit -lt $total) { $targets = $targets[0..($Limit - 1)] }
Write-Output ("待处理原图 : {0} 张{1}" -f $targets.Count, $(if ($Limit -gt 0) { "（已限制为前 $Limit 张，试跑）" } else { '' }))
Write-Output ''

# ---------- 逐张生成 ----------
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$done = 0; $skipped = 0; $failed = 0
$srcBytes = 0L; $thumbBytes = 0L
$rotated = 0

foreach ($t in $targets) {
    $src = $t.File
    $rel = $src.FullName.Substring($t.Root.Length).TrimStart('\')
    $relDir = [System.IO.Path]::GetDirectoryName($rel)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($src.Name)
    $destDir = Join-Path (Join-Path $t.Root 'thumb') $relDir
    $dest = Join-Path $destDir ($base + '.jpg')

    if (-not $Force -and (Test-Path $dest)) {
        $d = Get-Item $dest
        if ($d.LastWriteTimeUtc -ge $src.LastWriteTimeUtc) { $skipped++; continue }
    }

    try {
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

        $img = [System.Drawing.Image]::FromFile($src.FullName)
        try {
            $orient = Get-ExifOrientation $img
            $needRotate = ($orient -ne 1 -and $orientationMap.ContainsKey($orient))

            $w = $Width
            $h = [int][math]::Round($img.Height * $Width / $img.Width)
            if ($h -lt 1) { $h = 1 }

            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            try {
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                try {
                    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    # PNG 可能带透明通道，JPEG 不支持，铺白底避免变黑
                    $g.Clear([System.Drawing.Color]::White)
                    $g.DrawImage($img, 0, 0, $w, $h)
                } finally { $g.Dispose() }

                if ($needRotate) {
                    $bmp.RotateFlip($orientationMap[$orient])
                    $rotated++
                }
                $bmp.Save($dest, $jpegCodec, $encParams)
            } finally { $bmp.Dispose() }
        } finally { $img.Dispose() }

        $srcBytes += $src.Length
        $thumbBytes += (Get-Item $dest).Length
        $done++
        if (-not $Quiet -and ($done % 50 -eq 0)) {
            Write-Output ("  ...已生成 {0} 张（{1:N1}s）" -f $done, $sw.Elapsed.TotalSeconds)
        }
    } catch {
        $failed++
        Write-Warning ("失败: " + $src.FullName + " -> " + $_.Exception.Message)
    }
}

$sw.Stop()
Write-Output ''
Write-Output '================ 完成 ================'
Write-Output ("新生成     : {0} 张" -f $done)
Write-Output ("跳过(增量) : {0} 张" -f $skipped)
Write-Output ("失败       : {0} 张" -f $failed)
if ($rotated -gt 0) { Write-Output ("EXIF 旋转  : {0} 张" -f $rotated) }
Write-Output ("原图总体积 : {0:N1} MB" -f ($srcBytes / 1MB))
Write-Output ("缩略图体积 : {0:N2} MB" -f ($thumbBytes / 1MB))
if ($srcBytes -gt 0) { Write-Output ("压缩比     : 约 {0:N0} : 1" -f ($srcBytes / [math]::Max($thumbBytes, 1))) }
Write-Output ("耗时       : {0:N1}s" -f $sw.Elapsed.TotalSeconds)
if ($failed -gt 0) { exit 1 }
