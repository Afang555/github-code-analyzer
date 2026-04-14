import type { FunctionModule } from "@/types/aiAnalysis";

export type FunctionModuleColor = {
  solid: string;
  soft: string;
  border: string;
  text: string;
};

const MODULE_COLOR_PALETTE: FunctionModuleColor[] = [
  { solid: "#2563eb", soft: "#dbeafe", border: "#93c5fd", text: "#1e3a8a" },
  { solid: "#059669", soft: "#d1fae5", border: "#6ee7b7", text: "#065f46" },
  { solid: "#d97706", soft: "#fef3c7", border: "#fcd34d", text: "#92400e" },
  { solid: "#dc2626", soft: "#fee2e2", border: "#fca5a5", text: "#991b1b" },
  { solid: "#7c3aed", soft: "#ede9fe", border: "#c4b5fd", text: "#5b21b6" },
  { solid: "#0f766e", soft: "#ccfbf1", border: "#5eead4", text: "#115e59" },
  { solid: "#c2410c", soft: "#ffedd5", border: "#fdba74", text: "#9a3412" },
  { solid: "#be185d", soft: "#fce7f3", border: "#f9a8d4", text: "#831843" },
  { solid: "#4338ca", soft: "#e0e7ff", border: "#a5b4fc", text: "#312e81" },
  { solid: "#1f2937", soft: "#e5e7eb", border: "#cbd5e1", text: "#111827" },
];

const FALLBACK_MODULE_COLOR: FunctionModuleColor = {
  solid: "#475569",
  soft: "#e2e8f0",
  border: "#cbd5e1",
  text: "#1e293b",
};

export function buildFunctionModuleColorMap(
  modules: FunctionModule[],
): Record<string, FunctionModuleColor> {
  const colorMap: Record<string, FunctionModuleColor> = {};

  for (const [index, module] of modules.entries()) {
    colorMap[module.id] =
      MODULE_COLOR_PALETTE[index % MODULE_COLOR_PALETTE.length] ??
      FALLBACK_MODULE_COLOR;
  }

  return colorMap;
}

export function getFunctionModuleColor(
  moduleId: string | null | undefined,
  colorMap: Record<string, FunctionModuleColor>,
): FunctionModuleColor {
  if (!moduleId) {
    return FALLBACK_MODULE_COLOR;
  }

  return colorMap[moduleId] ?? FALLBACK_MODULE_COLOR;
}
