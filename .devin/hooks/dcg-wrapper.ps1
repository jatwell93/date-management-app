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

    # Evaluate via dcg test (--stdin avoids command-line injection;
    # 2>$null suppresses the .dcg.toml ACL warning on Windows)
    $json = $command | dcg test --stdin --format json 2>$null

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
