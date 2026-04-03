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
  totalTokens?: number
  transcriptText?: string
}

interface ParsedEvents {
  transcriptText: string
  totalTokens: number
}

function parseJsonEvents(stdout: string): ParsedEvents {
  const textParts: string[] = []
  let totalTokens = 0

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    try {
      const evt = JSON.parse(line)
      if (evt.type === "text" && evt.part?.text) {
        textParts.push(evt.part.text)
      }
      if (evt.type === "step_finish" && evt.part?.tokens?.total) {
        totalTokens += evt.part.tokens.total
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return { transcriptText: textParts.join(""), totalTokens }
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
    skillPath?: string
  } = {},
): Promise<RunResult> {
  const args = ["run", "--format", "json"]

  if (opts.cwd) {
    args.push("--dir", opts.cwd)
  }

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

  const parsed = parseJsonEvents(result.stdout)
  result.totalTokens = parsed.totalTokens || undefined
  result.transcriptText = parsed.transcriptText || result.stdout

  if (opts.outputDir) {
    await mkdir(opts.outputDir, { recursive: true })
    await writeFile(path.join(opts.outputDir, "transcript.md"), result.transcriptText)
  }

  return result
}
