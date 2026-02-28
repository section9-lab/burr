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

import dataclasses
import datetime
import enum
import importlib
import importlib.metadata
import json
import logging
import random
import sys
import time
from contextvars import ContextVar
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from burr.integrations.base import require_plugin

logger = logging.getLogger(__name__)

try:
    from opentelemetry import context
    from opentelemetry import context as context_api
    from opentelemetry import trace
    from opentelemetry.sdk.trace import Span, SpanProcessor, TracerProvider
    from opentelemetry.trace import get_current_span, use_span
except ImportError as e:
    require_plugin(
        e,
        "opentelemetry",
    )

from burr.common import types as burr_types
from burr.core import Action, ApplicationGraph, State, serde
from burr.lifecycle import (
    PostApplicationExecuteCallHook,
    PostRunStepHook,
    PostStreamGenerateHook,
    PreApplicationExecuteCallHook,
    PreRunStepHook,
    PreStreamGenerateHook,
)
from burr.lifecycle.base import DoLogAttributeHook, ExecuteMethod, PostEndSpanHook, PreStartSpanHook
from burr.tracking import LocalTrackingClient
from burr.tracking.base import SyncTrackingClient
from burr.visibility import ActionSpan

# We have to keep track of tokens for the span
# As OpenTel has some weird behavior around context managers, we have to account for the latest ones we started
# This way we can pop one off and know where to set the current one (as the parent, when the next one ends)
token_stack = ContextVar[Optional[List[Tuple[object, Span]]]]("token_stack", default=None)


@dataclasses.dataclass
class FullSpanContext:
    action_span: ActionSpan
    partition_key: str
    app_id: str


span_map = {}


def cache_span(span: Span, context: FullSpanContext) -> Span:
    span_map[span.get_span_context().span_id] = context
    return span


def uncache_span(span: Span) -> Span:
    del span_map[span.get_span_context().span_id]
    return span


def get_cached_span(span_id: int) -> Optional[FullSpanContext]:
    return span_map.get(span_id)


tracker_context = ContextVar[Optional[SyncTrackingClient]]("tracker_context", default=None)

# Tracks whether the action-level span was skipped for streaming actions
_skipped_action_span = ContextVar[bool]("_skipped_action_span", default=False)


# Valid streaming telemetry modes
class StreamingTelemetryMode(enum.Enum):
    """Controls how streaming actions are instrumented by the OpenTelemetryBridge.

    - ``SINGLE_SPAN``: A single action span covers the full generator lifetime (default).
    - ``EVENT``: A single action span plus a ``stream_completed`` summary span event.
    - ``CHUNK_SPANS``: No action span. Per-yield child spans under the method span.
    - ``SINGLE_AND_CHUNK_SPANS``: Action span with summary event plus per-yield child spans.
    """

    SINGLE_SPAN = "single_span"
    EVENT = "event"
    CHUNK_SPANS = "chunk_spans"
    SINGLE_AND_CHUNK_SPANS = "single_and_chunk_spans"


@dataclasses.dataclass
class _StreamingAccumulator:
    """Accumulates timing data across stream yields for the span event summary."""

    generation_time_ns: int = 0
    consumer_time_ns: int = 0
    iteration_count: int = 0
    first_item_time_ns: Optional[int] = None
    stream_start_ns: Optional[int] = None
    last_post_generate_ns: Optional[int] = None
    _pre_generate_ns: Optional[int] = None


_streaming_accumulator = ContextVar[Optional[_StreamingAccumulator]](
    "_streaming_accumulator", default=None
)


def _is_homogeneous_sequence(value: Sequence):
    if len(value) == 0:
        return True
    first_type = type(value[0])
    return all([isinstance(val, first_type) for val in value])


def convert_to_otel_attribute(attr: Any):
    if isinstance(attr, (str, bool, float, int)):
        return attr
    elif isinstance(attr, Sequence):
        if _is_homogeneous_sequence(attr):
            return list(attr)
    try:
        return json.dumps(serde.serialize(attr))
    except Exception as e:
        logger.error(f"Failed to serialize attribute: {attr}, got error: {e}")
        return str(attr)


def _exit_span(exc: Optional[Exception] = None):
    """Ditto with _enter_span, but for exiting the span. Pops the token off the stack and detaches the context."""
    stack = token_stack.get()[:]
    token, span = stack.pop()
    token_stack.set(stack)
    context.detach(token)
    if exc:
        span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
    else:
        span.set_status(trace.Status(trace.StatusCode.OK))
    span.end()
    return span


def _enter_span(name: str, tracer: trace.Tracer):
    """Utility function to enter a span. Starts, sets the current context, and adds it to the token stack.

    See this for some background on why start_span doesn't really work. We could use start_as_current_span,
    but this is a bit more explicit.
    """
    span = tracer.start_span(
        name=name,
        record_exception=False,  # we'll handle this ourselves
        set_status_on_exception=False,
    )
    ctx = trace.set_span_in_context(span)
    token = context.attach(ctx)
    stack = (token_stack.get() or [])[:]
    stack.append((token, span))
    token_stack.set(stack)
    return span


class OpenTelemetryBridge(
    PreApplicationExecuteCallHook,
    PostApplicationExecuteCallHook,
    PreRunStepHook,
    PostRunStepHook,
    PreStartSpanHook,
    PostEndSpanHook,
    DoLogAttributeHook,
    PreStreamGenerateHook,
    PostStreamGenerateHook,
):
    """Lifecycle adapter that maps Burr execution events to OpenTelemetry spans and events.

    **How it works**

    The bridge implements Burr lifecycle hooks to create a span hierarchy that mirrors the
    execution structure:

    1. ``pre_run_execute_call`` / ``post_run_execute_call`` — creates a top-level **method span**
       for the application method being called (e.g. ``step``, ``astream_result``).
    2. ``pre_run_step`` / ``post_run_step`` — creates an **action span** as a child of the
       method span. For streaming actions, behavior depends on the ``streaming_telemetry`` mode.
    3. ``pre_start_span`` / ``post_end_span`` — creates **sub-action spans** for user-defined
       visibility spans (via ``TracerFactory`` / ``__tracer``).
    4. ``do_log_attributes`` — sets OTel attributes on the current span.
    5. ``pre_stream_generate`` / ``post_stream_generate`` — for streaming actions, optionally
       creates per-yield **chunk spans** and/or accumulates timing data for a summary event.

    All spans are managed via a ContextVar-based token stack (``token_stack``) to correctly
    handle nesting across sync and async execution.

    **Usage**

    .. code-block:: python

        # replace with instructions from your preferred vendor
        my_vendor_library_or_tracer_provider.init()

        app = (
            ApplicationBuilder()
            .with_entrypoint("prompt")
            .with_state(chat_history=[])
            .with_graph(graph)
            .with_hooks(OpenTelemetryBridge())
            .build()
        )

        app.run()  # will log to OpenTelemetry

    **Streaming telemetry modes**

    The ``streaming_telemetry`` parameter controls how streaming actions are instrumented.
    Non-streaming actions are unaffected — they always produce a single action span.

    - ``StreamingTelemetryMode.SINGLE_SPAN`` (default): A single action span covers the full
      generator lifetime (including consumer wait time). Streaming **attributes** are set on
      the span with the generation/consumer timing breakdown:

      - ``stream.generation_time_ms`` — time spent inside the generator producing items
      - ``stream.consumer_time_ms`` — time the consumer spent processing yielded items
      - ``stream.iteration_count`` — number of items yielded
      - ``stream.first_item_time_ms`` — time to first item (TTFT)

    - ``StreamingTelemetryMode.EVENT``: No action span. A ``stream_completed`` (or
      ``stream_error``) span event is added to the **method span** with the timing summary
      (including ``stream.total_time_ms`` since there is no action span to carry duration).
    - ``StreamingTelemetryMode.CHUNK_SPANS``: No action span. A child span
      (``{action}::chunk_{N}``) is created for each generator yield under the method span.
      Each chunk span measures only generation time (excludes consumer processing time).
    - ``StreamingTelemetryMode.SINGLE_AND_CHUNK_SPANS``: Combines ``SINGLE_SPAN`` and ``CHUNK_SPANS`` — the
      action span (with streaming attributes) plus per-yield chunk spans as its children.
    """

    def __init__(
        self,
        tracer_name: str = None,
        tracer: trace.Tracer = None,
        streaming_telemetry: StreamingTelemetryMode = StreamingTelemetryMode.SINGLE_SPAN,
    ):
        """Initializes an OpenTel adapter. Passes in a tracer_name or a tracer object,
        should only pass one.

        :param tracer_name: Name of the tracer if you want it to initialize for you -- not including it will use a default
        :param tracer: Tracer object if you want to pass it in yourself
        :param streaming_telemetry: How to instrument streaming actions. See :class:`StreamingTelemetryMode`.
        """
        if tracer_name and tracer:
            raise ValueError(
                f"Only pass in one of tracer_name or tracer, not both, got: tracer_name={tracer_name} and tracer={tracer}"
            )
        if tracer:
            self.tracer = tracer
        else:
            self.tracer = trace.get_tracer(__name__ if tracer_name is None else tracer_name)
        self.streaming_telemetry = streaming_telemetry

    @property
    def _emit_chunk_spans(self) -> bool:
        """Whether to create per-yield chunk spans (CHUNK_SPANS or BOTH)."""
        return self.streaming_telemetry in (
            StreamingTelemetryMode.CHUNK_SPANS,
            StreamingTelemetryMode.SINGLE_AND_CHUNK_SPANS,
        )

    @property
    def _emit_event(self) -> bool:
        """Whether to emit a summary span event on the method span (EVENT only).

        EVENT mode skips the action span entirely and attaches a ``stream_completed``
        event to the method span instead.
        """
        return self.streaming_telemetry == StreamingTelemetryMode.EVENT

    @property
    def _emit_attributes(self) -> bool:
        """Whether to set streaming attributes on the action span (SINGLE_SPAN or BOTH).

        These modes create an action span and set generation time, consumer time,
        iteration count, and TTFT as span attributes.
        """
        return self.streaming_telemetry in (
            StreamingTelemetryMode.SINGLE_SPAN,
            StreamingTelemetryMode.SINGLE_AND_CHUNK_SPANS,
        )

    @property
    def _use_accumulator(self) -> bool:
        """Whether timing accumulation is needed (all modes except CHUNK_SPANS)."""
        return self.streaming_telemetry != StreamingTelemetryMode.CHUNK_SPANS

    @property
    def _skip_single_action_span_for_streaming(self) -> bool:
        """Whether to skip the action-level span for streaming actions.

        True for EVENT and CHUNK_SPANS modes. EVENT attaches data to the method span
        instead. CHUNK_SPANS replaces the action span with per-yield child spans.
        In SINGLE_SPAN and BOTH modes, the action span is created normally.
        """
        return self.streaming_telemetry in (
            StreamingTelemetryMode.EVENT,
            StreamingTelemetryMode.CHUNK_SPANS,
        )

    def pre_run_execute_call(
        self,
        *,
        method: ExecuteMethod,
        **future_kwargs: Any,
    ):
        """Opens the top-level **method span** (e.g. ``step``, ``astream_result``).

        This is the outermost span in the Burr trace hierarchy. Action spans and chunk
        spans are nested under it.
        """
        # TODO -- handle links -- we need to wire this through
        _enter_span(method.value, self.tracer)

    def do_log_attributes(
        self,
        *,
        attributes: Dict[str, Any],
        **future_kwargs: Any,
    ):
        """Sets key-value attributes on the current OTel span.

        Values are serialized via :func:`convert_to_otel_attribute` to ensure they are
        OTel-compatible types (str, bool, int, float, or homogeneous sequences thereof).
        """
        otel_span = get_current_span()
        if otel_span is None:
            logger.warning(
                "Attempted to log attributes from the tracker outside of a span, ignoring"
            )
            return
        otel_span.set_attributes(
            {key: convert_to_otel_attribute(value) for key, value in attributes.items()}
        )

    def pre_run_step(
        self,
        *,
        action: "Action",
        **future_kwargs: Any,
    ):
        """Opens an **action span** for the step about to execute.

        For streaming actions in ``EVENT`` or ``CHUNK_SPANS`` mode, the action span is
        skipped. In ``SINGLE_SPAN`` and ``SINGLE_AND_CHUNK_SPANS`` modes, the action span is created normally.

        For all modes except ``CHUNK_SPANS``, a :class:`_StreamingAccumulator` is initialized
        to collect timing data across generator yields.
        """
        if getattr(action, "streaming", False) and self._skip_single_action_span_for_streaming:
            _skipped_action_span.set(True)
        else:
            _skipped_action_span.set(False)
            _enter_span(action.name, self.tracer)
        # Initialize accumulator for modes that need timing data
        if getattr(action, "streaming", False) and self._use_accumulator:
            _streaming_accumulator.set(_StreamingAccumulator())

    def pre_start_span(
        self,
        *,
        span: "ActionSpan",
        **future_kwargs: Any,
    ):
        """Opens a **sub-action span** for a user-defined visibility span.

        These are created by the ``TracerFactory`` (``__tracer``) context manager inside
        actions, and are nested under the current action span.
        """
        _enter_span(span.name, self.tracer)

    def post_end_span(
        self,
        *,
        span: "ActionSpan",
        **future_kwargs: Any,
    ):
        """Closes a sub-action span opened by :meth:`pre_start_span`."""
        # TODO -- wire through exceptions
        _exit_span()

    def post_run_step(
        self,
        *,
        exception: Exception,
        **future_kwargs: Any,
    ):
        """Closes the action span and, for streaming actions, emits summary telemetry.

        Behavior depends on mode:

        - ``SINGLE_SPAN`` / ``SINGLE_AND_CHUNK_SPANS``: Sets streaming attributes on the action span, then
          closes it.
        - ``EVENT``: Emits a ``stream_completed`` (or ``stream_error``) span event on the
          method span (the action span was skipped). Resets the skipped flag.
        - ``CHUNK_SPANS``: The action span was skipped; just resets the flag.
        """
        acc = _streaming_accumulator.get()
        if acc is not None:
            first_item_ms = 0.0
            if acc.first_item_time_ns is not None and acc.stream_start_ns is not None:
                first_item_ms = (acc.first_item_time_ns - acc.stream_start_ns) / 1e6

            if self._emit_attributes:
                # SINGLE_SPAN / BOTH: set attributes on the action span
                otel_span = get_current_span()
                if otel_span is not None:
                    otel_span.set_attributes(
                        {
                            "stream.generation_time_ms": acc.generation_time_ns / 1e6,
                            "stream.consumer_time_ms": acc.consumer_time_ns / 1e6,
                            "stream.iteration_count": acc.iteration_count,
                            "stream.first_item_time_ms": first_item_ms,
                        }
                    )

            elif self._emit_event:
                # EVENT: emit span event on the method span (action span was skipped)
                otel_span = get_current_span()
                if otel_span is not None:
                    total_time_ns = 0
                    if acc.stream_start_ns is not None and acc.last_post_generate_ns is not None:
                        total_time_ns = acc.last_post_generate_ns - acc.stream_start_ns
                    event_name = "stream_error" if exception else "stream_completed"
                    attrs: Dict[str, Any] = {
                        "stream.generation_time_ms": acc.generation_time_ns / 1e6,
                        "stream.consumer_time_ms": acc.consumer_time_ns / 1e6,
                        "stream.total_time_ms": total_time_ns / 1e6,
                        "stream.iteration_count": acc.iteration_count,
                        "stream.first_item_time_ms": first_item_ms,
                    }
                    if exception:
                        attrs["stream.error"] = str(exception)
                    otel_span.add_event(event_name, attributes=attrs)

            _streaming_accumulator.set(None)

        if _skipped_action_span.get():
            _skipped_action_span.set(False)
        else:
            _exit_span(exception)

    def pre_stream_generate(
        self,
        *,
        action: str,
        item_index: int,
        **future_kwargs: Any,
    ):
        """Called just before each ``__next__()`` / ``__anext__()`` on the generator.

        For modes with accumulation (``SINGLE_SPAN``, ``EVENT``, ``SINGLE_AND_CHUNK_SPANS``), records the
        start of generation time and accumulates consumer time (the gap between the previous
        ``post_stream_generate`` and now).

        In ``CHUNK_SPANS`` or ``SINGLE_AND_CHUNK_SPANS`` mode, opens a child span named
        ``{action}::chunk_{item_index}``.
        """
        now_ns = time.time_ns()
        acc = _streaming_accumulator.get()
        if acc is not None:
            if acc.stream_start_ns is None:
                acc.stream_start_ns = now_ns
            if acc.last_post_generate_ns is not None:
                acc.consumer_time_ns += now_ns - acc.last_post_generate_ns
            acc._pre_generate_ns = now_ns  # stash for post

        if self._emit_chunk_spans:
            _enter_span(f"{action}::chunk_{item_index}", self.tracer)

    def post_stream_generate(
        self,
        *,
        item: Any,
        item_index: int,
        exception: Optional[Exception],
        **future_kwargs: Any,
    ):
        """Called just after each ``__next__()`` / ``__anext__()`` returns (or raises).

        For modes with accumulation (``SINGLE_SPAN``, ``EVENT``, ``SINGLE_AND_CHUNK_SPANS``), accumulates
        generation time and updates the iteration count. When ``item`` is not ``None``,
        the item is counted; a ``None`` item signals generator exhaustion (``StopIteration``).

        In ``CHUNK_SPANS`` or ``SINGLE_AND_CHUNK_SPANS`` mode, closes the chunk span opened by
        :meth:`pre_stream_generate`, setting an error status if ``exception`` is provided.
        """
        now_ns = time.time_ns()
        acc = _streaming_accumulator.get()
        if acc is not None:
            pre_ns = acc._pre_generate_ns
            if pre_ns is not None:
                acc.generation_time_ns += now_ns - pre_ns
            if item is not None:
                acc.iteration_count += 1
                if acc.first_item_time_ns is None:
                    acc.first_item_time_ns = now_ns
            acc.last_post_generate_ns = now_ns

        if self._emit_chunk_spans:
            _exit_span(exception)

    def post_run_execute_call(
        self,
        *,
        exception: Optional[Exception],
        **future_kwargs,
    ):
        """Closes the top-level method span opened by :meth:`pre_run_execute_call`."""
        _exit_span(exception)


class OpenTelemetryTracker(
    SyncTrackingClient,
):
    """Tracker that includes logging of OpenTelemetry events. Note you will be unlikely to instantiate this directly,
    rather, you will instantiate it through with_tracker(use_oteL_tracing=True) on the ApplicationBuilder.

    At a high level, this:
    1. Logs all events to OpenTelemetry
    2. Adds a span processor to opentelemetry

    Note that this globally sets a tracer provider -- it is possible that this will interfere with
    other tracers, and we are actively investigating it.
    TODO -- add stream start/end to opentel + TTFS, etc...
    """

    def pre_start_stream(
        self,
        *,
        action: str,
        sequence_id: int,
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        return self.burr_tracker.pre_start_stream(
            action=action,
            sequence_id=sequence_id,
            app_id=app_id,
            partition_key=partition_key,
            **future_kwargs,
        )

    def post_stream_item(
        self,
        *,
        item: Any,
        item_index: int,
        stream_initialize_time: datetime.datetime,
        first_stream_item_start_time: datetime.datetime,
        action: str,
        sequence_id: int,
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        return self.burr_tracker.post_stream_item(
            item=item,
            item_index=item_index,
            stream_initialize_time=stream_initialize_time,
            first_stream_item_start_time=first_stream_item_start_time,
            action=action,
            sequence_id=sequence_id,
            app_id=app_id,
            partition_key=partition_key,
            **future_kwargs,
        )

    def post_end_stream(
        self,
        *,
        action: str,
        sequence_id: int,
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        return self.burr_tracker.post_end_stream(
            action=action,
            sequence_id=sequence_id,
            app_id=app_id,
            partition_key=partition_key,
            **future_kwargs,
        )

    def __init__(self, burr_tracker: SyncTrackingClient):
        initialize_tracer()
        self.tracer = trace.get_tracer("burr.integrations.opentelemetry")
        self.burr_tracker = burr_tracker

    def post_application_create(
        self,
        *,
        app_id: str,
        partition_key: Optional[str],
        state: "State",
        application_graph: "ApplicationGraph",
        parent_pointer: Optional[burr_types.ParentPointer],
        spawning_parent_pointer: Optional[burr_types.ParentPointer],
        **future_kwargs: Any,
    ):
        self.burr_tracker.post_application_create(
            app_id=app_id,
            partition_key=partition_key,
            state=state,
            application_graph=application_graph,
            parent_pointer=parent_pointer,
            spawning_parent_pointer=spawning_parent_pointer,
        )

    def do_log_attributes(
        self,
        *,
        attributes: Dict[str, Any],
        action: str,
        action_sequence_id: int,
        span: Optional["ActionSpan"],
        tags: dict,
        **future_kwargs: Any,
    ):
        # TODO -- get current span then call attributes
        # We need to serialize as well, attributes are not the right type to match 100%
        otel_span = get_current_span()
        if otel_span is None:
            # TODO -- see if this shows up then make it a les aggressive error
            raise ValueError("No current span")
        otel_span.set_attributes(
            {key: convert_to_otel_attribute(value) for key, value in attributes.items()}
        )

    def pre_run_step(
        self,
        *,
        app_id: str,
        partition_key: str,
        sequence_id: int,
        state: "State",
        action: "Action",
        inputs: Dict[str, Any],
        **future_kwargs: Any,
    ):
        self.burr_tracker.pre_run_step(
            app_id=app_id,
            partition_key=partition_key,
            sequence_id=sequence_id,
            state=state,
            action=action,
            inputs=inputs,
            **future_kwargs,
        )
        tracker_context.set(self.burr_tracker)
        span = _enter_span(action.name, self.tracer)
        cache_span(
            span,
            FullSpanContext(
                action_span=ActionSpan.create_initial(
                    action=action.name,
                    name=action.name,
                    sequence_id=0,
                    action_sequence_id=sequence_id,
                ),
                partition_key=partition_key,
                app_id=app_id,
            ),
        )

    def pre_start_span(
        self,
        *,
        action: str,
        action_sequence_id: int,
        span: "ActionSpan",
        span_dependencies: list[str],
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        otel_span = _enter_span(span.name, self.tracer)
        return otel_span

    def post_end_span(
        self,
        *,
        action: str,
        action_sequence_id: int,
        span: "ActionSpan",
        span_dependencies: list[str],
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        # TODO -- wire through exceptions
        _exit_span()

    def post_run_step(
        self,
        *,
        app_id: str,
        partition_key: str,
        sequence_id: int,
        state: "State",
        action: "Action",
        result: Optional[Dict[str, Any]],
        exception: Exception,
        **future_kwargs: Any,
    ):
        self.burr_tracker.post_run_step(
            app_id=app_id,
            partition_key=partition_key,
            sequence_id=sequence_id,
            state=state,
            action=action,
            result=result,
            exception=exception,
        )
        _exit_span(exception)
        tracker_context.set(None)

    def copy(self):
        return OpenTelemetryTracker(burr_tracker=self.burr_tracker.copy())


class BurrTrackingSpanProcessor(SpanProcessor):
    @property
    def tracker(self):
        """Quick trick to get closer to the right tracker. This is suboptimal as we don't really
        have guarentees that we'll be *in* the right context when it gets logged, but the way OpenTel
        is implemented we will (with the immediate span processor). TODO -- track a map of span ID -> tracker
        """
        return tracker_context.get()

    def on_start(
        self,
        span: "Span",
        parent_context: Optional[context_api.Context] = None,
    ) -> None:
        # First get the ID of the parent so we can retrieve from our cache
        parent_id = span.parent.span_id if span.parent is not None else None
        if parent_id is not None:
            parent_span = get_cached_span(span.parent.span_id)
            # If it exists, we can spawn a new span and cache that
            if parent_span is not None:
                cache_span(
                    span,
                    context := FullSpanContext(
                        action_span=parent_span.action_span.spawn(span.name),
                        partition_key=parent_span.partition_key,
                        app_id=parent_span.app_id,
                    ),
                )
                if self.tracker is not None:
                    self.tracker.pre_start_span(
                        action=context.action_span.action,
                        action_sequence_id=context.action_span.action_sequence_id,
                        span=context.action_span,
                        span_dependencies=[],  # TODO -- log
                        app_id=context.app_id,
                        partition_key=context.partition_key,
                    )

    def on_end(self, span: "Span") -> None:
        cached_span = get_cached_span(span.get_span_context().span_id)
        # If this is none it means we're outside of the burr context
        if cached_span is not None and self.tracker is not None:
            # TODO -- get tracker context to work
            self.tracker.post_end_span(
                action=cached_span.action_span.action,
                action_sequence_id=cached_span.action_span.action_sequence_id,
                span=cached_span.action_span,
                span_dependencies=[],  # TODO -- log
                app_id=cached_span.app_id,
                partition_key=cached_span.partition_key,
            )
            uncache_span(span)
            if len(span.attributes) > 0:
                self.tracker.do_log_attributes(
                    attributes=dict(**span.attributes),
                    action=cached_span.action_span.action,
                    action_sequence_id=cached_span.action_span.action_sequence_id,
                    span=cached_span.action_span,
                    tags={},  # TODO -- log
                    app_id=cached_span.app_id,
                    partition_key=cached_span.partition_key,
                )


initialized = False


def initialize_tracer():
    """Initializes the tracer for OpenTel. Note this sets it globally.
    TODO -- ensure that it is initialized properly/do this in a cleaner manner.
    OpenTel does not make this easy as it's all global state.
    """
    global initialized
    if initialized:
        return
    initialized = True
    trace.set_tracer_provider(TracerProvider())
    trace.get_tracer_provider().add_span_processor(BurrTrackingSpanProcessor())


INSTRUMENTS_SPECS = {
    "openai": ("openai", "opentelemetry.instrumentation.openai", "OpenAIInstrumentor"),
    "anthropic": ("anthropic", "opentelemetry.instrumentation.anthropic", "AnthropicInstrumentor"),
    "cohere": ("cohere", "opentelemetry.instrumentation.cohere", "CohereInstrumentor"),
    "google_generativeai": (
        "google.generativeai",
        "opentelemetry.instrumentation.google_generativeai",
        "GoogleGenerativeAiInstrumentor",
    ),
    "mistral": ("mistralai", "opentelemetry.instrumentation.mistralai", "MistralAiInstrumentor"),
    "ollama": ("ollama", "opentelemetry.instrumentation.ollama", "OllamaInstrumentor"),
    "transformers": (
        "transformers",
        "opentelemetry.instrumentation.transformers",
        "TransformersInstrumentor",
    ),
    "together": ("together", "opentelemetry.instrumentation.together", "TogetherAiInstrumentor"),
    "bedrock": ("bedrock", "opentelemetry.instrumentation.bedrock", "BedrockInstrumentor"),
    "replicate": ("replicate", "opentelemetry.instrumentation.replicate", "ReplicateInstrumentor"),
    "vertexai": ("vertexai", "opentelemetry.instrumentation.vertexai", "VertexAIInstrumentor"),
    "groq": ("groq", "opentelemetry.instrumentation.groq", "GroqInstrumentor"),
    "watsonx": ("ibm-watsonx-ai", "opentelemetry.instrumentation.watsonx", "WatsonxInstrumentor"),
    "alephalpha": (
        "aleph_alpha_client",
        "opentelemetry.instrumentation.alephalpha",
        "AlephAlphaInstrumentor",
    ),
    "pinecone": ("pinecone", "opentelemetry.instrumentation.pinecone", "PineconeInstrumentor"),
    "qdrant": ("qdrant_client", "opentelemetry.instrumentation.qdrant", "QdrantInstrumentor"),
    "chroma": ("chromadb", "opentelemetry.instrumentation.chromadb", "ChromaInstrumentor"),
    "milvus": ("pymilvus", "opentelemetry.instrumentation.milvus", "MilvusInstrumentor"),
    "weaviate": ("weaviate", "opentelemetry.instrumentation.weaviate", "WeaviateInstrumentor"),
    "lancedb": ("lancedb", "opentelemetry.instrumentation.lancedb", "LanceInstrumentor"),
    "marqo": ("marqo", "opentelemetry.instrumentation.marqo", "MarqoInstrumentor"),
    "redis": ("redis", "opentelemetry.instrumentation.redis", "RedisInstrumentor"),
    "langchain": ("langchain", "opentelemetry.instrumentation.langchain", "LangchainInstrumentor"),
    "llama_index": (
        "llama_index",
        "opentelemetry.instrumentation.llamaindex",
        "LlamaIndexInstrumentor",
    ),
    "haystack": ("haystack", "opentelemetry.instrumentation.haystack", "HaystackInstrumentor"),
    "requests": ("requests", "opentelemetry.instrumentation.requests", "RequestsInstrumentor"),
    "httpx": ("httpx", "opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
    "urllib": ("urllib", "opentelemetry.instrumentation.urllib", "URLLibInstrumentor"),
    "urllib3": ("urllib3", "opentelemetry.instrumentation.urllib3", "URLLib3Instrumentor"),
}

INSTRUMENTS = Literal[
    "openai",
    "anthropic",
    "cohere",
    "google_generativeai",
    "mistral",
    "ollama",
    "transformers",
    "together",
    "bedrock",
    "replicate",
    "vertexai",
    "groq",
    "watsonx",
    "alephalpha",
    "pinecone",
    "qdrant",
    "chroma",
    "milvus",
    "weaviate",
    "lancedb",
    "marqo",
    "redis",
    "langchain",
    "llama_index",
    "haystack",
    "requests",
    "httpx",
    "urllib",
    "urllib3",
]


def available_dists() -> set[str]:
    """Get the name of all available libraries in the current environment.

    ref for importlib.metadata: https://docs.python.org/3.11/library/importlib.metadata.html#metadata
    """
    return set((dist.name for dist in importlib.metadata.distributions()))


def _init_instrument(
    module_name: str, instrumentation_module_name: str, instrumentor_name: str
) -> None:
    """Instrument a Python library.
    Instrumentation will be skipped if module is not imported nor found in `sys.modules`
    Exit early if the instrumentation module isn't installed in the current environment.

    :param module_name: Name of the top-level module to instrument (e.g., `requests`, `openai`)
    :param instrumentation_module_name: Name of the module containing the instrumentor (e.g., opentelemetry.instrumentation.requests)
    :param instrumentor_name: Name of the object that has the `.instrument()` method. (e.g., OpenAIInstrumentor)
    :return:
    """
    if module_name not in sys.modules:
        logger.debug(f"`{module_name}` wasn't imported. Skipping instrumentation.")
        return

    instrumentation_package_name = instrumentation_module_name.replace(".", "-")
    if instrumentation_package_name not in available_dists():
        logger.info(
            f"Couldn't instrument `{module_name}`. Package `{instrumentation_package_name}` is missing."
        )
        return

    try:
        instrumentation_module = importlib.import_module(instrumentation_module_name)
        instrumentor = getattr(instrumentation_module, instrumentor_name)
        if instrumentor.is_instrumented_by_opentelemetry:
            logger.debug(f"`{module_name}` is already instrumented.")
        else:
            instrumentor.instrument()
            logger.info(f"`{module_name}` is now instrumented.")

    except BaseException:
        logger.error(f"Failed to instrument `{module_name}` with `{instrumentation_package_name}`.")


def init_instruments(*instruments: INSTRUMENTS, init_all: bool = False) -> None:
    """Instruments the specified libraries, or all that are installed if it is enabled.

    This will check if any libraries are available in the current environment and
    initialize if they are. See the ``INSTRUMENTS_SPECS`` field for the list of
    available libraries.

    :param instruments: Name of libraries to instrument (e.g., `requests`, `openai`)
    :param init_all: If True, initialize all available instruments for imported packages.
    :return:
    """
    # if no instrument explicitly passed, default to trying to instrument all available packages
    if init_all:
        logger.debug("Instrumenting all libraries.")
        instruments = INSTRUMENTS_SPECS.keys()

    for instrument in instruments:
        specs = INSTRUMENTS_SPECS[instrument]
        module_name, instrumentation_module_name, instrumentor_name = specs

        _init_instrument(module_name, instrumentation_module_name, instrumentor_name)


if __name__ == "__main__":
    initialize_tracer()
    tracer = trace.get_tracer(__name__)
    tracker = LocalTrackingClient("otel_test")
    opentel_adapter = OpenTelemetryTracker(burr_tracker=tracker)

    from burr.core import ApplicationBuilder, Result, action, default, expr
    from burr.visibility import TracerFactory

    def slp():
        time.sleep(random.random())

    @action(reads=["count"], writes=["count"])
    def counter(state: State, __tracer: TracerFactory) -> State:
        with __tracer("foo"):
            slp()
            with __tracer("bar"):
                slp()
                with tracer.start_span("baz") as span:
                    with use_span(span, end_on_exit=True):
                        slp()
                    with tracer.start_as_current_span("qux"):
                        slp()
                    with tracer.start_as_current_span("quux"):
                        slp()
                    slp()

                slp()
        return state.update(count=state["count"] + 1)

    result_action = Result("count").with_name("result")
    app = (
        ApplicationBuilder()
        .with_actions(result_action, counter=counter)
        .with_transitions(("counter", "counter", expr("count<10")))
        .with_transitions(("counter", "result", default))
        .with_hooks(opentel_adapter)
        .with_entrypoint("counter")
        # .with_tracker(tracker)
        .with_state(count=0)
        .build()
    )
    app.run(halt_after=["result"])
