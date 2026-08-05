const MENTION_QUERY_CHARACTER = /[A-Za-z0-9._/-]/;

export function isMentionQueryCharacter(character: string): boolean {
  return MENTION_QUERY_CHARACTER.test(character);
}

export type MentionRange = {
  start: number;
  end: number;
};

/**
 * Every `@mention` span in `text` — the "@ must start a token" rule (the character
 * before `@` can't itself be a mention-query character) keeps this from matching
 * mid-word, e.g. the `@` in an email address. Shared between the input bar (to
 * highlight while composing, and to drive the file/agent picker via `findActiveMention`
 * there) and rendered user messages (to highlight after send), so both agree on what
 * counts as a mention.
 */
export function findMentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "@") {
      const previousCharacter = text[index - 1];
      if (!previousCharacter || !isMentionQueryCharacter(previousCharacter)) {
        let end = index + 1;
        while (end < text.length && isMentionQueryCharacter(text[end]!)) {
          end += 1;
        }
        ranges.push({ start: index, end });
        index = end;
        continue;
      }
    }
    index += 1;
  }

  return ranges;
}
