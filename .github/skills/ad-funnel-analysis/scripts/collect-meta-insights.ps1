# Capture the charts on Meta Ads Manager's campaign insights page (the "View charts" page) for every campaign that
# spent in the window, and with -Settings read each campaign's settings from the read-only Review tab.
# View-only clicks: a campaign's View button, the chart's metric cards, the Demographics / Platform tabs and the Review
# tab. Nothing is edited or saved; the date range comes from the URL, so the owner's own date preset is left alone.
param(
  [Parameter(Mandatory)][string]$Since,
  [Parameter(Mandatory)][string]$Until,
  [Parameter(Mandatory)][string]$OutDir,
  [switch]$Settings
)
$ErrorActionPreference = 'Stop'
$skillDir = Split-Path -Parent $PSScriptRoot
$shared = Join-Path (Split-Path -Parent $skillDir) '_shared'
Import-Module (Join-Path $shared 'EdgeSession.psm1') -Force -DisableNameChecking
$site = Get-Content (Join-Path $shared 'site.local.json') -Raw | ConvertFrom-Json
$edgeProfile = if ($site.edge.profileDirectory) { $site.edge.profileDirectory } else { 'Default' }
$act = $site.meta.adAccountId
$biz = $site.meta.businessId
$dir = Join-Path $OutDir 'meta\insights'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Add-Day([string]$Date, [int]$N) { ([datetime]::ParseExact($Date, 'yyyy-MM-dd', $null)).AddDays($N).ToString('yyyy-MM-dd') }
$range = "${Since}_$(Add-Day $Until 1)"
$base = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns'
$overviewUrl = "$base/insights?act=$act&business_id=$biz&insights_date=$range"
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Get-Slug([string]$Text) { (($Text.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')) }
function Get-Named($w, [string]$Name, [string]$Type) {
  Find-EdgeElement $w -NamePattern ('^' + [regex]::Escape($Name) + '$') | Where-Object { $_.Current.LocalizedControlType -eq $Type } | Select-Object -First 1
}
function Get-DocRect($w) {
  $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  $w.Element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c).Current.BoundingRectangle
}
# The insights pane keeps its title and date picker pinned at the top; cards scrolled under it are hidden.
function Get-PinnedBottom($w) {
  $d = Find-EdgeElement $w -NamePattern '^([A-Za-z0-9 ]+: )?[A-Z][a-z]{2} \d{1,2}, \d{4}( [–-] [A-Z][a-z]{2} \d{1,2}, \d{4})?$' -ControlType Button | Select-Object -First 1
  if ($d) { $d.Current.BoundingRectangle.Bottom + 12 } else { (Get-DocRect $w).Top }
}
# Save the part of $Rect that is on screen; returns the file name, or $null when less than 60% of it is visible.
function Save-Card($w, [System.Windows.Rect]$Rect, [string]$File) {
  Show-EdgeWindow $w
  Start-Sleep -Milliseconds 600
  $doc = Get-DocRect $w
  $top = [Math]::Max($Rect.Top, (Get-PinnedBottom $w))
  $bottom = [Math]::Min($Rect.Bottom, $doc.Bottom)
  if ($bottom - $top -lt 0.6 * $Rect.Height) { return $null }
  Save-EdgeImage $w (Join-Path $dir $File) -Rect (New-Object System.Windows.Rect $Rect.X, $top, $Rect.Width, ($bottom - $top))
  $File
}
function Get-LowestElement($w, [double]$Left) {
  Find-EdgeElement $w -NamePattern '\S' | Where-Object { $r = $_.Current.BoundingRectangle; -not $r.IsEmpty -and $r.Left -ge $Left -and $r.Height -gt 0 } |
    Sort-Object { $_.Current.BoundingRectangle.Bottom } | Select-Object -Last 1
}

$campaigns = New-Object System.Collections.Generic.List[object]
$abFile = $null
$seen = @{}
$count = $null
for ($i = 0; $null -eq $count -or $i -lt $count; $i++) {
  $entry = [ordered]@{ name = $null; id = $null; spent = $null; charts = @(); settings = $null; errors = @() }
  $w = $null
  try {
    $w = Open-EdgeWindow -Url $overviewUrl -ProfileDirectory $edgeProfile
    $page = Wait-EdgeText $w -ReadyPattern 'Performance overview' -TimeoutSec 90 -SettleSec 3
    if (-not $page.Ready) { throw 'the insights page did not load (signed in to Ads Manager?)' }
    $views = @(Find-EdgeElement $w -NamePattern '^View$' -ControlType Button)
    if ($null -eq $count) { $count = [Math]::Min($views.Count, 12) }
    if ($i -ge $views.Count) { break }
    [void](Invoke-EdgeElement $views[$i])
    $detail = Wait-EdgeText $w -ReadyPattern 'Amount spent \S' -TimeoutSec 60 -SettleSec 4
    $entry.id = [regex]::Match((Get-EdgeAddress $w), 'selected_campaign_ids=(\d+)').Groups[1].Value
    if (-not $entry.id -or $seen.ContainsKey($entry.id)) { continue }
    $seen[$entry.id] = $true
    # The campaign name is the heading just before the "<n> Ad set" heading in the breadcrumb.
    $heads = @($detail.Lines | Where-Object { $_ -match '^\s*\[heading\] ' } | ForEach-Object { ($_ -replace '^\s*\[heading\] ', '').Trim() })
    $k = [array]::FindIndex([string[]]$heads, [Predicate[string]] { param($x) $x -match '^\d+ Ad sets?$' })
    $entry.name = if ($k -gt 0) { $heads[$k - 1] } else { $null }
    $entry.spent = ($detail.Lines | ForEach-Object { if ($_ -match '\[button\] Amount spent (\S+)') { $Matches[1] } } | Select-Object -First 1)
    if (-not $entry.name -or -not $entry.spent -or $entry.spent -match '^\$?0(\.00)?$|^[–-]+$') { continue }
    $slug = Get-Slug $entry.name

    # 1. Performance overview: one capture per metric card (the chart follows the selected card).
    $perfHead = Get-Named $w 'Performance overview' 'heading'
    $card = $walker.GetParent($perfHead).Current.BoundingRectangle
    $colX = $card.X - 6; $colW = $card.Width + 12
    $metricRe = '^(.+?) (\$?[\d,.]+[KkMm%]?|[–-]{2})$'
    $metrics = @(Find-EdgeElement $w -NamePattern $metricRe -ControlType Button | Where-Object {
        $r = $_.Current.BoundingRectangle; $r.Top -ge $card.Top -and $r.Bottom -le $card.Bottom -and $r.Left -ge $card.Left })
    $n = 0
    foreach ($m in $metrics) {
      $label = ([regex]::Match($m.Current.Name, $metricRe)).Groups[1].Value
      if ($n -gt 0) { [void](Invoke-EdgeElement $m); Start-Sleep -Milliseconds 2500 }
      $n++
      $rect = $walker.GetParent((Get-Named $w 'Performance overview' 'heading')).Current.BoundingRectangle
      $f = Save-Card $w (New-Object System.Windows.Rect $colX, ($rect.Top - 6), $colW, ($rect.Height + 12)) "$slug-performance-$(Get-Slug $label).png"
      if ($f) { $entry.charts += [ordered]@{ file = $f; kind = 'performance'; title = "Performance over time: $label" } }
    }

    # 2. Demographics (age and gender). The tab row sits right below the A/B test card, so scrolling it into view
    #    shows that card whole first.
    $demo = Get-Named $w 'Demographics' 'tab item'
    if ($demo) {
      Show-EdgeElement $demo
      [void](Invoke-EdgeElement $demo); Start-Sleep -Milliseconds 2000
      $ab = Get-Named $w 'A/B test results' 'heading'
      if ($ab -and -not $abFile) {
        $r = $walker.GetParent($ab).Current.BoundingRectangle
        if ($r.Bottom -gt (Get-DocRect $w).Bottom -or $r.Top -lt (Get-PinnedBottom $w)) { Show-EdgeElement $ab; $r = $walker.GetParent($ab).Current.BoundingRectangle }
        $abFile = Save-Card $w (New-Object System.Windows.Rect $colX, ($r.Top - 6), $colW, ($r.Height + 12)) 'ab-test.png'
      }
      $low = Get-LowestElement $w $colX
      if ($low) { Show-EdgeElement $low }
      $tab = (Get-Named $w 'Demographics' 'tab item').Current.BoundingRectangle
      $low = Get-LowestElement $w $colX
      $bottom = $low.Current.BoundingRectangle.Bottom + 24
      $f = Save-Card $w (New-Object System.Windows.Rect $colX, ($tab.Top - 16), $colW, ($bottom - $tab.Top + 16)) "$slug-demographics.png"
      if ($f) { $entry.charts += [ordered]@{ file = $f; kind = 'demographics'; title = 'Age and gender distribution' } }
    }

    # 3. Platform (placement per platform and device); the "See where your ads appeared" downloads below are left out.
    $plat = Get-Named $w 'Platform' 'tab item'
    if ($plat) {
      [void](Invoke-EdgeElement $plat); Start-Sleep -Milliseconds 2500
      $see = Get-Named $w 'See where your ads appeared' 'heading'
      $low = Get-LowestElement $w $colX
      if ($low) { Show-EdgeElement $low }
      $tab = (Get-Named $w 'Platform' 'tab item').Current.BoundingRectangle
      $see = Get-Named $w 'See where your ads appeared' 'heading'
      $bottom = if ($see) { $see.Current.BoundingRectangle.Top - 10 } else { (Get-LowestElement $w $colX).Current.BoundingRectangle.Bottom + 24 }
      $f = Save-Card $w (New-Object System.Windows.Rect $colX, ($tab.Top - 16), $colW, ($bottom - $tab.Top + 16)) "$slug-platform.png"
      if ($f) { $entry.charts += [ordered]@{ file = $f; kind = 'platform'; title = 'Placement per platform' } }
    }
  } catch {
    $entry.errors += $_.Exception.Message
  } finally { Close-EdgeWindow $w }

  # 4. Settings (Review tab): special ad category, budget, budget scheduling, bid strategy.
  if ($Settings -and $entry.id -and $entry.name) {
    $w = $null
    try {
      $w = Open-EdgeWindow -Url "$base/edit?act=$act&business_id=$biz&selected_campaign_ids=$($entry.id)" -ProfileDirectory $edgeProfile
      $edit = Wait-EdgeText $w -ReadyPattern 'Buying type|Campaign details' -TimeoutSec 60 -SettleSec 3
      if (-not $edit.Ready) { throw 'the campaign settings did not load' }
      $edit.Lines | Set-Content -Encoding utf8 (Join-Path $dir "settings-$slug-edit.txt")
      $review = Get-Named $w 'Review' 'tab item'
      if (-not $review) { throw 'no Review tab' }
      [void](Invoke-EdgeElement $review)
      $rv = Wait-EdgeText $w -ReadyPattern 'Special Ad Categor|Budget strategy' -TimeoutSec 30 -SettleSec 2
      $rv.Lines | Set-Content -Encoding utf8 (Join-Path $dir "settings-$slug-review.txt")
      $entry.settings = [ordered]@{ edit = "settings-$slug-edit.txt"; review = "settings-$slug-review.txt" }
    } catch {
      $entry.errors += "settings: $($_.Exception.Message)"
    } finally { Close-EdgeWindow $w }
  }
  if ($entry.name -or $entry.errors.Count) {
    $campaigns.Add($entry)
    Write-Host ("meta charts {0,-28} {1} chart(s){2}{3}" -f $(if ($entry.name) { $entry.name } else { "#$($i + 1)" }), $entry.charts.Count,
      $(if ($entry.settings) { ' + settings' }), $(if ($entry.errors.Count) { " ($($entry.errors -join '; '))" }))
  }
}
if ($abFile) { Write-Host 'meta charts A/B test card captured' }

[ordered]@{ range = $range; collectedAt = (Get-Date).ToUniversalTime().ToString('o'); abTest = $abFile; campaigns = $campaigns } |
  ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $dir 'insights.json')
