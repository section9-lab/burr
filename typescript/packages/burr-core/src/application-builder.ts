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

// Application builder with fluent API

import { z } from 'zod';
import { Graph } from './graph';
import { StateInstance } from './state';
import { Application } from './application';

/**
 * Immutable builder for constructing applications.
 * Each method returns a new builder instance.
 * 
 * Separates concerns:
 * - Graph defines structure (actions + transitions) and computes required state type
 * - ApplicationBuilder defines runtime (entrypoint + initial state) and validates state
 * 
 * Type safety:
 * - TAppState: The application's state type (from explicit generic or withState)
 * - TGraphState: The graph's required state type (computed from actions)
 * - Validation: TAppState must extend TGraphState (application state is superset of graph requirements)
 * 
 * @template TAppState - Application state type (defaults to never for inference)
 * @template TGraphState - Graph's required state type (internal, set by withGraph)
 */
export class ApplicationBuilder<
  TAppState = never,
  TGraphState = never
> {
  private readonly _graph: Graph<any> | null;
  private readonly _entrypoint: string | null;
  private readonly _initialState: StateInstance<any, any, any> | null;

  constructor(
    graph: Graph<any> | null = null,
    entrypoint: string | null = null,
    initialState: StateInstance<any, any, any> | null = null
  ) {
    this._graph = graph;
    this._entrypoint = entrypoint;
    this._initialState = initialState;
  }

  /**
   * Set the graph for this application.
   * The graph defines the structure (actions and transitions) and required state type.
   * 
   * When TAppState is not set (never), infers from graph.
   * Otherwise, validates at compile-time that TAppState extends TNewGraphState.
   * 
   * @param graph - Graph built with GraphBuilder
   * @returns New ApplicationBuilder instance with graph set
   * @throws Error if graph is already set or state incompatible with graph
   * 
   * @example
   * ```typescript
   * const app = new ApplicationBuilder()
   *   .withGraph(myGraph)
   *   .withEntrypoint('start')
   *   .withState(initialState)
   *   .build();
   * ```
   */
  withGraph<TNewGraphState>(
    graph: [TAppState] extends [never]
      ? Graph<TNewGraphState>
      : TAppState extends TNewGraphState
        ? Graph<TNewGraphState>
        : Graph<TNewGraphState> & {
            '❌ ERROR: State is missing fields required by graph': {
              'Graph requires': TNewGraphState;
              'State provides': TAppState;
              'Fix': 'Add missing fields to your state schema';
            };
          }
  ): ApplicationBuilder<
    [TAppState] extends [never] ? TNewGraphState : TAppState,
    TNewGraphState
  > {
    if (this._graph !== null) {
      throw new Error(
        'Graph is already set. ApplicationBuilder.withGraph() can only be called once.'
      );
    }

    return new ApplicationBuilder<
      [TAppState] extends [never] ? TNewGraphState : TAppState,
      TNewGraphState
    >(
      graph as any,
      this._entrypoint,
      this._initialState
    );
  }

  /**
   * Set the entrypoint action for this application.
   * This is the first action that will be executed.
   * 
   * @param actionName - Name of the action to start at
   * @returns New ApplicationBuilder instance with entrypoint set
   * @throws Error if entrypoint is already set or if graph is not set
   * 
   * @example
   * ```typescript
   * builder.withEntrypoint('myStartAction')
   * ```
   */
  withEntrypoint(actionName: string): ApplicationBuilder<TAppState, TGraphState> {
    if (this._entrypoint !== null) {
      throw new Error(
        'Entrypoint is already set. ApplicationBuilder.withEntrypoint() can only be called once.'
      );
    }

    if (this._graph === null) {
      throw new Error(
        'Graph must be set before entrypoint. Call withGraph() first.'
      );
    }

    // Validate entrypoint exists in graph
    if (!this._graph.hasAction(actionName)) {
      const availableActions = this._graph.getActionNames();
      throw new Error(
        `Entrypoint action '${actionName}' not found in graph. ` +
        `Available actions: ${availableActions.join(', ')}`
      );
    }

    return new ApplicationBuilder<TAppState, TGraphState>(
      this._graph, 
      actionName, 
      this._initialState
    );
  }

  /**
   * Set the initial state for this application.
   * 
   * When TAppState is not set (never), infers from state.
   * Validates at compile-time that state type extends graph requirements (if graph is set).
   * 
   * @param initialState - State instance created with createState()
   * @returns New ApplicationBuilder instance with state set
   * @throws Error if state is already set or state doesn't match graph requirements
   * 
   * @example
   * ```typescript
   * const state = createState(
   *   z.object({ count: z.number() }),
   *   { count: 0 }
   * );
   * builder.withState(state)
   * ```
   */
  withState<TNewStateSchema extends z.ZodType<Record<string, any>>>(
    initialState: [TGraphState] extends [never]
      ? StateInstance<TNewStateSchema, any, any>
      : z.infer<TNewStateSchema> extends TGraphState
        ? StateInstance<TNewStateSchema, any, any>
        : StateInstance<TNewStateSchema, any, any> & {
            '❌ ERROR: State is missing fields required by graph': {
              'Graph requires': TGraphState;
              'State provides': z.infer<TNewStateSchema>;
              'Fix': 'Add missing fields to your state schema';
            };
          }
  ): ApplicationBuilder<
    [TAppState] extends [never] ? z.infer<TNewStateSchema> : TAppState,
    TGraphState
  > {
    if (this._initialState !== null) {
      throw new Error(
        'Initial state is already set. ApplicationBuilder.withState() can only be called once.'
      );
    }

    return new ApplicationBuilder<
      [TAppState] extends [never] ? z.infer<TNewStateSchema> : TAppState,
      TGraphState
    >(
      this._graph,
      this._entrypoint,
      initialState as any
    );
  }

  /**
   * Build the final application.
   * Validates that all required components are set.
   * 
   * @returns Immutable Application instance with typed state
   * @throws Error if graph, entrypoint, or state is not set
   * 
   * @example
   * ```typescript
   * const app = new ApplicationBuilder()
   *   .withGraph(graph)
   *   .withEntrypoint('start')
   *   .withState(initialState)
   *   .build();
   * ```
   */
  build(): Application<
    [TAppState] extends [never] 
      ? [TGraphState] extends [never]
        ? Record<string, any>
        : TGraphState
      : TAppState
  > {
    // Validate all required components are set
    if (this._graph === null) {
      throw new Error(
        'Cannot build application without graph. Call withGraph() before build().'
      );
    }

    if (this._entrypoint === null) {
      throw new Error(
        'Cannot build application without entrypoint. Call withEntrypoint() before build().'
      );
    }

    if (this._initialState === null) {
      throw new Error(
        'Cannot build application without initial state. Call withState() before build().'
      );
    }

    // TypeScript can't narrow the conditional type properly, so we use type assertion
    return new Application(
      this._graph as any,
      this._entrypoint,
      this._initialState as any
    ) as any;
  }
}

