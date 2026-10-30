---
title: One chat box, eight agents
description: How CortexAI's LangGraph router sends each message to one of eight agents, why its classifier returns an enum, and how answers stream to the browser.
date: 2026-10-13
kind: technical
tags: [Python, LangGraph, LLM, Streaming]
project: cortexai
draft: false
---

In the first prototype of CortexAI, the router asked a model which agent should handle a message and parsed its free-text reply. Its prompt also listed only four of the six agents that existed. So two of them, presentations and image generation, were unreachable through the router, and no error said so.

I designed the new router against both halves of that failure: returning something the code doesn't expect, and being unable to return something it should.

## The graph

The agent service is Python, FastAPI and LangGraph. The graph is short. From `agent/app/graph/graph.py`:

```python
def build_graph():
    g = StateGraph(AgentState)
    g.add_node("router", route)
    g.add_node("guard", guard)
    for name, node in AGENT_NODES.items():
        g.add_node(name, node)
        g.add_edge(name, END)
    g.add_edge(START, "router")
    g.add_edge("router", "guard")
    g.add_conditional_edges("guard", lambda s: s["agent"], {name: name for name in AGENT_NODES})
    return g.compile()
```

So every turn follows the same path:

1. `router` decides which agent handles the message.
2. `guard` checks rate limits and reserves credits.
3. Exactly one agent node produces the answer.

The same file has `assert set(AGENT_NODES) == set(AGENTS)` at import time, so adding an agent to the price table without wiring a node (or the other way round) fails on startup, before it can reach production traffic.

The eight agents, with their prices and per-minute limits from `agent/app/costs.py`:

| Agent | Credits | Per minute |
|---|---|---|
| chat | 1 | 20 |
| search | 3 | 8 |
| coding | 5 | 6 |
| pdf | 5 | 4 |
| ppt | 5 | 4 |
| image | 5 | 3 |
| vision | 3 | 6 |
| rag | 2 | 10 |

## Routing rules, in order

The router doesn't call a model unless it has to. From `agent/app/graph/router.py`:

```python
async def route(state: AgentState, config: RunnableConfig) -> AgentState:
    req = request_of(config)
    requested = state.get("requested_agent", "auto")

    if requested != "auto":
        agent = requested
    elif req.upload and is_image(req.upload.mime):
        agent = "vision"
    elif req.upload:
        agent = "rag"
    else:
        agent = await classify(state, config)
    # ...
    emit("meta", agent=agent, cost=CREDIT_COST[agent])
    return {"agent": agent}
```

An agent the user picked explicitly always wins. An uploaded image goes to Vision and an uploaded PDF goes to Document Q&A. Uploads are identified by magic bytes, so the "is this an image" check reads the file's contents and ignores its filename and `Content-Type`. Only a plain text message in Auto mode reaches the classifier.

After choosing, the router validates the choice. Picking Vision without an image, or Document Q&A in a conversation with no documents, ends the turn with an `error` event (status 400) and a message telling the user what to attach. Then it emits a `meta` event, so the UI can show which agent was picked and what it costs before any answer arrives.

## Classifying with an enum

The classifier's output type is a Pydantic model whose only field is a `Literal`:

```python
AgentName = Literal["chat", "search", "coding", "pdf", "ppt", "image", "rag"]


class Route(BaseModel):
    agent: AgentName = Field(description="The single best agent for the request")
```

I left `vision` out of that list on purpose: it's only reachable with an image attached, and that case never gets to the classifier. With structured output, the model can only return one of these names, so there's no parsing step to drift away from the list of agents the way the prototype's did.

The classifier itself, from the same file:

```python
try:
    model = deps.models.raw(deps.settings.router_model, temperature=0, max_tokens=1024)
    result = await model.with_structured_output(Route).ainvoke(
        [
            SystemMessage(ROUTER_PROMPT.format(rag_line=rag_line)),
            HumanMessage(state["prompt"][:2000]),
        ]
    )
    agent = result.agent if isinstance(result, Route) else "chat"
except Exception:  # classification is best effort
    log.warning("router classification failed; defaulting to chat", exc_info=True)
    return "chat"
if agent == "rag" and not docs:
    return "chat"
return agent
```

Some details in that code:

- The router model defaults to `groq:openai/gpt-oss-20b`, a small, fast model. For `gpt-oss` models the model factory in `agent/app/llm.py` sets `reasoning_effort` to `"low"`, because hidden reasoning tokens count toward `max_tokens`.
- `raw()` returns the model without the fallback chain the other agents get. Its docstring reserves it for features the fallback can't do, such as structured output.
- The `rag` line in the prompt only appears when the conversation has documents, and it names up to the last five of them. Without documents, the classifier isn't even told RAG exists, and a `rag` answer is downgraded to `chat` anyway.
- Any failure (a timeout, invalid JSON, a provider error) sends the message to `chat`. The prompt tells the model the same: `Pick "chat" when unsure.`

The guard has to run after the router, because the price depends on the agent. It still runs before any agent node, so rate limits are checked and credits are reserved before any expensive call. I wrote about the credit side in [Billing that can't double-charge](/writing/billing-cant-double-charge).

## Streaming the answer

As they work, agent nodes push UI events through LangGraph's `custom` stream mode, and those events are what the API forwards to the browser. From `agent/app/graph/context.py`:

```python
def emit(event: str, **data: Any) -> None:
    get_stream_writer()({"event": event, "data": data})
```

The API layer in `agent/app/api/chat.py` runs the graph with two stream modes at once. `custom` events become Server-Sent Events immediately, and the last `values` chunk is the final state that gets saved:

```python
async for mode, chunk in graph.astream(state, config, stream_mode=["custom", "values"]):
    if mode == "custom":
        yield sse(chunk["event"], chunk["data"])
    else:
        final = chunk
```

The event types are `meta`, `status`, `token`, `sources`, `artifact`, `attachment`, `done` and `error`. Validation and ownership errors return as normal HTTP errors before the stream starts. Anything that fails later has to be an `error` event, because the 200 status has already been sent.

I chose SSE over WebSockets because the stream is one-way and it's plain HTTP. It passes through Caddy and the Go gateway unchanged, as long as neither buffers it: Caddy has `flush_interval -1`, and the gateway's reverse proxy to the agent uses `FlushInterval: -1`. In the browser, `EventSource` only supports GET, and a chat turn can carry a file upload, so `frontend/src/features/agent.api.js` uses `fetch` with a streaming body reader and splits the `event:` and `data:` frames itself.

## The coding agent's two modes

The coding agent shows why the event types are useful. It either builds a project, as `FILE: <name>` blocks, or answers in Markdown, and it decides which from the first five characters of the output. In project mode, raw file text stays out of the chat bubble: the agent sends a `status` event per file ("Writing index.html") and, once done, one `artifact` event with all the files for the side panel.

![CortexAI chat routed to the coding agent, with the generated project open in the code panel](/img/cortexai.jpg)

The preview runs in an `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so generated JavaScript can't reach the app's origin, cookies or storage.

## Testing routing without an API key

`agent/tests/test_api.py` runs the real graph end to end with a fake LLM and in-memory stand-ins for the Go services. The fake model's `with_structured_output` returns a fixed object, or raises a fixed exception. Two tests cover the router directly:

- `test_auto_routing_uses_classifier` makes the classifier return `Route(agent="coding")` and the model return two `FILE:` blocks. It checks that the first event names `coding`, the artifact has `index.html` and `style.css`, a "Writing index.html" status was sent, and no `<h1>` leaked into the streamed tokens.
- `test_router_failure_falls_back_to_chat` makes structured output raise, and checks that the turn still completes with `chat`.

Other tests in the file check that Document Q&A without documents is rejected, and that a failing agent refunds the reservation.

What the tests can't tell me is how often the classifier picks the right agent on real prompts. The next step in my design notes is a labelled prompt set to measure router accuracy. Until that exists, the structure guarantees that every choice is valid and safe, but nothing yet tells me whether it's correct.
