---
name: skill-creator
description: Create new Agent Skills from scratch, test them with evals, compare old vs new versions, optimize trigger descriptions, and measure performance with benchmarks. Use when users want to create a skill, write test cases, run evaluations, compare skill versions, or improve skill descriptions for better triggering.
---

# Skill Creator

A skill for creating new Agent Skills and iteratively improving them through automated testing and evaluation.

## Overview

The skill creation process follows this loop:

1. **Capture intent** — Understand what the skill should do, when it should trigger, expected output format
2. **Write the skill** — Create SKILL.md with frontmatter and instructions
3. **Write evals** — Create test prompts with assertions in evals/evals.json
4. **Run tests** — Execute evals with `opencode-skill-eval test` (with-skill + baseline)
5. **Grade results** — Evaluate assertions against outputs with `opencode-skill-eval grade`
6. **Aggregate benchmarks** — Generate stats with `opencode-skill-eval benchmark`
7. **Review** — Show results in the HTML viewer with `opencode-skill-eval view`
8. **Iterate** — Improve the skill based on feedback, rerun, repeat
9. **Compare versions** — Use `opencode-skill-eval compare` for old vs new skill comparison
10. **Optimize description** — Use `opencode-skill-eval optimize-triggers` to improve triggering

## Prerequisites

The `opencode-skill-eval` CLI must be installed:
```bash
npm install -g opencode-skill-eval
```

All commands are available as `opencode-skill-eval <command> [options]`.

## Step-by-Step Guide

### 1. Scaffold a New Skill

If creating a skill from scratch:

```bash
opencode-skill-eval scaffold my-skill --path ./my-skills
```

This creates:
```
my-skill/
├── SKILL.md          # Skill definition (edit this)
└── evals/
    └── evals.json    # Test cases (edit this)
```

### 1.5. Choose the Right Skill Location

Skills must be placed in one of these directories for the agent to discover them:

**Project-local skills** (available only in the current project):
- `.opencode/skills/<skill-name>/` — for OpenCode
- `.agents/skills/<skill-name>/` — for Claude Code

**Global skills** (available in any directory):
- `~/.config/opencode/skills/<skill-name>/` — for OpenCode
- `~/.agents/skills/<skill-name>/` — for Claude Code

Each skill directory must contain:
```
<skill-name>/
├── SKILL.md          # Skill definition with frontmatter
└── evals/
    └── evals.json    # Test cases
```

Choose project-local for project-specific tools and global for utilities you want everywhere.

### 2. Write SKILL.md

Fill in the SKILL.md with:
- `name` (required): lowercase alphanumeric with hyphens, must match directory name
- `description` (required): 1-1024 chars describing what it does AND when to trigger
- Body: step-by-step instructions, output format definitions, examples

Important: The description is the primary triggering mechanism. Make it specific enough to trigger when needed but not so broad it triggers incorrectly.

### 3. Write evals/evals.json

Create test cases that verify the skill works correctly:

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "A realistic user prompt that should trigger this skill",
      "expected_output": "Description of what the output should look like",
      "files": ["evals/files/sample-input.csv"],
      "assertions": [
        "Output is a valid .xlsx file",
        "Column headers match the input schema",
        "Totals row sums to the expected value"
      ]
    }
  ]
}
```

Guidelines for good evals:
- Use 2-5 test prompts (start small, expand later)
- Make prompts realistic — something a real user would actually type
- Make assertions objectively verifiable
- For subjective skills (writing style, art), fewer or no assertions; focus on qualitative review
- Store any input files in `evals/files/` relative to the skill directory

### 4. Run Tests

```bash
opencode-skill-eval test ./my-skill \
  --evals ./my-skill/evals/evals.json \
  --model anthropic/claude-sonnet-4-20250514 \
  --workspace ./my-skill-workspace \
  --baseline-mode without_skill \
  --parallel 2
```

This runs each eval prompt twice:
- `with_skill`: the prompt with the skill loaded
- `without_skill`: the same prompt without the skill (baseline)

Results are saved to `./my-skill-workspace/iteration-1/`.

### 5. Grade Results

```bash
opencode-skill-eval grade ./my-skill-workspace/iteration-1 \
  --model anthropic/claude-sonnet-4-20250514
```

The grader evaluates each assertion against the execution transcript and output files, producing `grading.json` with pass/fail verdicts and evidence.

### 6. Generate Benchmark

```bash
opencode-skill-eval benchmark ./my-skill-workspace/iteration-1 \
  --skill-name my-skill \
  --skill-path ./my-skill \
  --model anthropic/claude-sonnet-4-20250514
```

Produces:
- `benchmark.json` — structured stats (pass rate, time, tokens) with deltas
- `benchmark.md` — human-readable summary

### 7. View Results

```bash
opencode-skill-eval view ./my-skill-workspace/iteration-1 \
  --benchmark ./my-skill-workspace/iteration-1/benchmark.json \
  --static ./my-skill-workspace/iteration-1/review.html
```

Opens an HTML viewer with two tabs:
- **Outputs**: one test case at a time with prompt, output files, grading, feedback form
- **Benchmark**: stats summary with pass rates, timing, token usage

For headless environments (no browser), use `--static` to write a standalone HTML file.

### 8. Iterate

After reviewing results:
1. Improve the SKILL.md based on user feedback
2. Rerun tests into a new iteration:
```bash
opencode-skill-eval test ./my-skill \
  --workspace ./my-skill-workspace \
  --iteration 2
```
3. Compare against previous iteration:
```bash
opencode-skill-eval view ./my-skill-workspace/iteration-2 \
  --previous-workspace ./my-skill-workspace/iteration-1 \
  --static ./my-skill-workspace/iteration-2/review.html
```

Repeat until the user is satisfied.

### 9. Compare Old vs New Skill

When improving an existing skill, compare the old and new versions with blind A/B testing:

```bash
opencode-skill-eval compare ./my-skill-old ./my-skill-new \
  --evals ./my-skill-new/evals/evals.json \
  --model anthropic/claude-sonnet-4-20250514 \
  --workspace ./my-skill-compare-workspace
```

This:
1. Snapshots the old skill
2. Runs all evals with both old and new versions
3. Grades both sets
4. Runs blind A/B comparison (the comparator doesn't know which is which)
5. Analyzes why the winner won
6. Generates a viewer with comparison results

### 10. Optimize Trigger Description

After the skill works well, optimize its description for triggering accuracy:

```bash
opencode-skill-eval optimize-triggers ./my-skill \
  --eval-set ./my-skill/trigger-evals.json \
  --model anthropic/claude-sonnet-4-20250514 \
  --max-iterations 5
```

The trigger eval set should contain ~20 queries (10 should-trigger, 10 should-not-trigger):

```json
[
  {"query": "Convert this CSV to a formatted report with charts", "should_trigger": true},
  {"query": "Read this PDF file", "should_trigger": false},
  {"query": "my boss needs the Q4 numbers in a spreadsheet by EOD", "should_trigger": true}
]
```

The optimizer iteratively improves the description, selecting the best version by test score to prevent overfitting.

## Workspace Structure

After running tests, the workspace looks like:

```
my-skill-workspace/
├── iteration-1/
│   ├── eval-1/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/
│   │   │   └── run-1/
│   │   │       ├── outputs/
│   │   │       │   ├── transcript.md
│   │   │       │   └── ... (output files)
│   │   │       ├── grading.json
│   │   │       └── timing.json
│   │   └── without_skill/
│   │       └── run-1/
│   │           └── ...
│   ├── eval-2/
│   │   └── ...
│   ├── benchmark.json
│   ├── benchmark.md
│   └── review.html
├── iteration-2/
│   └── ...
└── feedback.json
```

## JSON Schemas

### evals.json
```json
{
  "skill_name": "string",
  "evals": [
    {
      "id": 1,
      "prompt": "User prompt",
      "expected_output": "Expected result description",
      "files": ["path/to/input"],
      "assertions": ["Verifiable assertion"]
    }
  ]
}
```

### grading.json
```json
{
  "expectations": [
    { "text": "assertion", "passed": true, "evidence": "evidence from transcript" }
  ],
  "summary": { "passed": 2, "failed": 1, "total": 3, "pass_rate": 0.67 }
}
```

### benchmark.json
```json
{
  "metadata": { "skill_name": "...", "executor_model": "...", "timestamp": "..." },
  "runs": [ ... ],
  "run_summary": {
    "with_skill": { "pass_rate": {"mean": 0.85, "stddev": 0.05}, "time_seconds": {...}, "tokens": {...} },
    "without_skill": { "pass_rate": {"mean": 0.35, "stddev": 0.08}, ... },
    "delta": { "pass_rate": "+0.50", "time_seconds": "+13.0", "tokens": "+1700" }
  },
  "notes": ["observation 1", "observation 2"]
}
```

## Tips

- **Start small**: 2-3 evals is enough for an initial validation. Expand later.
- **Assertions over vibes**: Objectively verifiable assertions produce more reliable benchmarks.
- **Baseline matters**: `without_skill` shows whether the skill adds value. `old_skill` shows whether changes improved it.
- **Description precision**: The skill description is the main trigger mechanism. If the skill doesn't trigger when expected, optimize the description.
- **Use `--static` in headless environments**: When running on a server or in CI, use `--static` to write HTML files instead of trying to open a browser.
- **Don't overfit on trigger optimization**: The train/test split prevents this, but still review the best description to ensure it's natural.
