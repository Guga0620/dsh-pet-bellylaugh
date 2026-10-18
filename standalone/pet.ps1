# ============================================================================
# dsh-pet-bellylaugh —— 独立版桌宠（不依赖 DSH 是否运行）
#
# 与页面版行为对齐：同一套动画表、同一个点击递进、长按抚摸、拖动跑动、
# 出错抖动、空闲搭话、带尾巴的气泡、静音开关。
#
# 一个 WPF 无边框窗口：逐像素透明、置顶、不占任务栏、可拖动。
# DSH 在跑时自动连它的 /pet-bellylaugh/state（端口自动发现），
# DSH 关掉就自己待机，互不依赖。
#
# 用法：双击 standalone\launch.vbs，或
#       powershell -ExecutionPolicy Bypass -File standalone\pet.ps1
#
# 注意：本文件必须保存为 UTF-8 with BOM —— Windows PowerShell 5.1 会把
#       无 BOM 的 UTF-8 当 GBK 读，中文全乱、脚本直接语法报错。
# ============================================================================
param(
  [int]$Cell = 156,                     # 显示时单帧宽度（高度按 12:13 推导）
  [string]$DsUrl = ""                   # 手动指定 DSH 地址，留空则自动发现
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PetNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
# 不声明 DPI 感知的话，125% 缩放下整窗会被系统拉伸，画面发虚。
try { [void][PetNative]::SetProcessDPIAware() } catch { }

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$sheetPath = Join-Path $here 'spritesheet.png'
$laughPath = Join-Path $here 'laugh.mp3'
$posPath = Join-Path $here '.position'
if (-not (Test-Path $sheetPath)) { throw "找不到 $sheetPath" }

# --- 素材 ---------------------------------------------------------------------
$sheet = New-Object System.Windows.Media.Imaging.BitmapImage
$sheet.BeginInit()
$sheet.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
$sheet.UriSource = [Uri]$sheetPath
$sheet.EndInit()
$sheet.Freeze()

$cols = 8
$rows = 9
$cellW = [double]$sheet.PixelWidth / $cols
$cellH = [double]$sheet.PixelHeight / $rows
$winW = [int]$Cell
$winH = [int]($cellH * ($Cell / $cellW))

# --- 动画表（与 lib/client.js 完全一致）----------------------------------------
$script:Anims = @{
  idle   = @{ row = 0; fps = 4.5; frames = @(0,2,3,5, 0,2,3,5, 1, 0,2,3,5, 0,2,3,5, 0,2,3,5, 4, 0,2,3,5, 0,2,3,5) }
  runR   = @{ row = 1; fps = 13;  frames = @(0,1,2,3,4,5,6,7) }
  runL   = @{ row = 2; fps = 13;  frames = @(0,1,2,3,4,5,6,7) }
  laughA = @{ row = 3; fps = 9;   frames = @(0,1,2,3) }
  laughB = @{ row = 4; fps = 9;   frames = @(0,1,2,3,4) }
  laughC = @{ row = 5; fps = 9;   frames = @(0,1,2,3,4,5,6,7) }
  idleB  = @{ row = 6; fps = 5.5; frames = @(0,1,2,3,4,5) }
  pat    = @{ row = 7; fps = 7;   frames = @(0,1,2,3,4,5) }
  wave   = @{ row = 8; fps = 9;   frames = @(0,1,2,3,4,5) }
}

# --- 台词（与页面版同一套）------------------------------------------------------
$script:Lines = @{
  greet   = @('嗨～', '在呢在呢', '有事吗？', '戳我干嘛～')
  happy   = @('嘿嘿～', '舒服～', '再来一下', '咕噜咕噜')
  annoyed = @('别戳啦！', '晕了晕了', '再戳要生气咯', '住手住手')
  pet     = @('❤️ 呼噜呼噜…', '❤️ 好舒服…', '❤️ 再摸摸嘛', '❤️ 嘿嘿…')
  idle    = @('发呆中…', '要不要歇会儿？', '我在这儿呢', '肚子有点饿了', '等你很久啦')
  busy    = @('忙着呢，别打扰～', '加油加油！', '我帮你盯着', '快好啦快好啦')
}
$script:LaughText = '哈哈哈哈哈哈哈哈'

function Pick { param([object[]]$list) $list[(Get-Random -Maximum $list.Count)] }

# --- 宠物窗口 -------------------------------------------------------------------
$win = New-Object System.Windows.Window
$win.WindowStyle = [System.Windows.WindowStyle]::None
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ResizeMode = [System.Windows.ResizeMode]::NoResize
$win.Width = $winW
$win.Height = $winH
$win.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$win.Title = 'dsh-pet-bellylaugh'

$work = [System.Windows.SystemParameters]::WorkArea
$left = $work.Right - $winW - 24
$top = $work.Bottom - $winH - 24
if (Test-Path $posPath) {
  try {
    $parts = (Get-Content -LiteralPath $posPath -Raw).Split(',')
    $left = [double]$parts[0]
    $top = [double]$parts[1]
  } catch { }
}
if ($left -lt $work.Left -or $left -gt $work.Right - 40 -or $top -lt $work.Top -or $top -gt $work.Bottom - 40) {
  $left = $work.Right - $winW - 24
  $top = $work.Bottom - $winH - 24
}
$win.Left = $left
$win.Top = $top

# 画面：矩形 + ImageBrush，用 Viewbox 选帧；RenderTransform 留给抖动
$root = New-Object System.Windows.Controls.Grid
$root.Background = [System.Windows.Media.Brushes]::Transparent

$brush = New-Object System.Windows.Media.ImageBrush
$brush.ImageSource = $sheet
$brush.ViewboxUnits = [System.Windows.Media.BrushMappingMode]::Absolute
$brush.Viewbox = New-Object System.Windows.Rect 0, 0, $cellW, $cellH
$brush.Stretch = [System.Windows.Media.Stretch]::Fill
$script:brush = $brush

$sprite = New-Object System.Windows.Shapes.Rectangle
$sprite.Fill = $brush
$sprite.Width = $winW
$sprite.Height = $winH
$sprite.Cursor = [System.Windows.Input.Cursors]::Hand
$shakeTransform = New-Object System.Windows.Media.TranslateTransform
$sprite.RenderTransform = $shakeTransform
$script:shakeTransform = $shakeTransform
$root.Children.Add($sprite) | Out-Null

# 悬停出现的小喇叭（与页面版同款；隐藏/退出走右键菜单）
$muteBadge = New-Object System.Windows.Controls.Border
$muteBadge.Width = 22
$muteBadge.Height = 22
$muteBadge.CornerRadius = New-Object System.Windows.CornerRadius 11
$muteBadge.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(230, 255, 255, 255))
$muteBadge.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$muteBadge.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
$muteBadge.Margin = New-Object System.Windows.Thickness 0, 14, -2, 0
$muteBadge.Cursor = [System.Windows.Input.Cursors]::Hand
$muteBadge.Opacity = 0
$muteText = New-Object System.Windows.Controls.TextBlock
$muteText.FontSize = 11
$muteText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$muteText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
$muteBadge.Child = $muteText
$root.Children.Add($muteBadge) | Out-Null
$script:muteBadge = $muteBadge
$script:muteText = $muteText

$win.Content = $root

# --- 气泡窗口（独立窗口才能盖在宠物头顶，又不挡住别处）-----------------------------
$bubbleWin = New-Object System.Windows.Window
$bubbleWin.WindowStyle = [System.Windows.WindowStyle]::None
$bubbleWin.AllowsTransparency = $true
$bubbleWin.Background = [System.Windows.Media.Brushes]::Transparent
$bubbleWin.Topmost = $true
$bubbleWin.ShowInTaskbar = $false
$bubbleWin.ResizeMode = [System.Windows.ResizeMode]::NoResize
$bubbleWin.SizeToContent = [System.Windows.SizeToContent]::WidthAndHeight
$bubbleWin.IsHitTestVisible = $false
$bubbleWin.ShowActivated = $false

$bubbleGrid = New-Object System.Windows.Controls.Grid
$bubbleBorder = New-Object System.Windows.Controls.Border
$bubbleBorder.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255, 247, 226))
$bubbleBorder.BorderBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(232, 217, 184))
$bubbleBorder.BorderThickness = New-Object System.Windows.Thickness 1
$bubbleBorder.CornerRadius = New-Object System.Windows.CornerRadius 13
$bubbleBorder.Padding = New-Object System.Windows.Thickness 11, 5, 11, 5
$bubbleText = New-Object System.Windows.Controls.TextBlock
$bubbleText.FontSize = 12.5
$bubbleText.FontWeight = [System.Windows.FontWeights]::SemiBold
$bubbleText.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(90, 63, 15))
$bubbleText.TextWrapping = [System.Windows.TextWrapping]::NoWrap
$bubbleBorder.Child = $bubbleText
$bubbleGrid.Children.Add($bubbleBorder) | Out-Null

# 尾巴：右下角一个旋转 45° 的小方块
$tail = New-Object System.Windows.Shapes.Rectangle
$tail.Width = 9
$tail.Height = 9
$tail.Fill = $bubbleBorder.Background
$tail.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$tail.VerticalAlignment = [System.Windows.VerticalAlignment]::Bottom
$tail.Margin = New-Object System.Windows.Thickness 0, 0, 24, -4
$tail.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5
$tail.RenderTransform = New-Object System.Windows.Media.RotateTransform 45
$bubbleGrid.Children.Add($tail) | Out-Null

$bubbleWin.Content = $bubbleGrid
$script:bubbleWin = $bubbleWin
$script:bubbleText = $bubbleText

# --- 音频 ---------------------------------------------------------------------
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = 0.85
if (Test-Path $laughPath) { $player.Open([Uri]$laughPath) }
$script:player = $player

# --- 状态 ---------------------------------------------------------------------
$script:queue = New-Object System.Collections.ArrayList
$script:animName = 'idle'
$script:frameIndex = 0
$script:frameAcc = 0.0
$script:lastTick = [DateTime]::Now
$script:busy = $false
$script:seenDone = $null
$script:seenTool = $null
$script:seenError = $null
$script:clickStreak = 0
$script:lastClick = [DateTime]::MinValue
$script:bubbleUntil = [DateTime]::MinValue
$script:laughing = $false
$script:laughUntil = [DateTime]::MinValue
$script:shakeUntil = [DateTime]::MinValue
$script:muted = $false
$script:dragAnim = $null
$script:dragging = $false
$script:dragMoved = $false
$script:dragOrigin = $null
$script:longPressed = $false
$script:idleLastTalk = [DateTime]::Now
$script:itemMute = $null

$shared = [hashtable]::Synchronized(@{ state = $null; url = $null })

# --- 后台轮询：自动发现 DSH 端口 -------------------------------------------------
$poller = {
  param($shared, $initialUrl)
  $url = $initialUrl
  $candidatePorts = @()
  $lastDiscover = [DateTime]::MinValue
  $lastBeat = [DateTime]::MinValue

  function Send-Beat([string]$base) {
    try {
      $beat = [System.Net.HttpWebRequest]::Create("$base/pet-bellylaugh/standalone")
      $beat.Method = 'POST'
      $beat.ContentLength = 0
      $beat.Timeout = 900
      $beat.Proxy = $null
      $beat.GetResponse().Close()
    } catch { }
  }

  function Invoke-State([string]$base) {
    try {
      $req = [System.Net.HttpWebRequest]::Create("$base/pet-bellylaugh/state")
      $req.Timeout = 900
      $req.ReadWriteTimeout = 900
      $req.Proxy = $null
      $resp = $req.GetResponse()
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $reader.ReadToEnd()
      $reader.Close(); $resp.Close()
      return $text | ConvertFrom-Json
    } catch { return $null }
  }

  while ($true) {
    try {
      if (-not $url) {
        if (([DateTime]::Now - $lastDiscover).TotalSeconds -ge 10) {
          $lastDiscover = [DateTime]::Now
          $candidatePorts = @()
          $ids = @()
          foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
            if ($proc.ProcessName -like 'DeepSeek*') { $ids += $proc.Id }
          }
          if ($ids.Count -gt 0) {
            $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
              Where-Object { $ids -contains $_.OwningProcess }
            foreach ($l in $listeners) {
              if ($candidatePorts -notcontains $l.LocalPort) { $candidatePorts += $l.LocalPort }
            }
          }
          foreach ($port in $candidatePorts) {
            $probe = Invoke-State "http://127.0.0.1:$port"
            if ($probe -ne $null) { $url = "http://127.0.0.1:$port"; break }
          }
        }
      } else {
        $state = Invoke-State $url
        if ($state -eq $null) {
          $url = $null
          $shared.state = $null
        } else {
          $shared.state = $state
          if (([DateTime]::Now - $lastBeat).TotalSeconds -ge 5) {
            $lastBeat = [DateTime]::Now
            Send-Beat $url
          }
        }
      }
      $shared.url = $url
    } catch { }
    Start-Sleep -Milliseconds 500
  }
}

$rs = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
$rs.ApartmentState = 'MTA'
$rs.ThreadOptions = 'ReuseThread'
$rs.Open()
$rs.SessionStateProxy.SetVariable('shared', $shared)
$psJob = [System.Management.Automation.PowerShell]::Create()
$psJob.Runspace = $rs
$null = $psJob.AddScript($poller.ToString()).AddArgument($shared).AddArgument($DsUrl)
$psHandle = $psJob.BeginInvoke()

# --- 工具函数 ------------------------------------------------------------------
function Update-BubblePosition {
  if ($script:bubbleWin.Visibility -ne [System.Windows.Visibility]::Visible) { return }
  $script:bubbleWin.Measure([System.Windows.Size]::new([double]::PositiveInfinity, [double]::PositiveInfinity))
  $w = $script:bubbleWin.DesiredSize.Width
  $h = $script:bubbleWin.DesiredSize.Height
  # 与页面版一致：贴右上、气泡底部压住宠物顶部 12px
  $script:bubbleWin.Left = $win.Left + $win.Width - $w - 2
  $bubbleTop = $win.Top - $h + 12
  # 宠物贴到屏幕上沿时，气泡别跑到屏幕外去
  if ($bubbleTop -lt 0) { $bubbleTop = 0 }
  $script:bubbleWin.Top = $bubbleTop
}

function Show-Bubble([string]$text, [int]$ms = 1800) {
  $script:bubbleText.Text = $text
  $script:bubbleWin.Show()
  Update-BubblePosition
  $script:bubbleUntil = [DateTime]::Now.AddMilliseconds($ms)
}

function Hide-Bubble {
  if ($script:bubbleWin.Visibility -eq [System.Windows.Visibility]::Visible) {
    $script:bubbleWin.Hide()
  }
}

function Add-Anim([string]$name, [int]$loops, [bool]$replace = $false) {
  if ($replace) { $script:queue.Clear() }
  if ($script:queue.Count -lt 4) {
    $null = $script:queue.Add(@{ name = $name; loops = $loops })
  }
}

function Play-Laugh([int]$ms = 1800) {
  if ($script:muted) { return }
  try {
    $script:player.Position = [TimeSpan]::Zero
    $script:player.Play()
    $script:laughing = $true
    $script:laughUntil = [DateTime]::Now.AddMilliseconds($ms)
  } catch { }
}

function Start-Shake { $script:shakeUntil = [DateTime]::Now.AddMilliseconds(550) }

function Update-Shake {
  $remaining = ($script:shakeUntil - [DateTime]::Now).TotalMilliseconds
  if ($remaining -le 0) {
    $script:shakeTransform.X = 0
    return
  }
  $elapsed = 550 - $remaining
  $steps = @(-6, 6, -4, 4, -2, 2, 0)
  $index = [int][Math]::Floor($elapsed / 75)
  if ($index -ge $steps.Count) { $index = $steps.Count - 1 }
  $script:shakeTransform.X = $steps[$index]
}

function Base-Anim {
  if ($script:busy) { return 'pat' } else { return 'idle' }
}

function Sync-MuteBadge {
  $script:muteText.Text = if ($script:muted) { '🔇' } else { '🔊' }
  if ($null -ne $script:itemMute) {
    $script:itemMute.Header = if ($script:muted) { '取消静音' } else { '静音' }
  }
}

function Toggle-Mute {
  $script:muted = -not $script:muted
  Sync-MuteBadge
  if ($script:muted) {
    try { $script:player.Stop() } catch { }
    $script:laughing = $false
  }
}

# --- 点击递进（与页面版一致）----------------------------------------------------
function Invoke-Click {
  $now = [DateTime]::Now
  if (($now - $script:lastClick).TotalMilliseconds -le 1600) { $script:clickStreak += 1 } else { $script:clickStreak = 1 }
  $script:lastClick = $now

  if ($script:clickStreak -ge 7) {
    $script:clickStreak = 0
    Add-Anim 'idleB' 2 $true
    Start-Shake
    Show-Bubble (Pick $script:Lines.annoyed) 1800
    return
  }
  switch ($script:clickStreak) {
    1       { Add-Anim 'wave' 1 $true;   Show-Bubble (Pick $script:Lines.greet) 1800 }
    2       { Add-Anim 'pat' 2 $true;    Show-Bubble (Pick $script:Lines.happy) 1800 }
    3       { Add-Anim 'laughA' 2 $true; Show-Bubble '痒～哈哈哈' 1800 }
    default { Add-Anim 'laughC' 1 $true; Show-Bubble $script:LaughText 1800; Play-Laugh 1800 }
  }
}

function Invoke-Pet {
  Add-Anim 'pat' 3 $true
  Show-Bubble (Pick $script:Lines.pet) 2200
}

# --- 主循环 -------------------------------------------------------------------
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(55)
$timer.Add_Tick({
  $now = [DateTime]::Now
  $delta = ($now - $script:lastTick).TotalMilliseconds
  $script:lastTick = $now
  if ($delta -gt 250) { $delta = 250 }

  if ($script:bubbleWin.Visibility -eq [System.Windows.Visibility]::Visible -and $now -gt $script:bubbleUntil) {
    Hide-Bubble
  }
  if ($script:laughing -and $now -gt $script:laughUntil) {
    $script:player.Stop()
    $script:laughing = $false
  }
  Update-Shake

  # 后台状态
  $state = $shared.state
  if ($state -ne $null) {
    $script:busy = [bool]$state.busy
    $doneSeq = [int]$state.doneSeq
    $toolSeq = [int]$state.toolSeq
    $errorSeq = [int]$state.errorSeq

    if ($script:seenDone -eq $null) {
      $script:seenDone = $doneSeq; $script:seenTool = $toolSeq; $script:seenError = $errorSeq
    } else {
      if ($errorSeq -gt $script:seenError) {
        $script:seenError = $errorSeq
        Add-Anim 'idleB' 2 $true
        Start-Shake
        Show-Bubble '哎呀，好像出错了' 2200
      } elseif ($doneSeq -gt $script:seenDone) {
        $script:seenDone = $doneSeq
        Add-Anim 'laughC' 3 $true
        Add-Anim 'wave' 1
        Show-Bubble $script:LaughText 2600
        Play-Laugh 4200
      } elseif ($toolSeq -gt $script:seenTool) {
        $script:seenTool = $toolSeq
        if ((Get-Random -Maximum 2) -eq 0) { Add-Anim 'runR' 2 } else { Add-Anim 'runL' 2 }
      }
      $script:seenDone = [Math]::Max($script:seenDone, $doneSeq)
      $script:seenTool = [Math]::Max($script:seenTool, $toolSeq)
      $script:seenError = [Math]::Max($script:seenError, $errorSeq)
    }
  }

  # 空闲搭话（页面版同款：45% 演一段、50% 说一句）
  if (($now - $script:idleLastTalk).TotalSeconds -ge 42) {
    $script:idleLastTalk = $now
    if ($script:queue.Count -eq 0 -and -not $script:dragging -and $script:bubbleWin.Visibility -ne [System.Windows.Visibility]::Visible) {
      if ((Get-Random -Maximum 100) -lt 45) {
        Add-Anim (Pick @('wave', 'idleB', 'pat')) 1
      }
      if ((Get-Random -Maximum 100) -lt 50) {
        if ($script:busy) { Show-Bubble (Pick $script:Lines.busy) 2600 } else { Show-Bubble (Pick $script:Lines.idle) 2600 }
      }
    }
  }

  # 选动画：拖动优先
  if ($null -ne $script:dragAnim) {
    $name = $script:dragAnim
  } elseif ($script:queue.Count -gt 0) {
    $name = $script:queue[0].name
  } else {
    $name = Base-Anim
  }
  $spec = $script:Anims[$name]
  if ($null -eq $spec) { $spec = $script:Anims['idle'] }

  if ($name -ne $script:animName) {
    $keepPhase = ($script:animName.StartsWith('run')) -and ($name.StartsWith('run'))
    $script:animName = $name
    if (-not $keepPhase) { $script:frameIndex = 0; $script:frameAcc = 0.0 }
  }

  $script:frameAcc += $delta
  $step = 1000.0 / $spec.fps
  $wraps = 0
  while ($script:frameAcc -ge $step) {
    $script:frameAcc -= $step
    $script:frameIndex += 1
    if ($script:frameIndex -ge $spec.frames.Count) {
      $script:frameIndex = 0
      $wraps += 1
    }
  }
  if ($wraps -gt 0 -and $script:queue.Count -gt 0) {
    $head = $script:queue[0]
    $head.loops = $head.loops - $wraps
    if ($head.loops -le 0) { $script:queue.RemoveAt(0) }
  }

  $frame = $spec.frames[$script:frameIndex]
  $script:brush.Viewbox = New-Object System.Windows.Rect ($frame * $cellW), ($spec.row * $cellH), $cellW, $cellH

  if ($script:bubbleWin.Visibility -eq [System.Windows.Visibility]::Visible) { Update-BubblePosition }
})

# --- 拖动与点击 -----------------------------------------------------------------
$holdTimer = New-Object System.Windows.Threading.DispatcherTimer
$holdTimer.Interval = [TimeSpan]::FromMilliseconds(700)
$holdTimer.Add_Tick({
  $holdTimer.Stop()
  if ($script:dragging -and -not $script:dragMoved) {
    $script:longPressed = $true
    Invoke-Pet
  }
})

function Get-CursorPosition {
  $pt = New-Object PetNative+POINT
  [void][PetNative]::GetCursorPos([ref]$pt)
  return @{ x = [double]$pt.X; y = [double]$pt.Y }
}

function Get-DpiScale {
  try {
    $dpi = [System.Windows.Media.VisualTreeHelper]::GetDpi($win)
    if ($dpi.DpiScaleX -gt 0) { return $dpi.DpiScaleX }
  } catch { }
  return 1.0
}

$sprite.Add_MouseLeftButtonDown({
  param($sender, $e)
  $script:dragging = $true
  $script:dragMoved = $false
  $script:longPressed = $false
  $script:dragOrigin = @{
    cursor = (Get-CursorPosition)
    left   = $win.Left
    top    = $win.Top
  }
  [void]$sprite.CaptureMouse()
  $holdTimer.Start()
  $e.Handled = $true
})

$sprite.Add_MouseMove({
  param($sender, $e)
  if (-not $script:dragging) { return }
  $cursor = Get-CursorPosition
  $dxRaw = $cursor.x - $script:dragOrigin.cursor.x
  $dyRaw = $cursor.y - $script:dragOrigin.cursor.y
  if (-not $script:dragMoved) {
    if ([Math]::Abs($dxRaw) -lt 5 -and [Math]::Abs($dyRaw) -lt 5) { return }
    $script:dragMoved = $true
    $holdTimer.Stop()
  }
  $scale = Get-DpiScale
  $win.Left = $script:dragOrigin.left + ($dxRaw / $scale)
  $win.Top = $script:dragOrigin.top + ($dyRaw / $scale)
  if ([Math]::Abs($dxRaw) -ge 1) { $script:dragAnim = if ($dxRaw -gt 0) { 'runR' } else { 'runL' } }
})

$sprite.Add_MouseLeftButtonUp({
  param($sender, $e)
  if (-not $script:dragging) { return }
  $wasMoved = $script:dragMoved
  $wasLong = $script:longPressed
  $script:dragging = $false
  $script:dragAnim = $null
  $holdTimer.Stop()
  [void]$sprite.ReleaseMouseCapture()

  if ($wasMoved) {
    try { Set-Content -LiteralPath $posPath -Value ("{0},{1}" -f [int]$win.Left, [int]$win.Top) -Encoding ascii } catch { }
    return
  }
  if ($wasLong) { return }   # 长按已经按抚摸处理过了
  Invoke-Click
})

$win.Add_MouseEnter({ $script:muteBadge.Opacity = 1 })
$win.Add_MouseLeave({ if ($script:dragging) { return }; $script:muteBadge.Opacity = 0 })
$muteBadge.Add_MouseLeftButtonDown({
  param($sender, $e)
  Toggle-Mute
  Show-Bubble $(if ($script:muted) { '已静音' } else { '已开启声音' }) 1200
  $e.Handled = $true
})

# --- 右键菜单 -------------------------------------------------------------------
$menu = New-Object System.Windows.Controls.ContextMenu
$script:itemMute = New-Object System.Windows.Controls.MenuItem
$script:itemMute.Add_Click({ Toggle-Mute })
$itemReset = New-Object System.Windows.Controls.MenuItem
$itemReset.Header = '回到右下角'
$itemReset.Add_Click({
  $w = [System.Windows.SystemParameters]::WorkArea
  $win.Left = $w.Right - $win.Width - 24
  $win.Top = $w.Bottom - $win.Height - 24
  try { Set-Content -LiteralPath $posPath -Value ("{0},{1}" -f [int]$win.Left, [int]$win.Top) -Encoding ascii } catch { }
})
$itemQuit = New-Object System.Windows.Controls.MenuItem
$itemQuit.Header = '退出'
$itemQuit.Add_Click({ $win.Close() })
$null = $menu.Items.Add($script:itemMute)
$null = $menu.Items.Add($itemReset)
$null = $menu.Items.Add((New-Object System.Windows.Controls.Separator))
$null = $menu.Items.Add($itemQuit)
$sprite.ContextMenu = $menu
Sync-MuteBadge

$win.Add_Closed({
  try { $timer.Stop() } catch { }
  try { $holdTimer.Stop() } catch { }
  try { $bubbleWin.Close() } catch { }
  try { $player.Stop(); $player.Close() } catch { }
  try { $psJob.Stop(); $psJob.Dispose(); $rs.Close(); $rs.Dispose() } catch { }
})

# --- 启动 ---------------------------------------------------------------------
$timer.Start()
Show-Bubble '奶龙来了～' 2000
$null = $win.ShowDialog()
