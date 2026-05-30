import { toolInputSchemas } from "@koincode/shared";
import { SERVER_PORT } from "@koincode/shared";
import { fetchWithRestart } from "../lib/api-client";

const BASE_URL = `http://localhost:${SERVER_PORT}`;

export async function runMemoryAdd(input: unknown) {
  const { key, value } = toolInputSchemas.memoryAdd.parse(input);
  const res = await fetchWithRestart(`${BASE_URL}/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const data = await res.json();
  if (!res.ok) return { error: (data as { error: string }).error ?? "Failed to add memory" };
  return { ok: true, key };
}

export async function runMemoryUpdate(input: unknown) {
  const { key, value } = toolInputSchemas.memoryUpdate.parse(input);
  const res = await fetchWithRestart(`${BASE_URL}/memory/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  const data = await res.json();
  if (!res.ok) return { error: (data as { error: string }).error ?? "Failed to update memory" };
  return { ok: true, key };
}

export async function runMemoryDelete(input: unknown) {
  const { key } = toolInputSchemas.memoryDelete.parse(input);
  const res = await fetchWithRestart(`${BASE_URL}/memory/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) return { error: (data as { error: string }).error ?? "Failed to delete memory" };
  return { ok: true, key };
}

export async function runMemoryList(_input: unknown) {
  const res = await fetchWithRestart(`${BASE_URL}/memory`);
  const data = await res.json();
  if (!res.ok) return { error: "Failed to list memories" };
  return { memories: data as { key: string; value: string }[] };
}
