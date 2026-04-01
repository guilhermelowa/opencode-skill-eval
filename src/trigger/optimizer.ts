import { type TriggerEvalItem, type TriggerOptimizeOutput, type TriggerHistoryEntry } from "./types.js"
import { runTriggerEval } from "./runner.js"
import { runPrompt } from "../utils/subprocess.js"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

export interface OptimizeOptions {
  evalSet: TriggerEvalItem[]
  skillPath: string
  skillName: string
  skillContent: string
  originalDescription: string
  model: string
  maxIterations: number
  parallel: number
  timeout: number
  runsPerQuery: number
  triggerThreshold: number
  holdout: number
  workspace: string
}

function splitEvalSet(evalSet: TriggerEvalItem[], holdout: number): { train: TriggerEvalItem[]; test: TriggerEvalItem[] } {
  const trigger = evalSet.filter((e) => e.should_trigger)
  const noTrigger = evalSet.filter((e) => !e.should_trigger)

  // Shuffle
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  const shuffledTrigger = shuffle(trigger)
  const shuffledNoTrigger = shuffle(noTrigger)

  const nTriggerTest = Math.max(1, Math.floor(shuffledTrigger.length * holdout))
  const nNoTriggerTest = Math.max(1, Math.floor(shuffledNoTrigger.length * holdout))

  return {
    test: [...shuffledTrigger.slice(0, nTriggerTest), ...shuffledNoTrigger.slice(0, nNoTriggerTest)],
    train: [...shuffledTrigger.slice(nTriggerTest), ...shuffledNoTrigger.slice(nNoTriggerTest)],
  }
}

export async function optimizeTriggers(opts: OptimizeOptions): Promise<TriggerOptimizeOutput> {
  const { train, test } = splitEvalSet(opts.evalSet, opts.holdout)
  const history: TriggerHistoryEntry[] = []
  let currentDescription = opts.originalDescription
  let exitReason = "unknown"

  await mkdir(opts.workspace, { recursive: true })

  for (let iteration = 1; iteration <= opts.maxIterations; iteration++) {
    // Evaluate train + test together
    const allQueries = [...train, ...test]
    const tempDir = path.join(opts.workspace, `iter-${iteration}`)
    await mkdir(tempDir, { recursive: true })

    const runOutput = await runTriggerEval({
      evalSet: allQueries,
      skillName: opts.skillName,
      description: currentDescription,
      skillContent: opts.skillContent,
      model: opts.model,
      runsPerQuery: opts.runsPerQuery,
      parallel: opts.parallel,
      timeout: opts.timeout,
      triggerThreshold: opts.triggerThreshold,
      tempDir,
    })

    // Split results back
    const trainQueries = new Set(train.map((q) => q.query))
    const trainResults = runOutput.results.filter((r) => trainQueries.has(r.query))
    const testResults = runOutput.results.filter((r) => !trainQueries.has(r.query))

    const trainPassed = trainResults.filter((r) => r.pass).length
    const testPassed = testResults.filter((r) => r.pass).length

    history.push({
      iteration,
      description: currentDescription,
      train_passed: trainPassed,
      train_failed: train.length - trainPassed,
      train_total: train.length,
      test_passed: test.length ? testPassed : null,
      test_failed: test.length ? test.length - testPassed : null,
      test_total: test.length || null,
    })

    if (trainPassed === train.length) {
      exitReason = `all_passed (iteration ${iteration})`
      break
    }

    if (iteration === opts.maxIterations) {
      exitReason = `max_iterations (${opts.maxIterations})`
      break
    }

    // Improve description
    const failures = trainResults.filter((r) => !r.pass)
    const improvePrompt = `You are improving a skill description to fix triggering accuracy.

## Skill: ${opts.skillName}
## Current description:
${currentDescription}

## Failed queries:
${failures.map((f) => `- [expected ${f.should_trigger ? "trigger" : "no trigger"}, got ${f.trigger_rate >= opts.triggerThreshold ? "trigger" : "no trigger"}] "${f.query}"`).join("\n")}

## Passing queries (for context):
${trainResults.filter((r) => r.pass).map((f) => `- [${f.should_trigger ? "should trigger" : "should not"}] "${f.query}"`).join("\n")}

Write an improved description that:
1. Keeps it concise (under 200 words)
2. Is specific about when to trigger
3. Fixes the failures without breaking the passing queries

Return ONLY the new description text, nothing else.`

    const improveResult = await runPrompt(improvePrompt, {
      model: opts.model,
      timeout: 60_000,
    })

    currentDescription = improveResult.stdout.trim()
  }

  // Find best by test score
  const withTest = history.filter((h) => h.test_passed !== null)
  const best = withTest.length
    ? withTest.reduce((a, b) => (b.test_passed! > a.test_passed! ? b : a))
    : history.reduce((a, b) => (b.train_passed > a.train_passed ? b : a))

  return {
    exit_reason: exitReason,
    original_description: opts.originalDescription,
    best_description: best.description,
    best_score: withTest.length
      ? `${best.test_passed}/${best.test_total}`
      : `${best.train_passed}/${best.train_total}`,
    best_train_score: `${best.train_passed}/${best.train_total}`,
    best_test_score: withTest.length ? `${best.test_passed}/${best.test_total}` : null,
    final_description: currentDescription,
    iterations_run: history.length,
    holdout: opts.holdout,
    train_size: train.length,
    test_size: test.length,
    history,
  }
}
