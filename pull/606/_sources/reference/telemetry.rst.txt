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


==============================
Usage analytics + data privacy
==============================

By default, when using Burr, it collects anonymous usage data to help improve Burr and know where to apply development efforts.

We capture events on the following occasions:

1. When an application is built
2. When one of the ``execution`` functions is run in ``Application``
3. When a CLI command is run

The captured data is limited to:

- Operating System and Python version
- A persistent UUID to indentify the session, stored in ~/.burr.conf.
- The name of the function/CLI command that was run

If you're worried, see ``telemetry.py`` for details.

If you do not wish to participate, one can opt-out with one of the following methods:

1. Set it to false programmatically in your code before creating a Burr application builder:

.. code-block:: python

    from burr import telemetry
    telemetry.disable_telemetry()

2. Set the key telemetry_enabled to false in ``~/.burr.conf`` under the DEFAULT section:

.. code-block:: ini

    [DEFAULT]
    telemetry_enabled = False

3. Set BURR_TELEMETRY_ENABLED=false as an environment variable. Either setting it for your shell session:

.. code-block:: bash

    export BURR_TELEMETRY_ENABLED=false

or passing it as part of the run command:

.. code-block:: bash

    BURR_TELEMETRY_ENABLED=false python NAME_OF_MY_DRIVER.py
