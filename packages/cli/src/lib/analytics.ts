import Mixpanel from "mixpanel";
import os from "os";
import crypto from "crypto";

import { readGlobalConfig, writeGlobalConfig } from "../utils/configs/global-config";
import { findSupportedChatModel, isLocalModelId } from "@koincode/shared";
import { version } from "../../package.json";

const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN ?? "";

let mp: Mixpanel.Mixpanel | null = null;
let distinctId: string = "";

function getOrCreateAnalyticsId(): string {
  const config = readGlobalConfig();
  if (config.analyticsId) return config.analyticsId;

  const id = crypto.randomUUID();
  writeGlobalConfig({ ...config, analyticsId: id });
  return id;
}

function isEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return false;
  const config = readGlobalConfig();
  return config.telemetry !== false;
}

function init() {
  if (!isEnabled()) return;

  distinctId = getOrCreateAnalyticsId();

  try {
    mp = Mixpanel.init(MIXPANEL_TOKEN, {
      geolocate: false,
    });
  } catch {
    mp = null;
  }
}

init();

function track(event: string, properties?: Record<string, unknown>) {
  if (!mp || !isEnabled()) return;

  try {
    mp.track(event, {
      distinct_id: distinctId,
      app_version: version,
      os: process.platform,
      arch: os.arch(),
      node_version: process.version,
      ...properties,
    });
  } catch {
    // never let analytics crash the app
  }
}

function resolveProvider(modelId: string): string {
  if (isLocalModelId(modelId)) return "local";
  return findSupportedChatModel(modelId)?.provider ?? "unknown";
}

// ── Public tracking functions ────────────────────────────────────────────────

export function trackAppStarted() {
  track("App Started", {
    terminal: process.env.TERM_PROGRAM ?? "unknown",
  });
}

export function trackSessionCreated(props: { model: string; mode: string }) {
  track("Session Created", {
    ...props,
    provider: resolveProvider(props.model),
  });
}

export function trackMessageSent(props: {
  model: string;
  mode: string;
  queued: boolean;
}) {
  track("Message Sent", {
    ...props,
    provider: resolveProvider(props.model),
  });
}

export function trackToolExecuted(props: {
  tool: string;
  mode: string;
  success: boolean;
}) {
  track("Tool Executed", props);
}

export function trackModeSwitched(props: { from: string; to: string }) {
  track("Mode Switched", props);
}

export function trackModelChanged(props: { model: string }) {
  track("Model Changed", {
    ...props,
    provider: resolveProvider(props.model),
  });
}

export function trackSessionResumed() {
  track("Session Resumed");
}

export function trackError(props: { source: string; message: string }) {
  track("Error Occurred", {
    source: props.source,
    error_message: props.message.slice(0, 200),
  });
}

export function trackFeatureUsed(props: { feature: string }) {
  track("Feature Used", props);
}
