# Remote Execution with Ray

This example demonstrates how to use Burr's **Action Execution Interceptors** to run specific actions on Ray workers while keeping orchestration on the main process.

## Overview

Burr's lifecycle hook system includes **interceptors** that can wrap action execution and redirect it to different execution backends like Ray, Temporal, or custom distributed systems.

This example shows:
- ✅ Selective interception (only actions tagged with `ray` run remotely)
- ✅ Orchestrator hooks (run on main process)
- ✅ Worker hooks (run on Ray workers)
- ✅ Seamless mixing of local and remote execution
- ✅ State management across distributed execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (Orchestrator)                                 │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │  Burr Application                             │            │
│  │                                               │            │
│  │  PreRunStepHook (Orchestrator) ────┐         │            │
│  │                                     ↓         │            │
│  │  RayActionInterceptor               │         │            │
│  │    - should_intercept()             │         │            │
│  │    - intercept_run() ───────────────┼─────────┼─────┐     │
│  │                                     │         │      │     │
│  │  PostRunStepHook (Orchestrator) ←──┘         │      │     │
│  └──────────────────────────────────────────────┘      │     │
└────────────────────────────────────────────────────────┼─────┘
                                                          │
                                         Ray Remote Call  │
                                                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Ray Worker                                                  │
│                                                              │
│  PreRunStepHookWorker  ────┐                                │
│                            ↓                                │
│  Action.run_and_update()  (actual execution)                │
│                            │                                │
│  PostRunStepHookWorker ←───┘                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### 1. Two-Tier Hook System

**Orchestrator Hooks** (run on main process):
- `PreRunStepHook` - runs before any action (local or remote)
- `PostRunStepHook` - runs after any action completes
- These hooks see all actions but don't know about execution details

**Worker Hooks** (run on Ray workers):
- `PreRunStepHookWorker` - runs on the worker before execution
- `PostRunStepHookWorker` - runs on the worker after execution
- Only called for intercepted actions
- Must be serializable (picklable)

### 2. Action Execution Interceptor

The interceptor has two methods:

```python
def should_intercept(self, *, action: Action, **kwargs) -> bool:
    """Decide if this action should be intercepted"""
    return "ray" in action.tags

def intercept_run(self, *, action: Action, state: State, inputs: Dict[str, Any], **kwargs) -> dict:
    """Execute the action on Ray and return the result"""
    # Get worker hooks to pass to Ray worker
    worker_adapter_set = kwargs.get("worker_adapter_set")

    # Execute on Ray with worker hooks
    @ray.remote
    def execute_on_ray():
        # Call worker hooks
        # Execute action
        # Return result

    return ray.get(execute_on_ray.remote())
```

### 3. Selective Execution

Actions are tagged to control where they run:

```python
@action(reads=["count"], writes=["count"], tags=["local"])
def local_task(state: State):
    # Runs on main process
    ...

@action(reads=["count"], writes=["count"], tags=["ray"])
def remote_task(state: State):
    # Runs on Ray worker
    ...
```

## Installation

```bash
pip install -r requirements.txt
```

## Running the Example

### Python Script

```bash
python application.py
```

Expected output:
```
================================================================================
Burr + Ray Remote Execution Example
================================================================================

[Main Process] Initializing Ray...

================================================================================
Step 1: Local execution (increment_local)
================================================================================
[Main Process] About to execute action: increment_local
[Main Process] Finished executing action: increment_local
Result: count=1, operation=increment_local

================================================================================
Step 2: Ray execution (heavy_computation)
================================================================================
[Main Process] About to execute action: heavy_computation
[Main Process] Dispatching heavy_computation to Ray...
[Ray Worker] Starting action: heavy_computation on Ray worker
[Ray Worker] Running heavy computation with multiplier=3
[Ray Worker] Completed action: heavy_computation on Ray worker
[Main Process] Received result from Ray for heavy_computation
[Main Process] Finished executing action: heavy_computation
Result: count=3, operation=heavy_computation(x3)

...
```

### Jupyter Notebook

```bash
jupyter notebook notebook.ipynb
```

## Use Cases

This pattern is useful for:

1. **Compute-Intensive Operations**: Offload heavy computations to Ray clusters
2. **GPU Workloads**: Run ML inference/training on GPU workers
3. **Scalability**: Distribute work across multiple machines
4. **Resource Isolation**: Keep heavy operations away from orchestrator
5. **Hybrid Workflows**: Mix local control flow with distributed execution

## Extending to Other Backends

The same pattern works for other execution backends:

### Temporal

```python
class TemporalActionInterceptor(ActionExecutionInterceptorHook):
    def should_intercept(self, *, action, **kwargs):
        return "temporal" in action.tags

    def intercept_run(self, *, action, state, inputs, **kwargs):
        # Execute as Temporal activity
        return await workflow.execute_activity(
            action.run_and_update,
            state,
            **inputs
        )
```

### Custom Distributed System

```python
class CustomBackendInterceptor(ActionExecutionInterceptorHook):
    def should_intercept(self, *, action, **kwargs):
        return "distributed" in action.tags

    def intercept_run(self, *, action, state, inputs, **kwargs):
        # Submit to your custom backend
        job_id = backend.submit_job(action, state, inputs)
        result = backend.wait_for_completion(job_id)
        return result
```

## Important Notes

1. **State Serialization**: State must be serializable to pass to workers
2. **Worker Hooks**: Must be picklable (avoid closures with local variables)
3. **Error Handling**: Exceptions on workers propagate back to orchestrator
4. **Performance**: Ray overhead ~100ms per task; use for tasks >1s

## Related Documentation

- [Burr Lifecycle Hooks](https://burr.dagworks.io/concepts/hooks/)
- [Ray Core API](https://docs.ray.io/en/latest/ray-core/walkthrough.html)
- [Temporal Workflows](https://docs.temporal.io/)
