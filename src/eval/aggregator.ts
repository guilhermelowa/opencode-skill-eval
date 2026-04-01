import path from "path"
import { type Benchmark, type BenchmarkRun, type BenchmarkStats, type GradingResult } from "./types.js"
import { readJson, writeJson, listDirs, exists } from "../utils/filesystem.js"

function calcStats(values: number[]): BenchmarkStats {
  if (!values.length) return { mean: 0, stddev: 0, min: 0, max: 0 }
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = n > 1
    ? values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1)
    : 0
  return {
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(Math.sqrt(variance) * 10000) / 10000,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

export async function aggregateBenchmark(
  workspaceDir: string,
  skillName: string,
  skillPath: string,
  model: string,
): Promise<Benchmark> {
  const iterDir = workspaceDir
  const configs: Record<string, Array<{
    evalId: number
    runNumber: number
    passRate: number
    passed: number
    failed: number
    total: number
    timeSeconds: number
    tokens: number
    grading: GradingResult
    notes: string[]
  }>> = {}

  // Discover eval directories
  const evalDirs = (await listDirs(iterDir))
    .filter((d) => d.startsWith("eval-"))
    .sort()

  for (const evalDirName of evalDirs) {
    const evalId = parseInt(evalDirName.split("-")[1], 10) || 0
    const evalPath = path.join(iterDir, evalDirName)

    // Discover config directories
    const configDirs = (await listDirs(evalPath))
      .filter((d) => d !== "inputs")

    for (const configName of configDirs) {
      const configPath = path.join(evalPath, configName)
      const runDirs = (await listDirs(configPath))
        .filter((d) => d.startsWith("run-"))
        .sort()

      for (const runDirName of runDirs) {
        const runNumber = parseInt(runDirName.split("-")[1], 10) || 1
        const runPath = path.join(configPath, runDirName)

        // Load grading
        const gradingPath = path.join(runPath, "grading.json")
        let grading: GradingResult | null = null
        if (await exists(gradingPath)) {
          grading = await readJson<GradingResult>(gradingPath)
        }

        // Load timing
        const timingPath = path.join(runPath, "timing.json")
        let timeSeconds = 0
        let tokens = 0
        if (await exists(timingPath)) {
          const timing = await readJson<{ total_duration_seconds?: number; total_tokens?: number }>(timingPath)
          timeSeconds = timing.total_duration_seconds ?? 0
          tokens = timing.total_tokens ?? 0
        }

        if (!configs[configName]) configs[configName] = []
        configs[configName].push({
          evalId,
          runNumber,
          passRate: grading?.summary.pass_rate ?? 0,
          passed: grading?.summary.passed ?? 0,
          failed: grading?.summary.failed ?? 0,
          total: grading?.summary.total ?? 0,
          timeSeconds,
          tokens,
          grading: grading ?? {
            expectations: [],
            summary: { passed: 0, failed: 0, total: 0, pass_rate: 0 },
          },
          notes: [],
        })
      }
    }
  }

  // Build runs array
  const runs: BenchmarkRun[] = []
  for (const [config, entries] of Object.entries(configs)) {
    for (const entry of entries) {
      runs.push({
        eval_id: entry.evalId,
        configuration: config as BenchmarkRun["configuration"],
        run_number: entry.runNumber,
        result: {
          pass_rate: entry.passRate,
          passed: entry.passed,
          failed: entry.failed,
          total: entry.total,
          time_seconds: entry.timeSeconds,
          tokens: entry.tokens,
          tool_calls: 0,
          errors: 0,
        },
        expectations: entry.grading.expectations,
        notes: entry.notes,
      })
    }
  }

  // Build summary
  const runSummary: Record<string, unknown> = {}
  for (const [config, entries] of Object.entries(configs)) {
    runSummary[config] = {
      pass_rate: calcStats(entries.map((e) => e.passRate)),
      time_seconds: calcStats(entries.map((e) => e.timeSeconds)),
      tokens: calcStats(entries.map((e) => e.tokens)),
    }
  }

  // Delta
  const configNames = Object.keys(configs)
  if (configNames.length >= 2) {
    const primary = runSummary[configNames[0]] as Record<string, BenchmarkStats>
    const baseline = runSummary[configNames[1]] as Record<string, BenchmarkStats>
    runSummary["delta"] = {
      pass_rate: `${(primary.pass_rate.mean - baseline.pass_rate.mean >= 0 ? "+" : "") + (primary.pass_rate.mean - baseline.pass_rate.mean).toFixed(2)}`,
      time_seconds: `${(primary.time_seconds.mean - baseline.time_seconds.mean >= 0 ? "+" : "") + (primary.time_seconds.mean - baseline.time_seconds.mean).toFixed(1)}`,
      tokens: `${(primary.tokens.mean - baseline.tokens.mean >= 0 ? "+" : "") + Math.round(primary.tokens.mean - baseline.tokens.mean)}`,
    }
  }

  const evalIds = [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b)

  const benchmark: Benchmark = {
    metadata: {
      skill_name: skillName,
      skill_path: skillPath,
      executor_model: model,
      timestamp: new Date().toISOString(),
      evals_run: evalIds,
      runs_per_configuration: 1,
    },
    runs,
    run_summary: runSummary,
    notes: [],
  }

  const outPath = path.join(iterDir, "benchmark.json")
  await writeJson(outPath, benchmark)

  return benchmark
}

export function generateMarkdown(benchmark: Benchmark): string {
  const m = benchmark.metadata
  const summary = benchmark.run_summary as Record<string, Record<string, BenchmarkStats | string>>

  const configs = Object.keys(summary).filter((k) => k !== "delta")
  const labelA = configs[0]?.replace(/_/g, " ") ?? "Config A"
  const labelB = configs[1]?.replace(/_/g, " ") ?? "Config B"

  const lines: string[] = [
    `# Skill Benchmark: ${m.skill_name}`,
    "",
    `**Model**: ${m.executor_model}`,
    `**Date**: ${m.timestamp}`,
    `**Evals**: ${m.evals_run.join(", ")} (${m.runs_per_configuration} runs each)`,
    "",
    "## Summary",
    "",
    `| Metric | ${labelA} | ${labelB} | Delta |`,
    "|--------|----------|---------|-------|",
  ]

  type StatsRecord = Record<string, BenchmarkStats>
  const a = (summary[configs[0]] ?? {}) as StatsRecord
  const b = (summary[configs[1]] ?? {}) as StatsRecord
  const delta = (summary["delta"] ?? {}) as Record<string, string>

  const fmt = (s: BenchmarkStats | undefined, pct = false, dec = 1) => {
    if (!s) return "—"
    return pct
      ? `${(s.mean * 100).toFixed(0)}% ± ${(s.stddev * 100).toFixed(0)}%`
      : `${s.mean.toFixed(dec)} ± ${s.stddev.toFixed(dec)}`
  }

  lines.push(`| Pass Rate | ${fmt(a.pass_rate, true)} | ${fmt(b.pass_rate, true)} | ${delta.pass_rate ?? "—"} |`)
  lines.push(`| Time (s) | ${fmt(a.time_seconds, false)} | ${fmt(b.time_seconds, false)} | ${delta.time_seconds ?? "—"}s |`)
  lines.push(`| Tokens | ${fmt(a.tokens, false, 0)} | ${fmt(b.tokens, false, 0)} | ${delta.tokens ?? "—"} |`)

  if (benchmark.notes.length) {
    lines.push("", "## Notes", "")
    for (const note of benchmark.notes) {
      lines.push(`- ${note}`)
    }
  }

  return lines.join("\n")
}
