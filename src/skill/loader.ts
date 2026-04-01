import { readFile } from "fs/promises"
import path from "path"
import { exists } from "../utils/filesystem.js"

export interface SkillInfo {
  name: string
  description: string
  content: string
  location: string
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { data: {}, content: raw }

  const data: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key) data[key] = val
  }
  return { data, content: match[2].trim() }
}

export async function loadSkill(dir: string): Promise<SkillInfo | null> {
  const mdPath = path.join(dir, "SKILL.md")
  if (!(await exists(mdPath))) return null

  const raw = await readFile(mdPath, "utf-8")
  const { data, content } = parseFrontmatter(raw)

  if (!data.name || !data.description) return null

  return {
    name: data.name,
    description: data.description,
    content,
    location: mdPath,
  }
}

export async function loadEvals(dir: string) {
  const evalsPath = path.join(dir, "evals", "evals.json")
  if (!(await exists(evalsPath)) && !(await exists(path.join(dir, "evals.json")))) return null

  const p = (await exists(evalsPath)) ? evalsPath : path.join(dir, "evals.json")
  const raw = await readFile(p, "utf-8")
  return JSON.parse(raw)
}
