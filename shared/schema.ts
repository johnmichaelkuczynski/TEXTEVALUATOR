import { z } from "zod";

export const analysisRequestSchema = z.object({
  text: z.string().min(1),
  backgroundInfo: z.string().optional(),
  mode: z.enum([
    "cognitive-short",
    "cognitive-long", 
    "psychological-short",
    "psychological-long",
    "psychopathological-short",
    "psychopathological-long"
  ]),
  llmProvider: z.enum(["zhi1", "zhi2", "zhi3", "zhi4"]),
  chunks: z.array(z.object({
    id: z.string(),
    text: z.string(),
    selected: z.boolean()
  })).optional(),
  critique: z.string().optional()
});

export const analysisResultSchema = z.object({
  id: z.string(),
  mode: z.string(),
  llmProvider: z.string(),
  overallScore: z.number(),
  summary: z.string(),
  category: z.string(),
  questions: z.array(z.object({
    question: z.string(),
    answer: z.string(),
    score: z.number()
  })),
  finalAssessment: z.string(),
  timestamp: z.string(),
  rawResponse: z.string()
});

export const fileUploadSchema = z.object({
  content: z.string(),
  filename: z.string(),
  wordCount: z.number()
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type FileUpload = z.infer<typeof fileUploadSchema>;
