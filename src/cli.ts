#!/usr/bin/env node
import { Command } from "commander"
import path from "path"
import os from "os"
import { execFile } from "child_process"
import { runEval } from "./eval/runner.js"
import { gradeRun } from "./eval/grader.js"
import { compareRuns } from "./eval/comparator.js"
import { aggregateBenchmark, generateMarkdown } from "./eval/aggregator.js"
import { analyzeBenchmark } from "./eval/analyzer.js"
import { generateView } from "./viewer/generate.js"
import { runTriggerEval } from "./trigger/runner.js"
import { optimizeTriggers } from "./trigger/optimizer.js"
import { loadSkill, loadEvals } from "./skill/loader.js"
import { scaffoldSkill } from "./skill/scaffold.js"
import { snapshotSkill } from "./skill/snapshot.js"
import { readJson, writeJson, ensureDir, exists, listDirs } from "./utils/filesystem.js"
import { type EvalItem, EvalsFile } from "./eval/types.js"
import { type TriggerEvalItem } from "./trigger/types.js"
import { readFile, writeFile } from "fs/promises"

const pkg = { name: "opencode-skill-eval", version: "0.1.0" }

async function openInBrowser(filePath: string): Promise<void> {
  const url = `file://${path.resolve(filePath)}`
  const platform = os.platform()
  const cmd = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open"
  const args = platform === "win32" ? ["/c", "start", url] : [url]

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(cmd, args, (err: Error | null) => err ? reject(err) : resolve())
    })
    console.log(`Opened viewer in browser: ${url}`)
  } catch {
    console.log(`Could not open browser automatically.`)
    console.log(`Open manually: ${url}`)
  }
}

async function autoGenerateView(iterDir: string, skillName: string, benchmarkPath: string): Promise<void> {
  const htmlPath = path.join(iterDir, "review.html")
  console.log(`\nGenerating HTML viewer...`)
  await generateView({ workspace: iterDir, skillName, benchmarkPath, outputPath: htmlPath })
  console.log(`Viewer saved to: ${htmlPath}`)
  await openInBrowser(htmlPath)
}

const program = new Command()
  .name("opencode-skill-eval")
  .description("Create, test, and evaluate Agent Skills for OpenCode")
  .version(pkg.version)

// --- scaffold ---
program
  .command("scaffold <name>")
  .description("Scaffold a new skill with evals directory")
  .option("-p, --path <dir>", "Base directory for the skill", ".")
  .action(async (name: string, opts: { path: string }) => {
    const dir = await scaffoldSkill(name, path.resolve(opts.path))
    console.log(`Created skill at: ${dir}`)
    console.log("Next steps:")
    console.log(`  1. Edit ${dir}/SKILL.md with your skill instructions`)
    console.log(`  2. Edit ${dir}/evals/evals.json with test prompts and assertions`)
    console.log(`  3. Run: opencode-skill-eval test ${dir}`)
  })

// --- test ---
program
  .command("test <skill-path>")
  .description("Run output quality tests (with-skill + baseline)")
  .option("-e, --evals <path>", "Path to evals.json")
  .requiredOption("-m, --model <model>", "Model to use (e.g. opencode/qwen3.6-plus-free)")
  .option("-w, --workspace <dir>", "Workspace directory")
  .option("-i, --iteration <n>", "Iteration number", "1")
  .option("-p, --parallel <n>", "Parallel runs", "2")
  .option("-t, --timeout <ms>", "Timeout per run in ms", "300000")
  .option("--no-baseline", "Skip baseline runs")
  .option("--baseline-mode <mode>", "Baseline mode: without_skill or old_skill", "without_skill")
  .option("--old-skill <path>", "Path to old skill for old_skill baseline")
  .action(async (skillPath: string, opts: Record<string, unknown>) => {
    const resolved = path.resolve(skillPath)
    const evalsPath = (opts.evals as string) || path.join(resolved, "evals", "evals.json")
    const workspace = (opts.workspace as string) || `${resolved}-workspace`

    const evalsData = await readJson<EvalsFile>(evalsPath)
    const parsed = EvalsFile.parse(evalsData)

    console.log(`Running ${parsed.evals.length} evals for skill: ${parsed.skill_name}`)
    console.log(`Model: ${opts.model}`)
    console.log(`Workspace: ${workspace}`)

    const results = await runEval({
      evals: parsed.evals,
      skillPath: resolved,
      model: opts.model as string,
      workspace,
      iteration: parseInt(opts.iteration as string, 10),
      parallel: parseInt(opts.parallel as string, 10),
      timeout: parseInt(opts.timeout as string, 10),
      withBaseline: opts.baseline !== false,
      baselineMode: (opts.baselineMode as "without_skill" | "old_skill") || "without_skill",
      oldSkillPath: opts.oldSkill as string | undefined,
    })

    console.log(`\nCompleted ${results.length} runs:`)
    for (const r of results) {
      console.log(`  eval-${r.evalId} [${r.config}]: ${r.timing.total_duration_seconds.toFixed(1)}s`)
    }
    console.log(`\nNext: opencode-skill-eval grade ${workspace}/iteration-${opts.iteration}`)
  })

// --- grade ---
program
  .command("grade <workspace>")
  .description("Grade eval outputs against assertions")
  .requiredOption("-m, --model <model>", "Model to use for grading (e.g. opencode/qwen3.6-plus-free)")
  .action(async (workspace: string, opts: Record<string, unknown>) => {
    const iterDir = path.resolve(workspace)
    const evalDirs = (await listDirs(iterDir)).filter((d) => d.startsWith("eval-")).sort()

    console.log(`Grading ${evalDirs.length} evals...`)

    for (const evalDirName of evalDirs) {
      const evalPath = path.join(iterDir, evalDirName)

      const metaPath = path.join(evalPath, "eval_metadata.json")
      const meta = await readJson<{ eval_id: number; assertions: string[] }>(metaPath)

      const configs = (await listDirs(evalPath)).filter((d) => d !== "inputs")
      for (const config of configs) {
        const configPath = path.join(evalPath, config)
        const runDirs = (await listDirs(configPath)).filter((d) => d.startsWith("run-")).sort()
        for (const runDir of runDirs) {
          const runPath = path.join(configPath, runDir)
          const transcriptPath = path.join(runPath, "outputs", "transcript.md")
          const outputsDir = path.join(runPath, "outputs")
          const outputPath = path.join(runPath, "grading.json")

          if (await exists(outputPath)) {
            console.log(`  ${evalDirName}/${config}/${runDir}: already graded, skipping`)
            continue
          }

          console.log(`  Grading ${evalDirName}/${config}/${runDir}...`)
          await gradeRun({
            evalAssertions: meta.assertions,
            transcriptPath,
            outputsDir,
            model: opts.model as string,
            outputPath,
          })
        }
      }
    }

    console.log(`\nNext: opencode-skill-eval benchmark ${iterDir}`)
  })

// --- benchmark ---
program
  .command("benchmark <workspace>")
  .description("Aggregate grading results into benchmark stats")
  .option("-n, --skill-name <name>", "Skill name")
  .option("--skill-path <path>", "Skill path")
  .requiredOption("-m, --model <model>", "Model used for grading (e.g. opencode/qwen3.6-plus-free)")
  .option("--no-view", "Skip generating HTML viewer")
  .action(async (workspace: string, opts: Record<string, unknown>) => {
    const iterDir = path.resolve(workspace)
    const skillName = (opts.skillName as string) || path.basename(path.dirname(iterDir)).replace("-workspace", "")
    const skillPath = (opts.skillPath as string) || ""

    console.log(`Generating benchmark for ${skillName}...`)

    const benchmark = await aggregateBenchmark(iterDir, skillName, skillPath, opts.model as string)
    const md = generateMarkdown(benchmark)

    const mdPath = path.join(iterDir, "benchmark.md")
    await writeFile(mdPath, md)

    console.log(md)
    console.log(`\nBenchmark saved to: ${path.join(iterDir, "benchmark.json")}`)
    console.log(`Markdown saved to: ${mdPath}`)

    if (opts.view !== false) {
      await autoGenerateView(iterDir, skillName, path.join(iterDir, "benchmark.json"))
    }
  })

// --- view ---
program
  .command("view <workspace>")
  .description("Generate and optionally serve the eval viewer")
  .option("-n, --skill-name <name>", "Skill name")
  .option("--benchmark <path>", "Path to benchmark.json")
  .option("--previous-workspace <path>", "Path to previous iteration workspace")
  .option("--static <path>", "Write static HTML to this path instead of serving")
  .action(async (workspace: string, opts: Record<string, unknown>) => {
    const iterDir = path.resolve(workspace)
    const skillName = (opts.skillName as string) || path.basename(path.dirname(iterDir)).replace("-workspace", "")
    const outputPath = (opts.static as string) || path.join(iterDir, "review.html")

    console.log(`Generating viewer...`)

    await generateView({
      workspace: iterDir,
      skillName,
      benchmarkPath: opts.benchmark as string | undefined,
      previousWorkspace: opts.previousWorkspace as string | undefined,
      outputPath,
    })

    console.log(`Viewer written to: ${outputPath}`)

    if (!opts.static) {
      await openInBrowser(outputPath)
    }
  })

// --- compare ---
program
  .command("compare <old-skill> <new-skill>")
  .description("Compare old skill vs new skill with blind A/B comparison")
  .option("-e, --evals <path>", "Path to evals.json")
  .requiredOption("-m, --model <model>", "Model to use (e.g. opencode/qwen3.6-plus-free)")
  .option("-w, --workspace <dir>", "Workspace directory")
  .option("-p, --parallel <n>", "Parallel runs", "2")
  .option("-t, --timeout <ms>", "Timeout per run in ms", "300000")
  .option("--no-view", "Skip generating HTML viewer")
  .action(async (oldSkill: string, newSkill: string, opts: Record<string, unknown>) => {
    const oldResolved = path.resolve(oldSkill)
    const newResolved = path.resolve(newSkill)
    const workspace = (opts.workspace as string) || `${newResolved}-compare-workspace`
    const evalsPath = (opts.evals as string) || path.join(newResolved, "evals", "evals.json")

    const evalsData = await readJson<EvalsFile>(evalsPath)
    const parsed = EvalsFile.parse(evalsData)

    console.log(`Comparing old vs new skill with ${parsed.evals.length} evals...`)

    const results = await runEval({
      evals: parsed.evals,
      skillPath: newResolved,
      model: opts.model as string,
      workspace,
      iteration: 1,
      parallel: parseInt(opts.parallel as string, 10),
      timeout: parseInt(opts.timeout as string, 10),
      withBaseline: true,
      baselineMode: "old_skill",
      oldSkillPath: oldResolved,
    })

    console.log(`\nCompleted ${results.length} runs:`)
    for (const r of results) {
      console.log(`  eval-${r.evalId} [${r.config}]: ${r.timing.total_duration_seconds.toFixed(1)}s`)
    }

    const iterDir = path.join(workspace, "iteration-1")
    const evalDirs = (await listDirs(iterDir)).filter((d) => d.startsWith("eval-")).sort()

    for (const evalDirName of evalDirs) {
      const evalPath = path.join(iterDir, evalDirName)
      const meta = await readJson<{ assertions: string[] }>(path.join(evalPath, "eval_metadata.json"))
      const configs = (await listDirs(evalPath)).filter((d) => d !== "inputs")

      for (const config of configs) {
        const configPath = path.join(evalPath, config)
        const runDirs = (await listDirs(configPath)).filter((d) => d.startsWith("run-")).sort()
        for (const runDir of runDirs) {
          const runPath = path.join(configPath, runDir)
          console.log(`  Grading ${evalDirName}/${config}/${runDir}...`)
          await gradeRun({
            evalAssertions: meta.assertions,
            transcriptPath: path.join(runPath, "outputs", "transcript.md"),
            outputsDir: path.join(runPath, "outputs"),
            model: opts.model as string,
            outputPath: path.join(runPath, "grading.json"),
          })
        }
      }
    }

    console.log("\nRunning blind comparisons...")
    for (const ev of parsed.evals) {
      const oldOutputPath = path.join(iterDir, `eval-${ev.id}`, "old_skill", "run-1", "outputs")
      const newOutputPath = path.join(iterDir, `eval-${ev.id}`, "with_skill", "run-1", "outputs")
      const compOutputPath = path.join(iterDir, `eval-${ev.id}`, "comparison.json")

      await compareRuns({
        evalPrompt: ev.prompt,
        outputAPath: newOutputPath,
        outputBPath: oldOutputPath,
        labelA: "New Skill",
        labelB: "Old Skill",
        expectations: ev.assertions,
        model: opts.model as string,
        outputPath: compOutputPath,
      })
      console.log(`  Comparison saved for eval-${ev.id}`)
    }

    const benchmark = await aggregateBenchmark(iterDir, parsed.skill_name, newResolved, opts.model as string)
    const md = generateMarkdown(benchmark)
    await writeFile(path.join(iterDir, "benchmark.md"), md)

    console.log(md)

    const analysisPath = path.join(iterDir, "analysis.json")
    const notes = await analyzeBenchmark({
      benchmark,
      skillPath: newResolved,
      model: opts.model as string,
      outputPath: analysisPath,
    })
    benchmark.notes = notes
    await writeJson(path.join(iterDir, "benchmark.json"), benchmark)

    if (opts.view !== false) {
      await autoGenerateView(iterDir, parsed.skill_name, path.join(iterDir, "benchmark.json"))
    }

    console.log(`\nComparison complete!`)
    console.log(`Benchmark: ${path.join(iterDir, "benchmark.json")}`)

    const summary = benchmark.run_summary as Record<string, { pass_rate: { mean: number } }>
    for (const [config, stats] of Object.entries(summary)) {
      if (config === "delta") continue
      console.log(`  ${config}: ${(stats.pass_rate.mean * 100).toFixed(1)}% pass rate`)
    }
  })

// --- run-all ---
program
  .command("run-all <skill-path>")
  .description("Run full eval pipeline: test → grade → benchmark → view")
  .option("-e, --evals <path>", "Path to evals.json")
  .requiredOption("-m, --model <model>", "Model to use (e.g. opencode/qwen3.6-plus-free)")
  .option("-w, --workspace <dir>", "Workspace directory")
  .option("-i, --iteration <n>", "Iteration number", "1")
  .option("-p, --parallel <n>", "Parallel runs", "2")
  .option("-t, --timeout <ms>", "Timeout per run in ms", "300000")
  .option("--no-baseline", "Skip baseline runs")
  .option("--baseline-mode <mode>", "Baseline mode: without_skill or old_skill", "without_skill")
  .option("--old-skill <path>", "Path to old skill for baseline")
  .option("--compare <old-skill>", "Enable A/B compare mode with old skill path")
  .option("--no-view", "Skip generating HTML viewer")
  .action(async (skillPath: string, opts: Record<string, unknown>) => {
    const resolved = path.resolve(skillPath)
    const evalsPath = (opts.evals as string) || path.join(resolved, "evals", "evals.json")
    const workspace = (opts.workspace as string) || `${resolved}-workspace`
    const comparePath = opts.compare as string | undefined

    const evalsData = await readJson<EvalsFile>(evalsPath)
    const parsed = EvalsFile.parse(evalsData)

    const iteration = parseInt(opts.iteration as string, 10)
    const iterDir = path.join(workspace, `iteration-${iteration}`)

    const baselineMode = comparePath
      ? "old_skill"
      : (opts.baselineMode as "without_skill" | "old_skill") || "without_skill"
    const oldSkillPath = comparePath
      ? path.resolve(comparePath)
      : (opts.oldSkill as string | undefined)

    console.log(`Running full pipeline for skill: ${parsed.skill_name}`)
    console.log(`Model: ${opts.model}`)
    console.log(`Workspace: ${workspace}`)
    console.log(`Baseline: ${baselineMode}`)
    if (comparePath) console.log(`Compare mode: vs ${path.resolve(comparePath)}`)
    console.log("")

    // Phase 1: Test
    console.log("=== Phase 1: Running evals ===")
    const results = await runEval({
      evals: parsed.evals,
      skillPath: resolved,
      model: opts.model as string,
      workspace,
      iteration,
      parallel: parseInt(opts.parallel as string, 10),
      timeout: parseInt(opts.timeout as string, 10),
      withBaseline: opts.baseline !== false,
      baselineMode,
      oldSkillPath,
    })

    console.log(`\nCompleted ${results.length} runs:`)
    for (const r of results) {
      console.log(`  eval-${r.evalId} [${r.config}]: ${r.timing.total_duration_seconds.toFixed(1)}s`)
    }
    console.log("")

    // Phase 2: Grade
    console.log("=== Phase 2: Grading ===")
    const evalDirs = (await listDirs(iterDir)).filter((d) => d.startsWith("eval-")).sort()

    for (const evalDirName of evalDirs) {
      const evalPath = path.join(iterDir, evalDirName)
      const meta = await readJson<{ assertions: string[] }>(path.join(evalPath, "eval_metadata.json"))
      const configs = (await listDirs(evalPath)).filter((d) => d !== "inputs")

      for (const config of configs) {
        const configPath = path.join(evalPath, config)
        const runDirs = (await listDirs(configPath)).filter((d) => d.startsWith("run-")).sort()
        for (const runDir of runDirs) {
          const runPath = path.join(configPath, runDir)
          const outputPath = path.join(runPath, "grading.json")

          if (await exists(outputPath)) {
            console.log(`  ${evalDirName}/${config}/${runDir}: already graded, skipping`)
            continue
          }

          console.log(`  Grading ${evalDirName}/${config}/${runDir}...`)
          await gradeRun({
            evalAssertions: meta.assertions,
            transcriptPath: path.join(runPath, "outputs", "transcript.md"),
            outputsDir: path.join(runPath, "outputs"),
            model: opts.model as string,
            outputPath,
          })
        }
      }
    }
    console.log("")

    // Phase 3: Benchmark
    console.log("=== Phase 3: Benchmark ===")
    const benchmark = await aggregateBenchmark(iterDir, parsed.skill_name, resolved, opts.model as string)
    const md = generateMarkdown(benchmark)
    await writeFile(path.join(iterDir, "benchmark.md"), md)

    console.log(md)

    // Phase 4: Compare mode extras
    if (comparePath) {
      console.log("=== Phase 4: Analysis & Blind Comparison ===")

      const analysisPath = path.join(iterDir, "analysis.json")
      const notes = await analyzeBenchmark({
        benchmark,
        skillPath: resolved,
        model: opts.model as string,
        outputPath: analysisPath,
      })
      benchmark.notes = notes

      for (const ev of parsed.evals) {
        const oldOutputPath = path.join(iterDir, `eval-${ev.id}`, "old_skill", "run-1", "outputs")
        const newOutputPath = path.join(iterDir, `eval-${ev.id}`, "with_skill", "run-1", "outputs")
        const compOutputPath = path.join(iterDir, `eval-${ev.id}`, "comparison.json")

        await compareRuns({
          evalPrompt: ev.prompt,
          outputAPath: newOutputPath,
          outputBPath: oldOutputPath,
          labelA: "New Skill",
          labelB: "Old Skill",
          expectations: ev.assertions,
          model: opts.model as string,
          outputPath: compOutputPath,
        })
        console.log(`  Comparison saved for eval-${ev.id}`)
      }

      await writeJson(path.join(iterDir, "benchmark.json"), benchmark)
    } else {
      await writeJson(path.join(iterDir, "benchmark.json"), benchmark)
    }

    // Phase 5: View
    if (opts.view !== false) {
      await autoGenerateView(iterDir, parsed.skill_name, path.join(iterDir, "benchmark.json"))
    }

    // Summary
    console.log(`\n=== Pipeline Complete ===`)
    console.log(`Benchmark: ${path.join(iterDir, "benchmark.json")}`)
    console.log(`Markdown: ${path.join(iterDir, "benchmark.md")}`)

    const summary = benchmark.run_summary as Record<string, { pass_rate: { mean: number } }>
    for (const [config, stats] of Object.entries(summary)) {
      if (config === "delta") continue
      console.log(`  ${config}: ${(stats.pass_rate.mean * 100).toFixed(1)}% pass rate`)
    }
  })

// --- optimize-triggers ---
program
  .command("optimize-triggers <skill-path>")
  .description("Optimize skill description for accurate triggering")
  .option("-e, --eval-set <path>", "Path to trigger eval JSON")
  .requiredOption("-m, --model <model>", "Model to use (e.g. opencode/qwen3.6-plus-free)")
  .option("--max-iterations <n>", "Max optimization iterations", "5")
  .option("--runs-per-query <n>", "Runs per query", "3")
  .option("--threshold <n>", "Trigger threshold", "0.5")
  .option("--holdout <n>", "Test holdout fraction", "0.4")
  .option("-w, --workspace <dir>", "Workspace directory")
  .action(async (skillPath: string, opts: Record<string, unknown>) => {
    const resolved = path.resolve(skillPath)
    const evalSetPath = (opts.evalSet as string) || path.join(resolved, "trigger-evals.json")
    const workspace = (opts.workspace as string) || `${resolved}-trigger-workspace`

    const skill = await loadSkill(resolved)
    if (!skill) {
      console.error("Could not load skill from:", resolved)
      process.exit(1)
    }

    const evalSet = await readJson<TriggerEvalItem[]>(evalSetPath)
    console.log(`Optimizing triggers with ${evalSet.length} queries...`)

    const result = await optimizeTriggers({
      evalSet,
      skillPath: resolved,
      skillName: skill.name,
      skillContent: skill.content,
      originalDescription: skill.description,
      model: opts.model as string,
      maxIterations: parseInt(opts.maxIterations as string, 10),
      parallel: 3,
      timeout: 30_000,
      runsPerQuery: parseInt(opts.runsPerQuery as string, 10),
      triggerThreshold: parseFloat(opts.threshold as string),
      holdout: parseFloat(opts.holdout as string),
      workspace,
    })

    console.log(`\nOptimization complete!`)
    console.log(`Exit reason: ${result.exit_reason}`)
    console.log(`Iterations: ${result.iterations_run}`)
    console.log(`Best score: ${result.best_score}`)
    console.log(`\nBest description:\n${result.best_description}`)

    await writeJson(path.join(workspace, "optimization-result.json"), result)
    console.log(`\nResults saved to: ${path.join(workspace, "optimization-result.json")}`)
  })

// --- snapshot ---
program
  .command("snapshot <skill-path>")
  .description("Create a snapshot of a skill directory")
  .option("-w, --workspace <dir>", "Output directory")
  .action(async (skillPath: string, opts: Record<string, unknown>) => {
    const resolved = path.resolve(skillPath)
    const workspace = (opts.workspace as string) || `${resolved}-workspace`
    const dest = await snapshotSkill(resolved, workspace)
    console.log(`Snapshot created at: ${dest}`)
  })

program.parse()
