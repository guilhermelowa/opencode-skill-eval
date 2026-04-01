import path from "path"
import os from "os"
import { cp, mkdir, rm } from "fs/promises"
import pLimit from "p-limit"
import { type EvalItem, type EvalMetadata, type TimingData } from "./types.js"
import { runPrompt } from "../utils/subprocess.js"
import { ensureDir, writeJson, listFiles } from "../utils/filesystem.js"
import { snapshotSkill } from "../skill/snapshot.js"

export interface RunEvalOptions {
  evals: EvalItem[]
  skillPath: string
  model: string
  workspace: string
  iteration: number
  parallel: number
  timeout: number
  withBaseline: boolean
  baselineMode: "without_skill" | "old_skill"
  oldSkillPath?: string
}

export interface RunResult {
  evalId: number
  config: string
  outputDir: string
  timing: TimingData
}

export async function runEval(opts: RunEvalOptions): Promise<RunResult[]> {
  const limit = pLimit(opts.parallel)
  const tasks: Promise<RunResult>[] = []

  // Snapshot old skill if needed
  let oldSnapshot: string | undefined
  if (opts.baselineMode === "old_skill" && opts.oldSkillPath) {
    oldSnapshot = await snapshotSkill(opts.oldSkillPath, opts.workspace)
  }

  // Create a clean temp workspace for all runs
  const tempWorkspace = await mkdir(
    path.join(os.tmpdir(), `opencode-eval-${Date.now()}`),
    { recursive: true },
  ) as string

  try {
    for (const ev of opts.evals) {
      const evalName = `eval-${ev.id}`

      // Write eval metadata
      const metaDir = path.join(opts.workspace, `iteration-${opts.iteration}`, evalName)
      await ensureDir(metaDir)

      const metadata: EvalMetadata = {
        eval_id: ev.id,
        eval_name: evalName,
        prompt: ev.prompt,
        assertions: ev.assertions,
      }
      await writeJson(path.join(metaDir, "eval_metadata.json"), metadata)

      // Copy input files if any
      const inputDir = path.join(metaDir, "inputs")
      for (const file of ev.files) {
        const src = path.resolve(opts.skillPath, file)
        await ensureDir(inputDir)
        try {
          await cp(src, path.join(inputDir, path.basename(file)))
        } catch {
          // File may not exist, continue
        }
      }

      // with_skill run: place skill in temp workspace
      const skillName = path.basename(opts.skillPath)
      const skillInTemp = path.join(tempWorkspace, ".opencode", "skill", skillName)
      await cp(opts.skillPath, skillInTemp, { recursive: true })

      const withDir = path.join(metaDir, "with_skill", "run-1")
      tasks.push(
        limit(async () => {
          const result = await runPrompt(ev.prompt, {
            model: opts.model,
            cwd: tempWorkspace,
            disableExternalSkills: true,
            timeout: opts.timeout,
            outputDir: path.join(withDir, "outputs"),
          })
          const timing: TimingData = {
            duration_ms: result.durationMs,
            total_duration_seconds: result.durationMs / 1000,
          }
          await writeJson(path.join(withDir, "timing.json"), timing)

          // Copy any files created by the skill into outputs
          await collectOutputFiles(tempWorkspace, path.join(withDir, "outputs"))

          return { evalId: ev.id, config: "with_skill", outputDir: withDir, timing }
        }),
      )

      // baseline run
      if (opts.withBaseline) {
        const baselineConfig = opts.baselineMode
        const baselineDir = path.join(metaDir, baselineConfig, "run-1")

        // For without_skill: remove skill from temp workspace
        // For old_skill: replace skill in temp workspace
        if (baselineConfig === "without_skill") {
          await rm(skillInTemp, { recursive: true, force: true })
        } else if (baselineConfig === "old_skill" && oldSnapshot) {
          await rm(skillInTemp, { recursive: true, force: true })
          await cp(oldSnapshot, skillInTemp, { recursive: true })
        }

        const baselineCwd = baselineConfig === "without_skill"
          ? tempWorkspace
          : tempWorkspace

        tasks.push(
          limit(async () => {
            const result = await runPrompt(ev.prompt, {
              model: opts.model,
              cwd: baselineCwd,
              disableExternalSkills: true,
              timeout: opts.timeout,
              outputDir: path.join(baselineDir, "outputs"),
            })
            const timing: TimingData = {
              duration_ms: result.durationMs,
              total_duration_seconds: result.durationMs / 1000,
            }
            await writeJson(path.join(baselineDir, "timing.json"), timing)

            return { evalId: ev.id, config: baselineConfig, outputDir: baselineDir, timing }
          }),
        )
      }
    }

    return await Promise.all(tasks)
  } finally {
    // Clean up temp workspace
    await rm(tempWorkspace, { recursive: true, force: true })
  }
}

const EXCLUDE_FILES = new Set(["transcript.md", "user_notes.md", "metrics.json"])

async function collectOutputFiles(workspaceDir: string, outputDir: string): Promise<void> {
  try {
    const files = await listFiles(workspaceDir, EXCLUDE_FILES)
    for (const f of files) {
      try {
        await cp(path.join(workspaceDir, f), path.join(outputDir, f))
      } catch {
        // Skip
      }
    }
  } catch {
    // Workspace dir may not exist
  }
}
