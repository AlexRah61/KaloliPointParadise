# ad-funnel-analysis: collect (stored leads, website visits, Meta Ads, GA4) -> analyze -> report -> PDF, in one command.
#   pwsh -File .github/skills/ad-funnel-analysis/scripts/run.ps1 [-Since yyyy-MM-dd] [-Until yyyy-MM-dd] [-Quick] [-Publish]
#   pwsh -File .github/skills/ad-funnel-analysis/scripts/run.ps1 -RunDir reports/ad-funnel-analysis/<run-id>   # re-analyze only
# Meta and GA4 are read in temporary windows of the owner's signed-in Edge profile (read-only; nothing is edited).
# The PDF goes to "daily ad report/" in the repository; -Publish commits only that file and pushes it.
param(
  [string]$Since,
  [string]$Until,
  [switch]$Quick,
  [switch]$SkipMeta,
  [switch]$SkipMetaCharts,
  [switch]$SkipGa4,
  [switch]$SkipSite,
  [switch]$SkipLeads,
  [switch]$NoPdf,
  [switch]$Publish,
  [string]$RunDir
)
$ErrorActionPreference = 'Stop'
$skillDir = Split-Path -Parent $PSScriptRoot
$repo = (Resolve-Path (Join-Path $skillDir '..\..\..')).Path
$shared = Join-Path (Split-Path -Parent $skillDir) '_shared'
$siteCfgPath = Join-Path $shared 'site.local.json'
if (-not (Test-Path $siteCfgPath)) { throw "Missing $siteCfgPath (copy site.example.json and fill in the IDs)." }
$site = Get-Content $siteCfgPath -Raw | ConvertFrom-Json
$funnel = Get-Content (Join-Path $skillDir 'funnel.json') -Raw | ConvertFrom-Json
$node = (Get-Command node -ErrorAction Stop).Source

$zone = [TimeZoneInfo]::FindSystemTimeZoneById($site.meta.timezone)
$now = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $zone)
if (-not $Until) { $Until = $now.ToString('yyyy-MM-dd') }
if (-not $Since) { $Since = $now.AddDays( - ([int]$funnel.defaults.lookbackDays - 1)).ToString('yyyy-MM-dd') }
foreach ($d in $Since, $Until) { if ($d -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Dates must be yyyy-MM-dd (got '$d')." } }
if ($Since -gt $Until) { throw "-Since $Since is after -Until $Until." }

function Invoke-Step([string]$Name, [scriptblock]$Body) {
  $t = Get-Date
  Write-Host "== $Name"
  try {
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE) { Write-Warning "$Name exited with code $LASTEXITCODE" }
  } catch { Write-Warning "$Name failed: $($_.Exception.Message)" }
  Write-Host ("   {0:n0} s" -f ((Get-Date) - $t).TotalSeconds)
}

if ($RunDir) {
  $dir = (Resolve-Path $RunDir).Path
} else {
  if (-not ($SkipMeta -and $SkipGa4)) {
    Import-Module (Join-Path $shared 'EdgeSession.psm1') -Force -DisableNameChecking
    if (Test-EdgeDesktopLocked) { throw 'The Windows session is locked: Edge cannot show or read Meta and GA4 pages. Unlock the PC (keep it awake during the run) and rerun, or use -SkipMeta -SkipGa4.' }
  }
  $dir = Join-Path $repo "reports\ad-funnel-analysis\$($now.ToString('yyyy-MM-ddTHHmm'))"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $skipped = @()
  if ($SkipMeta) { $skipped += 'meta' }
  if ($SkipGa4) { $skipped += 'ga4' }
  if ($SkipSite) { $skipped += 'site' }
  if ($SkipLeads) { $skipped += 'leads' }
  [ordered]@{
    runId = Split-Path $dir -Leaf
    since = $Since
    until = $Until
    quick = [bool]$Quick
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    metaTimezone = $site.meta.timezone
    ga4Timezone = $site.ga4.timezone
    skipped = $skipped
  } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $dir 'run.json')
  Write-Host "Run folder: $dir  (window $Since .. $Until, $($site.meta.timezone)$(if ($Quick) { ', quick' }))"

  Push-Location $repo
  try {
    if (-not $SkipLeads) { Invoke-Step 'Stored tour requests (D1)' { & $node (Join-Path $PSScriptRoot 'collect-leads.mjs') --since $Since --until $Until --out (Join-Path $dir 'leads.json') } }
    if (-not $SkipMeta -or -not $SkipGa4) { Write-Host 'Edge windows will open and close by themselves for Meta and GA4; please do not type in them.' }
    if (-not $SkipMeta) { Invoke-Step 'Meta Ads (Edge)' { & (Join-Path $PSScriptRoot 'collect-meta.ps1') -Since $Since -Until $Until -OutDir $dir -Quick:$Quick } }
    if (-not $SkipMeta -and -not $SkipMetaCharts) { Invoke-Step 'Meta insight charts and campaign settings (Edge)' { & (Join-Path $PSScriptRoot 'collect-meta-insights.ps1') -Since $Since -Until $Until -OutDir $dir -Settings } }
    if (-not $SkipGa4) { Invoke-Step 'GA4 (Edge)' { & (Join-Path $PSScriptRoot 'collect-ga4.ps1') -Since $Since -Until $Until -OutDir $dir -Quick:$Quick } }
    # Cloudflare last: its query budget recovers while the browser steps run, which matters for back-to-back runs.
    if (-not $SkipSite) { Invoke-Step 'Website visits (Cloudflare)' { & $node (Join-Path $PSScriptRoot 'collect-site.mjs') --since $Since --until $Until --out (Join-Path $dir 'site.json') --leads (Join-Path $dir 'leads.json') } }
  } finally { Pop-Location }
}

& $node (Join-Path $PSScriptRoot 'analyze.mjs') --run $dir
if ($LASTEXITCODE) { throw 'analyze failed' }
& $node (Join-Path $PSScriptRoot 'report.mjs') --run $dir
if ($LASTEXITCODE) { throw 'report failed' }
Write-Host "Report: $(Join-Path $dir 'report.md')"
Write-Host "        $(Join-Path $dir 'report.html')"
if ($NoPdf) { return }

& $node (Join-Path $PSScriptRoot 'export-pdf.mjs') --run $dir
if ($LASTEXITCODE) { Write-Warning "The PDF was not filed in the repository (export-pdf exit code $LASTEXITCODE)."; return }
$pdf = Get-Content (Join-Path $dir 'pdf.json') -Raw | ConvertFrom-Json
Write-Host "PDF:    $($pdf.repoPath)"
if (-not $Publish) { return }

# Commit only the new PDF (other staged work stays staged) and push it when it is the only unpushed commit.
Push-Location $repo
try {
  git add -- $pdf.repoPath
  git commit --quiet -m "Daily ad report: $([IO.Path]::GetFileNameWithoutExtension($pdf.name))" -- $pdf.repoPath
  if ($LASTEXITCODE) { Write-Warning 'git commit failed; the PDF is saved but not committed.'; return }
  $ahead = git rev-list --count '@{u}..HEAD' 2>$null
  if ($ahead -ne '1') { Write-Warning "Committed locally but not pushed: $(if ($ahead) { "$ahead commits" } else { 'no upstream branch' }) ahead of the remote. Push them yourself."; return }
  git push --quiet
  if ($LASTEXITCODE) { Write-Warning 'git push failed; the report is committed locally.' } else { Write-Host 'Published: committed and pushed.' }
} finally { Pop-Location }
