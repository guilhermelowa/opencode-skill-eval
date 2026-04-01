#!/usr/bin/env node
import { cp, mkdir, stat } from "fs/promises"
import path from "path"
import os from "os"

async function main() {
  const home = os.homedir()
  const src = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "skill-creator")
  const dest = path.join(home, ".config", "opencode", "skills", "skill-creator")

  try {
    await stat(path.join(dest, "SKILL.md"))
    console.log("skill-creator already installed, skipping")
    return
  } catch {}

  try {
    await stat(path.join(src, "SKILL.md"))
  } catch {
    console.log("skill-creator source not found, skipping install")
    return
  }

  await mkdir(path.dirname(dest), { recursive: true })
  await cp(src, dest, { recursive: true })
  console.log(`Installed skill-creator to ${dest}`)
}

main().catch(() => {})
