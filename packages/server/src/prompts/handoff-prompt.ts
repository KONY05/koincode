export function buildHandoffPrompt(conversationText: string) {
  return `You are producing a handoff brief for a brand-new agent session that will continue this work.
The new session will have NO access to the conversation history — only what you write here.

IMPORTANT: Structure your response EXACTLY as follows:

## ORIGINAL GOAL
[State the user's original request or goal in one paragraph. Be precise — this anchors everything.]

## COMPLETED ACTIONS (DO NOT REPEAT THESE)
[Exhaustive list of what is DONE. Use bullet points. Be specific: exact file paths, function names, schema changes, commands run, decisions finalised. The agent must not redo any of this.]

## CURRENT STATE
[Describe the codebase/project as it stands right now. Which files were created or modified, what the current behaviour is, what tests pass, what the DB looks like, etc.]

## IN-PROGRESS WORK
[Anything that was partially done or left mid-flight when the handoff was triggered. Partial changes, uncommitted edits, half-written code.]

## REMAINING TASKS
[Everything still needed to fully complete the original goal. Ordered by priority. Specific enough that the agent can act without guessing.]

## NEXT STEP
[The single most important immediate action. Be precise — file name, function, command. The agent does this first.]

## KEY CONTEXT
[Constraints, user preferences, architectural decisions, gotchas, env requirements, and anything else the agent must know to avoid making wrong assumptions.]

## RECOMMENDED SETUP
[If the volume of context is large or a persistent reference file would help, suggest that the agent write a file (e.g. \`HANDOFF.md\` or \`.koincode/context.md\`) at the start of the new session so context survives further compactions. Include what that file should contain.]

Be exhaustive and precise. This document is the agent's only memory of all prior work.

Conversation to summarize:

${conversationText}`;
}
