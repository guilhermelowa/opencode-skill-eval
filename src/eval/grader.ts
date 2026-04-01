import path from "path"
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

  const assertionsList = opts.evalAssertions.map((a, i) => `${i + 1}. ${a}`).join("\n")

  const gradingPrompt = `You are a grader evaluating whether an AI agent's output meets specific expectations.

## Assertions to evaluate:
${assertionsList}

## Execution transcript:
${transcript.slice(0, 10000)}

## Output files:
${outputSummary.slice(0, 10000)}

For each assertion, determine PASS or FAIL with specific evidence. Be objective and cite evidence.

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
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/)
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
