import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN;

if (process.env.NODE_ENV === "production" && dsn) {
  Sentry.init({ dsn });
}

export { Sentry };
