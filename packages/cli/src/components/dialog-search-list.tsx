import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  TextAttributes,
  type InputRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { useKeyboardLayer } from "../providers/keyboard-layer";
import { useTheme } from "../providers/theme";

const MAX_VISIBLE_ITEMS = 6;

/**
 * Every `<text>` in OpenTUI is independently scrollable: `TextBufferRenderable`'s own
 * `onMouseEvent` runs `scrollY += delta` on any wheel event that hits it, and a title
 * too long for its row word-wraps into 2+ lines, which makes that scroll actually move.
 * The visible result is a row showing the *tail* of its title mid-scroll ("…console log"
 * rendering as just "log") while its neighbours look fine.
 *
 * It can't be prevented at the source: mouse dispatch runs the target's own
 * `onMouseEvent` before bubbling to the parent, and that call is gated by neither
 * `preventDefault()` nor `stopPropagation()`. What we can do is undo it — the scrollbox
 * sees the same event on the way up, so resetting every descendant text's offsets here
 * lands before the frame is drawn. Keyboard scrolling never triggers this.
 */
function resetNestedTextScroll(node: unknown): void {
  const candidate = node as {
    wrapMode?: unknown;
    scrollX?: number;
    scrollY?: number;
    getChildren?: () => unknown[];
  };

  // `wrapMode` is the marker for a text-buffer-backed renderable. Checking it keeps us
  // off the ScrollBox itself, whose own scroll offsets are `scrollTop`/`scrollLeft` and
  // must be left alone.
  if (typeof candidate.wrapMode === "string") {
    if (candidate.scrollY) candidate.scrollY = 0;
    if (candidate.scrollX) candidate.scrollX = 0;
  }

  if (typeof candidate.getChildren === "function") {
    for (const child of candidate.getChildren()) resetNestedTextScroll(child);
  }
}

type DialogSearchListProps<T> = {
  items: T[];
  onSelect: (item: T) => void;
  onHighlight?: (item: T) => void;
  filterFn: (item: T, query: string) => boolean;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  getKey: (item: T) => string;
  placeholder?: string;
  emptyText?: string;
  /**
   * Optional section header label for an item, e.g. "Today" / "Yesterday". Items are
   * assumed to already be sorted so that same-label items are contiguous — a header row
   * is inserted whenever this changes from the previous item. Omit for a plain flat list.
   */
  getGroupLabel?: (item: T) => string;
};

export function DialogSearchList<T>({
  items,
  onSelect,
  onHighlight,
  filterFn,
  renderItem,
  getKey,
  placeholder = "Search",
  emptyText = "No results",
  getGroupLabel,
}: DialogSearchListProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<InputRenderable>(null);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { isTopLayer } = useKeyboardLayer();
  const { colors } = useTheme();

  const handleContentChange = useCallback(() => {
    const text = inputRef.current?.value ?? "";
    setSearchValue(text);
    setSelectedIndex(0);

    const scrollbox = scrollRef.current;
    if (scrollbox) {
      scrollbox.scrollTo(0);
    }
  }, []);

  const filtered = searchValue
    ? items.filter((item) => filterFn(item, searchValue))
    : items;

  // Interleave section-header rows between items whenever getGroupLabel's value changes
  // from the previous item. itemRowIndex[k] is where the k-th item actually lands once
  // headers are counted, so keyboard scrolling can target the right row — selectedIndex
  // itself stays purely in item-space (headers are never selectable).
  type Row =
    | { type: "spacer" }
    | { type: "header"; label: string }
    | { type: "item"; item: T; itemIndex: number };
  const rows: Row[] = [];
  const itemRowIndex: number[] = [];
  let lastGroupLabel: string | undefined;
  filtered.forEach((item, itemIndex) => {
    if (getGroupLabel) {
      const label = getGroupLabel(item);
      if (label !== lastGroupLabel) {
        // No spacer above the very first header — there's nothing above it to separate from.
        if (rows.length > 0) rows.push({ type: "spacer" });
        rows.push({ type: "header", label });
        lastGroupLabel = label;
      }
    }
    itemRowIndex.push(rows.length);
    rows.push({ type: "item", item, itemIndex });
  });

  const visibleHeight = Math.min(rows.length, MAX_VISIBLE_ITEMS);

  useKeyboard((key) => {
    if (!isTopLayer("dialog")) return;

    if (key.name === "return" || key.name === "enter") {
      const item = filtered[selectedIndex];
      if (item) {
        onSelect(item);
      }
    } else if (key.name === "up") {
      setSelectedIndex((i) => {
        const newIndex = Math.max(0, i - 1);
        const sb = scrollRef.current;
        let rowIndex = itemRowIndex[newIndex] ?? newIndex;
        // Scrolling up onto the first item of a group would otherwise land it at the
        // very top of the viewport, pushing its header off-screen — pull the header
        // into view along with it instead.
        if (rows[rowIndex - 1]?.type === "header") rowIndex -= 1;
        if (sb && rowIndex < sb.scrollTop) {
          sb.scrollTo(rowIndex);
        }
        const item = filtered[newIndex];
        if (item && onHighlight) onHighlight(item);
        return newIndex;
      });
    } else if (key.name === "down") {
      setSelectedIndex((i) => {
        const newIndex = Math.min(filtered.length - 1, i + 1);
        const sb = scrollRef.current;
        const rowIndex = itemRowIndex[newIndex] ?? newIndex;
        if (sb) {
          const viewportHeight = sb.viewport.height;
          const visibleEnd = sb.scrollTop + viewportHeight - 1;
          if (rowIndex > visibleEnd) {
            sb.scrollTo(rowIndex - viewportHeight + 1);
          }
        }
        const item = filtered[newIndex];
        if (item && onHighlight) onHighlight(item);
        return newIndex;
      });
    }
  });

  return (
    <box flexDirection="column" gap={1}>
      <input
        ref={inputRef}
        placeholder={placeholder}
        focused
        onContentChange={handleContentChange}
      />
      {filtered.length === 0 ? (
        <text attributes={TextAttributes.DIM}>{emptyText}</text>
      ) : (
        <scrollbox
          ref={scrollRef}
          height={visibleHeight}
          onMouseScroll={() => resetNestedTextScroll(scrollRef.current)}
        >
          {rows.map((row, rowIndex) => {
            if (row.type === "spacer") {
              return <box key={`spacer-${rowIndex}`} height={1} />;
            }

            if (row.type === "header") {
              return (
                <box key={`header-${rowIndex}`} flexDirection="row" height={1} overflow="hidden">
                  <text selectable={false} fg={colors.primary} attributes={TextAttributes.BOLD}>
                    {row.label}
                  </text>
                </box>
              );
            }

            const { item, itemIndex } = row;
            const isSelected = itemIndex === selectedIndex;
            return (
              <box
                key={getKey(item)}
                flexDirection="row"
                height={1}
                overflow="hidden"
                backgroundColor={isSelected ? colors.selection : undefined}
                onMouseMove={() => {
                  setSelectedIndex(itemIndex);
                  if (onHighlight) onHighlight(item);
                }}
                onMouseDown={() => onSelect(item)}
              >
                {renderItem(item, isSelected)}
              </box>
            );
          })}
        </scrollbox>
      )}
    </box>
  );
}
