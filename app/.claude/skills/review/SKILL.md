---
name: detailed-review
description: Run a multi-agent code review on the current branch vs a base branch. Use when the user asks for a code review, branch review, or wants to review changes before merging.
argument-hint: "[project] [base-branch]  (project: leadtone-card-platform | card-platform-infrastructure | card-platform-tests, default: leadtone-card-platform develop)"
disable-model-invocation: true
---

# Multi-Agent Code Review

Run a comprehensive code review of the current branch against a base branch using specialized review agents.

## Setup

1. Parse `$ARGUMENTS` to determine the project and base branch:
   - Available projects: `leadtone-card-platform`, `card-platform-infrastructure`, `card-platform-tests`
   - If `$ARGUMENTS` contains a known project name, use it; otherwise default to `leadtone-card-platform`
   - If `$ARGUMENTS` contains a non-project token (e.g., a branch name), use it as the base branch; otherwise default to `develop`
   - Examples:
     - `/review` → project=leadtone-card-platform, base=develop
     - `/review main` → project=leadtone-card-platform, base=main
     - `/review card-platform-infrastructure` → project=card-platform-infrastructure, base=develop
     - `/review card-platform-tests main` → project=card-platform-tests, base=main

2. Set the project directory to `{workspace_root}/{project}` (e.g., `/home/abobreshov/Work/leadtone/card-platform/leadtone-card-platform`)

3. **All git commands below MUST be run inside the project directory** (use `cd {project_dir} && git ...` or pass `-C {project_dir}` to git)

4. Get the current branch name:
   ```
   git -C {project_dir} branch --show-current
   ```

5. Get the list of changed files:
   ```
   git -C {project_dir} diff <base-branch>...HEAD --name-only
   ```

6. Get the full diff for context:
   ```
   git -C {project_dir} diff <base-branch>...HEAD
   ```

7. If there are no changed files, inform the user and stop.

8. Determine the main feature or purpose from the branch name and commit messages:
   ```
   git -C {project_dir} log <base-branch>...HEAD --oneline
   ```

## Change Summary

Before launching review agents, write a short summary answering:
- **Why?** — What problem or need does this change address?
- **What?** — What is being changed at a high level (features, fixes, refactoring)?
- **How?** — Brief summary of the approach (patterns, services affected, key design choices)

Derive this from the branch name, commit messages, and a quick scan of the diff. This summary will be included in the review file header and the OpenViking artifact.

## Review Execution

Spawn ALL of the following review agents IN PARALLEL using the Agent tool. Each agent receives the full diff, the list of changed files, and instructions to read any files they need for full context.

**IMPORTANT**: Launch all 9 agents in a SINGLE message with parallel tool calls. Do NOT wait for one to finish before starting the next.

### Agent 1: Security Review
- **subagent_type**: `general-purpose`
- **Focus**: Security vulnerabilities, injection risks (SQL, XSS, command), auth/authz issues, secrets exposure, OWASP Top 10, insecure crypto, input validation gaps
- **Output format**: List findings with severity (critical/high/medium/low), file path, line reference, description, and remediation suggestion

### Agent 2: Architecture Review
- **subagent_type**: `general-purpose`
- **Focus**: Architectural patterns, separation of concerns, module boundaries, dependency direction, API design consistency, breaking changes, database schema impact, migration safety
- **Output format**: List findings with severity, file path, description, and architectural recommendation

### Agent 3: Code Quality Review
- **subagent_type**: `general-purpose`
- **Focus**: Code readability, naming conventions, DRY violations, dead code, error handling, logging quality, test coverage gaps, TypeScript type safety, linting issues
- **Output format**: List findings with severity, file path, line reference, description, and improvement suggestion

### Agent 4: CodeRabbit Review
- **subagent_type**: `coderabbit:code-reviewer`
- **Focus**: Comprehensive automated code review using CodeRabbit's analysis
- **Output format**: CodeRabbit's standard review output

### Agent 5: AWS & Infrastructure Review
- **subagent_type**: `aws-solution-architect`
- **Focus**: Cloud infrastructure impact, AWS service usage, Lambda/SQS changes, environment config, deployment concerns, cost implications, scaling considerations
- **Output format**: List findings with severity, description, and infrastructure recommendation

### Agent 6: Challenger Review
- **subagent_type**: `challenger`
- **Focus**: Challenge assumptions, question design decisions, identify alternatives not considered, flag premature abstractions, over-engineering, under-engineering, missing edge cases
- **Output format**: List challenges with severity, description, the assumption being challenged, and suggested alternative

### Agent 7: SOLID Principles Review
- **subagent_type**: `solid-code-reviewer`
- **Focus**: SOLID/DRY compliance, class responsibilities (SRP), interface segregation, dependency inversion, testability, coupling analysis
- **Output format**: List findings with severity, file path, principle violated, description, and refactoring suggestion

### Agent 8: Business Analysis Review
- **subagent_type**: `business-analyst`
- **Focus**: Business logic correctness, business rule gaps or inconsistencies, user workflow impact, data integrity, compliance concerns, missing acceptance criteria, edge cases from business perspective
- **Output format**: List findings with severity, business rule reference, description, and impact assessment

### Agent 9: Backend Architecture Review
- **subagent_type**: `backend-architect`
- **Focus**: System design quality, database schema correctness, inter-service communication patterns, API contract changes, performance implications, scalability concerns, data model consistency
- **Output format**: List findings with severity, file path, description, and design recommendation

---

For each agent, provide this context in the prompt:

```
You are reviewing code changes in the `{project}` project on branch `{current_branch}` compared to `{base_branch}`.
Project root: {project_dir}

Changed files:
{changed_files_list}

Full diff:
{full_diff}

Read any additional files you need for full context (e.g., to understand interfaces, base classes, or existing patterns). Files are relative to the project root: {project_dir}

Use `/ov-search` (via Skill tool) to check for related architecture decisions, feature specs, or prior reviews that provide context for this change.

Categorize every finding by severity:
- **CRITICAL**: Security vulnerabilities, data loss risks, breaking production
- **HIGH**: Bugs, significant design flaws, missing error handling for critical paths
- **MEDIUM**: Code quality issues, minor design concerns, missing tests
- **LOW**: Style issues, minor improvements, suggestions

Return your findings as a structured markdown list grouped by severity. Include file paths and line numbers where applicable. If you find no issues, explicitly state "No issues found" for each severity level.
```

## Compilation

After ALL agents complete:

1. Collect all findings from all 9 agents

2. **Verify and consolidate findings:**
   - For each finding, assess: is this really an issue? Consider the project context, existing patterns, and whether the finding reflects actual risk or is a false positive.
   - Merge duplicate findings from different agents into a single entry (note which agents flagged it)
   - Remove false positives or findings that don't apply to this project's conventions
   - Combine related findings into coherent groups
   - Produce a detailed consolidated summary with verified findings only

3. Write the review file (see Output section)

4. **Write a separate change summary .md file** for OpenViking storage (see OpenViking Artifact section)

## Output

Write the review file to:
```
reviews/{project}/YYYY-MM-DD-review-{feature_slug}.md
```

Where:
- `{project}` is the project name (e.g., `leadtone-card-platform`, `card-platform-infrastructure`)
- `YYYY-MM-DD` is today's date
- `{feature_slug}` is a kebab-case slug derived from the branch name or main feature

### Review File Format

```markdown
# Code Review: {Branch Name}

**Date**: YYYY-MM-DD
**Project**: `{project}`
**Branch**: `{current_branch}` vs `{base_branch}`
**Changed Files**: {count} files
**Reviewers**: Security, Architecture, Code Quality, CodeRabbit, AWS/Infra, Challenger, SOLID, Business Analyst, Backend Architect

## Change Summary

**Why**: {problem or need this change addresses}
**What**: {high-level description of changes}
**How**: {brief approach summary}

## Findings Overview

| Severity | Count |
|----------|-------|
| Critical | X |
| High | X |
| Medium | X |
| Low | X |

---

## Critical Findings

{Verified critical findings, with source agent(s) noted}

## High Findings

{Verified high findings, with source agent(s) noted}

## Medium Findings

{Verified medium findings, with source agent(s) noted}

## Low Findings

{Verified low findings, with source agent(s) noted}

---

## Review Details by Agent

### Security
{Full security review output}

### Architecture
{Full architecture review output}

### Code Quality
{Full code quality review output}

### CodeRabbit
{Full CodeRabbit review output}

### AWS & Infrastructure
{Full AWS review output}

### Challenger
{Full challenger review output}

### SOLID Principles
{Full SOLID review output}

### Business Analysis
{Full business analyst review output}

### Backend Architecture
{Full backend architect review output}
```

## OpenViking Artifact

**Do NOT store the review itself in OpenViking.** Instead, write a short summary .md file:

```
leadtone-card-platform/mng/reviews/YYYY-MM-DD-{feature_slug}-summary.md
```

Content:
```markdown
# {Feature Name} — Change Summary

**Date**: YYYY-MM-DD
**Branch**: `{current_branch}`
**Review**: `reviews/{project}/YYYY-MM-DD-review-{feature_slug}.md`

## Why
{1-2 sentences on the problem/need}

## What
{1-2 sentences on what changed}

## How
{2-3 sentences on the approach — patterns, services affected, key design choices}

## Key Decisions
{Bullet list of important design decisions made in this change}

## Verified Issues
{Bullet list of confirmed critical/high findings that need resolution}
```

Then run `/ov-ingest` on the summary file:
```
/ov-ingest leadtone-card-platform/mng/reviews/YYYY-MM-DD-{feature_slug}-summary.md --reason "{feature_slug} change summary and key decisions"
```

## Final Step

After writing both files, print a summary to the user:
- Path to the full review file
- Path to the OpenViking summary file
- Total findings by severity (after verification/consolidation)
- Any critical or high items that need immediate attention

## Post-Review: C4 Architecture Documentation

After the review is complete and findings are presented, check whether the changes affect system structure or business flows by scanning the diff for:

**Infrastructure/system changes:**
- New or removed services/containers
- New inter-service communication paths (HTTP calls, message queues, events)
- New external dependencies or providers
- New deployment components (Lambdas, SQS queues, etc.)
- Changed API contracts between services

**Business logic and flow changes:**
- New or modified business workflows (e.g., new card creation flow, new KYC verification path)
- Changed data flow or processing sequences between components
- New or modified entity relationships (database schema changes that alter how data connects)
- New user-facing operations or modified existing operation sequences
- Changes to authorization/access patterns that alter who can do what through which path

If any structural or flow changes are detected:

1. Identify which diagram types are affected:

   **C4 diagrams** (`leadtone-card-platform/docs/architecture/diagrams/`):
   - `c1-context/` — system boundary or external actor changes
   - `c2-container/` — new/removed containers or inter-container links
   - `c3-component/` — component-level changes within a service (new modules, changed dependencies between components)
   - `flows/` — technical service-to-service sequences (e.g., webhook processing pipeline, inter-service call chains)
   - `deployment/` — infrastructure/deployment topology changes

   **User journey diagrams** (`leadtone-card-platform/docs/architecture/diagrams/journeys/`):
   - One `.mmd` file per functional feature, showing the end-to-end user experience
   - Use Mermaid `journey` diagram type (not sequence diagrams — those go in `flows/`)
   - Focus on: user goals, steps they take, touchpoints (which UI or API), decision points, happy path + key alternative paths
   - Name convention: `journey-{N}-{feature-slug}.mmd` (e.g., `journey-1-card-onboarding.mmd`)
   - Create or update a journey when:
     - A new user-facing feature is added (new journey file)
     - An existing user workflow changes steps, adds decision points, or alters the sequence
     - User roles or permissions change who can do what
   - Journey diagrams should reference the actor (Cardholder, Admin, B2B Partner) and show which system touchpoints they interact with at each step

   Example format:
   ```mermaid
   journey
       title Card Top-Up via Crypto
       section Get Deposit Address
           Select card to top up: 5: Cardholder
           Choose crypto currency: 4: Cardholder
           Receive deposit address: 5: Cardholder, REST API
       section Send Crypto
           Transfer crypto to address: 3: Cardholder, Fireblocks
           Wait for confirmation: 2: Cardholder
       section Balance Updated
           Receive balance update notification: 5: Cardholder, REST API
   ```

2. Update the relevant Mermaid `.mmd` files — create new files for new features, update existing ones for modified features

3. Update the overview at `docs/architecture/c4-architecture-diagram.md` if the diagram index needs a new entry (add a "User Journeys" section if it doesn't exist yet)

4. Run `/ov-ingest leadtone-card-platform/docs/architecture/ --reason "Architecture diagrams updated after {feature_slug} review"`

If no structural or flow changes are detected, skip this step and note "No diagram updates needed" in the summary.
