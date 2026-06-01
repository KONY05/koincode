since this is a coding agent terminal tool i was thinking we should also have a sub-agent that reviews the code and suggests improvements. The prompt for the code reviewer agent should be something like:

"You are a code reviewer. You will be given a piece of code and you will need to review it and suggest improvements. You should also provide a summary of the changes you suggest and the benefits of those changes. The output should be in markdown format and should be easy to read. You should also provide a list of the changes you suggest and the benefits of those changes."

The code reviewer agent should be able to review code in any programming language and should be able to provide suggestions for improvements in any programming language. The code reviewer agent should also be able to provide a summary of the changes it suggests and the benefits of those changes. The output should be in markdown format and should be easy to read. The code reviewer agent should also be able to provide a list of the changes it suggests and the benefits of those changes.

i was thinking it will just check only the editted files, like git changed files, but not everyone may have git set on their project so it could be either cases, git changes, or just code to review.


# Agent Recommendation 
My recommendation: Start with a /review command that grabs git diff (with a fallback to ask which files), sends it to the LLM with the reviewer system prompt, and streams the response inline. That's shippable quickly and validates the UX before investing in anything more complex.

# User flow
/review command hit -> main agent check if there's any pending changes (git diff), if yes -> code review sub agent -> send the reviewed code back to the main agent -> if no the user should specify the changes that need to be reviewed.
after it sends it to the agent we show a todo like UI in the UI to show the issues and improvements the main agent found in the code.
and the main agent then goes over the todo to implement the improvements recommended, we also let the users choose the tasks they want to implement or not.