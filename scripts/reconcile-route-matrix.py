"""
Reconcile the 2.1 route matrix against the Worker's LIVE route surface.

Answers one question per Express route: does a Worker route serve it today?
The matrix's own Decision column is treated as a CLAIM to be checked, never as
the answer -- several rows are known stale (3.1.d and 3.1.l shipped routes
without updating their dispositions).

Live surface = MINIMAL_API_ROUTES + the bootstrap dispatch + the public webhook
map + the upload router, i.e. everything reachable from index-minimal.ts, which
workers/build.js bundles.
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATRIX = os.path.join(
    ROOT, 'openspec', 'changes', 'retire-express-unify-on-postgres', 'audit', '2.1-route-matrix.md'
)
IDX = os.path.join(ROOT, 'workers', 'src', 'index-minimal.ts')
UPLOAD_ROUTER = os.path.join(ROOT, 'workers', 'src', 'upload', 'upload-router.ts')

# Known false positives, each checked by hand. The matrix writes these paths in
# a shape this matcher cannot resolve; they are not gaps.
#   POST /upload/direct -- the matrix row omits the `:key` segment the Worker
#       matches as a prefix. The sibling `/upload/direct/:key` row resolves LIVE.
#   GET  /             -- the Worker serves root metadata at `pathname === '/'`
#       in the fetch handler, which is not part of the route table this parses.
KNOWN_FALSE_POSITIVES = {('POST', '/api/upload/direct'), ('GET', '/api/')}

idx = io.open(IDX, encoding='utf-8').read()
router = io.open(UPLOAD_ROUTER, encoding='utf-8').read()

# ---------------------------------------------------------------- live routes
live = []  # (method, matcher-kind, pattern)

table = re.search(r'MINIMAL_API_ROUTES: MinimalApiRoute\[\] = \[(.*?)\n\];', idx, re.S).group(1)

# Resolve `const RE_X = /.../;` so regex-valued entries can be compared.
re_consts = dict(re.findall(r'const (RE_[A-Z0-9_]+)\s*=\s*/(.+?)/;', idx))

for m in re.finditer(r"\[\s*'([A-Z]+)'\s*,\s*(.+?)\s*,\s*handle", table, re.S):
    method, matcher = m.group(1), m.group(2).strip()
    if matcher.startswith("'"):
        live.append((method, 'exact', matcher.strip("'")))
    elif matcher.startswith('/^'):
        live.append((method, 'regex', matcher.strip('/')))
    elif matcher in re_consts:
        live.append((method, 'regex', re_consts[matcher]))
    else:
        live.append((method, 'unknown', matcher))

# Routes dispatched outside the table.
for pathname in re.findall(r"\['(/api/webhooks/[a-z]+|/webhooks/[a-z]+)'", idx):
    live.append(('POST', 'exact', pathname))
live.append(('POST', 'exact', '/api/organization/bootstrap'))
live.append(('GET', 'exact', '/health'))
live.append(('GET', 'exact', '/api/health'))

# Upload router: base is /upload or /api/upload.
for base in ('/upload', '/api/upload'):
    live.append(('POST', 'exact', base + '/initiate'))
    live.append(('POST', 'exact', base + '/complete'))
    for meth, suffix in re.findall(r"method: '([A-Z]+)',\s*\n\s*suffix: '(/[a-z-]+/)'", router):
        live.append((meth, 'prefix', base + suffix))


def serves(method, path):
    """Does any live route serve this Express method+path?"""
    for lm, kind, pat in live:
        if lm != method:
            continue
        if kind == 'exact' and pat == path:
            return pat
        if kind == 'prefix' and path.startswith(pat):
            return pat + '*'
        if kind == 'regex':
            # Express ':id' -> a concrete sample so the regex can match.
            probe = re.sub(r':[A-Za-z_]+', '1', path)
            try:
                if re.match(pat, probe):
                    return '/' + pat + '/'
            except re.error:
                pass
    return None


# ------------------------------------------------------------- matrix parsing
rows = []
for line in io.open(MATRIX, encoding='utf-8').read().split('\n'):
    if not line.startswith('|'):
        continue
    cells = [c.strip() for c in line.split('|')[1:-1]]
    if len(cells) < 16:
        continue
    method = cells[0].strip('` ')
    if method in ('Method', '---', '') or set(method) <= set('-'):
        continue
    paths = re.findall(r'`([^`]+)`', cells[1])
    decision = cells[16] if len(cells) > 16 else cells[-1]
    rows.append((method, paths, decision, cells[1]))

# --------------------------------------------------------------- reconcile
verdicts = {}
actionable = []
for method, paths, decision, rawpath in rows:
    api_paths = [p for p in paths if p.startswith('/')]
    if not api_paths:
        continue
    # Prefer the /api-prefixed variant; the Worker only mounts those.
    candidates = [p if p.startswith('/api/') else '/api' + p for p in api_paths]
    hit = None
    for c in candidates:
        hit = serves(method, c)
        if hit:
            break
    # Parse the LEADING disposition token only. Substring-matching the whole
    # cell is wrong: these decisions are prose, and most of them contain the
    # word "retire" somewhere ("...before Express is retired"), which silently
    # reclassified every rehome row as a retire on the first run.
    lead = re.match(
        r'(?:DONE|PROPOSED|UPDATED|REOPENED|CORRECTED)[^:]*:\s*([a-z][a-z-]*)',
        decision,
    )
    claim = lead.group(1) if lead else 'other'
    if decision.startswith('DONE'):
        # A row can be DONE because the route was built, or DONE because it was
        # deliberately retired. Only the first should be live, so conflating
        # them makes a completed retirement look like outstanding work.
        claim = 'retire' if re.search(r'\bRETIRED\b', decision) else 'done'

    state = 'LIVE' if hit else 'ABSENT'
    verdicts[(claim, state)] = verdicts.get((claim, state), 0) + 1
    if (method, candidates[0]) in KNOWN_FALSE_POSITIVES:
        continue
    if state == 'ABSENT' and claim in ('rehome', 'done', 'keep', 'replace'):
        actionable.append((method, candidates[0], claim + '-but-ABSENT', decision[:70]))
    if state == 'LIVE' and claim in ('retire',):
        actionable.append((method, candidates[0], 'retire-but-LIVE', decision[:70]))

print('=== claim x reality ===')
for (claim, state), n in sorted(verdicts.items(), key=lambda x: (-x[1])):
    print(f'{n:4}  claim={claim:8} reality={state}')

print()
print('=== NEEDS ATTENTION ===')
seen = set()
for method, path, claim, d in actionable:
    k = (method, path)
    if k in seen:
        continue
    seen.add(k)
    print(f'  {claim:16} {method:6} {path}')
print(f'\n({len(seen)} distinct)')
print(f'\nlive route entries parsed: {len(live)}; matrix rows parsed: {len(rows)}')

# Exit non-zero while anything is outstanding. Two conditions are reported:
# a row claiming a Worker route that does not exist (remaining 3.1 work), and a
# row claiming a route retires that is in fact live (a stale disposition). The
# second is why this script exists -- seven such rows sat in the matrix for
# weeks after 3.1.d and 3.1.l shipped their routes, and reading the matrix gave
# the wrong answer to "what is left in 3.1?".
sys.exit(1 if seen else 0)
