import { TextAttributes } from "@opentui/core";

import type { ThemeColors } from "../../theme";
import type { TodoItem } from "@koincode/shared";

export default function TodoList({
  input,
  toolName,
  pending,
  colors,
}: {
  input: unknown;
  toolName: string;
  pending: boolean;
  colors: ThemeColors;
}) {
  if (!input || typeof input !== "object") return null;
  const { todos } = input as { todos?: TodoItem[] };
  if (!todos?.length) return null;

  const label = toolName === "createTodos" ? "Todos" : "Updated todos";
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <box width="100%">
      <box flexDirection="row" gap={1}>
        <text><em fg={colors.info}>{label}</em></text>
        <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
          {completedCount}/{todos.length}
        </text>
        {pending && <text attributes={TextAttributes.DIM}> …</text>}
      </box>
      {todos.map((todo) => (
        <box key={todo.id} flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={todo.completed ? colors.success : colors.dimSeparator}>
            {todo.completed ? "✓" : "○"}
          </text>
          <text attributes={todo.completed ? TextAttributes.STRIKETHROUGH : TextAttributes.NONE}>
            {todo.text}
          </text>
        </box>
      ))}
    </box>
  );
}
