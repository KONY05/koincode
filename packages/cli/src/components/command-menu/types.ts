import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ModeType } from "@koincode/shared";
import type { ContextUsage } from "../../hooks/use-chat";

export type CommandContext = {
  exit: () => void;
  destroyRenderer: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  navigate: (path: string) => void;
  mode: ModeType;
  model: string;
  setMode: (mode: ModeType) => void;
  setModel: (model: string) => void;
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  compact: () => Promise<void>;
  toggleVoice: () => void;
  contextUsage: ContextUsage | null;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  isSkill?: boolean;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
