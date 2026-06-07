export function buildCompactionPrompt(conversationText: string){
    return `Provide a detailed continuation prompt for resuming this work. The new session will NOT have access to our conversation history.
    
    IMPORTANT: Structure your response EXACTLY as follows:
    
    ## ORIGINAL GOAL
    [State the user's original request/goal in one paragraph]
    
    ## COMPLETED ACTIONS (DO NOT REPEAT THESE)
    [List specific actions that are DONE and should NOT be repeated. Be specific with file paths, function names, changes made. Use bullet points.]
    
    ## CURRENT STATE
    [Describe the current state of the codebase/project after the completed actions. What files exist, what has been modified, what is the current status.]
    
    ## IN-PROGRESS WORK
    [What was being worked on when the context limit was hit? Any partial changes?]
    
    ## REMAINING TASKS
    [What still needs to be done to complete the original goal? Be specific.]
    
    ## NEXT STEP
    [What is the immediate next action to take? Be very specific — this is what the agent should do first.]
    
    ## KEY CONTEXT
    [Any important decisions, constraints, user preferences, technical context or assumptions that must persist.]
    
    Be extremely specific with file paths and function names. The goal is to allow seamless continuation without redoing any completed work.
    
    Conversation to summarize:
    
    ${conversationText}`
}