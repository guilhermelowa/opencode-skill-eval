# JSON Schemas Reference

This document defines the JSON schemas used by opencode-skill-eval.

---

## evals.json

Located at `<skill-dir>/evals/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's example prompt",
      "expected_output": "Description of expected result",
      "files": ["evals/files/sample1.csv"],
      "assertions": [
        "The output file is a valid .xlsx",
        "Column headers match the input schema"
      ]
    }
  ]
}
```

**Fields:**
- `skill_name`: Name matching the skill's frontmatter `name`
- `evals[].id`: Unique integer identifier
- `evals[].prompt`: The task prompt to execute
- `evals[].expected_output`: Human-readable description of success
- `evals[].files`: Optional input file paths (relative to skill root)
- `evals[].assertions`: List of verifiable statements checked by the grader

---

## grading.json

Output from the grader. Located at `<run-dir>/grading.json`.

```json
{
  "expectations": [
    {
      "text": "The output includes the name 'John Smith'",
      "passed": true,
      "evidence": "Found in transcript Step 3: 'Extracted names: John Smith, Sarah Johnson'"
    },
    {
      "text": "The spreadsheet has a SUM formula in cell B10",
      "passed": false,
      "evidence": "No spreadsheet was created. The output was a text file."
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 1,
    "total": 2,
    "pass_rate": 0.5
  }
}
```

**Fields:**
- `expectations[]`: Graded expectations
  - `text`: The original assertion text
  - `passed`: Boolean
  - `evidence`: Specific quote or description supporting the verdict
- `summary`: Aggregate pass/fail counts and rate

---

## timing.json

Wall clock timing for a run. Located at `<run-dir>/timing.json`.

```json
{
  "total_tokens": 84852,
  "duration_ms": 23332,
  "total_duration_seconds": 23.3
}
```

**Fields:**
- `total_tokens`: Total tokens consumed (if available)
- `duration_ms`: Wall clock time in milliseconds
- `total_duration_seconds`: Wall clock time in seconds

---

## benchmark.json

Output from the benchmark aggregator. Located at `<workspace>/benchmark.json`.

```json
{
  "metadata": {
    "skill_name": "pdf",
    "skill_path": "/path/to/pdf",
    "executor_model": "anthropic/claude-sonnet-4-20250514",
    "timestamp": "2026-01-15T10:30:00Z",
    "evals_run": [1, 2, 3],
    "runs_per_configuration": 1
  },
  "runs": [
    {
      "eval_id": 1,
      "configuration": "with_skill",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "tokens": 3800
      },
      "expectations": [
        {"text": "...", "passed": true, "evidence": "..."}
      ],
      "notes": []
    }
  ],
  "run_summary": {
    "with_skill": {
      "pass_rate": {"mean": 0.85, "stddev": 0.05, "min": 0.80, "max": 0.90},
      "time_seconds": {"mean": 45.0, "stddev": 12.0, "min": 32.0, "max": 58.0},
      "tokens": {"mean": 3800, "stddev": 400, "min": 3200, "max": 4100}
    },
    "without_skill": {
      "pass_rate": {"mean": 0.35, "stddev": 0.08, "min": 0.28, "max": 0.45},
      "time_seconds": {"mean": 32.0, "stddev": 8.0, "min": 24.0, "max": 42.0},
      "tokens": {"mean": 2100, "stddev": 300, "min": 1800, "max": 2500}
    },
    "delta": {
      "pass_rate": "+0.50",
      "time_seconds": "+13.0",
      "tokens": "+1700"
    }
  },
  "notes": [
    "Assertion 'Output is a PDF file' passes 100% in both configurations - may not differentiate skill value"
  ]
}
```

---

## comparison.json

Output from blind A/B comparison. Located at `<eval-dir>/comparison.json`.

```json
{
  "winner": "A",
  "reasoning": "Output A provides a complete solution with proper formatting. Output B is missing the date field.",
  "rubric": {
    "A": {
      "content": {"correctness": 5, "completeness": 5, "accuracy": 4},
      "structure": {"organization": 4, "formatting": 5, "usability": 4},
      "content_score": 4.7,
      "structure_score": 4.3,
      "overall_score": 9.0
    },
    "B": {
      "content": {"correctness": 3, "completeness": 2, "accuracy": 3},
      "structure": {"organization": 3, "formatting": 2, "usability": 3},
      "content_score": 2.7,
      "structure_score": 2.7,
      "overall_score": 5.4
    }
  },
  "output_quality": {
    "A": {
      "score": 9,
      "strengths": ["Complete solution", "Well-formatted"],
      "weaknesses": ["Minor style inconsistency in header"]
    },
    "B": {
      "score": 5,
      "strengths": ["Readable output"],
      "weaknesses": ["Missing date field", "Formatting inconsistencies"]
    }
  }
}
```

---

## feedback.json

User review feedback. Written by the HTML viewer.

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means the user approved that output.

---

## trigger-eval.json

Trigger optimization eval set.

```json
[
  {"query": "Convert this CSV to a formatted Excel report", "should_trigger": true},
  {"query": "Read this PDF file", "should_trigger": false},
  {"query": "my boss needs the Q4 numbers in a spreadsheet", "should_trigger": true}
]
```

**Guidelines:**
- 10-12 should_trigger queries: different phrasings, formal/casual, edge cases
- 10-12 should_not_trigger queries: near-misses sharing keywords but needing different skills
- Make queries realistic with specific details (file paths, column names, context)
