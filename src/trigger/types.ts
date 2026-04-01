import { z } from "zod"

export const TriggerEvalItem = z.object({
  query: z.string(),
  should_trigger: z.boolean(),
})
export type TriggerEvalItem = z.infer<typeof TriggerEvalItem>

export const TriggerEvalResult = z.object({
  query: z.string(),
  should_trigger: z.boolean(),
  trigger_rate: z.number(),
  triggers: z.number(),
  runs: z.number(),
  pass: z.boolean(),
})
export type TriggerEvalResult = z.infer<typeof TriggerEvalResult>

export const TriggerRunOutput = z.object({
  skill_name: z.string(),
  description: z.string(),
  results: z.array(TriggerEvalResult),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
  }),
})
export type TriggerRunOutput = z.infer<typeof TriggerRunOutput>

export const TriggerHistoryEntry = z.object({
  iteration: z.number(),
  description: z.string(),
  train_passed: z.number(),
  train_failed: z.number(),
  train_total: z.number(),
  test_passed: z.number().nullable(),
  test_failed: z.number().nullable(),
  test_total: z.number().nullable(),
})
export type TriggerHistoryEntry = z.infer<typeof TriggerHistoryEntry>

export const TriggerOptimizeOutput = z.object({
  exit_reason: z.string(),
  original_description: z.string(),
  best_description: z.string(),
  best_score: z.string(),
  best_train_score: z.string(),
  best_test_score: z.string().nullable(),
  final_description: z.string(),
  iterations_run: z.number(),
  holdout: z.number(),
  train_size: z.number(),
  test_size: z.number(),
  history: z.array(TriggerHistoryEntry),
})
export type TriggerOptimizeOutput = z.infer<typeof TriggerOptimizeOutput>
