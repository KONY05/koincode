import { z } from "zod";

export const customProviderInputSchema = z.object({
  name: z.string().trim().min(3, "Name is required"),
  baseURL: z.url("Must be a valid URL").trim(),
  apiKey: z.string().trim().min(8, "API key looks too short").optional(),
});

export const customModelInputSchema = z.object({
  modelId: z.string().trim().min(5, "Model id is required"),
  contextWindow: z.number().int().positive().optional(),
  vision: z.boolean().optional().default(false),
});

export type CustomProviderInput = z.infer<typeof customProviderInputSchema>;
export type CustomModelInput = z.infer<typeof customModelInputSchema>;
