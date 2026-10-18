# ============================================================================
# dsh-pet-bellylaugh —— 独立版桌宠（不依赖 DSH 的窗口能否存在）
#
# 一个 WPF 无边框窗口：逐像素透明、置顶、不占任务栏、可拖动。
# DSH 在跑时自动连它的 /pet-bellylaugh/state（端口自动发现），
# DSH 关掉就自己待机，互不依赖。
#
# 用法：双击 standalone\launch.vbs，或
#       powershell -ExecutionPolicy Bypass -File standalone\pet.ps1
# ============================================================================
param(
  [int]$Cell = 156,                     # 显示时单帧宽度（高度按 12:13 推导）
  [string]$DsUrl = ""                   # 手动指定 DSH 地址，留空则自动发现
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# 不声明 DPI 感知的话，125% 缩放下整窗会被系统拉伸，画面发虚。
try {
  Add-Type -Namespace Pet -Name Dpi -MemberDefinition '
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();' | Out-Null
  [void][Pet.Dpi]::SetProcessDPIAware()
} catch { }

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
$scale = $Cell / $cellW
$winW = [int]$Cell
$winH = [int]($cellH * $scale)

# --- 动画表（与浏览器端一致：行号 + 帧序列 + fps）------------------------------
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

# --- 窗口 ---------------------------------------------------------------------
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

# 记住上次位置：.position 里是 "Left,Top"
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
# 防止上次的坐标落在已拔掉的显示器上
if ($left -lt $work.Left -or $left -gt $work.Right - 40 -or $top -lt $work.Top -or $top -gt $work.Bottom - 40) {
  $left = $work.Right - $winW - 24
  $top = $work.Bottom - $winH - 24
}
$win.Left = $left
$win.Top = $top

# --- 画面 ---------------------------------------------------------------------
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
$root.Children.Add($sprite) | Out-Null

# 气泡
$bubble = New-Object System.Windows.Controls.Border
$bubble.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(255, 247, 226))
$bubble.BorderBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(214, 190, 140))
$bubble.BorderThickness = New-Object System.Windows.Thickness 1
$bubble.CornerRadius = New-Object System.Windows.CornerRadius 12
$bubble.Padding = New-Object System.Windows.Thickness 8, 4, 8, 4
$bubble.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
$bubble.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
$bubble.Margin = New-Object System.Windows.Thickness 0, -30, 0, 0
$bubble.Visibility = [System.Windows.Visibility]::Collapsed
$bubbleText = New-Object System.Windows.Controls.TextBlock
$bubbleText.FontSize = 13
$bubbleText.FontWeight = [System.Windows.FontWeights]::SemiBold
$bubbleText.Foreground = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(90, 63, 15))
$bubble.Child = $bubbleText
$root.Children.Add($bubble) | Out-Null
$script:bubble = $bubble
$script:bubbleText = $bubbleText

$win.Content = $root

# --- 音频 ---------------------------------------------------------------------
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = 0.85
if (Test-Path $laughPath) { $player.Open([Uri]$laughPath) }
$script:player = $player

function Pick { param([object[]]$list) $list[(Get-Random -Maximum $list.Count)] }

# --- 状态 ---------------------------------------------------------------------
$script:queue = New-Object System.Collections.ArrayList   # @{name; loops}
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
        # 每 10 秒找一次：DSH 主机是 DeepSeek Harness.exe 的子进程，监听 127.0.0.1
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
          $url = $null            # DSH 关了，回到待机，稍后重找
          $shared.state = $null
        } else {
          $shared.state = $state
          # 心跳：让页面里那只自动让位，免得桌面上出现两只奶龙
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
function Show-Bubble([string]$text, [int]$ms = 1800) {
  $script:bubbleText.Text = $text
  $script:bubble.Visibility = [System.Windows.Visibility]::Visible
  $script:bubbleUntil = [DateTime]::Now.AddMilliseconds($ms)
}

function Add-Anim([string]$name, [int]$loops, [bool]$replace = $false) {
  if ($replace) { $script:queue.Clear() }
  if ($script:queue.Count -lt 4) {
    $null = $script:queue.Add(@{ name = $name; loops = $loops })
  }
}

function Play-Laugh([int]$ms = 1800) {
  try {
    $script:player.Position = [TimeSpan]::Zero
    $script:player.Play()
    $script:laughing = $true
    $script:laughUntil = [DateTime]::Now.AddMilliseconds($ms)
  } catch { }
}

function Base-Anim {
  if ($script:busy) { return 'pat' } else { return 'idle' }
}

# --- 主循环 -------------------------------------------------------------------
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(55)
$timer.Add_Tick({
  $now = [DateTime]::Now
  $delta = ($now - $script:lastTick).TotalMilliseconds
  $script:lastTick = $now
  if ($delta -gt 250) { $delta = 250 }

  # 气泡到期
  if ($script:bubble.Visibility -eq [System.Windows.Visibility]::Visible -and $now -gt $script:bubbleUntil) {
    $script:bubble.Visibility = [System.Windows.Visibility]::Collapsed
  }
  if ($script:laughing -and $now -gt $script:laughUntil) {
    $script:player.Stop()
    $script:laughing = $false
  }

  # 读取后台状态
  $state = $shared.state
  if ($state -ne $null) {
    $busy = [bool]$state.busy
    $script:busy = $busy
    $doneSeq = [int]$state.doneSeq
    $toolSeq = [int]$state.toolSeq
    $errorSeq = [int]$state.errorSeq

    if ($script:seenDone -eq $null) {
      $script:seenDone = $doneSeq; $script:seenTool = $toolSeq; $script:seenError = $errorSeq
    } else {
      if ($errorSeq -gt $script:seenError) {
        $script:seenError = $errorSeq
        Add-Anim 'idleB' 2 $true
        Show-Bubble '哎呀，好像出错了' 2200
      } elseif ($doneSeq -gt $script:seenDone) {
        $script:seenDone = $doneSeq
        Add-Anim 'laughC' 3 $true
        Add-Anim 'wave' 1
        Show-Bubble '哈哈哈哈哈哈哈哈' 2600
        Play-Laugh 4200
      } elseif ($toolSeq -gt $script:seenTool) {
        $script:seenTool = $toolSeq
        Add-Anim 'runR' 2
      }
      if ($doneSeq -gt $script:seenDone) { $script:seenDone = $doneSeq }
      if ($toolSeq -gt $script:seenTool) { $script:seenTool = $toolSeq }
      if ($errorSeq -gt $script:seenError) { $script:seenError = $errorSeq }
    }
  }

  # 选当前动画
  $name = if ($script:queue.Count -gt 0) { $script:queue[0].name } else { Base-Anim }
  $spec = $script:Anims[$name]
  if ($null -eq $spec) { $spec = $script:Anims['idle'] }

  if ($name -ne $script:animName) {
    $script:animName = $name
    $script:frameIndex = 0
    $script:frameAcc = 0.0
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

  # 画帧
  $frame = $spec.frames[$script:frameIndex]
  $script:brush.Viewbox = New-Object System.Windows.Rect ($frame * $cellW), ($spec.row * $cellH), $cellW, $cellH
})

# --- 交互 ---------------------------------------------------------------------
$sprite.Add_MouseLeftButtonDown({
  $before = @{ left = $win.Left; top = $win.Top }
  try { $win.DragMove() } catch { }
  $moved = ([Math]::Abs($win.Left - $before.left) -gt 3) -or ([Math]::Abs($win.Top - $before.top) -gt 3)
  if ($moved) {
    try { Set-Content -LiteralPath $posPath -Value ("{0},{1}" -f [int]$win.Left, [int]$win.Top) -Encoding ascii } catch { }
    return
  }
  # 没移动 = 点了一下
  $now = [DateTime]::Now
  if (($now - $script:lastClick).TotalMilliseconds -le 1600) { $script:clickStreak += 1 } else { $script:clickStreak = 1 }
  $script:lastClick = $now
  switch ($script:clickStreak) {
    1 { Add-Anim 'wave' 1 $true; Show-Bubble (Pick @('嗨～','在呢在呢','有事吗？','戳我干嘛～')) }
    2 { Add-Anim 'pat' 2 $true;  Show-Bubble (Pick @('嘿嘿～','舒服～','再来一下','咕噜咕噜')) }
    3 { Add-Anim 'laughA' 2 $true; Show-Bubble '痒～哈哈哈' }
    4 { Add-Anim 'laughC' 1 $true; Show-Bubble '哈哈哈哈哈哈哈哈'; Play-Laugh 1800 }
    default {
      if ($script:clickStreak -ge 7) {
        $script:clickStreak = 0
        Add-Anim 'idleB' 2 $true
        Show-Bubble (Pick @('别戳啦！','晕了晕了','再戳要生气咯','住手住手'))
      } else {
        Add-Anim 'laughC' 1 $true; Show-Bubble '哈哈哈哈哈哈哈哈'; Play-Laugh 1800
      }
    }
  }
})

$menu = New-Object System.Windows.Controls.ContextMenu
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
$null = $menu.Items.Add($itemReset)
$null = $menu.Items.Add((New-Object System.Windows.Controls.Separator))
$null = $menu.Items.Add($itemQuit)
$sprite.ContextMenu = $menu

$win.Add_Closed({
  try { $timer.Stop() } catch { }
  try { $player.Stop(); $player.Close() } catch { }
  try { $psJob.Stop(); $psJob.Dispose(); $rs.Close(); $rs.Dispose() } catch { }
})

# --- 启动 ---------------------------------------------------------------------
$timer.Start()
Show-Bubble '奶龙来了～' 2000
$null = $win.ShowDialog()
