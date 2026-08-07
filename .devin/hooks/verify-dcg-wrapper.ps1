# verify-dcg-wrapper.ps1 — regression test for the Devin dcg guard.
#
# Run:  pwsh -NoProfile -File .devin/hooks/verify-dcg-wrapper.ps1
#
# Exercises the real PreToolUse path end to end: builds Devin hook JSON, pipes it
# into dcg-wrapper.ps1, and asserts the exit code. 2 = blocked, 0 = allowed.
#
# Why this exists: .devin/config.local.json grants Devin a broad `Exec(git)` and
# `Exec(gh pr)`, so the wrapper is not a backstop behind Devin's own permission
# system — it is the only thing preventing a push, a deploy, or `doppler run`
# handing live production secrets to a third-party agent. A guard that load-bearing
# needs a test that fails loudly when someone weakens it.

$ErrorActionPreference = "Stop"

# $PSCommandPath is <repo>/.devin/hooks/verify-dcg-wrapper.ps1 — three levels up.
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$env:DEVIN_PROJECT_DIR = $repoRoot
$wrapper = Join-Path $repoRoot ".devin/hooks/dcg-wrapper.ps1"

if (-not (Test-Path $wrapper)) {
    Write-Host "FAIL: wrapper not found at $wrapper" -ForegroundColor Red
    exit 1
}

# Commands Devin must never run. Sourced from the delegate skill's non-negotiables.
$mustBlock = @(
    'git push origin main',
    'git push --force origin feature/x',
    'gh pr create --title x --body y',
    'gh issue close 455',
    'doppler run -- npm test',
    'doppler run -- npx wrangler deploy',
    'doppler secrets download --no-file',
    'npx wrangler deploy --env production',
    'wrangler secret put NEON_CONNECTION_STRING',
    'neonctl branches delete production',
    'psql "postgresql://u:p@h/db" -c "SELECT 1"',
    'npx prisma migrate deploy',
    'git commit -m "wip"'
)

# Commands Devin legitimately needs in order to verify its own work.
$mustAllow = @(
    'npm run test:migrations',
    'npm run test:db',
    'npm run compile',
    'npx vitest run src/health.test.ts',
    'node --test build/src/database/migrations/log.test.js',
    'npx eslint src/database/migrations/log.ts',
    'npx tsc --noEmit -p tsconfig.json',
    'git status --porcelain',
    'git diff --stat',
    'ls -la src/database/migrations'
)

function Invoke-Guard([string]$Command) {
    $payload = @{ tool_name = "exec"; tool_input = @{ command = $Command } } | ConvertTo-Json -Compress
    $null = $payload | & pwsh -NoProfile -File $wrapper 2>$null
    return $LASTEXITCODE
}

$failures = 0

Write-Host "`n== Must BLOCK (expect exit 2) ==" -ForegroundColor Cyan
foreach ($c in $mustBlock) {
    $code = Invoke-Guard $c
    if ($code -eq 2) {
        Write-Host ("  BLOCKED  {0}" -f $c) -ForegroundColor Green
    } else {
        Write-Host ("  LEAKED   {0}   (exit {1}, expected 2)" -f $c, $code) -ForegroundColor Red
        $failures++
    }
}

Write-Host "`n== Must ALLOW (expect exit 0) ==" -ForegroundColor Cyan
foreach ($c in $mustAllow) {
    $code = Invoke-Guard $c
    if ($code -eq 0) {
        Write-Host ("  allowed  {0}" -f $c) -ForegroundColor Green
    } else {
        Write-Host ("  BLOCKED  {0}   (exit {1}, expected 0)" -f $c, $code) -ForegroundColor Red
        $failures++
    }
}

# A missing config must fail closed, not silently unguard every command above.
Write-Host "`n== Fail-closed on missing config ==" -ForegroundColor Cyan
$config = Join-Path $repoRoot ".devin/dcg-devin.toml"
$backup = "$config.verify-bak"
if (Test-Path $config) {
    Move-Item $config $backup -Force
    try {
        $code = Invoke-Guard 'npm run test:migrations'
        if ($code -eq 2) {
            Write-Host "  fails closed when .devin/dcg-devin.toml is absent" -ForegroundColor Green
        } else {
            Write-Host ("  FAILS OPEN (exit {0}, expected 2) — a missing config would silently unguard everything" -f $code) -ForegroundColor Red
            $failures++
        }
    } finally {
        Move-Item $backup $config -Force
    }
} else {
    Write-Host "  SKIP: .devin/dcg-devin.toml not present" -ForegroundColor Yellow
    $failures++
}

Write-Host ""
if ($failures -eq 0) {
    Write-Host "PASS - guard holds on all $($mustBlock.Count + $mustAllow.Count) commands plus the fail-closed check." -ForegroundColor Green
    exit 0
} else {
    Write-Host "FAIL - $failures problem(s). Do NOT run Devin in bypass mode until this passes." -ForegroundColor Red
    exit 1
}
