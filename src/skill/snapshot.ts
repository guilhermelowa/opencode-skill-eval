import { copyDir, ensureDir, exists } from "../utils/filesystem.js"
import path from "path"

export async function snapshotSkill(skillPath: string, workspaceDir: string): Promise<string> {
  const dest = path.join(workspaceDir, "skill-snapshot")
  if (await exists(dest)) return dest
  await copyDir(skillPath, dest)
  return dest
}
