# 新增图片后，一条命令搞定：生成缩略图 + 暂存 + 提交。
#
#   powershell -ExecutionPolicy Bypass -File collection\tools\make-thumbs.cmd.ps1 -m "新增 XXX 纸币图片"
#
# 只管缩略图，不动你的原图和数据文件 —— 它们留在工作区，由你自己决定什么时候提交。
# 提交后仍然需要你自己 git push（除非加 -Push）。
#
# 为什么要有这个封装：make-thumbs.ps1 自己没法知道你想写什么提交说明，
# 而"生成完还要手动 git add 一堆路径"很容易漏。这里把三步串起来。
#
# ★ 本文件是 UTF-8 **带 BOM** 的。仓库里所有含中文的 .ps1 都必须如此：
#   Windows PowerShell 5.1 会把无 BOM 的 UTF-8 当 ANSI(GBK) 读，
#   中文字符串里的引号会被截断成非法 token，脚本直接跑不起来。
param(
    [string]$Message = '',
    [switch]$Push,
    [switch]$Quiet,
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 脚本在 collection\tools\ 下，所以仓库根是上两级
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $Here '..\..')).Path }
$RepoRoot = (Resolve-Path $RepoRoot).Path

Write-Host "仓库根: $RepoRoot"
Write-Host ''

# ---- 1) 生成缩略图 ----
$gen = Join-Path $Here 'make-thumbs.ps1'
if (-not (Test-Path $gen)) { Write-Host "找不到 $gen"; exit 1 }

# ★ 必须**另起一个进程**才拿得到可靠的退出码。
#   用 `& $gen` 调用时 $LASTEXITCODE 不会被重置（脚本内部只用 cmdlet，
#   没有外部命令去覆盖它），会残留上一条 git 命令的退出码 ——
#   表现就是"明明 0 失败，却被判成有失败项而不提交"。
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $psExe = (Get-Process -Id $PID).Path
} else {
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
}
& $psExe -NoProfile -ExecutionPolicy Bypass -File $gen -RepoRoot $RepoRoot
$genExit = $LASTEXITCODE
# 生成器在"全部失败"时返回 1；有失败就不提交，避免把半成品推上去
if ($genExit -ne 0) {
    Write-Host ''
    Write-Host "生成阶段有失败项（退出码 $genExit），已中止提交。请先看上面的 Warning。"
    exit $genExit
}

# ---- 2) 暂存缩略图 ----
# pathspec 必须用 :(glob) magic：普通 pathspec 里的 '*' 不跨 '/'。
# 仓库里有两套缩略图布局，只对**实际存在**的那套执行，避免在不存在的路径上报错。
$specs = @()
foreach ($s in @(':(glob)**/image/thumb/**', ':(glob)**/images/thumb/**')) {
    $probe = & git -C $RepoRoot ls-files -- $s
    if ($LASTEXITCODE -eq 0 -and $probe) { $specs += $s }
}
if ($specs.Count -eq 0) { Write-Host '没有找到缩略图路径，退出。'; exit 0 }

$status = & git -C $RepoRoot status --porcelain -- $specs
if (-not $status) {
    Write-Host ''
    Write-Host '缩略图没有变化，无需提交。'
    exit 0
}

Write-Host ''
Write-Host '新增/更新的缩略图:'
$status | ForEach-Object { Write-Host "  $_" }

& git -C $RepoRoot add -- $specs

# ---- 3) 提交 ----
if (-not $Message) { $Message = '更新图片缩略图' }
& git -C $RepoRoot commit -m $Message
if ($LASTEXITCODE -ne 0) { Write-Host '提交失败（可能没有可提交内容）。'; exit $LASTEXITCODE }

Write-Host ''
if ($Push) {
    & git -C $RepoRoot push
    if ($LASTEXITCODE -ne 0) { Write-Host 'push 失败，请检查网络或远端。'; exit $LASTEXITCODE }
    Write-Host '已提交并推送。'
} else {
    Write-Host '已提交。需要时执行: git push'
}
