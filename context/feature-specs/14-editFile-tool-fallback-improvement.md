i want to improve on the `editFile` tool. i want us to have a robust fallback option to better handle the case when the `oldString` is not found in the file. 

## Suggestion
1. **Whitespace tolerance** — the most common failure mode is the model returning code with slightly different indentation or trailing spaces:
typescriptconst normalized = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
// normalize both before matching, but replace with original positions
2. **Fuzzy matching as a fallback** — if exact match fails, try matching after normalizing whitespace. Claude Code does this.
3. **Better error context** — instead of just "not found", show a snippet of the file so the model can self-correct:
typescriptif (occurrences === 0) {
  const lines = content.split('\n').slice(0, 20).join('\n');
  throw new Error(`oldString not found. File starts with:\n${lines}`);
}
4. **Dry run / diff preview** — return a unified diff in the result so the model (and user) can see exactly what changed:
typescriptimport { createPatch } from 'diff'; // npm: diff

const patch = createPatch(path, content, newContent);
return { success: true, path: relative(cwd, resolved), diff: patch };
This is valuable because the model can catch its own mistakes if it sees the diff in the tool result.