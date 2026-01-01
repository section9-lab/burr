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
import { Action } from './action';
import { z } from 'zod';

/**
 * Result of executing a single step.
 * 
 * @template TStateSchema - The Zod schema type for the application state (allows type narrowing)
 */
export interface StepResult<TStateSchema extends z.ZodType<Record<string, any>> = z.ZodType<Record<string, any>>> {
  /** The action that was executed */
  action: Action<z.ZodObject<any>, z.ZodObject<any>, z.ZodType, z.ZodObject<any> | z.ZodVoid>;
  
  /** The result returned from action.run() */
  result: Record<string, any> | void;
  
  /** The new state after the action */
  state: StateInstance<TStateSchema, TStateSchema, TStateSchema>;
  
  /** Possible next actions (from transitions) */
  next: string[];
}

/**
 * Result of running the application to completion.
 * 
 * @template TStateSchema - The Zod schema type for the application state (allows type narrowing)
 */
export interface RunResult<TStateSchema extends z.ZodType<Record<string, any>> = z.ZodType<Record<string, any>>> {
  /** The final action that was executed (or null if halted before execution) */
  action: Action<z.ZodObject<any>, z.ZodObject<any>, z.ZodType, z.ZodObject<any> | z.ZodVoid> | null;
  
  /** The result from the final action (or null if halted before execution) */
  result: Record<string, any> | void | null;
  
  /** The final state of the application */
  state: StateInstance<TStateSchema, TStateSchema, TStateSchema>;
}

/**
 * Options for controlling execution.
 * 
 * Matches Python's API: halt_before, halt_after, inputs.
 * Note: maxSteps, timeout, and haltCondition are TypeScript-only extensions
 * and not part of the Python API.
 */
export interface ExecutionOptions {
  /** Halt before executing these actions (by name or tag like "@tag:myTag") */
  haltBefore?: string[];
  
  /** Halt after executing these actions (by name or tag like "@tag:myTag") */
  haltAfter?: string[];
}

/**
 * Represents a runnable application.
 * An application combines a graph structure with runtime configuration.
 * 
 * @template TStateSchema - The Zod schema type for the application state (allows type narrowing)
 */
export class Application<TStateSchema extends z.ZodType<Record<string, any>> = z.ZodType<Record<string, any>>> {
  /** The graph defining the structure of the application */
  readonly graph: Graph<TStateSchema>;
  
  /** The name of the action to start execution at */
  readonly entrypoint: string;
  
  /** The initial state of the application */
  readonly initialState: StateInstance<TStateSchema, TStateSchema, TStateSchema>;

  /** @internal Type-level field for state schema tracking (not used at runtime) */
  // @ts-expect-error - This field is only for type-level tracking, not used at runtime
  private readonly _stateSchema!: TStateSchema;

  constructor(
    graph: Graph<TStateSchema>,
    entrypoint: string,
    initialState: StateInstance<TStateSchema, TStateSchema, TStateSchema>
  ) {
    this.graph = graph;
    this.entrypoint = entrypoint;
    this.initialState = initialState;
  }

  /**
   * Executes a single step of the application.
   * 
   * Advances the state machine by one action, executing the next action
   * based on the current state and transitions.
   * 
   * @param inputs - Optional inputs to pass to the action (only used for first step if provided)
   * @returns StepResult containing the action, result, new state, and possible next actions.
   *          Returns null if there is no next action to execute.
   * 
   * @example
   * ```typescript
   * const step = await app.step();
   * if (step) {
   *   console.log(`Executed: ${step.action.name}`);
   *   console.log(`Result:`, step.result);
   *   console.log(`Next actions:`, step.next);
   * }
   * ```
   */
  async step(_inputs?: Record<string, any>): Promise<StepResult<TStateSchema> | null> {
    // TODO: Implement execution logic
    throw new Error('Not implemented');
  }

  /**
   * Runs the application to completion.
   * 
   * Executes steps until a terminal state is reached or a halt condition is met.
   * Does not provide intermediate state access - use iterate() if you need that.
   * 
   * @param inputs - Optional inputs to pass to the first action
   * @param options - Execution options (haltBefore, haltAfter)
   * @returns RunResult containing the final action, result, and state
   * 
   * @example
   * ```typescript
   * const result = await app.run(
   *   { userId: '123' },
   *   { haltAfter: ['final_action'] }
   * );
   * console.log(`Final state:`, result.state.data);
   * ```
   */
  async run(
    _inputs?: Record<string, any>,
    _options?: ExecutionOptions
  ): Promise<RunResult<TStateSchema>> {
    // TODO: Implement execution logic
    throw new Error('Not implemented');
  }

  /**
   * Iterates through the application execution, yielding each step.
   * 
   * Returns an async iterable that yields StepResult for each executed action.
   * This allows you to observe state changes as they happen.
   * 
   * @param inputs - Optional inputs to pass to the first action
   * @param options - Execution options (halt conditions)
   * @returns AsyncIterable that yields StepResult for each step
   * 
   * @example
   * ```typescript
   * for await (const step of app.iterate(
   *   { userId: '123' },
   *   { haltAfter: ['final_action'] }
   * )) {
   *   console.log(`Executed: ${step.action.name}`);
   *   console.log(`State:`, step.state.data);
   *   console.log(`Next:`, step.next);
   * }
   * ```
   */
  async *iterate(
    _inputs?: Record<string, any>,
    _options?: ExecutionOptions
  ): AsyncIterable<StepResult<TStateSchema>> {
    // TODO: Implement execution logic
    throw new Error('Not implemented');
  }
}

