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

# Apache Burr (TypeScript)

TypeScript implementation of Apache Burr - a framework for building applications that make decisions (chatbots, agents, simulations, etc.) from simple building blocks.

## Status

🚧 **Work in Progress** - This is an active port of the Python implementation. APIs may change.

## Structure

- `packages/burr-core/` - Core library (state machine, actions, application)
- `examples/` - TypeScript examples
- `tests/` - Integration tests

## Getting Started

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

## Documentation

See the main [Burr documentation](https://burr.apache.org/) for concepts and guides. TypeScript-specific documentation coming soon.

## Compatibility

This implementation aims to match the Python version's core functionality with TypeScript idioms and best practices.

