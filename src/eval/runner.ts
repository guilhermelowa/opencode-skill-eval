import path from "path"
import os from "os"
import { cp, mkdir, rm, writeFile } from "fs/promises"
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

  // Create separate temp workspaces for with_skill and baseline runs
  const withSkillWorkspace = await mkdir(
    path.join(os.tmpdir(), `opencode-eval-with-${Date.now()}`),
    { recursive: true },
  ) as string
  const baselineWorkspace = await mkdir(
    path.join(os.tmpdir(), `opencode-eval-baseline-${Date.now()}`),
    { recursive: true },
  ) as string

  // Clear ~/swim.txt before running evals to ensure clean state
  const swimFile = path.join(os.homedir(), "swim.txt")
  await writeFile(swimFile, "")

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

      // with_skill run: place skill in with_skill workspace
      const skillName = path.basename(opts.skillPath)
      const skillInWithWorkspace = path.join(withSkillWorkspace, ".opencode", "skill", skillName)
      await cp(opts.skillPath, skillInWithWorkspace, { recursive: true })

      const withDir = path.join(metaDir, "with_skill", "run-1")
      tasks.push(
        limit(async () => {
          const result = await runPrompt(ev.prompt, {
            model: opts.model,
            cwd: withSkillWorkspace,
            disableExternalSkills: true,
            timeout: opts.timeout,
            outputDir: path.join(withDir, "outputs"),
          })
          const timing: TimingData = {
            duration_ms: result.durationMs,
            total_duration_seconds: result.durationMs / 1000,
            total_tokens: result.totalTokens,
          }
          await writeJson(path.join(withDir, "timing.json"), timing)

          // Copy any files created by the skill into outputs
          await collectOutputFiles(withSkillWorkspace, path.join(withDir, "outputs"))

          return { evalId: ev.id, config: "with_skill", outputDir: withDir, timing }
        }),
      )

      // baseline run
      if (opts.withBaseline) {
        const baselineConfig = opts.baselineMode
        const baselineDir = path.join(metaDir, baselineConfig, "run-1")

        // For old_skill: place old skill in baseline workspace
        if (baselineConfig === "old_skill" && oldSnapshot) {
          const skillInBaselineWorkspace = path.join(baselineWorkspace, ".opencode", "skill", skillName)
          await cp(oldSnapshot, skillInBaselineWorkspace, { recursive: true })
        }

        tasks.push(
          limit(async () => {
            const result = await runPrompt(ev.prompt, {
              model: opts.model,
              cwd: baselineWorkspace,
              disableExternalSkills: true,
              timeout: opts.timeout,
              outputDir: path.join(baselineDir, "outputs"),
            })
            const timing: TimingData = {
              duration_ms: result.durationMs,
              total_duration_seconds: result.durationMs / 1000,
              total_tokens: result.totalTokens,
            }
            await writeJson(path.join(baselineDir, "timing.json"), timing)

            return { evalId: ev.id, config: baselineConfig, outputDir: baselineDir, timing }
          }),
        )
      }
    }

    return await Promise.all(tasks)
  } finally {
    // Clean up temp workspaces
    await rm(withSkillWorkspace, { recursive: true, force: true })
    await rm(baselineWorkspace, { recursive: true, force: true })
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
