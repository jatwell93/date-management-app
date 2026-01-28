🤖 AI Agent Instructions: Ultimate Bug Scanner
Purpose

The Ultimate Bug Scanner (ubs) is a static analysis tool that must be run proactively during code development to catch bugs before they reach production. As an AI coding agent, you should integrate this scanner into your workflow automatically.
When to Run
✅ ALWAYS Run Before:

    Committing code changes
    Completing a feature implementation
    Finishing a bug fix
    Responding to "done" or "ready to commit"
    After writing more than 50 lines of new code in UBS-supported languages (JavaScript/TypeScript, Python, C/C++, Rust, Go, Java, Ruby, Swift)

✅ Run Upon Request:

    User asks "check code quality"
    User mentions "scan", "lint", or "analyze code"
    User requests "review my code"
    Before creating a pull request

❌ NEVER Run:

    For documentation-only changes (README, comments)
    For non-code files (JSON, YAML, Markdown)
    Multiple times in same session without code changes
    During active debugging sessions (unless requested)

How to Run
Basic Usage

# From project root
ubs .

# Verbose mode (show more examples)
ubs -v .

# Strict mode (fail on warnings)
ubs . --fail-on-warning

Integration Pattern

Recommended workflow:

    After Code Changes: Run scanner immediately

    ubs . 2>&1 | head -100

    Before Commit: Run with strict mode

    if ! ubs . --fail-on-warning; then
      echo "Fix issues before committing"
    fi

    Show Summary: Display findings to user

    ubs . 2>&1 | tail -30

Interpreting Results
Exit Codes

    0 = No critical issues (safe to proceed)
    1 = Critical issues found (MUST fix before committing)

Severity Levels

🔥 CRITICAL  → Fix IMMEDIATELY (crashes, security, data corruption)
⚠  Warning   → Fix before commit (bugs, performance, maintenance)
ℹ  Info      → Consider improvements (code quality, best practices)

Output Format

Summary Statistics:
  Files scanned:    61
  Critical issues:  12     ← BLOCK commits if > 0
  Warning issues:   156    ← Should fix before commit
  Info items:       423    ← Optional improvements

Required Actions

###if Critical Issues Found (Exit Code 1)

    Read the findings in the output
    Fix the critical issues before proceeding
    Re-run the scanner to verify fixes
    Only then proceed with commit/completion

Example response to user:

I've completed the implementation, but the bug scanner found 12 critical
issues that need to be fixed:

- 5 unguarded null pointer accesses in user-input.js:42-87
- 3 potential XSS vulnerabilities in render.js:156-203
- 4 missing await keywords in async-handler.js:23-67

Let me fix these issues before committing...

If Only Warnings Found (Exit Code 0)

    Mention the warnings to the user
    Offer to fix if time permits
    Proceed with commit if user approves

Example:

Implementation complete! The scanner found 23 warnings (no critical issues):
- 15 opportunities for optional chaining (?.)
- 8 potential division-by-zero edge cases

Would you like me to address these warnings before committing?
