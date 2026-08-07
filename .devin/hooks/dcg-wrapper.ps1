# dcg-wrapper.ps1 — bridges dcg (Destructive Command Guard) into Devin CLI's PreToolUse hook.
#
# Why this exists:
#   dcg only evaluates commands when tool_name matches known agent tool names
#   (e.g. "Bash" for Claude Code). Devin's exec tool is named "exec", so dcg
#   skips it and allows everything. This wrapper extracts the command from
#   Devin's hook JSON and evaluates it via `dcg test`, then translates the
#   result into Devin's hook output format.
#
# Input (stdin):  Devin PreToolUse hook JSON — { tool_name, tool_input: { command } }
# Output (stdout): { "decision": "block", "reason": "..." } when denied
# Exit codes:      0 = allow, 2 = block (Devin convention)

$ErrorActionPreference = "Stop"

try {
    $raw = [Console]::In.ReadToEnd()

    # Empty stdin — nothing to evaluate
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $hook = $raw | ConvertFrom-Json

    # Only evaluate shell commands from the exec tool
    if ($hook.tool_name -ne "exec") { exit 0 }

    $command = $hook.tool_input.command
    if ([string]::IsNullOrWhiteSpace($command)) { exit 0 }

    # Fail open with a visible warning if dcg is not on PATH — silent fail-open
    # gives a false sense that destructive commands are being guarded.
    if (-not (Get-Command dcg -ErrorAction SilentlyContinue)) {
        [Console]::Error.WriteLine("dcg-wrapper: dcg binary not found on PATH — command NOT guarded. Install dcg and ensure it is on PATH.")
        exit 0
    }

    # Evaluate against the strict Devin-only config (.devin/dcg-devin.toml), NOT the
    # user's own dcg config. The user config deliberately permits `doppler run`, `gh`
    # and `git push` because the orchestrator needs them; Devin must never run any of
    # them. Explicit `-c` also sidesteps automatic project-config discovery, which dcg
    # refuses on Windows ("native ACL and reparse-point validation is unavailable").
    #
    # Fail CLOSED if the config is missing: without it every prohibition silently
    # disappears, which is worse than refusing to run.
    $devinConfig = Join-Path $env:DEVIN_PROJECT_DIR ".devin/dcg-devin.toml"
    if (-not (Test-Path $devinConfig)) {
        $reason = "dcg-wrapper: .devin/dcg-devin.toml is missing — refusing to run unguarded."
        [Console]::Error.WriteLine($reason)
        Write-Output (@{ decision = "block"; reason = $reason } | ConvertTo-Json -Compress)
        exit 2
    }

    # --stdin avoids command-line injection; 2>$null suppresses config discovery noise.
    $json = $command | dcg test -c "$devinConfig" --stdin --format json 2>$null

    if ([string]::IsNullOrWhiteSpace($json)) { exit 0 }

    $result = $json | ConvertFrom-Json

    if ($result.decision -eq "deny") {
        $reason = if ($result.reason) { $result.reason } else { "Command blocked by dcg (Destructive Command Guard)." }
        $block = @{ decision = "block"; reason = $reason } | ConvertTo-Json -Compress
        Write-Output $block
        exit 2
    }

    # allow or any other decision — let it through
    exit 0
} catch {
    # Fail open on any unexpected error — don't block work due to a wrapper bug
    exit 0
}
