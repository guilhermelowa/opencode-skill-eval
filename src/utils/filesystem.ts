import { mkdir, cp, readdir, stat, writeFile, readFile } from "fs/promises"
import path from "path"

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(p: string): Promise<T> {
  const raw = await readFile(p, "utf-8")
  return JSON.parse(raw) as T
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(p))
  await writeFile(p, JSON.stringify(data, null, 2) + "\n")
}

export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

export async function listFiles(dir: string, exclude: Set<string> = new Set()): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && !exclude.has(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
}

export function workspacePath(base: string, iteration: number, evalId: number, config: string): string {
  return path.join(base, `iteration-${iteration}`, `eval-${evalId}`, config)
}

export function evalDir(base: string, iteration: number, evalId: number): string {
  return path.join(base, `iteration-${iteration}`, `eval-${evalId}`)
}
