import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { ensureDir } from "../utils/filesystem.js"

export async function scaffoldSkill(name: string, baseDir: string): Promise<string> {
  const dir = path.join(baseDir, name)
  await mkdir(dir, { recursive: true })

  const skillMd = `---
name: ${name}
description: Describe what this skill does and when to use it
---

## What this skill does

<!-- Describe the skill's purpose and capabilities -->

## When to use

<!-- Describe trigger conditions -->

## Steps

<!-- Step-by-step instructions -->

## Output format

<!-- Expected output format, if any -->
`

  await writeFile(path.join(dir, "SKILL.md"), skillMd)

  const evalsDir = path.join(dir, "evals")
  await mkdir(evalsDir, { recursive: true })

  const evalsJson = {
    skill_name: name,
    evals: [
      {
        id: 1,
        prompt: "A realistic user prompt that should trigger this skill",
        expected_output: "Description of the expected result",
        files: [],
        assertions: ["A verifiable assertion about the output"],
      },
    ],
  }

  await writeFile(
    path.join(evalsDir, "evals.json"),
    JSON.stringify(evalsJson, null, 2) + "\n",
  )

  return dir
}
