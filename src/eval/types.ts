import { z } from "zod"

// --- evals.json ---

export const EvalItem = z.object({
  id: z.number(),
  prompt: z.string(),
  expected_output: z.string().optional(),
  files: z.array(z.string()).default([]),
  assertions: z.array(z.string()).default([]),
})
export type EvalItem = z.infer<typeof EvalItem>

export const EvalsFile = z.object({
  skill_name: z.string(),
  evals: z.array(EvalItem),
})
export type EvalsFile = z.infer<typeof EvalsFile>

// --- eval_metadata.json ---

export const EvalMetadata = z.object({
  eval_id: z.number(),
  eval_name: z.string(),
  prompt: z.string(),
  assertions: z.array(z.string()).default([]),
})
export type EvalMetadata = z.infer<typeof EvalMetadata>

// --- grading.json ---

export const GradedExpectation = z.object({
  text: z.string(),
  passed: z.boolean(),
  evidence: z.string(),
})
export type GradedExpectation = z.infer<typeof GradedExpectation>

export const GradingSummary = z.object({
  passed: z.number(),
  failed: z.number(),
  total: z.number(),
  pass_rate: z.number(),
})
export type GradingSummary = z.infer<typeof GradingSummary>

export const GradingResult = z.object({
  expectations: z.array(GradedExpectation),
  summary: GradingSummary,
})
export type GradingResult = z.infer<typeof GradingResult>

// --- timing.json ---

export const TimingData = z.object({
  total_tokens: z.number().optional(),
  duration_ms: z.number(),
  total_duration_seconds: z.number(),
})
export type TimingData = z.infer<typeof TimingData>

// --- benchmark.json ---

export const BenchmarkStats = z.object({
  mean: z.number(),
  stddev: z.number(),
  min: z.number(),
  max: z.number(),
})
export type BenchmarkStats = z.infer<typeof BenchmarkStats>

export const BenchmarkRunSummary = z.record(z.string(), z.object({
  pass_rate: BenchmarkStats,
  time_seconds: BenchmarkStats,
  tokens: BenchmarkStats,
}))
export type BenchmarkRunSummary = z.infer<typeof BenchmarkRunSummary>

export const BenchmarkRun = z.object({
  eval_id: z.number(),
  eval_name: z.string().optional(),
  configuration: z.enum(["with_skill", "without_skill", "old_skill", "new_skill"]),
  run_number: z.number(),
  result: z.object({
    pass_rate: z.number(),
    passed: z.number(),
    failed: z.number(),
    total: z.number(),
    time_seconds: z.number(),
    tokens: z.number().default(0),
    tool_calls: z.number().default(0),
    errors: z.number().default(0),
  }),
  expectations: z.array(GradedExpectation),
  notes: z.array(z.string()).default([]),
})
export type BenchmarkRun = z.infer<typeof BenchmarkRun>

export const Benchmark = z.object({
  metadata: z.object({
    skill_name: z.string(),
    skill_path: z.string(),
    executor_model: z.string(),
    timestamp: z.string(),
    evals_run: z.array(z.number()),
    runs_per_configuration: z.number(),
  }),
  runs: z.array(BenchmarkRun),
  run_summary: z.record(z.string(), z.any()),
  notes: z.array(z.string()).default([]),
})
export type Benchmark = z.infer<typeof Benchmark>

// --- comparison.json ---

export const ComparisonResult = z.object({
  winner: z.enum(["A", "B", "TIE"]),
  reasoning: z.string(),
  label_a: z.string().optional(),
  label_b: z.string().optional(),
  rubric: z.object({
    A: z.object({
      content: z.record(z.string(), z.number()),
      structure: z.record(z.string(), z.number()),
      content_score: z.number(),
      structure_score: z.number(),
      overall_score: z.number(),
    }),
    B: z.object({
      content: z.record(z.string(), z.number()),
      structure: z.record(z.string(), z.number()),
      content_score: z.number(),
      structure_score: z.number(),
      overall_score: z.number(),
    }),
  }),
  output_quality: z.object({
    A: z.object({
      score: z.number(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
    }),
    B: z.object({
      score: z.number(),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
    }),
  }),
  expectation_results: z.object({
    A: z.object({
      passed: z.number(),
      total: z.number(),
      pass_rate: z.number(),
      details: z.array(z.object({
        text: z.string(),
        passed: z.boolean(),
      })),
    }),
    B: z.object({
      passed: z.number(),
      total: z.number(),
      pass_rate: z.number(),
      details: z.array(z.object({
        text: z.string(),
        passed: z.boolean(),
      })),
    }),
  }).optional(),
})
export type ComparisonResult = z.infer<typeof ComparisonResult>

// --- analysis.json ---

export const AnalysisResult = z.object({
  comparison_summary: z.object({
    winner: z.enum(["A", "B", "TIE"]),
    winner_skill: z.string(),
    loser_skill: z.string(),
    comparator_reasoning: z.string(),
  }),
  winner_strengths: z.array(z.string()),
  loser_weaknesses: z.array(z.string()),
  improvement_suggestions: z.array(z.object({
    priority: z.enum(["high", "medium", "low"]),
    category: z.string(),
    suggestion: z.string(),
    expected_impact: z.string(),
  })),
  transcript_insights: z.object({
    winner_execution_pattern: z.string(),
    loser_execution_pattern: z.string(),
  }),
})
export type AnalysisResult = z.infer<typeof AnalysisResult>

// --- feedback.json ---

export const FeedbackReview = z.object({
  run_id: z.string(),
  feedback: z.string(),
  timestamp: z.string(),
})
export type FeedbackReview = z.infer<typeof FeedbackReview>

export const FeedbackFile = z.object({
  reviews: z.array(FeedbackReview),
  status: z.enum(["complete", "in_progress"]),
})
export type FeedbackFile = z.infer<typeof FeedbackFile>
