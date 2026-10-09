# Drive the owner's signed-in Microsoft Edge with Windows UI Automation (no remote debugging, no stored cookies).
# Every page opens in a NEW temporary window that is closed afterwards. The module reads accessible text, presses
# buttons and captures images; it never types into pages, so it cannot change settings by accident.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Drawing
if (-not ('EdgeSessionNative' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EdgeSessionNative {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
}
$script:A = [System.Windows.Automation.AutomationElement]
$script:CT = [System.Windows.Automation.ControlType]
$script:TS = [System.Windows.Automation.TreeScope]

# A locked Windows session (lock screen in front) stops Edge from painting and exposing pages, so nothing can be read.
if (-not ('EdgeSessionDesktop' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EdgeSessionDesktop {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
}
function Test-EdgeDesktopLocked {
  $procId = [uint32]0
  [void][EdgeSessionDesktop]::GetWindowThreadProcessId([EdgeSessionDesktop]::GetForegroundWindow(), [ref]$procId)
  (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName -in 'LockApp', 'LogonUI'
}

function Get-EdgeWindows {
  $cls = New-Object System.Windows.Automation.PropertyCondition($script:A::ClassNameProperty, 'Chrome_WidgetWin_1')
  @($script:A::RootElement.FindAll($script:TS::Children, $cls) | Where-Object { $_.Current.Name -like '*Microsoft*Edge' })
}

function Get-EdgeExe {
  $p = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -notmatch '--type=|--user-data-dir' } | Select-Object -First 1
  if ($p) { return (Get-Process -Id $p.ProcessId).Path }
  foreach ($c in "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") {
    if (Test-Path $c) { return $c }
  }
  throw 'Microsoft Edge was not found.'
}

# Chromium pauses rendering (and accessibility updates) for covered windows, so the temporary window stays in front.
function Show-EdgeWindow {
  param([Parameter(Mandatory)]$Window)
  try { $Window.Pattern.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Maximized) } catch {}
  [void][EdgeSessionNative]::ShowWindow($Window.Handle, 3)
  [void][EdgeSessionNative]::SetForegroundWindow($Window.Handle)
}

function Open-EdgeWindow {
  param([Parameter(Mandatory)][string]$Url, [string]$ProfileDirectory = 'Default', [int]$TimeoutSec = 25)
  $before = @(Get-EdgeWindows | ForEach-Object { $_.Current.NativeWindowHandle })
  Start-Process -FilePath (Get-EdgeExe) -ArgumentList "--profile-directory=$ProfileDirectory", '--new-window', "`"$Url`""
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 700
    $win = Get-EdgeWindows | Where-Object { $before -notcontains $_.Current.NativeWindowHandle } | Select-Object -First 1
    if ($win) {
      $w = [pscustomobject]@{
        Element = $win
        Handle = [IntPtr]$win.Current.NativeWindowHandle
        Pattern = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
      }
      Show-EdgeWindow $w
      return $w
    }
  }
  throw "No new Edge window opened for $Url"
}

function Close-EdgeWindow {
  param($Window)
  if ($Window) { try { $Window.Pattern.Close() } catch {} }
}

function Get-EdgeAddress {
  param([Parameter(Mandatory)]$Window)
  $c = New-Object System.Windows.Automation.PropertyCondition($script:A::ControlTypeProperty, $script:CT::Edit)
  foreach ($e in $Window.Element.FindAll($script:TS::Descendants, $c)) {
    if ($e.Current.Name -eq 'Address and search bar') {
      return $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    }
  }
}

# One line per named element: two spaces per depth level, then "[localized control type] name".
function Get-EdgeText {
  param([Parameter(Mandatory)]$Window, [int]$MaxNodes = 20000)
  $docCond = New-Object System.Windows.Automation.PropertyCondition($script:A::ControlTypeProperty, $script:CT::Document)
  $doc = $Window.Element.FindFirst($script:TS::Descendants, $docCond)
  if (-not $doc) { return @() }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $out = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($doc, 0))
  $count = 0
  $last = ''
  while ($stack.Count -gt 0 -and $count -lt $MaxNodes) {
    $pair = $stack.Pop(); $el = $pair[0]; $depth = $pair[1]; $count++
    try { $name = $el.Current.Name; $type = $el.Current.LocalizedControlType } catch { continue }
    if ($name) {
      $line = ('  ' * [Math]::Min($depth, 14)) + "[$type] " + (($name -replace '[\u200B\s]+', ' ').Trim())
      if ($line -ne $last) { $out.Add($line); $last = $line }
    }
    $kids = New-Object System.Collections.Generic.List[object]
    $c = $walker.GetFirstChild($el)
    while ($c) { $kids.Add($c); $c = $walker.GetNextSibling($c) }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push(@($kids[$k], ($depth + 1))) }
  }
  , $out.ToArray()
}

function Wait-EdgeText {
  param([Parameter(Mandatory)]$Window, [Parameter(Mandatory)][string]$ReadyPattern, [int]$TimeoutSec = 60, [int]$MaxNodes = 20000, [int]$SettleSec = 2)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lines = @()
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    Show-EdgeWindow $Window
    $lines = Get-EdgeText $Window -MaxNodes $MaxNodes
    if (($lines -join "`n") -match $ReadyPattern) {
      if ($SettleSec) { Start-Sleep -Seconds $SettleSec; $lines = Get-EdgeText $Window -MaxNodes $MaxNodes }
      return [pscustomobject]@{ Ready = $true; Lines = $lines }
    }
  }
  [pscustomobject]@{ Ready = $false; Lines = $lines }
}

function Find-EdgeElement {
  param([Parameter(Mandatory)]$Window, [Parameter(Mandatory)][string]$NamePattern, [string]$ControlType)
  $cond = if ($ControlType) {
    New-Object System.Windows.Automation.PropertyCondition($script:A::ControlTypeProperty, $script:CT::$ControlType)
  } else { [System.Windows.Automation.Condition]::TrueCondition }
  @($Window.Element.FindAll($script:TS::Descendants, $cond) | Where-Object {
      try { (($_.Current.Name -replace '[\u200B\s]+', ' ').Trim()) -match $NamePattern } catch { $false }
    })
}

function Invoke-EdgeElement {
  param([Parameter(Mandatory)]$Element)
  foreach ($p in 'Invoke', 'SelectionItem', 'Toggle', 'ExpandCollapse') {
    try {
      $pattern = $Element.GetCurrentPattern(([type]"System.Windows.Automation.${p}Pattern")::Pattern)
      switch ($p) {
        'Invoke' { $pattern.Invoke() }
        'SelectionItem' { $pattern.Select() }
        'Toggle' { $pattern.Toggle() }
        'ExpandCollapse' { $pattern.Expand() }
      }
      return $true
    } catch {}
  }
  $false
}

# -Rect (screen coordinates, as UI Automation reports them) crops the capture to that part of the window.
function Save-EdgeImage {
  param([Parameter(Mandatory)]$Window, [Parameter(Mandatory)][string]$Path, [System.Windows.Rect]$Rect = [System.Windows.Rect]::Empty)
  $r = New-Object EdgeSessionNative+RECT
  [void][EdgeSessionNative]::GetWindowRect($Window.Handle, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][EdgeSessionNative]::PrintWindow($Window.Handle, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  if (-not $Rect.IsEmpty) {
    $x = [Math]::Max(0, [int]($Rect.X - $r.Left)); $y = [Math]::Max(0, [int]($Rect.Y - $r.Top))
    $w = [Math]::Min($bmp.Width - $x, [int]$Rect.Width); $h = [Math]::Min($bmp.Height - $y, [int]$Rect.Height)
    if ($w -lt 10 -or $h -lt 10) { $bmp.Dispose(); throw "Crop $Rect is outside the window" }
    $crop = $bmp.Clone((New-Object System.Drawing.Rectangle $x, $y, $w, $h), $bmp.PixelFormat)
    $bmp.Dispose()
    $bmp = $crop
  }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Show-EdgeElement {
  param([Parameter(Mandatory)]$Element, [int]$SettleMs = 1500)
  try { $Element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
  Start-Sleep -Milliseconds $SettleMs
}

Export-ModuleMember -Function Test-EdgeDesktopLocked, Get-EdgeWindows, Get-EdgeExe, Show-EdgeWindow, Open-EdgeWindow, Close-EdgeWindow, Get-EdgeAddress, Get-EdgeText, Wait-EdgeText, Find-EdgeElement, Invoke-EdgeElement, Save-EdgeImage, Show-EdgeElement
