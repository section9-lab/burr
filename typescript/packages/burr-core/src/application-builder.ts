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
import {
  UseIfNotSet,
  EnsureRecordSchema,
  ConditionalValidate
} from './type-utils';

/**
 * Selects final schema: if app schema not set, use graph schema; otherwise use app schema.
 * Domain-specific utility for ApplicationBuilder.build() method.
 */
type SelectFinalSchema<
  TAppSchema extends z.ZodType,
  TGraphSchema extends z.ZodType
> = [TAppSchema] extends [z.ZodNever]
  ? [TGraphSchema] extends [z.ZodNever]
    ? z.ZodNever
    : TGraphSchema
  : TAppSchema;

/**
 * Validates schema compatibility and returns either SuccessType or error type.
 * Avoids duplication of ConditionalValidate calls in method signatures.
 */
type ValidatedOrError<
  TNew extends z.ZodType,
  TExisting extends z.ZodType,
  SuccessType,
  ErrorMsg extends string = '❌ Schema constraint violation'
> = ConditionalValidate<TNew, TExisting, ErrorMsg> extends z.ZodType
  ? SuccessType
  : ConditionalValidate<TNew, TExisting, ErrorMsg>;

/**
 * Immutable builder for constructing applications.
 * Each method returns a new builder instance.
 * 
 * Separates concerns:
 * - Graph defines structure (actions + transitions) and computes required state schema
 * - ApplicationBuilder defines runtime (entrypoint + initial state) and validates state
 * 
 * Type safety:
 * - TAppStateSchema: The application's state schema (from explicit generic or withState)
 * - TGraphStateSchema: The graph's required state schema (computed from actions)
 * - Validation: TAppStateSchema must extend TGraphStateSchema (application state is superset of graph requirements)
 * 
 * @template TAppStateSchema - Application state schema type (defaults to never for inference)
 * @template TGraphStateSchema - Graph's required state schema type (internal, set by withGraph)
 */
export class ApplicationBuilder<
  TAppStateSchema extends z.ZodType | z.ZodNever = z.ZodNever,
  TGraphStateSchema extends z.ZodType | z.ZodNever = z.ZodNever
> {
  private readonly _graph: Graph<TGraphStateSchema> | null;
  private readonly _entrypoint: string | null;
  private readonly _initialState: StateInstance<any, any, any> | null;

  constructor(
    graph: Graph<TGraphStateSchema> | null = null,
    entrypoint: string | null = null,
    initialState: StateInstance<any, any, any> | null = null
  ) {
    this._graph = graph;
    this._entrypoint = entrypoint;
    this._initialState = initialState;
  }

  /**
   * Set the graph for this application.
   * The graph defines the structure (actions and transitions) and required state schema.
   * 
   * When TAppStateSchema is not set (never), infers from graph.
   * Otherwise, validates at compile-time that TAppStateSchema's inferred type extends TNewGraphStateSchema's inferred type.
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
  withGraph<TNewGraphStateSchema extends z.ZodType<Record<string, any>>>(
    graph: ValidatedOrError<
      TAppStateSchema,
      TNewGraphStateSchema,
      Graph<TNewGraphStateSchema>,
      '❌ State schema must extend graph requirements'
    >
  ): ApplicationBuilder<
    UseIfNotSet<TAppStateSchema, TNewGraphStateSchema>,
    TNewGraphStateSchema
  > {
    if (this._graph !== null) {
      throw new Error(
        'Graph is already set. ApplicationBuilder.withGraph() can only be called once.'
      );
    }

    // Type guard to ensure graph is actually a Graph, not an error type
    if (!('actions' in graph)) {
      throw new Error('Invalid graph provided');
    }

    return new ApplicationBuilder<
      UseIfNotSet<TAppStateSchema, TNewGraphStateSchema>,
      TNewGraphStateSchema
    >(
      graph as Graph<TNewGraphStateSchema>,
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
  withEntrypoint(actionName: string): ApplicationBuilder<TAppStateSchema, TGraphStateSchema> {
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

    return new ApplicationBuilder<TAppStateSchema, TGraphStateSchema>(
      this._graph, 
      actionName, 
      this._initialState
    );
  }

  /**
   * Set the initial state for this application.
   * 
   * When TAppStateSchema is not set (never), infers from state schema.
   * Validates at compile-time that state schema's inferred type extends graph requirements (if graph is set).
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
    initialState: ValidatedOrError<
      TNewStateSchema,
      TGraphStateSchema,
      StateInstance<TNewStateSchema, TNewStateSchema, TNewStateSchema>,
      '❌ State schema must extend graph requirements'
    >
  ): ApplicationBuilder<
    UseIfNotSet<TAppStateSchema, TNewStateSchema>,
    TGraphStateSchema
  > {
    if (this._initialState !== null) {
      throw new Error(
        'Initial state is already set. ApplicationBuilder.withState() can only be called once.'
      );
    }

    return new ApplicationBuilder<
      UseIfNotSet<TAppStateSchema, TNewStateSchema>,
      TGraphStateSchema
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
   * @returns Immutable Application instance with typed state schema
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
  build(): Application<EnsureRecordSchema<SelectFinalSchema<TAppStateSchema, TGraphStateSchema>>> {
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

    // At runtime, we've validated that state and graph are set
    // Type assertion is safe because withState/withGraph enforce the constraint at the API boundary
    // EnsureRecordSchema ensures the constraint is satisfied
    type FinalStateSchema = EnsureRecordSchema<SelectFinalSchema<TAppStateSchema, TGraphStateSchema>>;

    return new Application(
      this._graph! as Graph<FinalStateSchema>,
      this._entrypoint!,
      this._initialState! as StateInstance<FinalStateSchema, FinalStateSchema, FinalStateSchema>
    ) as Application<FinalStateSchema>;
  }
}

