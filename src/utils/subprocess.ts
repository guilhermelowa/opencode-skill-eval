import { spawn } from "child_process"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

export interface RunOptions {
  cwd?: string
  timeout?: number
  env?: Record<string, string>
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

export async function run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    const proc = spawn("opencode", args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })

    const timer = opts.timeout
      ? setTimeout(() => proc.kill("SIGTERM"), opts.timeout)
      : null

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
      })
    })

    proc.on("error", () => {
      if (timer) clearTimeout(timer)
      resolve({
        stdout,
        stderr: stderr + "\nFailed to spawn opencode process",
        exitCode: -1,
        durationMs: Date.now() - start,
      })
    })

    proc.stdin.end()
  })
}

export async function runPrompt(
  prompt: string,
  opts: {
    model?: string
    cwd?: string
    timeout?: number
    outputDir?: string
    disableExternalSkills?: boolean
  } = {},
): Promise<RunResult> {
  const args = ["run"]

  if (opts.model) {
    args.push("--model", opts.model)
  }

  args.push(prompt)

  const env: Record<string, string> = {}
  if (opts.disableExternalSkills) {
    env.OPENCODE_DISABLE_EXTERNAL_SKILLS = "1"
  }

  const result = await run(args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 300_000,
    env: Object.keys(env).length > 0 ? env : undefined,
  })

  if (opts.outputDir) {
    await mkdir(opts.outputDir, { recursive: true })
    await writeFile(path.join(opts.outputDir, "transcript.md"), result.stdout)
  }

  return result
}
