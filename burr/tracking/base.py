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

import abc
import datetime
import time
from typing import Any, Optional

from burr.lifecycle import (
    PostApplicationCreateHook,
    PostEndSpanHook,
    PostRunStepHook,
    PreRunStepHook,
    PreStartSpanHook,
)
from burr.lifecycle.base import (
    DoLogAttributeHook,
    PostEndStreamHook,
    PostStreamGenerateHook,
    PostStreamItemHook,
    PreStartStreamHook,
    PreStreamGenerateHook,
)


class SyncTrackingClient(
    PostApplicationCreateHook,
    PreRunStepHook,
    PostRunStepHook,
    PreStartSpanHook,
    PostEndSpanHook,
    DoLogAttributeHook,
    PreStartStreamHook,
    PostStreamItemHook,
    PostEndStreamHook,
    PreStreamGenerateHook,
    PostStreamGenerateHook,
    abc.ABC,
):
    """Base class for synchronous tracking clients.

    Inherits from PreStreamGenerateHook/PostStreamGenerateHook so that all
    tracker implementations automatically accumulate generation-vs-consumer
    timing for streaming actions. The accumulated data is written to the
    EndStreamModel in post_end_stream.

    Subclasses do NOT need to override pre_stream_generate/post_stream_generate
    unless they want custom behavior — the default implementations here handle
    timing accumulation using the StreamState dataclass.

    TODO -- create an async tracking client
    """

    def pre_stream_generate(
        self,
        *,
        item_index: int,
        stream_initialize_time: datetime.datetime,
        action: str,
        sequence_id: int,
        app_id: str,
        partition_key: Optional[str],
        **future_kwargs: Any,
    ):
        """Records the start of a single generator __next__() call.

        Uses defensive getattr to access stream_state so that custom subclasses
        that don't call super().__init__() or don't have stream_state won't crash.
        """
        stream_state = getattr(self, "stream_state", None)
        if stream_state is None:
            return
        key = (app_id, action, partition_key)
        state = stream_state.get(key)
        if state is None:
            return

        now_ns = time.monotonic_ns()
        state._pre_generate_ns = now_ns

        # Record the stream start time on the first yield
        if state.stream_start_ns is None:
            state.stream_start_ns = now_ns

        # Consumer time = gap between previous post_stream_generate and this
        # pre_stream_generate. On the first call there's no previous post, so
        # consumer_time stays at 0.
        if state.last_post_generate_ns is not None:
            state.consumer_time_ns += now_ns - state.last_post_generate_ns

    def post_stream_generate(
        self,
        *,
        item: Any,
        item_index: int,
        stream_initialize_time: datetime.datetime,
        action: str,
        sequence_id: int,
        app_id: str,
        partition_key: Optional[str],
        exception: Optional[Exception] = None,
        **future_kwargs: Any,
    ):
        """Records the end of a single generator __next__() call.

        Accumulates generation_time_ns from the paired pre_stream_generate call,
        tracks iteration_count, and captures first_item_time_ns for TTFT.

        Uses defensive getattr to access stream_state so that custom subclasses
        that don't call super().__init__() or don't have stream_state won't crash.
        """
        stream_state = getattr(self, "stream_state", None)
        if stream_state is None:
            return
        key = (app_id, action, partition_key)
        state = stream_state.get(key)
        if state is None:
            return

        now_ns = time.monotonic_ns()
        state.last_post_generate_ns = now_ns

        # Accumulate generation time (time spent inside the generator)
        if state._pre_generate_ns is not None:
            state.generation_time_ns += now_ns - state._pre_generate_ns
            state._pre_generate_ns = None

        # Track iteration count (only for actual items, not StopIteration)
        if item is not None:
            state.iteration_count += 1

        # Capture TTFT (time from stream start to first item)
        if state.first_item_time_ns is None and item is not None:
            if state.stream_start_ns is not None:
                state.first_item_time_ns = now_ns - state.stream_start_ns

    @abc.abstractmethod
    def copy(self):
        pass


TrackingClient = SyncTrackingClient
