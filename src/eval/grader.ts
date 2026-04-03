import path from "path"
import os from "os"
import { readFile } from "fs/promises"
import { type GradingResult, type GradedExpectation } from "./types.js"
import { runPrompt } from "../utils/subprocess.js"
import { readJson, writeJson, listFiles, exists } from "../utils/filesystem.js"

export interface GradeOptions {
  evalAssertions: string[]
  transcriptPath: string
  outputsDir: string
  model: string
  outputPath: string
}

export async function gradeRun(opts: GradeOptions): Promise<GradingResult> {
  let transcript = ""
  try {
    transcript = await readFile(opts.transcriptPath, "utf-8")
  } catch {
    transcript = "(No transcript found)"
  }

  // Collect output file contents
  const outputFiles = await listFiles(opts.outputsDir)
  let outputSummary = ""
  for (const f of outputFiles) {
    const fp = path.join(opts.outputsDir, f)
    try {
      const content = await readFile(fp, "utf-8")
      outputSummary += `\n### ${f}\n${content}\n`
    } catch {
      outputSummary += `\n### ${f}\n(Binary file, ${f.split(".").pop()} format)\n`
    }
  }

  // Also check if ~/swim.txt exists and include its content
  try {
    const swimFile = path.join(os.homedir(), "swim.txt")
    const swimContent = await readFile(swimFile, "utf-8")
    outputSummary += `\n### ~/swim.txt\n${swimContent}\n`
  } catch {
    // File doesn't exist or can't be read
    outputSummary += `\n### ~/swim.txt\n(File does not exist or cannot be read)\n`
  }

  const assertionsList = opts.evalAssertions.map((a, i) => `${i + 1}. ${a}`).join("\n")

  const gradingPrompt = `You are a grader evaluating whether an AI agent's output meets specific expectations.

IMPORTANT: You must evaluate based ONLY on the execution transcript and output files provided below. Do NOT attempt to run any commands or access any files. Your job is to analyze what happened in the transcript.

## Assertions to evaluate:
${assertionsList}

## Execution transcript:
${transcript.slice(0, 10000)}

## Output files:
${outputSummary.slice(0, 10000)}

For each assertion, determine PASS or FAIL based on the evidence in the transcript and output files above. Be objective and cite specific evidence from the transcript.

Return your response as a JSON object with this exact structure:
{
  "expectations": [
    {
      "text": "assertion text",
      "passed": true or false,
      "evidence": "specific evidence from transcript or outputs"
    }
  ],
  "summary": {
    "passed": <count>,
    "failed": <count>,
    "total": <count>,
    "pass_rate": <0.0 to 1.0>
  }
}

Respond with ONLY the JSON object, no other text.`

  const result = await runPrompt(gradingPrompt, {
    model: opts.model,
    disableExternalSkills: true,
    timeout: 120_000,
  })

  // Parse JSON from response
  let grading: GradingResult
  try {
    const responseText = result.transcriptText || result.stdout
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      grading = JSON.parse(jsonMatch[0]) as GradingResult
    } else {
      throw new Error("No JSON found in response")
    }
  } catch {
    // Fallback: all assertions failed
    grading = {
      expectations: opts.evalAssertions.map((text) => ({
        text,
        passed: false,
        evidence: "Grading failed to produce valid output",
      })),
      summary: {
        passed: 0,
        failed: opts.evalAssertions.length,
        total: opts.evalAssertions.length,
        pass_rate: 0,
      },
    }
  }

  await writeJson(opts.outputPath, grading)
  return grading
}
