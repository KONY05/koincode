import * as Sentry from "@sentry/bun";
import { SENTRY_DSN } from "@koincode/shared";
import { version } from "../../package.json";

if (process.env.NODE_ENV === "production" && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Tag every event with the build version so errors can be attributed to a release
    // (filterable in Sentry's Releases view / `release:` search). Bun inlines JSON imports
    // at compile time, so this works in compiled binaries too.
    release: `koincode@${version}`,
  });
}

export { Sentry };
