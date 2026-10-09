# Collect Meta Ads data for ad-funnel-analysis from the owner's signed-in Edge. Read-only: CSV exports from Ads
# Reporting, the ads / ad sets / campaigns tables (status, budget, optimisation, URL parameters) and A/B test pages.
# Nothing is edited, published or saved in Meta; temporary report views are closed without saving.
param(
  [Parameter(Mandatory)][string]$Since,
  [Parameter(Mandatory)][string]$Until,
  [Parameter(Mandatory)][string]$OutDir,
  [switch]$Quick
)
$ErrorActionPreference = 'Stop'
$skillDir = Split-Path -Parent $PSScriptRoot
$shared = Join-Path (Split-Path -Parent $skillDir) '_shared'
Import-Module (Join-Path $shared 'EdgeSession.psm1') -Force -DisableNameChecking
$site = Get-Content (Join-Path $shared 'site.local.json') -Raw | ConvertFrom-Json
$cfgPath = Join-Path $skillDir 'campaigns.local.json'
$cfg = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw | ConvertFrom-Json } else { $null }
$edgeProfile = if ($site.edge.profileDirectory) { $site.edge.profileDirectory } else { 'Default' }
$metaDir = Join-Path $OutDir 'meta'
New-Item -ItemType Directory -Force -Path $metaDir | Out-Null

function Get-ZonedToday([string]$TimeZone) {
  try {
    $z = [TimeZoneInfo]::FindSystemTimeZoneById($TimeZone)
    return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $z).ToString('yyyy-MM-dd')
  } catch { return (Get-Date).ToString('yyyy-MM-dd') }
}
function Add-Day([string]$Date, [int]$N) { ([datetime]::ParseExact($Date, 'yyyy-MM-dd', $null)).AddDays($N).ToString('yyyy-MM-dd') }

# Edge saves exports to its download folder (Preferences > download.default_directory, else the user's Downloads).
function Get-EdgeDownloadDir {
  $prefs = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data\$edgeProfile\Preferences"
  try {
    $dir = (Get-Content $prefs -Raw | ConvertFrom-Json).download.default_directory
    if ($dir -and (Test-Path $dir)) { return $dir }
  } catch {}
  Join-Path $env:USERPROFILE 'Downloads'
}

$act = $site.meta.adAccountId
$biz = $site.meta.businessId
$today = Get-ZonedToday $site.meta.timezone
$yesterday = Add-Day $today -1
$range = "${Since}_$(Add-Day $Until 1)"
$todayRange = "${today}_$(Add-Day $today 1)"
$yesterdayRange = "${yesterday}_$today"
$downloads = Get-EdgeDownloadDir

# Meta refuses some combinations: hourly cannot be combined with country, age or reach.
# When = the day(s) that must have delivery in the daily export; exports for days without delivery are skipped.
$hourly = 'campaign_name,hourly_stats_aggregated_by_advertiser_time_zone'
$reports = @(
  [pscustomobject]@{ Name = 'daily'; Breakdowns = 'campaign_name,adset_name,ad_name,days_1'; Metrics = 'impressions,reach,inline_link_clicks,actions:landing_page_view,actions:offsite_conversion.fb_pixel_lead,spend'; Range = $range; When = $null },
  [pscustomobject]@{ Name = 'country'; Breakdowns = 'campaign_name,country'; Metrics = 'impressions,reach,inline_link_clicks,actions:landing_page_view,spend'; Range = $range; When = 'any' },
  [pscustomobject]@{ Name = 'country-today'; Breakdowns = 'campaign_name,country'; Metrics = 'impressions,reach,inline_link_clicks,actions:landing_page_view,spend'; Range = $todayRange; When = 'today' },
  [pscustomobject]@{ Name = 'hourly-today'; Breakdowns = $hourly; Metrics = 'impressions,inline_link_clicks,actions:landing_page_view,spend'; Range = $todayRange; When = 'today' },
  [pscustomobject]@{ Name = 'hourly-yesterday'; Breakdowns = $hourly; Metrics = 'impressions,inline_link_clicks,actions:landing_page_view,spend'; Range = $yesterdayRange; When = 'yesterday' }
)
if (-not $Quick) {
  $reports += @(
    [pscustomobject]@{ Name = 'country-daily'; Breakdowns = 'campaign_name,country,days_1'; Metrics = 'impressions,inline_link_clicks,actions:landing_page_view,spend'; Range = $range; When = 'any' },
    [pscustomobject]@{ Name = 'region'; Breakdowns = 'campaign_name,country,region'; Metrics = 'impressions,reach,inline_link_clicks,spend'; Range = $range; When = 'any' },
    [pscustomobject]@{ Name = 'age-gender'; Breakdowns = 'campaign_name,age,gender'; Metrics = 'impressions,reach,inline_link_clicks,actions:landing_page_view,spend'; Range = $range; When = 'any' },
    [pscustomobject]@{ Name = 'platform'; Breakdowns = 'campaign_name,publisher_platform'; Metrics = 'impressions,reach,inline_link_clicks,actions:landing_page_view,spend'; Range = $range; When = 'any' }
  )
}

function Export-MetaReport($Report) {
  $url = "https://adsmanager.facebook.com/adsmanager/reporting/view?act=$act&business_id=$biz&time_range=$($Report.Range)&metrics=$($Report.Metrics)&breakdowns=$($Report.Breakdowns)"
  $started = Get-Date
  $w = Open-EdgeWindow -Url $url -ProfileDirectory $edgeProfile
  try {
    $page = Wait-EdgeText $w -ReadyPattern 'rows displayed|Total results|No results|No data' -TimeoutSec 90 -SettleSec 4
    if (-not $page.Ready) { throw 'the report did not finish loading' }
    $exportButton = Find-EdgeElement $w -NamePattern '^Export$' -ControlType Button | Select-Object -First 1
    if (-not $exportButton -or -not (Invoke-EdgeElement $exportButton)) { throw 'no Export button' }
    Start-Sleep -Seconds 3
    $csv = Find-EdgeElement $w -NamePattern 'CSV' -ControlType RadioButton | Select-Object -First 1
    if ($csv) { [void](Invoke-EdgeElement $csv); Start-Sleep -Seconds 1 }
    $confirm = Find-EdgeElement $w -NamePattern '^Export$' -ControlType Button | Select-Object -Last 1
    [void](Invoke-EdgeElement $confirm)
    $file = $null
    for ($i = 0; $i -lt 45 -and -not $file; $i++) {
      Start-Sleep -Seconds 1
      $file = Get-ChildItem $downloads -File -Filter '*.csv' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $started -and $_.Length -gt 0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if (-not $file) { throw "no CSV arrived in $downloads" }
    Start-Sleep -Milliseconds 800
    $dest = Join-Path $metaDir "$($Report.Name).csv"
    Move-Item $file.FullName $dest -Force
    $rows = @(Import-Csv $dest)
    [pscustomobject]@{
      name = $Report.Name; ok = $true; rows = $rows.Count; requested = $Report.Range
      reportingStarts = (@($rows | ForEach-Object { $_.'Reporting starts' }) | Sort-Object -Unique) -join ','
      reportingEnds = (@($rows | ForEach-Object { $_.'Reporting ends' }) | Sort-Object -Unique) -join ','
    }
  } finally { Close-EdgeWindow $w }
}

function Read-MetaPage([string]$Url, [string]$ReadyPattern, [string]$File) {
  $w = Open-EdgeWindow -Url $Url -ProfileDirectory $edgeProfile
  try {
    $page = Wait-EdgeText $w -ReadyPattern $ReadyPattern -TimeoutSec 90 -SettleSec 4
    $page.Lines | Set-Content -Encoding utf8 (Join-Path $metaDir $File)
    [pscustomobject]@{ name = $File; ok = $page.Ready; lines = $page.Lines.Count }
  } finally { Close-EdgeWindow $w }
}

$status = New-Object System.Collections.Generic.List[object]
$deliveryDays = $null
foreach ($r in $reports) {
  if ($r.When -and $null -ne $deliveryDays) {
    $need = switch ($r.When) { 'today' { $today } 'yesterday' { $yesterday } default { $null } }
    $has = if ($need) { $deliveryDays -contains $need } else { $deliveryDays.Count -gt 0 }
    if (-not $has) {
      $status.Add([pscustomobject]@{ name = $r.Name; ok = $true; rows = 0; requested = $r.Range; skipped = 'no delivery' })
      Write-Host ("meta {0,-16} skipped (no delivery {1})" -f $r.Name, $(if ($need) { "on $need" } else { 'in the window' }))
      continue
    }
  }
  $result = $null
  for ($attempt = 1; $attempt -le 2 -and -not $result; $attempt++) {
    try { $result = Export-MetaReport $r }
    catch {
      if ($attempt -eq 2) { $result = [pscustomobject]@{ name = $r.Name; ok = $false; error = $_.Exception.Message; requested = $r.Range } }
    }
  }
  $status.Add($result)
  Write-Host ("meta {0,-16} {1}" -f $r.Name, $(if ($result.ok) { "$($result.rows) rows ($($result.reportingStarts)..$($result.reportingEnds))" } else { "FAILED: $($result.error)" }))
  if ($r.Name -eq 'daily' -and $result.ok) {
    $deliveryDays = @(Import-Csv (Join-Path $metaDir 'daily.csv') | ForEach-Object { $_.Day } | Where-Object { $_ } | Sort-Object -Unique)
  }
}

$tables = @(
  @{ Level = 'ads'; Columns = 'name,adset_name,campaign_name,delivery,url_tags,website_url' },
  @{ Level = 'adsets'; Columns = 'name,campaign_name,delivery,budget,bid,last_significant_edit,schedule,end_time' },
  @{ Level = 'campaigns'; Columns = 'name,delivery,objective,budget,schedule,end_time,last_significant_edit' }
)
foreach ($t in $tables) {
  try {
    $res = Read-MetaPage "https://adsmanager.facebook.com/adsmanager/manage/$($t.Level)?act=$act&business_id=$biz&columns=$($t.Columns)" 'Results from \d+' "table-$($t.Level).txt"
    $status.Add($res)
    Write-Host ("meta table {0,-9} {1}" -f $t.Level, $(if ($res.ok) { "$($res.lines) lines" } else { 'NOT READY (partial text saved)' }))
  } catch {
    $status.Add([pscustomobject]@{ name = "table-$($t.Level).txt"; ok = $false; error = $_.Exception.Message })
    Write-Host "meta table $($t.Level) FAILED: $($_.Exception.Message)"
  }
}

$n = 0
foreach ($e in @($cfg.experiments)) {
  if (-not $e.url) { continue }
  $n++
  try {
    $res = Read-MetaPage $e.url 'Key metric|Duration' "experiment-$n.txt"
    $status.Add($res)
    Write-Host "meta experiment $n $(if ($res.ok) { 'read' } else { 'NOT READY' })"
  } catch {
    $status.Add([pscustomobject]@{ name = "experiment-$n.txt"; ok = $false; error = $_.Exception.Message })
  }
}

[pscustomobject]@{ since = $Since; until = $Until; today = $today; timezone = $site.meta.timezone; collectedAt = (Get-Date).ToUniversalTime().ToString('o'); items = $status } |
  ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $metaDir 'collect.json')
