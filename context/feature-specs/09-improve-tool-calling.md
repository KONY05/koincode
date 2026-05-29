so right now all the tools are stored in one place `packages/cli/src/lib/local-tools.ts` and they are basically grouped in one big giant function `executeLocalTool` we should refactor it so that each tool is in its own file and they can be easily imported and used in other parts of the application (we need to move them to a `tools` folder under `packages/cli/src/`)

and have an index file in the folder that calls the executeLocalTool function as before that just points the switch cases to the respective tool file so that the functionality is exactly the same.

we can improve on each individual tool after we've performed the refactor