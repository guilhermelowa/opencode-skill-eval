import path from "path"
import { readFile, writeFile } from "fs/promises"
import { type Benchmark } from "../eval/types.js"
import { listDirs, listFiles, readJson, exists } from "../utils/filesystem.js"

interface RunView {
  id: string
  prompt: string
  evalId: number | null
  config: string
  outputs: { name: string; type: string; content?: string; dataUri?: string }[]
  grading: unknown
  timing: { total_duration_seconds?: number } | null
}

interface ComparisonView {
  evalId: number
  prompt: string
  winner: "A" | "B" | "TIE"
  reasoning: string
  labelA: string
  labelB: string
  rubric: {
    A: { content_score: number; structure_score: number; overall_score: number }
    B: { content_score: number; structure_score: number; overall_score: number }
  }
  outputQuality: {
    A: { score: number; strengths: string[]; weaknesses: string[] }
    B: { score: number; strengths: string[]; weaknesses: string[] }
  }
}

export interface GenerateOptions {
  workspace: string
  skillName: string
  benchmarkPath?: string
  previousWorkspace?: string
  outputPath: string
}

export async function generateView(opts: GenerateOptions): Promise<void> {
  const runs = await discoverRuns(opts.workspace)
  const comparisons = await discoverComparisons(opts.workspace)
  const benchmark = opts.benchmarkPath && (await exists(opts.benchmarkPath))
    ? await readJson<Benchmark>(opts.benchmarkPath)
    : null

  let previousFeedback: Record<string, string> = {}
  if (opts.previousWorkspace && (await exists(opts.previousWorkspace))) {
    const fbPath = path.join(opts.previousWorkspace, "feedback.json")
    if (await exists(fbPath)) {
      try {
        const fb = await readJson<{ reviews: { run_id: string; feedback: string }[] }>(fbPath)
        for (const r of fb.reviews) {
          if (r.feedback.trim()) previousFeedback[r.run_id] = r.feedback
        }
      } catch {}
    }
  }

  const html = buildHtml({
    skillName: opts.skillName,
    runs,
    comparisons,
    benchmark,
    previousFeedback,
  })

  await writeFile(opts.outputPath, html)
}

async function discoverRuns(workspace: string): Promise<RunView[]> {
  const runs: RunView[] = []
  await discoverRunsRecursive(workspace, workspace, runs)
  runs.sort((a, b) => {
    if (a.evalId !== null && b.evalId !== null) return a.evalId - b.evalId
    return a.id.localeCompare(b.id)
  })
  return runs
}

async function discoverRunsRecursive(root: string, current: string, runs: RunView[]): Promise<void> {
  const outputsDir = path.join(current, "outputs")
  const hasOutputs = await exists(outputsDir)

  if (hasOutputs) {
    const run = await buildRunView(root, current)
    if (run) runs.push(run)
    return
  }

  const dirs = await listDirs(current)
  for (const dir of dirs) {
    if (["node_modules", ".git", "__pycache__", "skill", "inputs", "skill-snapshot"].includes(dir)) continue
    await discoverRunsRecursive(root, path.join(current, dir), runs)
  }
}

async function buildRunView(root: string, runDir: string): Promise<RunView | null> {
  let prompt = ""
  let evalId: number | null = null

  for (const candidate of [path.join(runDir, "eval_metadata.json"), path.join(runDir, "..", "eval_metadata.json")]) {
    if (await exists(candidate)) {
      try {
        const meta = await readJson<{ prompt?: string; eval_id?: number }>(candidate)
        prompt = meta.prompt ?? ""
        evalId = meta.eval_id ?? null
        if (prompt) break
      } catch {}
    }
  }

  const runId = path.relative(root, runDir).replace(/[/\\]/g, "-")
  const outputsDir = path.join(runDir, "outputs")
  const excludeFiles = new Set(["transcript.md", "user_notes.md", "metrics.json"])

  const outputFiles: { name: string; type: string; content?: string; dataUri?: string }[] = []
  const files = await listFiles(outputsDir, excludeFiles)
  for (const f of files) {
    const fp = path.join(outputsDir, f)
    const ext = path.extname(f).toLowerCase()
    try {
      if ([".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".html", ".css", ".sh", ".yaml", ".yml"].includes(ext)) {
        const content = await readFile(fp, "utf-8")
        outputFiles.push({ name: f, type: "text", content })
      } else {
        outputFiles.push({ name: f, type: "binary" })
      }
    } catch {
      outputFiles.push({ name: f, type: "error", content: "(Error reading file)" })
    }
  }

  let grading: unknown = null
  for (const candidate of [path.join(runDir, "grading.json"), path.join(runDir, "..", "grading.json")]) {
    if (await exists(candidate)) {
      try {
        grading = await readJson(candidate)
        break
      } catch {}
    }
  }

  let timing: { total_duration_seconds?: number } | null = null
  const timingPath = path.join(runDir, "timing.json")
  if (await exists(timingPath)) {
    try {
      timing = await readJson(timingPath)
    } catch {}
  }

  const parentName = path.basename(path.dirname(runDir))
  const config = parentName

  return {
    id: runId,
    prompt: prompt || "(No prompt found)",
    evalId,
    config,
    outputs: outputFiles,
    grading,
    timing,
  }
}

async function discoverComparisons(workspace: string): Promise<ComparisonView[]> {
  const comparisons: ComparisonView[] = []
  await discoverComparisonsRecursive(workspace, workspace, comparisons)
  comparisons.sort((a, b) => a.evalId - b.evalId)
  return comparisons
}

async function discoverComparisonsRecursive(root: string, current: string, comparisons: ComparisonView[]): Promise<void> {
  const compPath = path.join(current, "comparison.json")
  if (await exists(compPath)) {
    const view = await buildComparisonView(root, current, compPath)
    if (view) comparisons.push(view)
    return
  }

  const dirs = await listDirs(current)
  for (const dir of dirs) {
    if (["node_modules", ".git", "__pycache__", "skill", "inputs"].includes(dir)) continue
    await discoverComparisonsRecursive(root, path.join(current, dir), comparisons)
  }
}

async function buildComparisonView(root: string, evalDir: string, compPath: string): Promise<ComparisonView | null> {
  try {
    const comp = await readJson<{
      winner?: "A" | "B" | "TIE"
      reasoning?: string
      label_a?: string
      label_b?: string
      rubric?: {
        A?: { content_score?: number; structure_score?: number; overall_score?: number }
        B?: { content_score?: number; structure_score?: number; overall_score?: number }
      }
      output_quality?: {
        A?: { score?: number; strengths?: string[]; weaknesses?: string[] }
        B?: { score?: number; strengths?: string[]; weaknesses?: string[] }
      }
    }>(compPath)

    let prompt = ""
    let evalId: number | null = null
    const metaPath = path.join(evalDir, "eval_metadata.json")
    if (await exists(metaPath)) {
      try {
        const meta = await readJson<{ prompt?: string; eval_id?: number }>(metaPath)
        prompt = meta.prompt ?? ""
        evalId = meta.eval_id ?? null
      } catch {}
    }

    return {
      evalId: evalId ?? 0,
      prompt: prompt || "(No prompt found)",
      winner: comp.winner ?? "TIE",
      reasoning: comp.reasoning ?? "",
      labelA: comp.label_a ?? "A",
      labelB: comp.label_b ?? "B",
      rubric: {
        A: {
          content_score: comp.rubric?.A?.content_score ?? 0,
          structure_score: comp.rubric?.A?.structure_score ?? 0,
          overall_score: comp.rubric?.A?.overall_score ?? 0,
        },
        B: {
          content_score: comp.rubric?.B?.content_score ?? 0,
          structure_score: comp.rubric?.B?.structure_score ?? 0,
          overall_score: comp.rubric?.B?.overall_score ?? 0,
        },
      },
      outputQuality: {
        A: {
          score: comp.output_quality?.A?.score ?? 0,
          strengths: comp.output_quality?.A?.strengths ?? [],
          weaknesses: comp.output_quality?.A?.weaknesses ?? [],
        },
        B: {
          score: comp.output_quality?.B?.score ?? 0,
          strengths: comp.output_quality?.B?.strengths ?? [],
          weaknesses: comp.output_quality?.B?.weaknesses ?? [],
        },
      },
    }
  } catch {
    return null
  }
}

interface BuildOptions {
  skillName: string
  runs: RunView[]
  comparisons: ComparisonView[]
  benchmark: Benchmark | null
  previousFeedback: Record<string, string>
}

function buildHtml(opts: BuildOptions): string {
  const data = JSON.stringify(opts)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.skillName} — Eval Results</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.6; }
.header { padding: 20px 24px; border-bottom: 1px solid #21262d; display: flex; align-items: center; gap: 16px; }
.header h1 { font-size: 20px; font-weight: 600; }
.header .meta { color: #8b949e; font-size: 14px; }
.tabs { display: flex; border-bottom: 1px solid #21262d; padding: 0 24px; }
.tab { padding: 12px 16px; cursor: pointer; color: #8b949e; border-bottom: 2px solid transparent; font-size: 14px; font-weight: 500; }
.tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
.tab:hover { color: #c9d1d9; }
.panel { display: none; padding: 24px; }
.panel.active { display: block; }
.outputs-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.outputs-nav button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.outputs-nav button:hover { background: #30363d; }
.outputs-nav button:disabled { opacity: 0.4; cursor: default; }
.outputs-nav .counter { color: #8b949e; font-size: 14px; }
.prompt-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 20px; white-space: pre-wrap; word-break: break-word; }
.prompt-label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.config-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-bottom: 16px; }
.config-with_skill { background: #0d4429; color: #3fb950; }
.config-without_skill { background: #3d1f00; color: #d29922; }
.config-old_skill { background: #3d1f00; color: #d29922; }
.config-new_skill { background: #0d4429; color: #3fb950; }
.outputs-section { margin-bottom: 24px; }
.file-header { background: #161b22; border: 1px solid #30363d; border-bottom: none; border-radius: 8px 8px 0 0; padding: 10px 16px; font-size: 13px; color: #8b949e; }
.file-content { background: #0d1117; border: 1px solid #30363d; border-radius: 0 0 8px 8px; padding: 16px; overflow-x: auto; max-height: 400px; overflow-y: auto; }
.file-content pre { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.grading-section { margin-top: 20px; }
.expectation { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; margin-bottom: 4px; border-radius: 6px; font-size: 13px; }
.expectation.pass { background: #0d442920; }
.expectation.fail { background: #3d1f0020; }
.expectation .badge { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.expectation.pass .badge { background: #238636; color: #fff; }
.expectation.fail .badge { background: #da3633; color: #fff; }
.expectation .evidence { color: #8b949e; font-size: 12px; margin-top: 2px; }
.feedback-box { margin-top: 24px; }
.feedback-box textarea { width: 100%; min-height: 80px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; color: #c9d1d9; font-size: 14px; resize: vertical; }
.prev-feedback { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 8px; font-size: 13px; color: #8b949e; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 14px; }
th { color: #8b949e; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
.notes { margin-top: 20px; }
.notes li { padding: 4px 0; color: #8b949e; font-size: 13px; }
.submit-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 16px 24px; background: #161b22; border-top: 1px solid #30363d; display: flex; justify-content: flex-end; gap: 12px; }
.submit-bar button { background: #238636; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
.submit-bar button:hover { background: #2ea043; }
.comparison-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
@media (max-width: 768px) { .comparison-grid { grid-template-columns: 1fr; } }
.winner-badge { display: inline-block; padding: 4px 12px; border-radius: 16px; font-size: 14px; font-weight: 600; margin-bottom: 16px; }
.winner-A { background: #0d4429; color: #3fb950; }
.winner-B { background: #0d4429; color: #3fb950; }
.winner-TIE { background: #3d3d00; color: #d29922; }
.reasoning-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
.quality-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
.quality-card h4 { margin-bottom: 8px; }
.quality-card ul { padding-left: 20px; }
.quality-card li { margin-bottom: 4px; font-size: 13px; }
.strength-list { color: #3fb950; }
.weakness-list { color: #f85149; }
.rubric-score { font-size: 20px; font-weight: 600; }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(opts.skillName)}</h1>
  <span class="meta">Eval Results</span>
</div>

<div class="tabs">
  <div class="tab active" data-tab="outputs">Outputs</div>
  <div class="tab" data-tab="comparison">Comparison</div>
  <div class="tab" data-tab="benchmark">Benchmark</div>
</div>

<div id="outputs-panel" class="panel active">
  <div class="outputs-nav">
    <button id="prev-btn">&#8592; Previous</button>
    <span class="counter" id="counter">1 / ${opts.runs.length}</span>
    <button id="next-btn">Next &#8594;</button>
  </div>
  <div id="run-content"></div>
</div>

<div id="comparison-panel" class="panel">
  <div class="outputs-nav">
    <button id="comp-prev-btn">&#8592; Previous</button>
    <span class="counter" id="comp-counter">1 / ${opts.comparisons.length}</span>
    <button id="comp-next-btn">Next &#8594;</button>
  </div>
  <div id="comp-content"></div>
</div>

<div id="benchmark-panel" class="panel">
  <div id="benchmark-content"></div>
</div>

<div class="submit-bar">
  <button id="submit-btn">Submit All Reviews</button>
</div>

<script>
const DATA = ${data};
let currentIdx = 0;
let compIdx = 0;

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-panel').classList.add('active');
  });
});

function renderRun(idx) {
  const run = DATA.runs[idx];
  if (!run) return;
  document.getElementById('counter').textContent = (idx + 1) + ' / ' + DATA.runs.length;

  const configClass = 'config-' + run.config;
  let html = '<div class="config-badge ' + configClass + '">' + run.config.replace(/_/g, ' ') + '</div>';
  html += '<div class="prompt-box"><div class="prompt-label">Prompt</div>' + escapeHtml(run.prompt) + '</div>';

  if (run.outputs.length > 0) {
    html += '<div class="outputs-section"><div class="prompt-label">Output Files</div>';
    for (const f of run.outputs) {
      html += '<div class="file-header">' + escapeHtml(f.name) + '</div>';
      html += '<div class="file-content"><pre>' + escapeHtml(f.content || '(binary file)') + '</pre></div>';
    }
    html += '</div>';
  }

  if (run.grading && run.grading.expectations) {
    html += '<div class="grading-section"><div class="prompt-label">Formal Grades</div>';
    for (const exp of run.grading.expectations) {
      html += '<div class="expectation ' + (exp.passed ? 'pass' : 'fail') + '">';
      html += '<span class="badge">' + (exp.passed ? 'PASS' : 'FAIL') + '</span>';
      html += '<div><div>' + escapeHtml(exp.text) + '</div>';
      if (exp.evidence) html += '<div class="evidence">' + escapeHtml(exp.evidence) + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
  }

  if (DATA.previousFeedback[run.id]) {
    html += '<div class="feedback-box"><div class="prompt-label">Previous Feedback</div>';
    html += '<div class="prev-feedback">' + escapeHtml(DATA.previousFeedback[run.id]) + '</div></div>';
  }

  html += '<div class="feedback-box"><div class="prompt-label">Feedback</div>';
  html += '<textarea data-run-id="' + run.id + '" placeholder="Enter feedback for this run...">' + (DATA.previousFeedback[run.id] || '') + '</textarea></div>';

  document.getElementById('run-content').innerHTML = html;

  document.getElementById('prev-btn').disabled = idx === 0;
  document.getElementById('next-btn').disabled = idx === DATA.runs.length - 1;
}

document.getElementById('prev-btn').addEventListener('click', () => { if (currentIdx > 0) { currentIdx--; renderRun(currentIdx); } });
document.getElementById('next-btn').addEventListener('click', () => { if (currentIdx < DATA.runs.length - 1) { currentIdx++; renderRun(currentIdx); } });

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') {
    const activePanel = document.querySelector('.panel.active');
    if (activePanel && activePanel.id === 'outputs-panel' && currentIdx > 0) { currentIdx--; renderRun(currentIdx); }
    else if (activePanel && activePanel.id === 'comparison-panel' && compIdx > 0) { compIdx--; renderComparison(compIdx); }
  }
  if (e.key === 'ArrowRight') {
    const activePanel = document.querySelector('.panel.active');
    if (activePanel && activePanel.id === 'outputs-panel' && currentIdx < DATA.runs.length - 1) { currentIdx++; renderRun(currentIdx); }
    else if (activePanel && activePanel.id === 'comparison-panel' && compIdx < DATA.comparisons.length - 1) { compIdx++; renderComparison(compIdx); }
  }
});

function renderComparison(idx) {
  if (DATA.comparisons.length === 0) {
    document.getElementById('comp-content').innerHTML = '<p style="color:#8b949e">No comparison data available. Run with <code>--compare</code> mode to enable A/B comparison.</p>';
    document.getElementById('comp-counter').textContent = '0 / 0';
    return;
  }

  const comp = DATA.comparisons[idx];
  if (!comp) return;
  document.getElementById('comp-counter').textContent = (idx + 1) + ' / ' + DATA.comparisons.length;

  const winLabel = comp.winner === 'TIE' ? 'TIE' : (comp.winner === 'A' ? comp.labelA : comp.labelB);
  const winClass = comp.winner === 'TIE' ? 'winner-TIE' : 'winner-' + comp.winner;

  let html = '<div class="prompt-box"><div class="prompt-label">Eval #' + comp.evalId + ' — Prompt</div>' + escapeHtml(comp.prompt) + '</div>';
  html += '<div class="winner-badge ' + winClass + '">' + escapeHtml(winLabel) + (comp.winner === 'TIE' ? '' : ' WINS') + '</div>';
  html += '<div class="reasoning-box"><div class="prompt-label">Reasoning</div>' + escapeHtml(comp.reasoning) + '</div>';

  html += '<h3 style="margin-bottom:12px">Rubric Scores</h3>';
  html += '<table><tr><th>Metric</th><th>' + escapeHtml(comp.labelA) + '</th><th>' + escapeHtml(comp.labelB) + '</th></tr>';
  html += '<tr><td>Content</td><td class="rubric-score">' + comp.rubric.A.content_score + '</td><td class="rubric-score">' + comp.rubric.B.content_score + '</td></tr>';
  html += '<tr><td>Structure</td><td class="rubric-score">' + comp.rubric.A.structure_score + '</td><td class="rubric-score">' + comp.rubric.B.structure_score + '</td></tr>';
  html += '<tr><td>Overall</td><td class="rubric-score">' + comp.rubric.A.overall_score + '</td><td class="rubric-score">' + comp.rubric.B.overall_score + '</td></tr>';
  html += '</table>';

  html += '<div class="comparison-grid">';
  html += '<div class="quality-card"><h4>' + escapeHtml(comp.labelA) + ' (Score: ' + comp.outputQuality.A.score + ')</h4>';
  if (comp.outputQuality.A.strengths.length) {
    html += '<div class="prompt-label">Strengths</div><ul class="strength-list">';
    for (const s of comp.outputQuality.A.strengths) html += '<li>' + escapeHtml(s) + '</li>';
    html += '</ul>';
  }
  if (comp.outputQuality.A.weaknesses.length) {
    html += '<div class="prompt-label">Weaknesses</div><ul class="weakness-list">';
    for (const w of comp.outputQuality.A.weaknesses) html += '<li>' + escapeHtml(w) + '</li>';
    html += '</ul>';
  }
  html += '</div>';

  html += '<div class="quality-card"><h4>' + escapeHtml(comp.labelB) + ' (Score: ' + comp.outputQuality.B.score + ')</h4>';
  if (comp.outputQuality.B.strengths.length) {
    html += '<div class="prompt-label">Strengths</div><ul class="strength-list">';
    for (const s of comp.outputQuality.B.strengths) html += '<li>' + escapeHtml(s) + '</li>';
    html += '</ul>';
  }
  if (comp.outputQuality.B.weaknesses.length) {
    html += '<div class="prompt-label">Weaknesses</div><ul class="weakness-list">';
    for (const w of comp.outputQuality.B.weaknesses) html += '<li>' + escapeHtml(w) + '</li>';
    html += '</ul>';
  }
  html += '</div></div>';

  document.getElementById('comp-content').innerHTML = html;

  document.getElementById('comp-prev-btn').disabled = idx === 0;
  document.getElementById('comp-next-btn').disabled = idx === DATA.comparisons.length - 1;
}

document.getElementById('comp-prev-btn').addEventListener('click', () => { if (compIdx > 0) { compIdx--; renderComparison(compIdx); } });
document.getElementById('comp-next-btn').addEventListener('click', () => { if (compIdx < DATA.comparisons.length - 1) { compIdx++; renderComparison(compIdx); } });

function renderBenchmark() {
  const b = DATA.benchmark;
  if (!b) {
    document.getElementById('benchmark-content').innerHTML = '<p style="color:#8b949e">No benchmark data available.</p>';
    return;
  }
  const summary = b.run_summary;
  const configs = Object.keys(summary).filter(k => k !== 'delta');
  let html = '<h2 style="margin-bottom:16px">Benchmark Summary</h2>';
  html += '<table><tr><th>Metric</th>';
  for (const c of configs) html += '<th>' + c.replace(/_/g, ' ') + '</th>';
  if (summary.delta) html += '<th>Delta</th>';
  html += '</tr>';

  for (const metric of ['pass_rate', 'time_seconds', 'tokens']) {
    const label = metric === 'pass_rate' ? 'Pass Rate' : metric === 'time_seconds' ? 'Time (s)' : 'Tokens';
    html += '<tr><td>' + label + '</td>';
    for (const c of configs) {
      const s = summary[c]?.[metric];
      if (!s) { html += '<td>—</td>'; continue; }
      if (metric === 'pass_rate') {
        html += '<td>' + (s.mean * 100).toFixed(0) + '% ± ' + (s.stddev * 100).toFixed(0) + '%</td>';
      } else {
        html += '<td>' + s.mean.toFixed(1) + ' ± ' + s.stddev.toFixed(1) + '</td>';
      }
    }
    if (summary.delta) html += '<td>' + (summary.delta[metric] ?? '—') + '</td>';
    html += '</tr>';
  }
  html += '</table>';

  if (b.notes && b.notes.length > 0) {
    html += '<h3 style="margin-bottom:12px">Notes</h3><ul class="notes">';
    for (const n of b.notes) html += '<li>' + escapeHtml(n) + '</li>';
    html += '</ul>';
  }

  document.getElementById('benchmark-content').innerHTML = html;
}

document.getElementById('submit-btn').addEventListener('click', () => {
  const reviews = [];
  document.querySelectorAll('textarea[data-run-id]').forEach(ta => {
    reviews.push({ run_id: ta.dataset.runId, feedback: ta.value, timestamp: new Date().toISOString() });
  });
  const data = { reviews, status: 'complete' };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'feedback.json';
  a.click();
});

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

renderRun(0);
renderComparison(0);
renderBenchmark();
</script>

</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
