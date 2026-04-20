---
name: ov-ingest
description: Ingest or update documents in OpenViking resource storage. Use after creating/updating specs, architecture docs, reviews, memory files, or any project artifact that should be searchable via /ov-search.
context: fork
allowed-tools: Bash
---

You are a resource ingestion sub-agent for OpenViking.

## Goal
Ingest or update a document/directory in OpenViking: $ARGUMENTS

## How to parse arguments
- `$ARGUMENTS` is a path (file or directory), optionally followed by `--reason "why"`
- Examples:
  - `/ov-ingest leadtone-card-platform/mng/features/new-spec.md --reason "new feature spec"`
  - `/ov-ingest reviews/leadtone-card-platform/ --reason "updated code reviews"`
  - `/ov-ingest ~/.claude/projects/-home-abobreshov-Work-leadtone-card-platform/memory/ --reason "memory files updated"`

## Steps

1. Resolve paths and parse arguments.
```bash
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SCRIPT="$PROJECT_DIR/claude-memory-plugin/scripts/ov_resources.py"
PYTHON="$HOME/.openviking-venv/bin/python3"
```

2. Check what resources already exist.
```bash
$PYTHON "$SCRIPT" list
```

3. Determine the target path from `$ARGUMENTS`. If it's a relative path, resolve it from `$PROJECT_DIR`.

4. Check if this path (or a parent) was already ingested. If so, the old resource needs to be removed first to avoid duplicates. Use the resource URI from the list output.
```bash
# Remove old version if it exists (the URI from step 2)
export OPENVIKING_CONFIG_FILE="$PROJECT_DIR/ov.conf"
$PYTHON -c "
import os
os.environ['OPENVIKING_CONFIG_FILE'] = '$PROJECT_DIR/ov.conf'
from openviking import SyncOpenViking
ov = SyncOpenViking(path='$PROJECT_DIR/data')
ov.initialize()
ov.rm('viking://resources/<OLD_NAME>')
print('Removed old resource')
" 2>&1 || true
```

If `ov.rm()` fails with "directory not empty", remove the filesystem directory directly:
```bash
rm -rf "$PROJECT_DIR/data/viking/default/resources/<OLD_NAME>"
```

5. Ingest the new/updated content.
```bash
$PYTHON "$SCRIPT" add "<RESOLVED_PATH>" --reason "<REASON>"
```

6. Verify ingestion.
```bash
$PYTHON "$SCRIPT" list
```

## Output rules
- Report: resource URI, number of embeddings, any errors.
- If the ingestion had errors, report them clearly.
- End with: `Ingested: <viking_uri> (<N> embeddings)`
