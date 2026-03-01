..
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


========
Tracking
========

Reference on the Tracking/Telemetry API.
Rather, you should use this through/in conjunction with :py:meth:`burr.core.application.ApplicationBuilder.with_tracker`.


.. autoclass:: burr.tracking.LocalTrackingClient
   :members:

   .. automethod:: __init__

Streaming Timing
~~~~~~~~~~~~~~~~

For streaming actions, the tracker automatically accumulates timing data by implementing
``PreStreamGenerateHook`` and ``PostStreamGenerateHook``. When a streaming action completes,
the ``end_stream`` log entry includes the following optional timing fields:

- ``generation_time_ms`` — Sum of time spent inside the generator producing items (excludes consumer wait time).
- ``consumer_time_ms`` — Sum of time the consumer spent processing yielded items between yields.
- ``first_item_time_ms`` — Time from stream start to first item produced (time to first token / TTFT).

These fields are ``null`` when the streaming timing hooks have not fired (e.g. old log files or
non-instrumented generators). The Burr UI renders these fields in the step detail view when
available, falling back to the legacy throughput calculation otherwise.
