export type ContextWindowOption = {
  value: number;
  label: string;
};

/** Curated context window sizes for the custom model picker, ascending 128K → 2M. */
export const CONTEXT_WINDOW_OPTIONS: ContextWindowOption[] = [
  { value: 128_000, label: "128K" },
  { value: 200_000, label: "200K" },
  { value: 256_000, label: "256K" },
  { value: 500_000, label: "500K" },
  { value: 1_000_000, label: "1M" },
  { value: 1_048_576, label: "1.05M" },
  { value: 2_000_000, label: "2M" },
];
