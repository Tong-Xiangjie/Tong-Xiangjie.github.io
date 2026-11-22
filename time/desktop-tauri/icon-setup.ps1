# One-time setup that lets the taskbar / shortcut icon follow the clock.
#
#   install :  .\icon-setup.ps1
#   undo    :  .\icon-setup.ps1 -Undo
#
# What it does:
#   1. writes the clock .ico once (via "timeclock.exe --icon-tick")
#   2. points every shortcut that launches this exe at that .ico
#      (this machine: the pinned taskbar shortcut) and records the list in
#      %LOCALAPPDATA%\TimeClock\shortcuts.txt so the app can refresh them
#   3. registers a per-minute scheduled task "TimeClockIcon" that runs
#      "timeclock.exe --icon-tick": a windowless, ~40 ms run that redraws the
#      .ico and tells the shell to re-read it. That is what keeps the pinned
#      icon ticking while the app is NOT running.
#
# The app itself does all of the above every minute while it is running, so
# this script only matters for the very first setup (or after moving the exe).

param([switch]$Undo)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe    = Join-Path $root 'src-tauri\target\release\timeclock.exe'
$data   = Join-Path $env:LOCALAPPDATA 'TimeClock'
$ico    = Join-Path $data 'clock.ico'
$list   = Join-Path $data 'shortcuts.txt'
$task   = 'TimeClockIcon'
$pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class ShNotify {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);
  public static void AssocChanged() {
    SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero); // SHCNE_ASSOCCHANGED, SHCNF_IDLIST
  }
}
'@

$shell = New-Object -ComObject WScript.Shell
$links = New-Object System.Collections.ArrayList
foreach ($d in @($pinned, (Join-Path $env:USERPROFILE 'Desktop'), 'C:\Users\Public\Desktop')) {
  if (-not (Test-Path $d)) { continue }
  foreach ($f in (Get-ChildItem $d -Filter *.lnk -ErrorAction SilentlyContinue)) {
    if ($shell.CreateShortcut($f.FullName).TargetPath -ieq $exe) { [void]$links.Add($f.FullName) }
  }
}

if ($Undo) {
  Write-Host '== undo =='
  schtasks /Delete /TN $task /F 2>&1 | ForEach-Object { "  $_" }
  foreach ($l in $links) {
    $sc = $shell.CreateShortcut($l)
    $sc.IconLocation = ',0'          # back to the icon embedded in the exe
    $sc.Save()
    Write-Host "  restored icon of $l"
  }
  if (Test-Path $data) { Remove-Item $data -Recurse -Force }
  [ShNotify]::AssocChanged()
  Write-Host 'done - the taskbar icon is static again'
  exit 0
}

Write-Host '== install =='
if (-not (Test-Path $exe)) { throw "not found: $exe  (build it first: cargo build --release)" }
if (-not (Test-Path $data)) { New-Item -ItemType Directory -Path $data | Out-Null }

Write-Host '  drawing the initial .ico'
& $exe --icon-tick
if (-not (Test-Path $ico)) { throw "the exe did not write $ico" }

foreach ($l in $links) {
  $sc = $shell.CreateShortcut($l)
  $sc.IconLocation = "$ico,0"
  $sc.Save()
  Write-Host "  pointed at the .ico: $l"
}
Set-Content -Path $list -Value $links -Encoding UTF8

# Register the minute task from XML instead of `schtasks /SC MINUTE`:
# the plain form inherits DisallowStartIfOnBatteries=true / StopIfGoingOnBatteries=true,
# which silently stops the refresh on a laptop running on battery (icon freezes after
# boot or resume). StartWhenAvailable also lets a missed tick run late after a sleep.
$xmlPath = Join-Path $env:TEMP "$task.xml"
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\$task</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$exe</Command>
      <Arguments>--icon-tick</Arguments>
    </Exec>
  </Actions>
</Task>
"@
[System.IO.File]::WriteAllText($xmlPath, $taskXml, [System.Text.Encoding]::Unicode)
schtasks /Create /TN $task /XML $xmlPath /F 2>&1 | ForEach-Object { "  $_" }
Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
[ShNotify]::AssocChanged()

Write-Host ''
Write-Host "installed. Undo any time with:  $($MyInvocation.MyCommand.Path) -Undo"
