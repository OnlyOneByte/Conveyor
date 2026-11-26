import * as z from "zod/mini";

export const authStatusSchema = z.strictObject({
  authEnabled: z.boolean(),
  authenticated: z.boolean(),
});

export type AuthStatus = z.infer<typeof authStatusSchema>;
