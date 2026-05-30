import { useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { useKeyboardLayer } from "../providers/keyboard-layer";
import { EmptyBorder } from "./border";
import type { PendingUserQuestion } from "../hooks/use-chat";

type Props = {
  question: PendingUserQuestion;
  onResponse: (value: string | null) => void;
};

export function AskUserWidget({ question, onResponse }: Props) {
  const { colors } = useTheme();
  const { push, pop, isTopLayer } = useKeyboardLayer();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [freeTextMode, setFreeTextMode] = useState(false);
  const textareaRef = useRef<TextareaRenderable>(null);

  const { options, allowFreeText } = question;

  useEffect(() => {
    push("ask-user", () => {
      onResponse(null);
      return true;
    });
    return () => pop("ask-user");
  }, [onResponse, pop, push]);

  useEffect(() => {
    if (freeTextMode) {
      textareaRef.current?.focus?.();
    }
  }, [freeTextMode]);

  const confirm = (index: number) => {
    const opt = options[index];
    if (opt) onResponse(opt.value);
  };

  useKeyboard((key) => {
    if (!isTopLayer("ask-user")) return;

    if (freeTextMode) {
      if (key.name === "escape") {
        key.preventDefault();
        setFreeTextMode(false);
      } else if (key.name === "return" || key.name === "enter") {
        key.preventDefault();
        const text = textareaRef.current?.plainText.trim() ?? "";
        onResponse(text.length > 0 ? text : null);
      }
      return;
    }

    if (key.name === "escape") {
      key.preventDefault();
      onResponse(null);
    } else if (key.name === "up") {
      key.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      key.preventDefault();
      const max = allowFreeText ? options.length : options.length - 1;
      setSelectedIndex((i) => Math.min(max, i + 1));
    } else if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      if (allowFreeText && selectedIndex === options.length) {
        setFreeTextMode(true);
      } else {
        confirm(selectedIndex);
      }
    } else if (key.sequence && /^[1-9]$/.test(key.sequence)) {
      const index = parseInt(key.sequence, 10) - 1;
      if (index < options.length) {
        key.preventDefault();
        confirm(index);
      } else if (allowFreeText && index === options.length) {
        key.preventDefault();
        setFreeTextMode(true);
      }
    }
  });

  const allOptions = allowFreeText
    ? [...options, { label: "Type a response...", value: "__free_text__" }]
    : options;

  return (
    <box width="100%" alignItems="center">
      <box
        border={["left"]}
        borderColor={colors.primary}
        customBorderChars={{
          ...EmptyBorder,
          vertical: "┃",
          bottomLeft: "╹",
        }}
        width="100%"
      >
        <box
          paddingX={2}
          paddingY={1}
          backgroundColor={colors.surface}
          width="100%"
          gap={1}
        >
          {/* Question */}
          <box>
            <text fg={colors.primary} attributes={TextAttributes.BOLD}>
              ? {question.question}
            </text>
          </box>

          {freeTextMode ? (
            /* Free-text input mode */
            <box flexDirection="column" gap={1}>
              <text fg="gray">Type your response and press enter:</text>
              <textarea
                ref={textareaRef}
                focused
                placeholder="Your response..."
              />
            </box>
          ) : (
            /* Option list */
            <box gap={0}>
              {allOptions.map((opt, i) => {
                const isSelected = i === selectedIndex;
                const isFreeText = opt.value === "__free_text__";
                const shortcut = i < 9 ? `${i + 1}` : " ";
                const fg = isSelected ? colors.primary : colors.dimSeparator;

                return (
                  <box
                    key={opt.value === "__free_text__" ? "__free_text__" : opt.value}
                    flexDirection="row"
                    gap={1}
                    height={1}
                    onMouseMove={() => setSelectedIndex(i)}
                    onMouseDown={() => {
                      if (isFreeText) {
                        setFreeTextMode(true);
                      } else {
                        confirm(i);
                      }
                    }}
                  >
                    <text fg={fg} attributes={isSelected ? TextAttributes.BOLD : undefined}>
                      {isSelected ? "›" : " "} [{shortcut}]
                    </text>
                    <text
                      fg={isSelected ? (isFreeText ? "gray" : "white") : "gray"}
                      attributes={isFreeText ? TextAttributes.DIM : undefined}
                    >
                      {opt.label}
                    </text>
                  </box>
                );
              })}
            </box>
          )}
        </box>
      </box>
    </box>
  );
}
