import { z } from 'zod/v4'
const lockSchema = z.object({ at: z.string(), pid: z.number() })
const npmVersionSchema = z.object({ version: z.string() })
const ghReleaseSchema = z.object({ tag_name: z.string() })
const checkResultSchema = z.object({
  at: z.string(),
  commit: z.string().optional(),
  pass: z.boolean(),
  summary: z.string().optional(),
  violations: z.number()
})
const logEntrySchema = z.object({
  at: z.string(),
  error: z.string().optional(),
  pass: z.boolean(),
  path: z.string(),
  project: z.string()
})
const watchEventSchema = z.object({
  at: z.string(),
  detail: z.string().optional(),
  project: z.string(),
  status: z.enum(['fail', 'ok', 'start']),
  step: z.enum(['audit', 'check', 'done', 'maintain', 'sync'])
})
const safeParse = <T>(schema: z.ZodType<T>, data: unknown): T | undefined => {
  const result = schema.safeParse(data)
  return result.success ? result.data : undefined
}
const safeParseJson = <T>(schema: z.ZodType<T>, text: string): T | undefined => {
  try {
    return safeParse(schema, JSON.parse(text))
  } catch {}
}
export {
  checkResultSchema,
  ghReleaseSchema,
  lockSchema,
  logEntrySchema,
  npmVersionSchema,
  safeParse,
  safeParseJson,
  watchEventSchema
}
