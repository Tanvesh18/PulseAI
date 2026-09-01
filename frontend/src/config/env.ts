import { z } from "zod";

const environmentSchema = z.object({
  BACKEND_API_URL: z.url().default("http://localhost:4000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Environment {
  return environmentSchema.parse({
    BACKEND_API_URL: environment.BACKEND_API_URL,
    NODE_ENV: environment.NODE_ENV,
  });
}

export const env = parseEnvironment(process.env);
