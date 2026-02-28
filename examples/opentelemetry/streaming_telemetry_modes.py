# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

"""Demonstrates the four StreamingTelemetryMode options for OpenTelemetryBridge.

Runs a simple async streaming action under each mode with the OTel console
exporter so you can see the spans and events printed to stdout.

Usage:
    python examples/opentelemetry/streaming_telemetry_modes.py

No external APIs are needed — the streaming action simulates an LLM by yielding
tokens with small delays.
"""

import asyncio

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor

from burr.core import ApplicationBuilder, State
from burr.core.action import streaming_action
from burr.core.graph import GraphBuilder
from burr.integrations.opentelemetry import OpenTelemetryBridge, StreamingTelemetryMode

# ---------------------------------------------------------------------------
# A simple streaming action that simulates token-by-token LLM output
# ---------------------------------------------------------------------------


@streaming_action(reads=["prompt"], writes=["response"])
async def generate_response(state: State) -> None:
    """Simulates a streaming LLM response, yielding one token at a time."""
    tokens = state["prompt"].split()
    buffer = []
    for token in tokens:
        await asyncio.sleep(0.02)  # simulate generation latency per token
        buffer.append(token)
        yield {"token": token}, None

    response = " ".join(buffer)
    yield {"token": "", "response": response}, state.update(response=response)


# ---------------------------------------------------------------------------
# Build the graph (shared across all modes)
# ---------------------------------------------------------------------------

graph = GraphBuilder().with_actions(generate=generate_response).with_transitions().build()


# ---------------------------------------------------------------------------
# Run one mode
# ---------------------------------------------------------------------------


async def run_with_mode(mode: StreamingTelemetryMode) -> None:
    """Builds an app with the given streaming telemetry mode and runs it."""
    # Each run gets its own tracer provider so console output stays grouped
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    tracer = provider.get_tracer("streaming-telemetry-demo")

    bridge = OpenTelemetryBridge(tracer=tracer, streaming_telemetry=mode)

    app = (
        ApplicationBuilder()
        .with_graph(graph)
        .with_entrypoint("generate")
        .with_state(State({"prompt": "hello world from burr streaming"}))
        .with_hooks(bridge)
        .with_identifiers(app_id=f"demo-{mode.value}")
        .build()
    )

    action, container = await app.astream_result(halt_after=["generate"])
    async for item in container:
        await asyncio.sleep(0.05)  # simulate consumer processing time per token
    await container.get()

    provider.shutdown()


# ---------------------------------------------------------------------------
# Main — run all four modes
# ---------------------------------------------------------------------------


async def main():
    modes = [
        StreamingTelemetryMode.SINGLE_SPAN,
        StreamingTelemetryMode.EVENT,
        StreamingTelemetryMode.CHUNK_SPANS,
        StreamingTelemetryMode.SINGLE_AND_CHUNK_SPANS,
    ]
    for mode in modes:
        print(f"\n{'=' * 70}")
        print(f"  StreamingTelemetryMode.{mode.name}")
        print(f"{'=' * 70}\n")
        await run_with_mode(mode)
        print()


if __name__ == "__main__":
    asyncio.run(main())
