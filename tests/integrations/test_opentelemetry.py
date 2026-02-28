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

import asyncio
import datetime
import threading
import time
import typing
from typing import Sequence
from unittest.mock import MagicMock

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult

import burr.integrations.opentelemetry as burr_otel
from burr.core.action import SingleStepAction, SingleStepStreamingAction
from burr.core.application import Application, _arun_single_step_streaming_action
from burr.core.graph import Graph
from burr.core.state import State
from burr.integrations.opentelemetry import OpenTelemetryBridge
from burr.integrations.opentelemetry import StreamingTelemetryMode as STM
from burr.integrations.opentelemetry import (
    _exit_span,
    _skipped_action_span,
    _streaming_accumulator,
    token_stack,
)
from burr.lifecycle.internal import LifecycleAdapterSet

# ============================================================================
# Simple in-memory exporter (not available in all otel SDK versions)
# ============================================================================


class _InMemorySpanExporter(SpanExporter):
    """Collects finished spans in memory for test assertions."""

    def __init__(self):
        self._spans = []
        self._lock = threading.Lock()

    def export(self, spans: Sequence) -> SpanExportResult:
        with self._lock:
            self._spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass

    def get_finished_spans(self):
        with self._lock:
            return list(self._spans)

    def clear(self):
        with self._lock:
            self._spans.clear()


def test_instrument_specs_match_instruments_literal():
    assert set(typing.get_args(burr_otel.INSTRUMENTS)) == set(burr_otel.INSTRUMENTS_SPECS.keys())


# ============================================================================
# Helpers
# ============================================================================


def _make_bridge_and_exporter(streaming_telemetry: STM = STM.SINGLE_SPAN):
    """Creates an OpenTelemetryBridge with an in-memory exporter for test assertions."""
    exporter = _InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")
    bridge = OpenTelemetryBridge(tracer=tracer, streaming_telemetry=streaming_telemetry)
    return bridge, exporter


def _make_mock_action(name: str, streaming: bool = False):
    """Creates a mock Action object with the given name and streaming flag."""
    action = MagicMock()
    action.name = name
    action.streaming = streaming
    return action


def _reset_token_stack():
    """Reset the token_stack and streaming ContextVars to clean state."""
    token_stack.set(None)
    _skipped_action_span.set(False)
    _streaming_accumulator.set(None)


# ============================================================================
# Test #9: pre_stream_generate enters a span
# ============================================================================


def test_bridge_pre_stream_generate_enters_span():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    bridge.pre_stream_generate(
        action="my_action",
        item_index=0,
        stream_initialize_time=datetime.datetime.now(),
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )

    stack = token_stack.get()
    assert stack is not None
    assert len(stack) == 1
    _, span = stack[0]
    assert span.name == "my_action::chunk_0"

    # Clean up
    _exit_span()
    _reset_token_stack()


# ============================================================================
# Test #10: post_stream_generate exits a span
# ============================================================================


def test_bridge_post_stream_generate_exits_span():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    bridge.pre_stream_generate(
        action="my_action",
        item_index=0,
        stream_initialize_time=datetime.datetime.now(),
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    assert len(token_stack.get()) == 1

    bridge.post_stream_generate(
        item={"chunk": "data"},
        item_index=0,
        stream_initialize_time=datetime.datetime.now(),
        action="my_action",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )

    stack = token_stack.get()
    assert len(stack) == 0

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "my_action::chunk_0"
    assert spans[0].status.status_code == trace.StatusCode.OK

    _reset_token_stack()


# ============================================================================
# Test #12: span naming for multiple chunks
# ============================================================================


def test_bridge_stream_span_naming():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    now = datetime.datetime.now()
    for i in range(3):
        bridge.pre_stream_generate(
            action="my_action",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_action",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    spans = exporter.get_finished_spans()
    assert [s.name for s in spans] == [
        "my_action::chunk_0",
        "my_action::chunk_1",
        "my_action::chunk_2",
    ]
    _reset_token_stack()


# ============================================================================
# Test #14: span closed on generator error
# ============================================================================


def test_bridge_stream_span_closed_on_generator_error():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    now = datetime.datetime.now()
    exc = RuntimeError("generator failed")

    bridge.pre_stream_generate(
        action="my_action",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item=None,
        item_index=0,
        stream_initialize_time=now,
        action="my_action",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=exc,
    )

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code == trace.StatusCode.ERROR
    assert "generator failed" in spans[0].status.description

    stack = token_stack.get()
    assert len(stack) == 0
    _reset_token_stack()


# ============================================================================
# Test #21: pre_run_step skips span for streaming action
# ============================================================================


def test_bridge_pre_run_step_skips_span_for_streaming_action():
    _reset_token_stack()
    bridge, _ = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)
    action = _make_mock_action("stream_action", streaming=True)

    bridge.pre_run_step(action=action)

    assert _skipped_action_span.get() is True
    stack = token_stack.get()
    assert stack is None or len(stack) == 0

    _reset_token_stack()


# ============================================================================
# Test #22: pre_run_step creates span for non-streaming action
# ============================================================================


def test_bridge_pre_run_step_creates_span_for_non_streaming_action():
    _reset_token_stack()
    bridge, _ = _make_bridge_and_exporter()
    action = _make_mock_action("normal_action", streaming=False)

    bridge.pre_run_step(action=action)

    assert _skipped_action_span.get() is False
    stack = token_stack.get()
    assert stack is not None
    assert len(stack) == 1
    _, span = stack[0]
    assert span.name == "normal_action"

    # Clean up
    _exit_span()
    _reset_token_stack()


# ============================================================================
# Test #23: post_run_step skips exit when action span was skipped
# ============================================================================


def test_bridge_post_run_step_skips_exit_when_action_span_was_skipped():
    _reset_token_stack()
    bridge, _ = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    # Simulate streaming action: pre_run_step skipped the span
    _skipped_action_span.set(True)

    # post_run_step should not pop anything (nothing was pushed)
    bridge.post_run_step(exception=None)

    assert _skipped_action_span.get() is False
    stack = token_stack.get()
    assert stack is None or len(stack) == 0

    _reset_token_stack()


# ============================================================================
# Test #24: post_run_step exits span for non-streaming action
# ============================================================================


def test_bridge_post_run_step_exits_span_for_non_streaming_action():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter()
    action = _make_mock_action("normal_action", streaming=False)

    bridge.pre_run_step(action=action)
    bridge.post_run_step(exception=None)

    stack = token_stack.get()
    assert len(stack) == 0

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "normal_action"
    assert spans[0].status.status_code == trace.StatusCode.OK

    _reset_token_stack()


# ============================================================================
# Test #25: streaming hierarchy has no action span — chunks are children of method span
# ============================================================================


def test_bridge_streaming_span_hierarchy_no_action_span():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    # Simulate full streaming hook sequence
    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    for i in range(3):
        bridge.pre_stream_generate(
            action="my_stream",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_stream",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have 4 spans: 3 chunks + 1 method. No "my_stream" action span.
    assert "my_stream" not in span_names
    assert "my_stream::chunk_0" in span_names
    assert "my_stream::chunk_1" in span_names
    assert "my_stream::chunk_2" in span_names
    assert "stream_result" in span_names
    assert len(spans) == 4

    # Chunk spans should be children of the stream_result method span
    method_span = next(s for s in spans if s.name == "stream_result")
    for s in spans:
        if s.name.startswith("my_stream::chunk_"):
            assert s.parent is not None
            assert s.parent.span_id == method_span.context.span_id

    _reset_token_stack()


# ============================================================================
# Test #26: non-streaming then streaming — no state leak
# ============================================================================


def test_bridge_non_streaming_then_streaming_no_state_leak():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)
    now = datetime.datetime.now()

    # First: non-streaming action
    normal_action = _make_mock_action("normal", streaming=False)
    bridge.pre_run_step(action=normal_action)
    bridge.post_run_step(exception=None)
    assert _skipped_action_span.get() is False

    # Second: streaming action
    stream_action = _make_mock_action("streamer", streaming=True)
    bridge.pre_run_step(action=stream_action)
    assert _skipped_action_span.get() is True

    bridge.pre_stream_generate(
        action="streamer",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item={"x": 1},
        item_index=0,
        stream_initialize_time=now,
        action="streamer",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )
    bridge.post_run_step(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]
    # Should have: "normal" action span + "streamer::chunk_0" chunk span
    assert "normal" in span_names
    assert "streamer::chunk_0" in span_names
    assert "streamer" not in span_names  # no action-level span for streaming

    _reset_token_stack()


# ============================================================================
# Test #27: streaming then non-streaming — no state leak
# ============================================================================


def test_bridge_streaming_then_non_streaming_no_state_leak():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)
    now = datetime.datetime.now()

    # First: streaming action
    stream_action = _make_mock_action("streamer", streaming=True)
    bridge.pre_run_step(action=stream_action)
    bridge.pre_stream_generate(
        action="streamer",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item={"x": 1},
        item_index=0,
        stream_initialize_time=now,
        action="streamer",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )
    bridge.post_run_step(exception=None)

    # Second: non-streaming action
    normal_action = _make_mock_action("normal", streaming=False)
    bridge.pre_run_step(action=normal_action)
    assert _skipped_action_span.get() is False
    stack = token_stack.get()
    assert len(stack) == 1
    _, span = stack[0]
    assert span.name == "normal"

    bridge.post_run_step(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]
    assert "streamer::chunk_0" in span_names
    assert "normal" in span_names
    assert "streamer" not in span_names

    _reset_token_stack()


# ============================================================================
# Test #11 (updated): child spans under action span for non-streaming
# ============================================================================


def test_bridge_non_streaming_creates_child_spans_under_action_span():
    """For non-streaming actions, pre/post_start_span creates children of the action span."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter()
    action = _make_mock_action("my_action", streaming=False)

    bridge.pre_run_step(action=action)
    # Simulate a nested span (e.g., from TracerFactory)
    mock_span = MagicMock()
    mock_span.name = "inner_op"
    bridge.pre_start_span(span=mock_span)
    bridge.post_end_span(span=mock_span)
    bridge.post_run_step(exception=None)

    spans = exporter.get_finished_spans()
    assert len(spans) == 2
    action_span = next(s for s in spans if s.name == "my_action")
    inner_span = next(s for s in spans if s.name == "inner_op")
    assert inner_span.parent is not None
    assert inner_span.parent.span_id == action_span.context.span_id

    _reset_token_stack()


# ============================================================================
# Test #13: span timing excludes consumer time
# ============================================================================


async def test_bridge_stream_span_timing_excludes_consumer_time():
    """Verify that chunk spans measure generation time, not consumer processing time."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    class SlowGeneratorAction(SingleStepStreamingAction):
        """Each yield takes ~50ms of 'generation time'."""

        async def stream_run_and_update(self, state, **run_kwargs):
            for i in range(3):
                await asyncio.sleep(0.05)  # simulate generation time
                yield {"i": i}, None
            await asyncio.sleep(0.05)
            yield {"i": 3}, state

        @property
        def reads(self):
            return []

        @property
        def writes(self):
            return []

    action = SlowGeneratorAction().with_name("slow_gen")
    state = State({})

    generator = _arun_single_step_streaming_action(
        action=action,
        state=state,
        inputs={},
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        lifecycle_adapters=LifecycleAdapterSet(bridge),
    )

    # Consumer adds significant delay
    async for item, state_update in generator:
        await asyncio.sleep(0.3)  # simulate slow consumer

    spans = exporter.get_finished_spans()
    chunk_spans = [s for s in spans if "chunk_" in s.name]
    assert len(chunk_spans) >= 3  # at least 3 intermediate + final + stop

    for span in chunk_spans:
        duration_ns = span.end_time - span.start_time
        duration_ms = duration_ns / 1e6
        # Each chunk should take roughly 50ms of generation time,
        # NOT 350ms (50ms generation + 300ms consumer).
        # Use generous tolerance to avoid flakiness.
        assert duration_ms < 200, (
            f"Span {span.name} took {duration_ms:.0f}ms, expected <200ms. "
            f"Consumer time is leaking into the span."
        )

    _reset_token_stack()


# ============================================================================
# Test #15: full integration — astream_result produces per-yield spans
# ============================================================================


async def test_astream_result_with_otel_bridge_produces_per_yield_spans():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)

    class SimpleStreamer(SingleStepStreamingAction):
        async def stream_run_and_update(self, state, **run_kwargs):
            for i in range(5):
                yield {"i": i}, None
            yield {"i": 5}, state.update(done=True)

        @property
        def reads(self):
            return []

        @property
        def writes(self):
            return ["done"]

    streamer = SimpleStreamer().with_name("streamer")
    app = Application(
        state=State({"done": False}),
        entrypoint="streamer",
        adapter_set=LifecycleAdapterSet(bridge),
        partition_key="test",
        uid="test-app",
        graph=Graph(
            actions=[streamer],
            transitions=[],
        ),
    )

    action, container = await app.astream_result(halt_after=["streamer"])
    _ = [item async for item in container]
    result, state = await container.get()

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have: stream_result method span + chunk spans (no action span)
    assert "stream_result" in span_names
    assert "streamer" not in span_names  # no action-level span
    chunk_names = [n for n in span_names if n.startswith("streamer::chunk_")]
    # 5 intermediate + 1 final + 1 StopIteration = 7 chunk spans
    assert len(chunk_names) >= 5

    # All chunk spans are children of stream_result
    method_span = next(s for s in spans if s.name == "stream_result")
    for s in spans:
        if s.name.startswith("streamer::chunk_"):
            assert s.parent is not None
            assert s.parent.span_id == method_span.context.span_id

    _reset_token_stack()


# ============================================================================
# Test #17: non-streaming action via astream_result still gets action span
# ============================================================================


async def test_astream_result_with_otel_bridge_non_streaming_action():
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter()

    class SimpleAction(SingleStepAction):
        def run_and_update(self, state, **run_kwargs):
            return {"val": 1}, state.update(val=1)

        @property
        def reads(self):
            return []

        @property
        def writes(self):
            return ["val"]

    action_obj = SimpleAction().with_name("simple")
    app = Application(
        state=State({"val": 0}),
        entrypoint="simple",
        adapter_set=LifecycleAdapterSet(bridge),
        partition_key="test",
        uid="test-app",
        graph=Graph(
            actions=[action_obj],
            transitions=[],
        ),
    )

    action, container = await app.astream_result(halt_after=["simple"])
    result, state = await container.get()

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Non-streaming should have an action span
    assert "simple" in span_names
    # No chunk spans
    chunk_names = [n for n in span_names if "chunk_" in n]
    assert len(chunk_names) == 0

    _reset_token_stack()


# ============================================================================
# Mode: "single_span" — backwards compatible (action span, no chunks, no events)
# ============================================================================


def test_bridge_single_span_mode_creates_action_span_for_streaming():
    """In 'single_span' mode, streaming actions get a normal action span, no chunk spans."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.SINGLE_SPAN)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # The action span should have been created
    assert _skipped_action_span.get() is False
    stack = token_stack.get()
    assert len(stack) == 2  # method span + action span

    for i in range(3):
        bridge.pre_stream_generate(
            action="my_stream",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_stream",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have action span + method span, no chunk spans
    assert "my_stream" in span_names
    assert "stream_result" in span_names
    chunk_names = [n for n in span_names if "chunk_" in n]
    assert len(chunk_names) == 0

    # No span events on the action span
    action_span = next(s for s in spans if s.name == "my_stream")
    assert len(action_span.events) == 0

    _reset_token_stack()


def test_bridge_single_span_mode_sets_attributes_on_action_span():
    """In 'single_span' mode, streaming attributes are set on the action span."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.SINGLE_SPAN)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # Accumulator should be initialized
    assert _streaming_accumulator.get() is not None

    for i in range(3):
        bridge.pre_stream_generate(
            action="my_stream",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_stream",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    action_span = next(s for s in spans if s.name == "my_stream")

    # Should have attributes, not events
    assert len(action_span.events) == 0
    attrs = dict(action_span.attributes)
    assert attrs["stream.iteration_count"] == 3
    assert "stream.generation_time_ms" in attrs
    assert "stream.consumer_time_ms" in attrs
    assert "stream.first_item_time_ms" in attrs

    # No chunk spans
    chunk_names = [s.name for s in spans if "chunk_" in s.name]
    assert len(chunk_names) == 0

    _reset_token_stack()


# ============================================================================
# Mode: "event" — action span + summary event, no chunk spans
# ============================================================================


def test_bridge_event_mode_emits_stream_completed_event():
    """In 'event' mode, no action span. A stream_completed event is added to the method span."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.EVENT)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # Action span should be skipped
    assert _skipped_action_span.get() is True
    # Accumulator should be initialized
    assert _streaming_accumulator.get() is not None

    for i in range(3):
        bridge.pre_stream_generate(
            action="my_stream",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_stream",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    # Signal end of stream (StopIteration case)
    bridge.pre_stream_generate(
        action="my_stream",
        item_index=3,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item=None,
        item_index=3,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have only method span, no action span, no chunk spans
    assert "stream_result" in span_names
    assert "my_stream" not in span_names
    chunk_names = [n for n in span_names if "chunk_" in n]
    assert len(chunk_names) == 0

    # Method span should have a stream_completed event
    method_span = next(s for s in spans if s.name == "stream_result")
    assert len(method_span.events) == 1
    event = method_span.events[0]
    assert event.name == "stream_completed"
    attrs = dict(event.attributes)
    assert "stream.generation_time_ms" in attrs
    assert "stream.consumer_time_ms" in attrs
    assert "stream.total_time_ms" in attrs
    assert attrs["stream.iteration_count"] == 3
    assert "stream.first_item_time_ms" in attrs

    # Accumulator should be cleaned up
    assert _streaming_accumulator.get() is None

    _reset_token_stack()


def test_bridge_event_mode_emits_stream_error_event():
    """In 'event' mode with an exception, a stream_error event is emitted on method span."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.EVENT)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # One successful yield
    bridge.pre_stream_generate(
        action="my_stream",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item={"i": 0},
        item_index=0,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )

    # Error on second yield
    exc = RuntimeError("stream failed")
    bridge.pre_stream_generate(
        action="my_stream",
        item_index=1,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item=None,
        item_index=1,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=exc,
    )

    bridge.post_run_step(exception=exc)
    bridge.post_run_execute_call(exception=exc)

    spans = exporter.get_finished_spans()
    # No action span — event is on the method span
    method_span = next(s for s in spans if s.name == "stream_result")

    assert len(method_span.events) == 1
    event = method_span.events[0]
    assert event.name == "stream_error"
    attrs = dict(event.attributes)
    assert attrs["stream.iteration_count"] == 1  # only 1 successful yield
    assert "stream.error" in attrs
    assert "stream failed" in attrs["stream.error"]

    _reset_token_stack()


def test_bridge_event_mode_accumulator_timing_values():
    """Verify that the accumulator separates generation time from consumer time."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.EVENT)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # Simulate 2 yields with measurable time gaps
    bridge.pre_stream_generate(
        action="my_stream",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    time.sleep(0.05)  # ~50ms generation time
    bridge.post_stream_generate(
        item={"i": 0},
        item_index=0,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )
    time.sleep(0.1)  # ~100ms consumer time

    bridge.pre_stream_generate(
        action="my_stream",
        item_index=1,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    time.sleep(0.05)  # ~50ms generation time
    bridge.post_stream_generate(
        item={"i": 1},
        item_index=1,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    # Event is on the method span (no action span in EVENT mode)
    method_span = next(s for s in spans if s.name == "stream_result")
    event = method_span.events[0]
    attrs = dict(event.attributes)

    gen_ms = attrs["stream.generation_time_ms"]
    consumer_ms = attrs["stream.consumer_time_ms"]
    total_ms = attrs["stream.total_time_ms"]
    first_item_ms = attrs["stream.first_item_time_ms"]

    # Generation: ~100ms total (2 × 50ms)
    assert gen_ms >= 50, f"generation_time_ms={gen_ms}, expected >= 50"
    assert gen_ms < 300, f"generation_time_ms={gen_ms}, expected < 300"

    # Consumer: ~100ms (gap between first post and second pre)
    assert consumer_ms >= 50, f"consumer_time_ms={consumer_ms}, expected >= 50"
    assert consumer_ms < 300, f"consumer_time_ms={consumer_ms}, expected < 300"

    # Total should be >= generation + consumer
    assert total_ms >= gen_ms, f"total_time_ms={total_ms} < generation_time_ms={gen_ms}"

    # First item time should be close to first generation time (~50ms)
    assert first_item_ms >= 20, f"first_item_time_ms={first_item_ms}, expected >= 20"
    assert first_item_ms < 200, f"first_item_time_ms={first_item_ms}, expected < 200"

    assert attrs["stream.iteration_count"] == 2

    _reset_token_stack()


# ============================================================================
# Mode: SINGLE_AND_CHUNK_SPANS — action span with attributes + per-yield child spans
# ============================================================================


def test_bridge_single_and_chunk_spans_mode():
    """In SINGLE_AND_CHUNK_SPANS mode, action span has streaming attributes AND per-yield child spans exist."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.SINGLE_AND_CHUNK_SPANS)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # Action span should be created (not skipped)
    assert _skipped_action_span.get() is False

    for i in range(3):
        bridge.pre_stream_generate(
            action="my_stream",
            item_index=i,
            stream_initialize_time=now,
            sequence_id=0,
            app_id="app",
            partition_key="pk",
        )
        bridge.post_stream_generate(
            item={"i": i},
            item_index=i,
            stream_initialize_time=now,
            action="my_stream",
            sequence_id=0,
            app_id="app",
            partition_key="pk",
            exception=None,
        )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have: method span + action span + 3 chunk spans
    assert "stream_result" in span_names
    assert "my_stream" in span_names
    assert "my_stream::chunk_0" in span_names
    assert "my_stream::chunk_1" in span_names
    assert "my_stream::chunk_2" in span_names
    assert len(spans) == 5

    # Action span should have streaming attributes (not events)
    action_span = next(s for s in spans if s.name == "my_stream")
    assert len(action_span.events) == 0
    attrs = dict(action_span.attributes)
    assert attrs["stream.iteration_count"] == 3
    assert "stream.generation_time_ms" in attrs
    assert "stream.consumer_time_ms" in attrs
    assert "stream.first_item_time_ms" in attrs

    # Chunk spans should be children of the action span
    for s in spans:
        if s.name.startswith("my_stream::chunk_"):
            assert s.parent is not None
            assert s.parent.span_id == action_span.context.span_id

    _reset_token_stack()


# ============================================================================
# Mode: "chunk_spans" — per-yield spans, no action span (already covered above,
# this test verifies no event is emitted)
# ============================================================================


def test_bridge_chunk_spans_mode_no_event_emitted():
    """In 'chunk_spans' mode, no span event is emitted (no accumulator)."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.CHUNK_SPANS)
    action = _make_mock_action("my_stream", streaming=True)
    now = datetime.datetime.now()

    bridge.pre_run_execute_call(method=burr_otel.ExecuteMethod.stream_result)
    bridge.pre_run_step(action=action)

    # No accumulator in spans-only mode
    assert _streaming_accumulator.get() is None

    bridge.pre_stream_generate(
        action="my_stream",
        item_index=0,
        stream_initialize_time=now,
        sequence_id=0,
        app_id="app",
        partition_key="pk",
    )
    bridge.post_stream_generate(
        item={"i": 0},
        item_index=0,
        stream_initialize_time=now,
        action="my_stream",
        sequence_id=0,
        app_id="app",
        partition_key="pk",
        exception=None,
    )

    bridge.post_run_step(exception=None)
    bridge.post_run_execute_call(exception=None)

    spans = exporter.get_finished_spans()

    # Only chunk span + method span, no action span
    span_names = [s.name for s in spans]
    assert "my_stream::chunk_0" in span_names
    assert "stream_result" in span_names
    assert "my_stream" not in span_names

    # No events on any span
    for s in spans:
        assert len(s.events) == 0

    _reset_token_stack()


# ============================================================================
# Integration: "event" mode with astream_result
# ============================================================================


async def test_astream_result_event_mode_produces_summary_event():
    """Full integration test: event mode with astream_result produces summary event."""
    _reset_token_stack()
    bridge, exporter = _make_bridge_and_exporter(streaming_telemetry=STM.EVENT)

    class SimpleStreamer(SingleStepStreamingAction):
        async def stream_run_and_update(self, state, **run_kwargs):
            for i in range(5):
                yield {"i": i}, None
            yield {"i": 5}, state.update(done=True)

        @property
        def reads(self):
            return []

        @property
        def writes(self):
            return ["done"]

    streamer = SimpleStreamer().with_name("streamer")
    app = Application(
        state=State({"done": False}),
        entrypoint="streamer",
        adapter_set=LifecycleAdapterSet(bridge),
        partition_key="test",
        uid="test-app",
        graph=Graph(
            actions=[streamer],
            transitions=[],
        ),
    )

    action, container = await app.astream_result(halt_after=["streamer"])
    _ = [item async for item in container]
    result, state = await container.get()

    spans = exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    # Should have only method span, no action span, no chunk spans
    assert "stream_result" in span_names
    assert "streamer" not in span_names
    chunk_names = [n for n in span_names if "chunk_" in n]
    assert len(chunk_names) == 0

    # Method span should have stream_completed event
    method_span = next(s for s in spans if s.name == "stream_result")
    assert len(method_span.events) == 1
    event = method_span.events[0]
    assert event.name == "stream_completed"
    attrs = dict(event.attributes)
    # 5 intermediate + 1 final = 6 yielded items
    assert attrs["stream.iteration_count"] >= 5
    assert attrs["stream.generation_time_ms"] >= 0
    assert attrs["stream.consumer_time_ms"] >= 0
    assert attrs["stream.total_time_ms"] >= 0
    assert attrs["stream.first_item_time_ms"] >= 0

    _reset_token_stack()
