import * as Sentry from "@sentry/bun";
import { SENTRY_DSN } from "@koincode/shared";

if (process.env.NODE_ENV === "production" && SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN });
}

export { Sentry };
