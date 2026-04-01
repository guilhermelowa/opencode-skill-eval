import { type Benchmark } from "./types.js"
import { runPrompt } from "../utils/subprocess.js"
import { writeJson } from "../utils/filesystem.js"

export interface AnalyzeOptions {
  benchmark: Benchmark
  skillPath: string
  model: string
  outputPath: string
}

export async function analyzeBenchmark(opts: AnalyzeOptions): Promise<string[]> {
  const b = opts.benchmark
  const summary = b.run_summary as Record<string, Record<string, { mean: number; stddev: number }>>

  let runDetails = ""
  for (const run of b.runs) {
    runDetails += `\n- Eval ${run.eval_id} (${run.configuration}, run ${run.run_number}): pass_rate=${run.result.pass_rate}, time=${run.result.time_seconds}s, tokens=${run.result.tokens}`
    if (run.expectations.length) {
      for (const exp of run.expectations) {
        runDetails += `\n    - [${exp.passed ? "PASS" : "FAIL"}] ${exp.text}`
      }
    }
  }

  const analyzePrompt = `You are analyzing benchmark results to surface patterns and anomalies.

## Skill: ${b.metadata.skill_name}
## Model: ${b.metadata.executor_model}

## Run Summary:
${JSON.stringify(summary, null, 2)}

## Individual Runs:
${runDetails}

Analyze the data and provide observations. Focus on:
- Assertions that always pass in both configs (may not differentiate)
- Assertions that always fail in both configs (may be broken)
- Assertions that pass with skill but fail without (skill adds value)
- High variance evals (possibly flaky)
- Time/token tradeoffs
- Any surprising patterns

Return a JSON array of observation strings:
["observation 1", "observation 2", ...]

Respond with ONLY the JSON array, no other text.`

  const result = await runPrompt(analyzePrompt, {
    model: opts.model,
    timeout: 120_000,
  })

  let notes: string[]
  try {
    const jsonMatch = result.stdout.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      notes = JSON.parse(jsonMatch[0]) as string[]
    } else {
      throw new Error("No JSON array found")
    }
  } catch {
    notes = ["Analysis failed to produce valid output"]
  }

  await writeJson(opts.outputPath, notes)
  return notes
}
