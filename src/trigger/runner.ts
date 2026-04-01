import { type TriggerEvalItem, type TriggerRunOutput, type TriggerEvalResult } from "./types.js"
import { runPrompt } from "../utils/subprocess.js"
import pLimit from "p-limit"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { exists } from "../utils/filesystem.js"

export interface TriggerRunOptions {
  evalSet: TriggerEvalItem[]
  skillName: string
  description: string
  skillContent: string
  model: string
  runsPerQuery: number
  parallel: number
  timeout: number
  triggerThreshold: number
  tempDir: string
}

export async function runTriggerEval(opts: TriggerRunOptions): Promise<TriggerRunOutput> {
  const limit = pLimit(opts.parallel)
  const tasks: Promise<{ query: string; shouldTrigger: boolean; triggered: boolean }>[] = []

  // Create temp directory with skill in .opencode/skill/<name>/SKILL.md
  const tempSkillDir = path.join(opts.tempDir, `trigger-test-${Date.now()}`)
  const skillDir = path.join(tempSkillDir, ".opencode", "skill", opts.skillName)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${opts.skillName}\ndescription: ${opts.description}\n---\n\n${opts.skillContent}`,
  )

  for (const item of opts.evalSet) {
    for (let run = 0; run < opts.runsPerQuery; run++) {
      tasks.push(
        limit(async () => {
          const result = await runPrompt(item.query, {
            model: opts.model,
            cwd: tempSkillDir,
            disableExternalSkills: true,
            timeout: opts.timeout,
          })
          // Detect if skill was triggered by looking for skill tool calls in output
          const triggered = result.stdout.includes(opts.skillName) ||
            result.stdout.includes("skill(") ||
            result.stdout.includes("skill_content")
          return {
            query: item.query,
            shouldTrigger: item.should_trigger,
            triggered,
          }
        }),
      )
    }
  }

  const allResults = await Promise.all(tasks)

  // Aggregate by query
  const queryMap = new Map<string, { shouldTrigger: boolean; triggers: boolean[] }>()
  for (const r of allResults) {
    if (!queryMap.has(r.query)) {
      queryMap.set(r.query, { shouldTrigger: r.shouldTrigger, triggers: [] })
    }
    queryMap.get(r.query)!.triggers.push(r.triggered)
  }

  const results: TriggerEvalResult[] = []
  for (const [query, data] of queryMap) {
    const triggerRate = data.triggers.filter(Boolean).length / data.triggers.length
    const shouldTrigger = data.shouldTrigger
    const pass = shouldTrigger
      ? triggerRate >= opts.triggerThreshold
      : triggerRate < opts.triggerThreshold

    results.push({
      query,
      should_trigger: shouldTrigger,
      trigger_rate: Math.round(triggerRate * 10000) / 10000,
      triggers: data.triggers.filter(Boolean).length,
      runs: data.triggers.length,
      pass,
    })
  }

  const passed = results.filter((r) => r.pass).length

  return {
    skill_name: opts.skillName,
    description: opts.description,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
  }
}
