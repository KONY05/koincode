since we've gotten most of the tool calling out of the way, i want us to focus on subagents functionality now. this will be when the main agent has a lot of work to do that it needs to break down or when it feels like splitting up and delegating to other agents to work in the background is the best approach.

and when rendering the tool in the UI, we can style it just like other tools (the readFile etc, that shows "Read file path"), but instead of a file path, it should show the name of the subagent, and the user can click on to open the subagent UI. and the subagent UI should be able to show the output of the subagents in the UI (not yet sure if i want to show it). but the response of the subagent won't be shown in the main chat UI but it will be sent back to the main llm so it can work with what it's done

## Comparison reference
class SubagentParams(BaseModel):
    goal: str = Field(
        ..., description="The specific task or goal for the subagent to accomplish"
    )


@dataclass
class SubagentDefinition:
    name: str
    description: str
    goal_prompt: str
    allowed_tools: list[str] | None = None
    max_turns: int = 20
    timeout_seconds: float = 600


class SubagentTool(Tool):
    def __init__(self, config: Config, definition: SubagentDefinition):
        super().__init__(config)
        self.definition = definition

    @property
    def name(self) -> str:
        return f"subagent_{self.definition.name}"

    @property
    def description(self) -> str:
        return f"subagent_{self.definition.description}"

    schema = SubagentParams

    def is_mutating(self, params: dict[str, Any]) -> bool:
        return True

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        from agent.agent import Agent
        from agent.events import AgentEventType

        params = SubagentParams(**invocation.params)
        if not params.goal:
            return ToolResult.error_result("No goal specified for sub-agent")

        config_dict = self.config.to_dict()
        config_dict["max_turns"] = self.definition.max_turns
        if self.definition.allowed_tools:
            config_dict["allowed_tools"] = self.definition.allowed_tools

        subagent_config = Config(**config_dict)

        prompt = f"""You are a specialized sub-agent with a specific task to complete.

        {self.definition.goal_prompt}

        YOUR TASK:
        {params.goal}

        IMPORTANT:
        - Focus only on completing the specified task
        - Do not engage in unrelated actions
        - Once you have completed the task or have the answer, provide your final response
        - Be concise and direct in your output
        """

        tool_calls = []
        final_response = None
        error = None
        terminate_response = "goal"

        try:
            async with Agent(subagent_config) as agent:
                deadline = (
                    asyncio.get_event_loop().time() + self.definition.timeout_seconds
                )

                async for event in agent.run(prompt):
                    if asyncio.get_event_loop().time() > deadline:
                        terminate_response = "timeout"
                        final_response = "Sub-agent timed out"
                        break

                    if event.type == AgentEventType.TOOL_CALL_START:
                        tool_calls.append(event.data.get("name"))
                    elif event.type == AgentEventType.TEXT_COMPLETE:
                        final_response = event.data.get("content")
                    elif event.type == AgentEventType.AGENT_END:
                        if final_response is None:
                            final_response = event.data.get("response")
                    elif event.type == AgentEventType.AGENT_ERROR:
                        terminate_response = "error"
                        error = event.data.get("error", "Unknown")
                        final_response = f"Sub-agent error: {error}"
                        break
        except Exception as e:
            terminate_response = "error"
            error = str(e)
            final_response = f"Sub-agent failed: {e}"

        result = f"""Sub-agent '{self.definition.name}' completed. 
        Termination: {terminate_response}
        Tools called: {', '.join(tool_calls) if tool_calls else 'None'}

        Result:
        {final_response or 'No response'}
        """

        if error:
            return ToolResult.error_result(result)

        return ToolResult.success_result(result)
