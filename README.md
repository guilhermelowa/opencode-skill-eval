# opencode-skill-eval

> **Disclaimer:** This is a vibe-coded repo, built by copying and adapting open-source [Anthropic's skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator) (not leaked).

A CLI tool to create, test, and evaluate **Agent Skills** for OpenCode. Skills are `SKILL.md` files with frontmatter and step-by-step instructions that extend an AI agent's capabilities. This tool measures whether a skill actually improves the agent's output quality compared to running without it.

> **Note:** While this is a CLI tool, it is designed to be used **inside OpenCode's agent**. The agent invokes these commands to run evaluations, grade outputs, and generate benchmarks — you don't typically run them manually from your terminal.

## Installation

```bash
npm install -g .
```

Or install directly from the repo:

```bash
npm install
npm run build
```

Requires Node.js >= 20.

## Quick Start

```bash
# 1. Scaffold a new skill
opencode-skill-eval scaffold my-skill

# 2. Edit the generated SKILL.md and evals/evals.json

# 3. Run the full pipeline (test → grade → benchmark → view)
opencode-skill-eval run-all path/to/my-skill

# Or step by step:
opencode-skill-eval test path/to/my-skill
opencode-skill-eval grade path/to/my-skill-workspace/iteration-1
opencode-skill-eval benchmark path/to/my-skill-workspace/iteration-1
```

The `benchmark` and `run-all` commands automatically generate an HTML viewer and open it in your browser. Use `--no-view` to suppress this.

> **Note:** The auto-open functionality is currently broken. After running evaluation, open the HTML manually at `<workspace>/iteration-N/review.html`.

## How It Works

The evaluation loop runs each test case twice:

- **With skill** — `opencode run` is invoked with `OPENCODE_SKILL_PATH` pointing to the skill directory. OpenCode loads the skill transparently via this environment variable, injecting its instructions into the agent's context.
- **Without skill (baseline)** — The same `opencode run` command executes but without the env var, so the agent has no skill loaded.

The agent cannot detect whether a skill is present — it just responds to the prompt. This ensures a fair comparison where the only variable is the skill's presence.

After execution, a grading LLM evaluates each run's transcript and output files against the defined assertions, producing pass/fail verdicts with evidence. Results are aggregated into statistics (pass rate, time, tokens) with deltas between configurations.

## Commands

### `scaffold <name>`

Creates a new skill directory with a template `SKILL.md` and `evals/evals.json`.

```bash
opencode-skill-eval scaffold my-skill -p ./skills
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --path <dir>` | Base directory for the skill | `.` |

### `run-all <skill-path>`

Runs the full eval pipeline: test → grade → benchmark → view. Prints the benchmark table to stdout and opens the HTML viewer in your browser.

```bash
# Standard mode: with_skill vs without_skill
opencode-skill-eval run-all ./skills/my-skill

# Compare mode: A/B blind comparison against an old skill version
opencode-skill-eval run-all ./skills/my-skill-v2 --compare ./skills/my-skill-v1

# Skip the HTML viewer
opencode-skill-eval run-all ./skills/my-skill --no-view
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --evals <path>` | Path to evals.json | `<skill-path>/evals/evals.json` |
| `-m, --model <model>` | Model to use for execution | `anthropic/claude-sonnet-4-20250514` |
| `-w, --workspace <dir>` | Output workspace directory | `<skill-path>-workspace` |
| `-i, --iteration <n>` | Iteration number | `1` |
| `-p, --parallel <n>` | Concurrent runs | `2` |
| `-t, --timeout <ms>` | Per-run timeout in ms | `300000` |
| `--no-baseline` | Skip baseline runs | — |
| `--baseline-mode <mode>` | `without_skill` or `old_skill` | `without_skill` |
| `--old-skill <path>` | Path to old skill for baseline | — |
| `--compare <old-skill>` | Enable A/B compare mode | — |
| `--no-view` | Skip generating HTML viewer | — |

### `test <skill-path>`

Runs all evals with the skill and baseline (parallel, configurable model/timeout).

```bash
opencode-skill-eval test ./skills/my-skill \
  --model anthropic/claude-sonnet-4-20250514 \
  --parallel 4 \
  --timeout 300000 \
  --baseline-mode without_skill
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --evals <path>` | Path to evals.json | `<skill-path>/evals/evals.json` |
| `-m, --model <model>` | Model to use for execution | `anthropic/claude-sonnet-4-20250514` |
| `-w, --workspace <dir>` | Output workspace directory | `<skill-path>-workspace` |
| `-i, --iteration <n>` | Iteration number | `1` |
| `-p, --parallel <n>` | Concurrent runs | `2` |
| `-t, --timeout <ms>` | Per-run timeout in ms | `300000` |
| `--no-baseline` | Skip baseline runs | — |
| `--baseline-mode <mode>` | `without_skill` or `old_skill` | `without_skill` |
| `--old-skill <path>` | Path to old skill for comparison | — |

### `grade <workspace>`

Grades all eval outputs against assertions using an LLM. Reads transcripts and output files, evaluates each assertion, and writes `grading.json` per run.

```bash
opencode-skill-eval grade ./skills/my-skill-workspace/iteration-1 \
  --model anthropic/claude-sonnet-4-20250514
```

| Option | Description | Default |
|--------|-------------|---------|
| `-m, --model <model>` | Model to use for grading | `anthropic/claude-sonnet-4-20250514` |

### `benchmark <workspace>`

Aggregates grading results into statistics with mean, stddev, min, max, and deltas between configurations. Prints the benchmark table to stdout, outputs `benchmark.json` and `benchmark.md`, and automatically generates and opens the HTML viewer.

```bash
opencode-skill-eval benchmark ./skills/my-skill-workspace/iteration-1 \
  --skill-name my-skill
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --skill-name <name>` | Skill name | Inferred from directory |
| `--skill-path <path>` | Skill path | — |
| `-m, --model <model>` | Model used for execution | `anthropic/claude-sonnet-4-20250514` |
| `--no-view` | Skip generating HTML viewer | — |

### `view <workspace>`

Generates a self-contained HTML viewer with tabs for individual run outputs, A/B comparisons, and benchmark summaries. Opens in browser by default, or writes static HTML.

```bash
# Open in browser
opencode-skill-eval view ./skills/my-skill-workspace/iteration-1

# Write static HTML
opencode-skill-eval view ./skills/my-skill-workspace/iteration-1 \
  --static ./results.html
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --skill-name <name>` | Skill name | Inferred from directory |
| `--benchmark <path>` | Path to benchmark.json | — |
| `--previous-workspace <path>` | Previous iteration for feedback comparison | — |
| `--static <path>` | Write static HTML instead of serving | — |

### `compare <old-skill> <new-skill>`

Blind A/B comparison of two skill versions. Runs both on the same evals, then an LLM judge evaluates outputs (labeled A/B) on content and structure rubrics (1-5 scoring). Automatically generates and opens the HTML viewer with a Comparison tab.

```bash
opencode-skill-eval compare ./skills/my-skill-v1 ./skills/my-skill-v2
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --evals <path>` | Path to evals.json | `<new-skill>/evals/evals.json` |
| `-m, --model <model>` | Model to use | `anthropic/claude-sonnet-4-20250514` |
| `-w, --workspace <dir>` | Workspace directory | `<new-skill>-compare-workspace` |
| `-p, --parallel <n>` | Parallel runs | `2` |
| `-t, --timeout <ms>` | Per-run timeout in ms | `300000` |
| `--no-view` | Skip generating HTML viewer | — |

### `optimize-triggers <skill-path>`

Iteratively improves the skill description for better trigger accuracy. Splits eval queries into train/test sets, evaluates, identifies failures, asks an LLM to improve the description, and selects the best version by test score to prevent overfitting.

```bash
opencode-skill-eval optimize-triggers ./skills/my-skill \
  --max-iterations 5 \
  --holdout 0.4 \
  --threshold 0.5
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --eval-set <path>` | Path to trigger eval JSON | `<skill-path>/trigger-evals.json` |
| `-m, --model <model>` | Model to use | `anthropic/claude-sonnet-4-20250514` |
| `--max-iterations <n>` | Max optimization iterations | `5` |
| `--runs-per-query <n>` | Runs per query | `3` |
| `--threshold <n>` | Trigger threshold | `0.5` |
| `--holdout <n>` | Test holdout fraction | `0.4` |
| `-w, --workspace <dir>` | Workspace directory | `<skill-path>-trigger-workspace` |

### `snapshot <skill-path>`

Creates a copy of a skill directory for version comparison.

```bash
opencode-skill-eval snapshot ./skills/my-skill
```

| Option | Description | Default |
|--------|-------------|---------|
| `-w, --workspace <dir>` | Output directory | `<skill-path>-workspace` |

## Defining Evals

Evals are defined in `evals/evals.json`:

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "A realistic user prompt that should trigger this skill",
      "expected_output": "Description of the expected result",
      "files": ["evals/files/input.csv"],
      "assertions": [
        "Output is a valid CSV file",
        "Column headers match input schema",
        "All rows are processed without data loss"
      ]
    }
  ]
}
```

Each eval item has:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `prompt` | The user prompt to send to the agent |
| `expected_output` | Human-readable description of expected result |
| `files` | Input file paths (relative to skill directory) |
| `assertions` | Verifiable claims about the output, evaluated by the grading LLM |

## Workspace Output Structure

After running `test` + `grade` + `benchmark` (or `run-all`):

```
my-skill-workspace/
├── iteration-1/
│   ├── eval-1/
│   │   ├── eval_metadata.json       # Eval ID, prompt, assertions
│   │   ├── inputs/                  # Copied input files
│   │   ├── with_skill/
│   │   │   └── run-1/
│   │   │       ├── outputs/
│   │   │       │   ├── transcript.md  # Full execution transcript
│   │   │       │   └── ...            # Files created by the agent
│   │   │       ├── grading.json       # Pass/fail per assertion with evidence
│   │   │       └── timing.json        # Duration and token usage
│   │   └── without_skill/
│   │       └── run-1/                 # Same structure (baseline)
│   ├── eval-2/
│   │   └── ...
│   ├── comparison.json                # Blind A/B comparison (compare mode only)
│   ├── benchmark.json                 # Aggregated stats with deltas
│   ├── benchmark.md                   # Human-readable summary table
│   └── review.html                    # HTML viewer
├── iteration-2/                       # Subsequent iterations
│   └── ...
└── feedback.json                      # User review feedback from viewer
```

## Iteration Workflow

1. Write your skill and evals
2. Run `run-all` for the full pipeline, or step through individually:
   - `test` to execute all evals
   - `grade` to score outputs
   - `benchmark` to see statistics (prints table + opens viewer)
3. Improve the skill based on results
4. Run `run-all` again with `--iteration 2`
5. Use `compare` or `run-all --compare` for A/B comparison between versions

## HTML Viewer

The viewer is a self-contained HTML file with three tabs:

- **Outputs** — Browse individual eval runs with transcripts, output files, and formal grades (PASS/FAIL with evidence)
- **Comparison** — View blind A/B comparison results with winner badges, rubric scores, and strengths/weaknesses per output (available when using `--compare` mode)
- **Benchmark** — Summary table with pass rate, time, and token statistics across configurations

Navigation uses prev/next buttons or arrow keys. A feedback bar at the bottom lets you annotate runs and download `feedback.json`.

## Architecture

```
src/
├── cli.ts                    # Commander.js CLI — all 9 commands
├── eval/
│   ├── runner.ts             # Orchestrates parallel eval execution
│   ├── grader.ts             # LLM-based assertion grading
│   ├── aggregator.ts         # Statistical benchmark aggregation
│   ├── analyzer.ts           # LLM-based benchmark analysis
│   ├── comparator.ts         # Blind A/B comparison
│   └── types.ts              # Zod schemas for all data structures
├── trigger/
│   ├── runner.ts             # Tests skill trigger accuracy
│   ├── optimizer.ts          # Iterative description optimization
│   └── types.ts              # Zod schemas for trigger evaluation
├── skill/
│   ├── loader.ts             # Parses SKILL.md frontmatter
│   ├── scaffold.ts           # Creates new skill template
│   └── snapshot.ts           # Copies skill for comparison
├── viewer/
│   └── generate.ts           # HTML results viewer generator
└── utils/
    ├── filesystem.ts         # File/directory helpers
    └── subprocess.ts         # Spawns opencode run with timeout
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `zod` | Schema validation for all JSON data structures |
| `p-limit` | Concurrency control for parallel eval runs |
| `typescript` | Compilation target |

## Development

```bash
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run typecheck    # Type check without emitting
```

## TODO

- Token counts are not correct yet and will be worked on soon

## License

Apache 2.0
