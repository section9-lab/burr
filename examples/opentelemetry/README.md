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

# OpenTelemetry + Burr

This goes over how to use Burr with OpenTelemetry.

We have two modes:

1. Log OpenTelemetry traces to the Burr UI
2. Log Burr to OpenTelemetry

See [notebook.ipynb](./notebook.ipynb) for a simple overview.
See [application.py](./application.py) for the full code.

## Streaming Telemetry

For streaming actions, the `OpenTelemetryBridge` supports four configurable
telemetry modes via `StreamingTelemetryMode`:

- **SINGLE_SPAN** (default) — one action span with streaming attributes (generation time, consumer time, TTFT)
- **EVENT** — no action span, single summary event on the method span
- **CHUNK_SPANS** — per-yield child spans measuring generation time only
- **SINGLE_AND_CHUNK_SPANS** — action span with attributes + per-yield child spans

See [streaming_telemetry_modes.py](./streaming_telemetry_modes.py) for a runnable
demo exercising all four modes with the console exporter.

See the [documentation](https://burr.dagworks.io/concepts/additional-visibility/#open-telemetry) for more info
