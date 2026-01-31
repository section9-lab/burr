<!--
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
-->

# Apache Burr Design Patterns & Best Practices

Architectural guidance and best practices for building production-ready Burr applications.

## Core Design Principles

### 1. Single Responsibility Actions

Each action should do one thing well.

**❌ Bad - Action does too much:**
```python
@action(reads=["query"], writes=["response", "documents", "reranked", "formatted"])
def do_everything(state: State) -> State:
    # Retrieves, reranks, generates, and formats all in one
    docs = retrieve(state["query"])
    reranked = rerank(docs)
    response = generate(reranked)
    formatted = format(response)
    return state.update(
        documents=docs,
        reranked=reranked,
        response=response,
        formatted=formatted
    )
```

**✅ Good - Focused actions:**
```python
@action(reads=["query"], writes=["documents"])
def retrieve_documents(state: State) -> State:
    docs = retrieve(state["query"])
    return state.update(documents=docs)

@action(reads=["documents"], writes=["reranked"])
def rerank_documents(state: State) -> State:
    reranked = rerank(state["documents"])
    return state.update(reranked=reranked)

# ... separate actions for generate and format
```

**Benefits:**
- Easier to test
- Easier to debug (can see which action failed)
- Reusable components
- Clear visualization in the Burr UI

### 2. Accurate reads/writes Declarations

Declare exactly what each action reads and writes.

**❌ Bad:**
```python
@action(reads=[], writes=[])  # Inaccurate!
def process_user(state: State) -> State:
    user_id = state["user_id"]  # Actually reads user_id
    profile = fetch_profile(user_id)
    return state.update(profile=profile)  # Actually writes profile
```

**✅ Good:**
```python
@action(reads=["user_id"], writes=["profile"])
def process_user(state: State) -> State:
    user_id = state["user_id"]
    profile = fetch_profile(user_id)
    return state.update(profile=profile)
```

**Benefits:**
- Self-documenting code
- Better debugging in UI
- Enables future optimizations
- Catches errors early

### 3. State Immutability

Never mutate state directly - always use `.update()` or `.append()`.

**❌ Bad:**
```python
@action(reads=["items"], writes=["items"])
def add_item(state: State, item: str) -> State:
    items = state["items"]
    items.append(item)  # Mutates state!
    return state
```

**✅ Good:**
```python
@action(reads=["items"], writes=["items"])
def add_item(state: State, item: str) -> State:
    return state.append(items=item)
```

**Benefits:**
- Time-travel debugging
- State history for replay
- Prevents subtle bugs
- Enables state persistence

### 4. Deterministic Actions

Given the same state and inputs, an action should always produce the same output.

**❌ Bad - Non-deterministic:**
```python
@action(reads=["data"], writes=["result"])
def process_data(state: State) -> State:
    # Random behavior makes debugging impossible
    if random.random() > 0.5:
        result = transform_a(state["data"])
    else:
        result = transform_b(state["data"])
    return state.update(result=result)
```

**✅ Good - Deterministic:**
```python
@action(reads=["data", "strategy"], writes=["result"])
def process_data(state: State) -> State:
    # Behavior controlled by state
    if state["strategy"] == "a":
        result = transform_a(state["data"])
    else:
        result = transform_b(state["data"])
    return state.update(result=result)
```

**Benefits:**
- Reproducible debugging
- Testable code
- Predictable behavior
- Easier to reason about

## Common Patterns

### Pattern: Request-Response Cycle

For chatbots and conversational AI.

```python
@action(reads=[], writes=["messages", "current_prompt"])
def receive_message(state: State, prompt: str) -> State:
    """Accept user input."""
    message = {"role": "user", "content": prompt}
    return (
        state.append(messages=message)
        .update(current_prompt=prompt)
    )

@action(reads=["messages"], writes=["messages", "response"])
def generate_response(state: State) -> State:
    """Generate AI response."""
    response = llm_call(state["messages"])
    message = {"role": "assistant", "content": response}
    return (
        state.append(messages=message)
        .update(response=response)
    )

@action(reads=["response"], writes=["display"])
def format_output(state: State) -> State:
    """Format for display."""
    return state.update(display=format_markdown(state["response"]))

app = (
    ApplicationBuilder()
    .with_actions(receive_message, generate_response, format_output)
    .with_transitions(
        ("receive_message", "generate_response"),
        ("generate_response", "format_output"),
        ("format_output", "receive_message")  # Loop back for next message
    )
    .with_state(messages=[])
    .with_entrypoint("receive_message")
    .build()
)
```

### Pattern: Error Recovery with Retries

Handle transient failures gracefully.

```python
@action(reads=["url", "retry_count"], writes=["data", "error", "retry_count"])
def fetch_with_retry(state: State) -> State:
    """Fetch data with retry logic."""
    try:
        data = http_get(state["url"])
        return state.update(data=data, error=None)
    except Exception as e:
        retry_count = state.get("retry_count", 0) + 1
        return state.update(
            error=str(e),
            retry_count=retry_count
        )

@action(reads=["data"], writes=["processed"])
def process_success(state: State) -> State:
    """Process successful fetch."""
    return state.update(processed=transform(state["data"]))

@action(reads=["error", "retry_count"], writes=["final_error"])
def handle_failure(state: State) -> State:
    """Handle permanent failure."""
    return state.update(
        final_error=f"Failed after {state['retry_count']} retries: {state['error']}"
    )

app = (
    ApplicationBuilder()
    .with_actions(fetch_with_retry, process_success, handle_failure)
    .with_transitions(
        # Success path
        ("fetch_with_retry", "process_success", when(error=None)),
        # Retry path
        ("fetch_with_retry", "fetch_with_retry",
         expr("error is not None and retry_count < 3")),
        # Failure path
        ("fetch_with_retry", "handle_failure", default)
    )
    .with_state(url="https://api.example.com", retry_count=0)
    .with_entrypoint("fetch_with_retry")
    .build()
)
```

### Pattern: Multi-Stage Pipeline

Sequential data processing pipeline.

```python
@action(reads=["raw_data"], writes=["validated_data"])
def validate(state: State) -> State:
    """Validate input data."""
    validated = validate_schema(state["raw_data"])
    return state.update(validated_data=validated)

@action(reads=["validated_data"], writes=["transformed_data"])
def transform(state: State) -> State:
    """Transform data."""
    transformed = apply_transformations(state["validated_data"])
    return state.update(transformed_data=transformed)

@action(reads=["transformed_data"], writes=["enriched_data"])
def enrich(state: State) -> State:
    """Enrich with external data."""
    enriched = add_external_data(state["transformed_data"])
    return state.update(enriched_data=enriched)

@action(reads=["enriched_data"], writes=["result"])
def finalize(state: State) -> State:
    """Finalize output."""
    result = create_output(state["enriched_data"])
    return state.update(result=result)

# Simple linear pipeline
app = (
    ApplicationBuilder()
    .with_actions(validate, transform, enrich, finalize)
    .with_transitions(
        ("validate", "transform"),
        ("transform", "enrich"),
        ("enrich", "finalize")
    )
    .with_entrypoint("validate")
    .build()
)
```

### Pattern: Branching Decision Tree

Route based on complex conditions.

```python
@action(reads=["content"], writes=["analysis"])
def analyze_content(state: State) -> State:
    """Analyze content type and complexity."""
    analysis = {
        "content_type": detect_type(state["content"]),
        "complexity": calculate_complexity(state["content"]),
        "language": detect_language(state["content"])
    }
    return state.update(analysis=analysis)

@action(reads=["content"], writes=["result"])
def handle_simple_text(state: State) -> State:
    return state.update(result=simple_processor(state["content"]))

@action(reads=["content"], writes=["result"])
def handle_complex_text(state: State) -> State:
    return state.update(result=complex_processor(state["content"]))

@action(reads=["content"], writes=["result"])
def handle_code(state: State) -> State:
    return state.update(result=code_processor(state["content"]))

@action(reads=["content"], writes=["result"])
def handle_unsupported(state: State) -> State:
    return state.update(result={"error": "Unsupported content type"})

app = (
    ApplicationBuilder()
    .with_actions(
        analyze_content,
        handle_simple_text,
        handle_complex_text,
        handle_code,
        handle_unsupported
    )
    .with_transitions(
        ("analyze_content", "handle_simple_text",
         expr("analysis['content_type'] == 'text' and analysis['complexity'] < 5")),
        ("analyze_content", "handle_complex_text",
         expr("analysis['content_type'] == 'text' and analysis['complexity'] >= 5")),
        ("analyze_content", "handle_code",
         when(analysis={"content_type": "code"})),
        ("analyze_content", "handle_unsupported", default)
    )
    .with_entrypoint("analyze_content")
    .build()
)
```

### Pattern: Aggregating Parallel Results

Run multiple analyses in parallel and combine.

```python
from burr.core import graph

@action(reads=["document"], writes=["summary"])
async def summarize(state: State) -> State:
    summary = await llm_summarize(state["document"])
    return state.update(summary=summary)

@action(reads=["document"], writes=["sentiment"])
async def analyze_sentiment(state: State) -> State:
    sentiment = await get_sentiment(state["document"])
    return state.update(sentiment=sentiment)

@action(reads=["document"], writes=["topics"])
async def extract_topics(state: State) -> State:
    topics = await get_topics(state["document"])
    return state.update(topics=topics)

@action(reads=["summary", "sentiment", "topics"], writes=["report"])
def create_report(state: State) -> State:
    """Aggregate all analyses into final report."""
    report = {
        "summary": state["summary"],
        "sentiment": state["sentiment"],
        "topics": state["topics"],
        "timestamp": datetime.now()
    }
    return state.update(report=report)

g = (
    graph.GraphBuilder()
    .with_actions(summarize, analyze_sentiment, extract_topics, create_report)
    .with_transitions(
        # Parallel execution
        ("start", "summarize"),
        ("start", "analyze_sentiment"),
        ("start", "extract_topics"),
        # Wait for all, then aggregate
        (["summarize", "analyze_sentiment", "extract_topics"], "create_report")
    )
    .build()
)
```

### Pattern: State Machine with Memory

Maintain conversation context and history.

```python
@action(reads=["history"], writes=["history", "current_query"])
def add_to_history(state: State, query: str) -> State:
    """Add query to history with metadata."""
    history_item = {
        "query": query,
        "timestamp": datetime.now(),
        "session_id": state.get("session_id")
    }
    return (
        state.append(history=history_item)
        .update(current_query=query)
    )

@action(reads=["history", "current_query"], writes=["response"])
def generate_with_context(state: State) -> State:
    """Generate response using conversation history."""
    # Build context from history
    context = build_context_from_history(state["history"])

    # Generate with full context
    response = llm_call_with_context(
        query=state["current_query"],
        context=context
    )
    return state.update(response=response)

@action(reads=["history"], writes=["should_summarize"])
def check_history_length(state: State) -> State:
    """Check if history needs summarization."""
    should_summarize = len(state["history"]) > 10
    return state.update(should_summarize=should_summarize)

@action(reads=["history"], writes=["history", "summary"])
def summarize_history(state: State) -> State:
    """Compress old history."""
    summary = create_summary(state["history"][:-5])
    recent = state["history"][-5:]
    return state.update(
        history=recent,
        summary=summary
    )
```

## Best Practices

### Testing Strategy

**Unit test individual actions:**
```python
def test_action():
    state = State({"input": "test"})
    result = my_action(state)
    assert result["output"] == "expected"
```

**Integration test the state machine:**
```python
def test_full_flow():
    app = build_app()
    _, _, final_state = app.run(halt_after=["end"])
    assert final_state["result"] == expected_value
```

**Test with mock state:**
```python
def test_with_fixtures():
    state = State({
        "user": {"id": 123, "name": "Test"},
        "settings": {"mode": "test"}
    })
    result = complex_action(state)
    assert result["processed"] is True
```

### Observability

**Always enable tracking during development:**
```python
app = (
    ApplicationBuilder()
    .with_actions(...)
    .with_tracker("local", project="my_app")
    .build()
)
```

**Use the Burr UI to:**
- Visualize state machine execution
- Inspect state at each step
- Debug transition logic
- Profile action performance

**Add custom hooks for production:**
```python
from burr.lifecycle import LifecycleAdapter

class MetricsHook(LifecycleAdapter):
    def post_run_step(self, action, result, state, **kwargs):
        # Log metrics to your monitoring system
        log_metric(f"action.{action.name}.duration", kwargs["duration"])
        log_metric(f"action.{action.name}.success", 1)
```

### State Management

**Keep state flat when possible:**
```python
# ✅ Good
state = State({
    "user_id": 123,
    "user_name": "Alice",
    "user_email": "alice@example.com"
})

# ❌ Avoid deep nesting (harder to track)
state = State({
    "user": {
        "profile": {
            "personal": {
                "name": "Alice"
            }
        }
    }
})
```

**Use meaningful key names:**
```python
# ✅ Good
state.update(validated_user_email="alice@example.com")

# ❌ Bad
state.update(ve="alice@example.com")
```

### Performance Optimization

**Use parallel execution for independent operations:**
```python
# Operations that don't depend on each other
("start", ["fetch_user", "fetch_products", "fetch_orders"])
```

**Keep actions lightweight:**
```python
# ❌ Bad - Heavy computation in action
@action(reads=["data"], writes=["result"])
def process(state: State) -> State:
    # Hours of computation
    result = train_ml_model(state["data"])
    return state.update(result=result)

# ✅ Better - Break into steps with state persistence
@action(reads=["data"], writes=["preprocessed"])
def preprocess(state: State) -> State:
    return state.update(preprocessed=preprocess_data(state["data"]))

@action(reads=["preprocessed"], writes=["checkpoint"])
def train_epoch(state: State) -> State:
    # Train one epoch, save checkpoint
    checkpoint = train_one_epoch(state["preprocessed"])
    return state.update(checkpoint=checkpoint)
```

### Production Deployment

**Enable persistence for long-running workflows:**
```python
from burr.core.persistence import SQLLitePersister

persister = SQLLitePersister("prod.db", "workflows")
app = (
    ApplicationBuilder()
    .with_actions(...)
    .with_state_persister(persister)
    .initialize_from(persister, resume_at_next_action=True)
    .build()
)
```

**Use unique identifiers:**
```python
app = (
    ApplicationBuilder()
    .with_identifiers(
        app_id=f"workflow-{workflow_id}",
        partition_key=f"user-{user_id}"
    )
    .build()
)
```

**Add error boundaries:**
```python
@action(reads=["data"], writes=["result", "error"])
def safe_operation(state: State) -> State:
    try:
        result = risky_operation(state["data"])
        return state.update(result=result, error=None)
    except Exception as e:
        logger.error(f"Operation failed: {e}")
        return state.update(result=None, error=str(e))
```

## Anti-Patterns to Avoid

### ❌ Shared Mutable State

```python
# Don't do this!
cache = {}

@action(reads=["key"], writes=["value"])
def get_cached(state: State) -> State:
    # Mutates external state - not reproducible!
    if state["key"] not in cache:
        cache[state["key"]] = expensive_call()
    return state.update(value=cache[state["key"]])
```

### ❌ Side Effects Without State Tracking

```python
# Don't do this!
@action(reads=["data"], writes=["saved"])
def save_to_db(state: State) -> State:
    # Side effect not tracked in state
    db.save(state["data"])
    return state.update(saved=True)

# Better: Track what was saved
@action(reads=["data"], writes=["saved", "saved_id"])
def save_to_db(state: State) -> State:
    saved_id = db.save(state["data"])
    return state.update(saved=True, saved_id=saved_id)
```

### ❌ God Actions

```python
# Don't do this!
@action(reads=["everything"], writes=["everything"])
def do_all_the_things(state: State) -> State:
    # 500 lines of code doing multiple things
    pass
```

### ❌ Missing Error Handling

```python
# Don't do this!
@action(reads=["url"], writes=["data"])
def fetch(state: State) -> State:
    # No error handling - will crash the app
    data = requests.get(state["url"]).json()
    return state.update(data=data)
```

## Summary

- **Keep actions small and focused**
- **Declare reads/writes accurately**
- **Never mutate state**
- **Make actions deterministic**
- **Use tracking and visualization**
- **Test actions independently**
- **Enable persistence for long workflows**
- **Handle errors gracefully**
- **Leverage parallel execution**
- **Monitor with hooks in production**
