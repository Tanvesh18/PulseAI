import { z } from "zod";

const environmentSchema = z.object({
  AUTH_COOKIE_NAME: z.string().min(1).default("pulse_access_token"),
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
    AUTH_COOKIE_NAME: environment.AUTH_COOKIE_NAME,
    BACKEND_API_URL: environment.BACKEND_API_URL,
    NODE_ENV: environment.NODE_ENV,
  });
}

export const env = parseEnvironment(process.env);
