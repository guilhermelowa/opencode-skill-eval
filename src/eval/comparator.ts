import path from "path"
import { readFile } from "fs/promises"
import { type ComparisonResult } from "./types.js"
import { runPrompt } from "../utils/subprocess.js"
import { writeJson, listFiles, exists } from "../utils/filesystem.js"

export interface CompareOptions {
  evalPrompt: string
  outputAPath: string
  outputBPath: string
  labelA?: string
  labelB?: string
  expectations?: string[]
  model: string
  outputPath: string
}

export async function compareRuns(opts: CompareOptions): Promise<ComparisonResult> {
  const labelA = opts.labelA ?? "Output A"
  const labelB = opts.labelB ?? "Output B"

  const outputA = await readOutputDir(opts.outputAPath)
  const outputB = await readOutputDir(opts.outputBPath)

  const expectationsSection = opts.expectations?.length
    ? `\n## Expectations:\n${opts.expectations.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
    : ""

  const comparePrompt = `You are a blind comparator. Judge which output better accomplishes the task.

## Task:
${opts.evalPrompt}
${expectationsSection}

## Output A (${labelA}):
${outputA}

## Output B (${labelB}):
${outputB}

Evaluate each output on two dimensions:
- Content: correctness, completeness, accuracy (1-5 each)
- Structure: organization, formatting, usability (1-5 each)

Return your response as a JSON object with this exact structure:
{
  "winner": "A" or "B" or "TIE",
  "reasoning": "explanation of why the winner was chosen",
  "rubric": {
    "A": { "content": {"correctness": N, "completeness": N, "accuracy": N}, "structure": {"organization": N, "formatting": N, "usability": N}, "content_score": N, "structure_score": N, "overall_score": N },
    "B": { "content": {"correctness": N, "completeness": N, "accuracy": N}, "structure": {"organization": N, "formatting": N, "usability": N}, "content_score": N, "structure_score": N, "overall_score": N }
  },
  "output_quality": {
    "A": { "score": N, "strengths": [...], "weaknesses": [...] },
    "B": { "score": N, "strengths": [...], "weaknesses": [...] }
  }
}

Respond with ONLY the JSON object, no other text.`

  const result = await runPrompt(comparePrompt, {
    model: opts.model,
    disableExternalSkills: true,
    timeout: 120_000,
  })

  let comparison: ComparisonResult
  try {
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      comparison = JSON.parse(jsonMatch[0]) as ComparisonResult
    } else {
      throw new Error("No JSON found")
    }
  } catch {
    comparison = {
      winner: "TIE",
      reasoning: "Comparison failed to produce valid output",
      rubric: {
        A: { content: {}, structure: {}, content_score: 0, structure_score: 0, overall_score: 0 },
        B: { content: {}, structure: {}, content_score: 0, structure_score: 0, overall_score: 0 },
      },
      output_quality: {
        A: { score: 0, strengths: [], weaknesses: ["Comparison failed"] },
        B: { score: 0, strengths: [], weaknesses: ["Comparison failed"] },
      },
    }
  }

  comparison.label_a = labelA
  comparison.label_b = labelB

  await writeJson(opts.outputPath, comparison)
  return comparison
}

async function readOutputDir(dir: string): Promise<string> {
  if (!(await exists(dir))) return "(No output directory found)"

  const files = await listFiles(dir, new Set(["transcript.md", "user_notes.md", "metrics.json"]))
  let result = ""

  for (const f of files) {
    const fp = path.join(dir, f)
    try {
      const content = await readFile(fp, "utf-8")
      result += `\n### ${f}\n${content.slice(0, 5000)}\n`
    } catch {
      result += `\n### ${f}\n(Binary file)\n`
    }
  }

  return result || "(No output files)"
}
