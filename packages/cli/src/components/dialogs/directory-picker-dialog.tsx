import { useCallback, useEffect, useRef, useState } from "react";
import { readdir } from "fs/promises";
import { dirname, resolve } from "path";
import {
  TextAttributes,
  type InputRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useDialog } from "../../providers/dialog";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useTheme } from "../../providers/theme";

const IGNORED_DIRECTORIES = new Set(["node_modules"]);
const MAX_VISIBLE_ITEMS = 8;

type Row =
  | { type: "use-current" }
  | { type: "entry"; name: string };

type Props = {
  onSelect: (path: string) => void;
};

export function DirectoryPickerDialogContent({ onSelect }: Props) {
  const [currentPath, setCurrentPath] = useState(() => dirname(process.cwd()));
  const [entries, setEntries] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const { close } = useDialog();
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  // Lazy, one level at a time — never a recursive walk.
  useEffect(() => {
    let ignore = false;

    (async () => {
      try {
        const dirents = await readdir(currentPath, { withFileTypes: true });
        const names = dirents
          .filter((e) => e.isDirectory())
          .filter((e) => !e.name.startsWith("."))
          .filter((e) => !IGNORED_DIRECTORIES.has(e.name))
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b));

        if (!ignore) setEntries(names);
      } catch {
        if (!ignore) setEntries([]);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [currentPath]);

  const filteredEntries = searchValue
    ? entries.filter((name) =>
        name.toLowerCase().includes(searchValue.toLowerCase()),
      )
    : entries;

  const rows: Row[] = [
    { type: "use-current" },
    ...filteredEntries.map((name) => ({ type: "entry" as const, name })),
  ];

  const resetToTop = useCallback(() => {
    setSelectedIndex(0);
    scrollRef.current?.scrollTo(0);
  }, []);

  const goUp = useCallback(() => {
    const parent = dirname(currentPath);
    if (parent === currentPath) return; // already at filesystem root

    setCurrentPath(parent);
    setSearchValue("");
    inputRef.current?.setText("");
    resetToTop();
  }, [currentPath, resetToTop]);

  const selectRow = useCallback(
    (row: Row) => {
      if (row.type === "use-current") {
        onSelect(currentPath);
        close();
        return;
      }

      setCurrentPath(resolve(currentPath, row.name));
      setSearchValue("");
      inputRef.current?.setText("");
      resetToTop();
    },
    [currentPath, onSelect, close, resetToTop],
  );

  const handleContentChange = useCallback(() => {
    setSearchValue(inputRef.current?.value ?? "");
    resetToTop();
  }, [resetToTop]);

  const visibleHeight = Math.min(rows.length, MAX_VISIBLE_ITEMS);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "return" || key.name === "enter") {
      const row = rows[selectedIndex];
      if (row) selectRow(row);
    } else if (key.name === "up") {
      setSelectedIndex((i) => {
        const newIndex = Math.max(0, i - 1);
        const sb = scrollRef.current;
        if (sb && newIndex < sb.scrollTop) sb.scrollTo(newIndex);
        return newIndex;
      });
    } else if (key.name === "down") {
      setSelectedIndex((i) => {
        const newIndex = Math.min(rows.length - 1, i + 1);
        const sb = scrollRef.current;
        if (sb) {
          const viewportHeight = sb.viewport.height;
          const visibleEnd = sb.scrollTop + viewportHeight - 1;
          if (newIndex > visibleEnd) sb.scrollTo(newIndex - viewportHeight + 1);
        }
        return newIndex;
      });
    } else if ((key.name === "backspace" || key.name === "left") && searchValue === "") {
      key.preventDefault();
      goUp();
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <input
        ref={inputRef}
        placeholder="Search this directory"
        focused
        onContentChange={handleContentChange}
      />

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator} wrapMode="none">
        {currentPath}
      </text>

      <scrollbox ref={scrollRef} height={visibleHeight}>
        {rows.map((row, i) => {
          const isSelected = i === selectedIndex;
          const key = row.type === "use-current" ? "__use-current__" : row.name;
          return (
            <box
              key={key}
              flexDirection="row"
              height={1}
              overflow="hidden"
              backgroundColor={isSelected ? colors.selection : undefined}
              onMouseMove={() => setSelectedIndex(i)}
              onMouseDown={() => selectRow(row)}
            >
              {row.type === "use-current" ? (
                <text fg={isSelected ? "black" : colors.primary}>
                  Use this directory — {currentPath}
                </text>
              ) : (
                <text fg={isSelected ? "black" : "white"}>{row.name}/</text>
              )}
            </box>
          );
        })}
      </scrollbox>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        enter · open or use directory   ←/backspace · up a level   esc · cancel
      </text>
    </box>
  );
}
