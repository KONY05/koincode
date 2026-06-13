import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { TextAttributes } from "@opentui/core";
import type { PasteEvent } from "@opentui/core";
import { decodePasteBytes } from "@opentui/core";
import type { TextareaRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { KeyBinding } from "@opentui/core";
import { useNavigate } from "react-router";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type RefObject,
} from "react";

import { checkRecorderAvailable, startRecording } from "../lib/voice-recorder";
// warmRecorder and isRecorderReady imported when voice is re-enabled
import type { RecorderHandle } from "../lib/voice-recorder";
import { transcribe } from "../lib/whisper";
import { readGlobalConfig } from "../utils/configs/global-config";
import type { ContextUsage } from "../hooks/use-chat";

import { EmptyBorder } from "./border";
import { StatusBar } from "./status-bar";
import { CommandMenu } from "./command-menu";
import type { Command } from "./command-menu/types";
import { useCommandMenu } from "./command-menu/use-command-menu";
import { useToast } from "../providers/toast";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { useSessionActions } from "../providers/session-actions";
import { Mode } from "@koincode/shared";
import type { QueuedMessage } from "../hooks/use-chat";

const MAX_VISIBLE_MENTIONS = 8;
const CURRENT_DIRECTORY = process.cwd();
const PASTE_THRESHOLD_LINES = 5;
const PASTE_THRESHOLD_CHARS = 200;
// Matches placeholders inserted for long pastes, e.g. [paste:p1: 12 lines]
const PASTE_PLACEHOLDER_RE = /\[paste:(p\d+): [^\]]+\]/g;
const MAX_FALLBACK_MENTION_CANDIDATES = 32;
const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;
const RECURSIVE_MENTION_IGNORED_DIRECTORIES = new Set(["node_modules"]);

type MentionMatch = {
  start: number;
  end: number;
  query: string;
};

type MentionCandidate = {
  path: string;
  kind: "file" | "directory";
};

function isWithinCurrentDirectory(targetPath: string) {
  const relativePath = relative(CURRENT_DIRECTORY, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isMentionQueryCharacter(character: string) {
  return MENTION_QUERY_CHARACTER.test(character);
}

function findActiveMention(
  text: string,
  cursorOffset: number,
): MentionMatch | null {
  const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));

  let start = safeOffset;
  while (start > 0 && !/\s/.test(text[start - 1]!)) {
    start -= 1;
  }

  let end = safeOffset;
  while (end < text.length && !/\s/.test(text[end]!)) {
    end += 1;
  }

  const token = text.slice(start, end);
  const relativeCursor = safeOffset - start;
  const mentionStart = token.lastIndexOf("@", relativeCursor);

  if (mentionStart === -1) {
    return null;
  }

  const previousCharacter = token[mentionStart - 1];
  if (previousCharacter && isMentionQueryCharacter(previousCharacter)) {
    return null;
  }

  let mentionEnd = mentionStart + 1;
  while (
    mentionEnd < token.length &&
    isMentionQueryCharacter(token[mentionEnd]!)
  ) {
    mentionEnd += 1;
  }

  if (relativeCursor < mentionStart || relativeCursor > mentionEnd) {
    return null;
  }

  return {
    start: start + mentionStart,
    end: start + mentionEnd,
    query: token.slice(mentionStart + 1, mentionEnd),
  };
}

async function getMentionCandidates(
  query: string,
): Promise<MentionCandidate[]> {
  const normalizedQuery = query.startsWith("./") ? query.slice(2) : query;
  if (normalizedQuery.startsWith("/")) {
    return [];
  }

  const hasTrailingSlash = normalizedQuery.endsWith("/");
  const lastSlashIndex = hasTrailingSlash
    ? normalizedQuery.length - 1
    : normalizedQuery.lastIndexOf("/");

  const directoryPart = hasTrailingSlash
    ? normalizedQuery.slice(0, -1)
    : lastSlashIndex === -1
      ? ""
      : normalizedQuery.slice(0, lastSlashIndex);

  const namePrefix = hasTrailingSlash
    ? ""
    : lastSlashIndex === -1
      ? normalizedQuery
      : normalizedQuery.slice(lastSlashIndex + 1);

  const absoluteDirectory = resolve(CURRENT_DIRECTORY, directoryPart || ".");
  if (!isWithinCurrentDirectory(absoluteDirectory)) {
    return [];
  }

  try {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const lowercasePrefix = namePrefix.toLowerCase();
    const showHiddenEntries = namePrefix.startsWith(".");

    const directMatches = entries
      .filter((entry) => showHiddenEntries || !entry.name.startsWith("."))
      .filter(
        (entry) =>
          !(
            entry.isDirectory() &&
            RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
          ),
      )
      .filter((entry) => {
        return (
          lowercasePrefix === "" ||
          entry.name.toLowerCase().startsWith(lowercasePrefix)
        );
      })
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .map((entry) => {
        const path = directoryPart
          ? `${directoryPart}/${entry.name}`
          : entry.name;
        const kind: MentionCandidate["kind"] = entry.isDirectory()
          ? "directory"
          : "file";
        return {
          path: kind === "directory" ? `${path}/` : path,
          kind,
        };
      });

    if (
      directMatches.length > 0 ||
      directoryPart !== "" ||
      namePrefix === "" ||
      namePrefix.length < 2
    ) {
      return directMatches;
    }

    const fallbackMatches: MentionCandidate[] = [];
    const visit = async (
      absoluteDirectory: string,
      directoryPart: string,
    ): Promise<void> => {
      const entries = await readdir(absoluteDirectory, { withFileTypes: true });

      for (const entry of entries) {
        if (!showHiddenEntries && entry.name.startsWith(".")) {
          continue;
        }

        if (
          entry.isDirectory() &&
          RECURSIVE_MENTION_IGNORED_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }

        const path = directoryPart
          ? `${directoryPart}/${entry.name}`
          : entry.name;
        const kind: MentionCandidate["kind"] = entry.isDirectory()
          ? "directory"
          : "file";

        if (entry.name.toLowerCase().startsWith(lowercasePrefix)) {
          fallbackMatches.push({
            path: kind === "directory" ? `${path}/` : path,
            kind,
          });
          if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
            return;
          }
        }

        if (entry.isDirectory()) {
          await visit(resolve(absoluteDirectory, entry.name), path);
          if (fallbackMatches.length >= MAX_FALLBACK_MENTION_CANDIDATES) {
            return;
          }
        }
      }
    };

    await visit(CURRENT_DIRECTORY, "");
    return fallbackMatches.sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  } catch {
    return [];
  }
}

type FileMentionMenuProps = {
  candidates: MentionCandidate[];
  selectedIndex: number;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onSelect: (index: number) => void;
  onExecute: (index: number) => void;
};

function FileMentionMenu({
  candidates,
  selectedIndex,
  scrollRef,
  onSelect,
  onExecute,
}: FileMentionMenuProps) {
  const { colors } = useTheme();
  const visibleHeight = Math.min(candidates.length, MAX_VISIBLE_MENTIONS);

  if (candidates.length === 0) {
    return (
      <box paddingX={1}>
        <text attributes={TextAttributes.DIM}>
          No matching files or folders
        </text>
      </box>
    );
  }

  return (
    <scrollbox ref={scrollRef} height={visibleHeight}>
      {candidates.map((candidate, index) => {
        const isSelected = index === selectedIndex;

        return (
          <box
            key={candidate.path}
            flexDirection="row"
            paddingX={1}
            height={1}
            overflow="hidden"
            backgroundColor={isSelected ? colors.selection : undefined}
            onMouseMove={() => onSelect(index)}
            onMouseDown={() => onExecute(index)}
          >
            <box flexGrow={1} flexShrink={1} overflow="hidden">
              <text selectable={false} fg={isSelected ? "black" : "white"}>
                {candidate.path}
              </text>
            </box>

            <box width={8} alignItems="flex-end" flexShrink={0}>
              <text selectable={false} fg={isSelected ? "black" : "gray"}>
                {candidate.kind === "directory" ? "Folder" : "File"}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}



function getInputBarPlaceholder(
  disabled: boolean,
  streaming: boolean,
  queueLength: number,
  voiceInput: boolean,
  voiceState: "idle" | "recording" | "transcribing",
): string {
  if (disabled) return "Agent is thinking… press esc to interrupt";
  if (streaming && queueLength > 0) return `${queueLength} queued — press enter to skip ahead`;
  if (streaming) return `Type to queue a message…`;
  if (!voiceInput) return `Ask anything... "Fix a bug in the database"`;
  if (voiceState === "recording") return "Recording… ctrl+r to stop";
  if (voiceState === "transcribing") return "Transcribing…";
  return "ctrl+r to record… or type normally";
}

export const TEXTAREA_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "enter", action: "submit" },
];
type Props = {
  onSubmit: (text: string) => void;
  onForceNext?: () => void;
  contextUsage?: ContextUsage | null;
  mcpServerCount?: number;
  disabled?: boolean;
  streaming?: boolean;
  queue?: QueuedMessage[];
  onRemoveFromQueue?: (index: number) => void;
  queueFocusedIndex?: number | null;
  onQueueFocusedIndexChange?: (index: number | null) => void;
};

export function InputBar({ onSubmit, onForceNext, contextUsage, mcpServerCount, disabled = false, streaming = false, queue = [], onRemoveFromQueue, queueFocusedIndex = null, onQueueFocusedIndexChange }: Props) {
  const { mode, model, toggleMode, setMode, setModel, voiceInput, toggleVoice } = usePromptConfig();
  const { invokeSkill, clearSession, handoff, compact } = useSessionActions();
  const textareaRef = useRef<TextareaRenderable>(null);
  const onSubmitRef = useRef<() => void>(() => {});
  const activeMentionRef = useRef<MentionMatch | null>(null);
  const mentionScrollRef = useRef<ScrollBoxRenderable>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const undoStackRef = useRef<string[]>([]);
  const prevTextRef = useRef("");
  const skipUndoRef = useRef(false);
  const pasteCounterRef = useRef(0);
  const pasteContentRef = useRef<Map<string, string>>(new Map());
  const recorderRef = useRef<RecorderHandle | null>(null);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");

  const effectiveDisabled = disabled;

  const renderer = useRenderer();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { colors } = useTheme();
  const { isTopLayer, push, pop, setResponder } = useKeyboardLayer();

  const setQueueFocusedIndex = useCallback((index: number | null) => {
    onQueueFocusedIndexChange?.(index);
  }, [onQueueFocusedIndexChange]);

  const exitQueueFocus = useCallback(() => {
    onQueueFocusedIndexChange?.(null);
    pop("queue");
  }, [onQueueFocusedIndexChange, pop]);

  const enterQueueFocus = useCallback(() => {
    if (queue.length === 0) return;
    onQueueFocusedIndexChange?.(queue.length - 1);
    push("queue", () => {
      onQueueFocusedIndexChange?.(null);
      return true;
    });
  }, [queue.length, onQueueFocusedIndexChange, push]);

  const [activeMention, setActiveMention] = useState<MentionMatch | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<
    MentionCandidate[]
  >([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const {
    showCommandMenu,
    commandQuery,
    selectedIndex,
    scrollRef,
    handleContentChange,
    resolveCommand,
    setSelectedIndex,
  } = useCommandMenu();

  const showMentionMenu = activeMention !== null;

  const closeMentionMenu = useCallback(() => {
    activeMentionRef.current = null;
    setActiveMention(null);
    setMentionCandidates([]);
    pop("mention");
  }, [pop]);

  const syncMentionMenu = useCallback(
    (text: string, cursorOffset: number) => {
      const nextMention = findActiveMention(text, cursorOffset);
      const previousMention = activeMentionRef.current;
      const mentionChanged =
        previousMention?.start !== nextMention?.start ||
        previousMention?.end !== nextMention?.end ||
        previousMention?.query !== nextMention?.query;

      if (!nextMention) {
        if (previousMention) {
          closeMentionMenu();
        }
        return;
      }

      activeMentionRef.current = nextMention;
      setActiveMention(nextMention);
      push("mention", () => {
        closeMentionMenu();
        return true;
      });

      if (mentionChanged) {
        setMentionSelectedIndex(0);
        mentionScrollRef.current?.scrollTo(0);
      }
    },
    [closeMentionMenu, push],
  );

  const handleTextareaContentChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!skipUndoRef.current) {
      undoStackRef.current.push(prevTextRef.current); // push the OLD text
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    }
    prevTextRef.current = textarea.plainText; // record the NEW text

    const text = textarea.plainText;
    handleContentChange(text);
    syncMentionMenu(text, textarea.cursorOffset);
  }, [handleContentChange, syncMentionMenu]);

  const expandPastes = useCallback((raw: string): string => {
    return raw.replace(PASTE_PLACEHOLDER_RE, (_, id: string) => {
      return pasteContentRef.current.get(id) ?? "";
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (effectiveDisabled && !streaming) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const raw = textarea.plainText.trim();
    if (raw.length === 0) return;

    const text = expandPastes(raw);
    pasteContentRef.current.clear();

    historyRef.current = [
      text,
      ...historyRef.current.filter((h) => h !== text),
    ];
    historyIndexRef.current = -1;
    undoStackRef.current = [];
    prevTextRef.current = "";

    onSubmit(text);
    skipUndoRef.current = true;
    textarea.setText("");
    skipUndoRef.current = false;
  }, [effectiveDisabled, streaming, onSubmit, expandPastes]);

  const handleMentionExecute = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      const mention = activeMentionRef.current;
      const candidate = mentionCandidates[index];

      if (!textarea || !mention || !candidate) return;

      const insertion =
        candidate.kind === "directory" ? candidate.path : `${candidate.path} `;

      const nextText = `${textarea.plainText.slice(0, mention.start)}@${insertion}${textarea.plainText.slice(mention.end)}`;

      skipUndoRef.current = true;
      textarea.replaceText(nextText);
      skipUndoRef.current = false;
      textarea.cursorOffset = mention.start + insertion.length + 1;
      syncMentionMenu(nextText, textarea.cursorOffset);
    },
    [mentionCandidates, syncMentionMenu],
  );

  const handleCommand = useCallback(
    (command: Command | undefined) => {
      const textarea = textareaRef.current;
      if (!textarea || !command) return;

      skipUndoRef.current = true;
      textarea.setText("");
      skipUndoRef.current = false;
      prevTextRef.current = "";

      if (command.action) {
        command.action({
          exit: () => {
            renderer.destroy();
            process.exit(0);
          },
          toast,
          dialog,
          navigate,
          mode,
          model,
          setMode,
          setModel,
          invokeSkill,
          clearSession,
          handoff,
          compact,
          toggleVoice,
          contextUsage: contextUsage ?? null,
        });
      } else {
        skipUndoRef.current = true;
        textarea.insertText(command.value + " ");
        skipUndoRef.current = false;
      }
    },
    [renderer, toast, dialog, navigate, mode, model, setMode, setModel, invokeSkill, clearSession, handoff, compact, contextUsage, toggleVoice],
  );

  const handleCommandExecute = useCallback(
    (index: number) => {
      const command = resolveCommand(index);
      handleCommand(command);
    },
    [resolveCommand, handleCommand],
  );

  // Keep the file picker in sync with the current @mention token.
  useEffect(() => {
    if (!activeMention) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clears stale candidates immediately when mention token disappears
      setMentionCandidates([]);
      return;
    }

    let ignore = false;
    const loadCandidates = async () => {
      const nextCandidates = await getMentionCandidates(activeMention.query);
      if (ignore) return;

      setMentionCandidates(nextCandidates);
      setMentionSelectedIndex((currentIndex) => {
        if (nextCandidates.length === 0) {
          return 0;
        }
        return Math.min(currentIndex, nextCandidates.length - 1);
      });
    };

    const handle = setTimeout(() => {
      void loadCandidates();
    }, 120);

    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [activeMention]);

  // Wire up textarea submit handler once so it always reads the latest state.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.onSubmit = () => {
      onSubmitRef.current();
    };
  }, []);

  // eslint-disable-next-line react-hooks/refs -- intentional: ref stores the latest submit handler so the textarea's onSubmit listener (wired once) never goes stale
  onSubmitRef.current = () => {
    // Block the submit handler only when the input is completely locked AND the agent is NOT streaming.
    if (effectiveDisabled && !streaming) return;

    if (showCommandMenu) {
      const command = resolveCommand(selectedIndex);
      handleCommand(command);
      return;
    }

    if (showMentionMenu) {
      const candidate = mentionCandidates[mentionSelectedIndex];
      if (candidate) {
        handleMentionExecute(mentionSelectedIndex);
        return;
      }
    }

    // Force-next: Enter on empty input while streaming with items queued.
    const textarea = textareaRef.current;
    if (streaming && queue.length > 0 && (!textarea || textarea.plainText.trim().length === 0)) {
      onForceNext?.();
      return;
    }

    handleSubmit();
  };

  useKeyboard((key) => {
    if (effectiveDisabled || streaming) return;
    if (!voiceInput) return;
    if (!isTopLayer("base")) return;
    // ctrl+r toggles recording on/off (toggle avoids needing key-release events).
    if (!key.ctrl || key.name !== "r") return;
    if (key.repeated) return;
    key.preventDefault();

    if (voiceState === "idle") {
      void (async () => {
        const { ok, hint } = await checkRecorderAvailable();
        if (!ok) {
          toast.show({ variant: "error", message: hint ?? "Recorder not available" });
          return;
        }
        recorderRef.current = await startRecording();
        setVoiceState("recording");
      })();
    } else if (voiceState === "recording" && recorderRef.current) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setVoiceState("transcribing");
      void (async () => {
        const wavPath = await recorder.stop();
        const config = readGlobalConfig();
        const text = await transcribe(wavPath, {
          whisperBackend: config.whisperBackend ?? "auto",
          openaiKey: config.apiKeys?.openai,
          openrouterKey: config.apiKeys?.openrouter,
        });
        if (text) textareaRef.current?.insertText(text + " ");
        setVoiceState("idle");
      })();
    }
  });

  useKeyboard((key) => {
    if (effectiveDisabled || streaming) return;
    if (!isTopLayer("base")) return;
    if (queueFocusedIndex !== null) return;
    if (key.name === "tab") {
      key.preventDefault();
      toggleMode();
    }
  });

  useKeyboard((key) => {
    if (effectiveDisabled) return;

    // Queue navigation: allow when the "queue" layer is on top.
    if (queueFocusedIndex !== null && isTopLayer("queue")) {
      if (key.name === "up") {
        key.preventDefault();
        setQueueFocusedIndex(queueFocusedIndex > 0 ? queueFocusedIndex - 1 : queueFocusedIndex);
      } else if (key.name === "down") {
        key.preventDefault();
        if (queueFocusedIndex >= queue.length - 1) {
          exitQueueFocus();
        } else {
          setQueueFocusedIndex(queueFocusedIndex + 1);
        }
      } else if (key.name === "backspace" || key.name === "delete") {
        key.preventDefault();
        const idx = queueFocusedIndex;
        onRemoveFromQueue?.(idx);
        const newLen = queue.length - 1;
        if (newLen === 0) {
          exitQueueFocus();
        } else {
          setQueueFocusedIndex(Math.min(idx, newLen - 1));
        }
      } else if (key.name === "return" || key.name === "enter") {
        key.preventDefault();
        onForceNext?.();
      } else if (key.name === "escape") {
        key.preventDefault();
        exitQueueFocus();
      }
      return;
    }

    if (!isTopLayer("base")) return;

    // Pressing up from an empty input enters queue focus (works during streaming too).
    if (key.name === "up" && queue.length > 0) {
      const ta = textareaRef.current;
      if (ta) {
        const text = ta.plainText;
        const cursorOnFirstLine = !text.slice(0, ta.cursorOffset).includes("\n");
        if (cursorOnFirstLine && text.length === 0) {
          key.preventDefault();
          enterQueueFocus();
          return;
        }
      }
    }

    if (streaming) return;
    if (showCommandMenu || showMentionMenu) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    if (key.name === "up") {
      const text = textarea.plainText;
      const cursorOnFirstLine = !text
        .slice(0, textarea.cursorOffset)
        .includes("\n");
      if (!cursorOnFirstLine) return;

      const history = historyRef.current;
      if (history.length === 0) return;

      key.preventDefault();
      const nextIndex = Math.min(
        historyIndexRef.current + 1,
        history.length - 1,
      );
      historyIndexRef.current = nextIndex;
      skipUndoRef.current = true;
      textarea.setText(history[nextIndex]!);
      skipUndoRef.current = false;
      textarea.cursorOffset = history[nextIndex]!.length;
    } else if (key.name === "down") {
      if (historyIndexRef.current === -1) return;

      const text = textarea.plainText;
      const cursorOnLastLine = !text
        .slice(textarea.cursorOffset)
        .includes("\n");
      if (!cursorOnLastLine) return;

      key.preventDefault();
      const nextIndex = historyIndexRef.current - 1;
      historyIndexRef.current = nextIndex;

      skipUndoRef.current = true;
      if (nextIndex < 0) {
        textarea.setText("");
      } else {
        textarea.setText(historyRef.current[nextIndex]!);
        textarea.cursorOffset = historyRef.current[nextIndex]!.length;
      }
      skipUndoRef.current = false;
    } else if ((key.ctrl || key["super"]) && key.name === "z") {
      key.preventDefault();
      const stack = undoStackRef.current;
      if (stack.length === 0) return;
      const prev = stack.pop()!;
      skipUndoRef.current = true;
      textarea.setText(prev);
      textarea.cursorOffset = prev.length;
      skipUndoRef.current = false;
      prevTextRef.current = prev;
    } else if (
      (key.name === "return" || key.name === "enter") &&
      (key.shift || key.meta)
    ) {
      // shift+return: works on Kitty-protocol terminals (shift modifier forwarded)
      // meta+return (opt+enter on macOS): works on all standard terminals
      key.preventDefault();
      textarea.insertText("\n");
    }
  });

  // Ctrl+C: copy active selection; or clear the textarea.
  useEffect(() => {
    setResponder("base", () => {
      const selection = renderer.getSelection();
      if (selection?.isActive) {
        const text = selection.getSelectedText();
        if (text) {
          renderer.copyToClipboardOSC52(text);
          return true;
        }
      }

      if (effectiveDisabled && !streaming) return false;

      const textarea = textareaRef.current;
      if (textarea && textarea.plainText.length > 0) {
        skipUndoRef.current = true;
        textarea.setText("");
        skipUndoRef.current = false;
        prevTextRef.current = "";
        historyIndexRef.current = -1;
        undoStackRef.current = [];
        return true;
      }
      return false;
    });

    return () => setResponder("base", null);
  }, [effectiveDisabled, streaming, renderer, setResponder]);

  // Intercept long pastes: store full content and insert a short placeholder instead.
  useEffect(() => {
    const internalKeyInput = renderer._internalKeyInput;

    const handlePaste = (event: PasteEvent) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const text = decodePasteBytes(event.bytes);
      const lines = text.split("\n");
      const isLong =
        lines.length > PASTE_THRESHOLD_LINES ||
        text.length > PASTE_THRESHOLD_CHARS;

      if (!isLong) return;

      event.preventDefault();

      const id = `p${++pasteCounterRef.current}`;
      pasteContentRef.current.set(id, text);

      const label =
        lines.length > PASTE_THRESHOLD_LINES
          ? `${lines.length} lines`
          : `${text.length} chars`;

      textarea.insertText(`[paste:${id}: ${label}]`);
    };

    internalKeyInput.on("paste", handlePaste);
    return () => {
      internalKeyInput.off("paste", handlePaste);
    };
  }, [renderer]);

  // Voice warmup disabled — see TODO in commands.tsx. Re-enable body when voice is re-introduced.
  // useEffect(() => {
  //   if (!voiceInput || isRecorderReady()) return;
  //   let cancelled = false;
  //   queueMicrotask(() => { if (!cancelled) setVoiceState("compiling"); });
  //   void warmRecorder()
  //     .then(() => { if (!cancelled) setVoiceState("idle"); })
  //     .catch(() => {
  //       if (!cancelled) setVoiceState("idle");
  //       toast.show({ variant: "error", message: "Failed to build voice recorder. Run: xcode-select --install" });
  //     });
  //   return () => { cancelled = true; };
  // }, [voiceInput, toast]);

  useKeyboard((key) => {
    if (effectiveDisabled) return;
    if (!showMentionMenu || !isTopLayer("mention")) return;

    if (key.name === "escape") {
      key.preventDefault();
      closeMentionMenu();
    } else if (key.name === "up") {
      key.preventDefault();
      setMentionSelectedIndex((currentIndex) => {
        const nextIndex = Math.max(0, currentIndex - 1);
        const scrollbox = mentionScrollRef.current;
        if (scrollbox && nextIndex < scrollbox.scrollTop) {
          scrollbox.scrollTo(nextIndex);
        }
        return nextIndex;
      });
    } else if (key.name === "down") {
      key.preventDefault();
      setMentionSelectedIndex((currentIndex) => {
        if (mentionCandidates.length === 0) {
          return 0;
        }

        const nextIndex = Math.min(
          mentionCandidates.length - 1,
          currentIndex + 1,
        );
        const scrollbox = mentionScrollRef.current;

        if (scrollbox) {
          const viewportHeight = scrollbox.viewport.height;
          const visibleEnd = scrollbox.scrollTop + viewportHeight - 1;
          if (nextIndex > visibleEnd) {
            scrollbox.scrollTo(nextIndex - viewportHeight + 1);
          }
        }

        return nextIndex;
      });
    }
  });

  return (
    <box flexDirection="column" width="100%" zIndex={1}>
      <box
        border={["left"]}
        borderColor={
          disabled
            ? colors.dimSeparator
            : mode === Mode.BUILD
              ? colors.primary
              : colors.planMode
        }
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
        width="100%"
      >
        <box
          position="relative"
          justifyContent="center"
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
          gap={1}
        >
          {showCommandMenu && (
            <box
              position="absolute"
              bottom="100%"
              left={0}
              width="100%"
              backgroundColor={colors.surface}
              zIndex={10}
            >
              <CommandMenu
                query={commandQuery}
                selectedIndex={selectedIndex}
                scrollRef={scrollRef}
                onSelect={setSelectedIndex}
                onExecute={handleCommandExecute}
              />
            </box>
          )}
          {!showCommandMenu && showMentionMenu && (
            <box
              position="absolute"
              bottom="100%"
              left={0}
              width="100%"
              backgroundColor={colors.surface}
              zIndex={10}
            >
              <FileMentionMenu
                candidates={mentionCandidates}
                selectedIndex={mentionSelectedIndex}
                scrollRef={mentionScrollRef}
                onSelect={setMentionSelectedIndex}
                onExecute={handleMentionExecute}
              />
            </box>
          )}
          <textarea
            ref={textareaRef}
            focused={
              !effectiveDisabled &&
              queueFocusedIndex === null &&
              (isTopLayer("base") ||
                isTopLayer("command") ||
                isTopLayer("mention"))
            }
            keyBindings={TEXTAREA_KEY_BINDINGS}
            onContentChange={handleTextareaContentChange}
            placeholder={getInputBarPlaceholder(disabled, streaming, queue.length, voiceInput, voiceState)}
          />
          <StatusBar contextUsage={contextUsage} mcpServerCount={mcpServerCount} />
        </box>
      </box>
    </box>
  );
}