# Collect GA4 tables for ad-funnel-analysis from the owner's signed-in Edge (read-only): sessions and funnel events by
# session campaign, source / medium, and visitor city/country (to spot ad-review bots). GA4 days use the property's
# reporting time zone.
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
$funnel = Get-Content (Join-Path $skillDir 'funnel.json') -Raw | ConvertFrom-Json
$edgeProfile = if ($site.edge.profileDirectory) { $site.edge.profileDirectory } else { 'Default' }
$gaDir = Join-Path $OutDir 'ga4'
New-Item -ItemType Directory -Force -Path $gaDir | Out-Null

$d0 = $Since -replace '-', ''
$d1 = $Until -replace '-', ''
$prop = "a$($site.ga4.accountId)p$($site.ga4.propertyId)"
$key = $funnel.ga4.keyEvent

function Get-AcquisitionUrl([string]$Dimension, [string]$EventName) {
  $dim = if ($Dimension) { "%26_r.explorerCard..seldim%3D%5B%22$Dimension%22%5D" } else { '' }
  $params = "_u..nav%3Dmaui%26_u.comparisonOption%3Ddisabled%26_u.date00%3D$d0%26_u.date01%3D$d1" + $dim +
    "%26_r.explorerCard..columnFilters%3D%7B%22event%22:%22$EventName%22,%22conversionEvent%22:%22$key%22,%22sessionConversionRate%22:%22$key%22%7D"
  "https://analytics.google.com/analytics/web/#/$prop/reports/explorer?params=$params&collectionId=business-objectives&ruid=lifecycle-traffic-acquisition-v2,business-objectives,generate-leads&r=lifecycle-traffic-acquisition-v2"
}
function Get-UserUrl([string]$Dimension, [string]$Report) {
  "https://analytics.google.com/analytics/web/#/$prop/reports/explorer?params=_u..nav%3Dmaui%26_u.comparisonOption%3Ddisabled%26_u.date00%3D$d0%26_u.date01%3D$d1%26_r.explorerCard..seldim%3D%5B%22$Dimension%22%5D&r=$Report&collectionId=user"
}

# GA4 shows 10 rows per page; when a table has more, pick the largest page size (a view setting, not saved).
function Expand-Rows($Window, [string[]]$Lines) {
  $m = [regex]::Match(($Lines -join "`n"), '\[text\] (\d+)-(\d+) of (\d+)')
  if (-not $m.Success -or [int]$m.Groups[2].Value -ge [int]$m.Groups[3].Value) { return $Lines }
  $combo = Find-EdgeElement $Window -NamePattern '^Rows per page' -ControlType ComboBox | Select-Object -First 1
  if (-not $combo -or -not (Invoke-EdgeElement $combo)) { return $Lines }
  Start-Sleep -Seconds 1
  $types = [System.Windows.Automation.ControlType]::ListItem, [System.Windows.Automation.ControlType]::MenuItem
  $opt = Find-EdgeElement $Window -NamePattern '^(500|250|100|50|25)$' | Where-Object { $types -contains $_.Current.ControlType } |
    Sort-Object { [int]$_.Current.Name } -Descending | Select-Object -First 1
  if (-not $opt -or -not (Invoke-EdgeElement $opt)) { return $Lines }
  $all = $m.Groups[3].Value
  $page = Wait-EdgeText $Window -ReadyPattern "\[text\] 1-$all of $all" -TimeoutSec 20 -SettleSec 1
  if ($page.Ready) { $page.Lines } else { $Lines }
}

$eventKeys = if ($Quick) { @($funnel.ga4.quickEvents) } else { @($funnel.ga4.events.PSObject.Properties.Name) }
$reads = New-Object System.Collections.Generic.List[object]
foreach ($k in $eventKeys) {
  $reads.Add(@{ File = "campaign-$k.txt"; Url = (Get-AcquisitionUrl 'sessionCampaignName' $funnel.ga4.events.$k) })
}
$reads.Add(@{ File = 'source-medium.txt'; Url = (Get-AcquisitionUrl 'sessionSourceMedium' $funnel.ga4.events.cta) })
# No dimension = the report's default, the session channel group (Paid Social, Unassigned, Cross-network, ...).
$reads.Add(@{ File = 'channel.txt'; Url = (Get-AcquisitionUrl '' $funnel.ga4.events.cta) })
if (-not $Quick) {
  $reads.Add(@{ File = 'city.txt'; Url = (Get-UserUrl 'city' 'user-demographics-detail') })
  $reads.Add(@{ File = 'country.txt'; Url = (Get-UserUrl 'country' 'user-demographics-detail') })
}

$status = New-Object System.Collections.Generic.List[object]
foreach ($r in $reads) {
  $ok = $false
  $err = $null
  for ($attempt = 1; $attempt -le 2 -and -not $ok; $attempt++) {
    $w = $null
    try {
      $w = Open-EdgeWindow -Url $r.Url -ProfileDirectory $edgeProfile
      $page = Wait-EdgeText $w -ReadyPattern '\[row\] Checkbox for total row|There is no data for this report' -TimeoutSec 90 -SettleSec 2
      $lines = if ($page.Ready) { Expand-Rows $w $page.Lines } else { $page.Lines }
      $lines | Set-Content -Encoding utf8 (Join-Path $gaDir $r.File)
      $ok = $page.Ready
      if (-not $ok) { $err = 'the report did not finish loading (signed in to GA4 in this Edge profile?)' }
    } catch { $err = $_.Exception.Message } finally { Close-EdgeWindow $w }
  }
  $status.Add([pscustomobject]@{ name = $r.File; ok = $ok; error = $(if ($ok) { $null } else { $err }) })
  Write-Host ("ga4 {0,-28} {1}" -f $r.File, $(if ($ok) { 'read' } else { 'NOT READY' }))
}
[pscustomobject]@{ since = $Since; until = $Until; timezone = $site.ga4.timezone; collectedAt = (Get-Date).ToUniversalTime().ToString('o'); items = $status } |
  ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $gaDir 'collect.json')
