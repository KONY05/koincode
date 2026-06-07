import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";
import type { ModeType } from "@koincode/shared";

export type CommandContext = {
  exit: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  navigate: (path: string) => void;
  mode: ModeType;
  setMode: (mode: ModeType) => void;
  setModel: (model: string) => void;
  invokeSkill: (skillName: string) => Promise<void>;
  clearSession: () => Promise<void>;
  handoff: () => Promise<void>;
  toggleVoice: () => void;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  isSkill?: boolean;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
