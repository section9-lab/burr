/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

// Application runtime and execution engine

import { Graph } from './graph';
import { StateInstance } from './state';

/**
 * Represents a runnable application.
 * An application combines a graph structure with runtime configuration.
 * 
 * This is an immutable data container - execution logic will be added in future phases.
 * 
 * @template TStateType - The inferred state type for this application
 */
export class Application<TStateType = Record<string, any>> {
  /** The graph defining the structure of the application */
  readonly graph: Graph<TStateType>;
  
  /** The name of the action to start execution at */
  readonly entrypoint: string;
  
  /** The initial state of the application */
  readonly initialState: StateInstance<any, any, any>;

  /** @internal Type-level field for state type tracking (not used at runtime) */
  // @ts-expect-error - This field is only for type-level tracking, not used at runtime
  private readonly _stateType!: TStateType;

  constructor(
    graph: Graph<TStateType>,
    entrypoint: string,
    initialState: StateInstance<any, any, any>
  ) {
    this.graph = graph;
    this.entrypoint = entrypoint;
    this.initialState = initialState;
  }
}

