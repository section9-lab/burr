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

// ============================================================================
// Framework Metadata Schemas
// ============================================================================

/**
 * Application metadata - frozen for the lifecycle of this execution.
 * Set once at application initialization, never changes during execution.
 * 
 * Stored in state as: state.appMetadata
 */
export const AppMetadataSchema = z.object({
  /** Unique identifier for this application instance */
  appId: z.string(),
  
  /** Optional partition key for grouping/querying application runs */
  partitionKey: z.string().optional(),
  
  /** The entrypoint action name where execution starts */
  entrypoint: z.string(),
});

export type AppMetadata = z.infer<typeof AppMetadataSchema>;

/**
 * Execution metadata - changes on every step.
 * Tracks the runtime state of execution flow.
 * 
 * Stored in state as: state.executionMetadata
 */
export const ExecutionMetadataSchema = z.object({
  /** Current sequence number (increments on each step, starts at 0) */
  sequenceId: z.number(),
  
  /** 
   * Name of the last executed action.
   * Used by graph to determine next action via transitions.
   * Undefined at start (before first action is executed).
   */
  priorStep: z.string().optional(),
});

export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;

/**
 * Combined framework metadata that gets merged into user state.
 * Application state will include: UserData & FrameworkMetadata
 */
export interface FrameworkMetadata {
  /** Application-level metadata (immutable during execution) */
  appMetadata: AppMetadata;
  
  /** Execution-level metadata (updates each step) */
  executionMetadata: ExecutionMetadata;
}

// ============================================================================
// Type Helpers for State with Metadata
// ============================================================================

/**
 * Application's internal state schema = user's state schema + framework metadata.
 * This is what Application works with internally.
 */
type TApplicationStateSchema<TStateSchema extends z.ZodType<Record<string, any>>> = 
  z.ZodType<z.infer<TStateSchema> & FrameworkMetadata>;

/**
 * StateInstance with framework metadata included.
 * This is the type of state that Application manages and returns to users.
 */
type ApplicationStateInstance<TStateSchema extends z.ZodType<Record<string, any>>> = 
  StateInstance<
    TApplicationStateSchema<TStateSchema>,
    TApplicationStateSchema<TStateSchema>,
    TApplicationStateSchema<TStateSchema>
  >;

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * Base execution result structure.
 * Used by both step() and run() to return consistent data.
 * 
 * @template TStateSchema - The user's state schema (without metadata)
 */
export interface ExecutionResult<TStateSchema extends z.ZodType<Record<string, any>>> {
  /** The action that was executed (null if halted before execution) */
  action: Action<z.ZodObject<any>, z.ZodObject<any>, z.ZodType, z.ZodObject<any> | z.ZodVoid> | null;
  
  /** The result returned from action.run() (null if halted before execution or no result) */
  result: Record<string, any> | void | null;
  
  /** 
   * The state after the action.
   * Includes user data + framework metadata (appMetadata, executionMetadata)
   */
  state: ApplicationStateInstance<TStateSchema>;
}

/**
 * Result of executing a single step.
 * Extends ExecutionResult with next action information.
 * 
 * @template TStateSchema - The user's state schema (without metadata)
 */
export interface StepResult<TStateSchema extends z.ZodType<Record<string, any>>> 
  extends ExecutionResult<TStateSchema> {
  /** 
   * The action that was executed.
   * Non-null for StepResult (step() returns null instead of a result when terminal)
   */
  action: Action<z.ZodObject<any>, z.ZodObject<any>, z.ZodType, z.ZodObject<any> | z.ZodVoid>;
  
  /** The result returned from action.run() */
  result: Record<string, any> | void;
}

/**
 * Result of running the application to completion.
 * Same as ExecutionResult - no additional fields needed.
 * 
 * @template TStateSchema - The user's state schema (without metadata)
 */
export type RunResult<TStateSchema extends z.ZodType<Record<string, any>>> = 
  ExecutionResult<TStateSchema>;

/**
 * Options for controlling execution.
 * 
 * Matches Python's API: halt_before, halt_after, inputs.
 * Note: maxSteps, timeout, and haltCondition are TypeScript-only extensions
 * and not part of the Python API.
 */
export interface ExecutionOptions {
  /** Runtime inputs to pass to actions */
  inputs?: Record<string, any>;
  
  /** Halt before executing these actions (by name or tag like "@tag:myTag") */
  haltBefore?: string[];
  
  /** Halt after executing these actions (by name or tag like "@tag:myTag") */
  haltAfter?: string[];
}

/**
 * Represents a runnable application.
 * An application combines a graph structure with runtime configuration.
 * 
 * @template TStateSchema - The user's state schema (without framework metadata)
 */
export class Application<TStateSchema extends z.ZodType<Record<string, any>> = z.ZodType<Record<string, any>>> {
  /** The graph defining the structure of the application */
  readonly graph: Graph<TStateSchema>;
  
  /** The name of the action to start execution at */
  readonly entrypoint: string;
  
  /** Application unique identifier */
  readonly appId: string;
  
  /** Optional partition key for grouping/querying application runs */
  readonly partitionKey?: string;
  
  /** Internal runtime state (includes user data + framework metadata) */
  private _state: ApplicationStateInstance<TStateSchema>;

  /** @internal Type-level field for state schema tracking (not used at runtime) */
  // @ts-expect-error - This field is only for type-level tracking, not used at runtime
  private readonly _stateSchema!: TStateSchema;

  constructor(
    graph: Graph<TStateSchema>,
    entrypoint: string,
    initialState: StateInstance<TStateSchema, TStateSchema, TStateSchema>,
    appId: string,
    partitionKey?: string,
    initialSequenceId?: number
  ) {
    this.graph = graph;
    this.entrypoint = entrypoint;
    this.appId = appId;
    this.partitionKey = partitionKey;
    
    // Extend user's state with framework metadata
    this._state = initialState.update({
      appMetadata: {
        appId,
        partitionKey,
        entrypoint,
      },
      executionMetadata: {
        sequenceId: initialSequenceId ?? 0,
        // priorStep starts undefined
      },
    } as any) as ApplicationStateInstance<TStateSchema>;
  }
  
  /**
   * Get the current state (includes metadata).
   */
  get state(): ApplicationStateInstance<TStateSchema> {
    return this._state;
  }
  
  /**
   * Get current execution metadata.
   */
  private get executionMetadata() {
    return (this._state.data).executionMetadata;
  }
  
  /**
   * Increment the sequence ID.
   */
  private incrementSequenceId(): void {
    this._state = this._state.update({
      executionMetadata: {
        ...this.executionMetadata,
        sequenceId: this.executionMetadata.sequenceId + 1,
      }
    } as any) as ApplicationStateInstance<TStateSchema>;
  }
  
  /**
   * Set the prior step (last executed action name).
   */
  private setPriorStep(actionName: string): void {
    this._state = this._state.update({
      executionMetadata: {
        ...this.executionMetadata,
        priorStep: actionName,
      }
    } as any) as ApplicationStateInstance<TStateSchema>;
  }

  /**
   * Get the next action to execute based on current state.
   * @internal
   */
  private getNextAction(): Action<any, any, any, any> | null {
    const priorStep = this.executionMetadata.priorStep;
    
    // If no prior step, start at entrypoint
    if (!priorStep) {
      const action = this.graph.getAction(this.entrypoint);
      return action || null;
    }
    
    // Get transitions from the prior action
    const transitions = this.graph.getTransitionsFrom(priorStep);
    
    // Evaluate transitions in order until one matches
    for (const transition of transitions) {
      // No condition = always transition (default condition)
      const conditionMet = !transition.condition || transition.condition(this._state.data);
      
      if (conditionMet) {
        // Check if this is a terminal transition
        if (transition.to === null) {
          return null;
        }
        
        const action = this.graph.getAction(transition.to);
        return action || null;
      }
    }
    
    // No transitions found - terminal state
    return null;
  }
  
  /**
   * Executes a single step of the application.
   * 
   * Advances the state machine by one action, executing the next action
   * based on the current state and transitions.
   * 
   * @param options - Execution options (inputs, halt conditions)
   * @returns StepResult containing the action, result, new state, and possible next actions.
   *          Returns null if there is no next action to execute.
   * 
   * @example
   * ```typescript
   * const step = await app.step({ inputs: { userId: '123' } });
   * if (step) {
   *   console.log(`Result:`, step.result);
   *   console.log(`Next actions:`, step.next);
   * }
   * ```
   */
  async step(options?: ExecutionOptions): Promise<StepResult<TStateSchema> | null> {
    // Get inputs - default to empty object for convenience (void validation accepts {})
    const inputs = options?.inputs || {};
    
    // Increment sequence ID before execution
    this.incrementSequenceId();
    
    // Get next action
    const nextAction = this.getNextAction();
    if (!nextAction) {
      return null; // Terminal state
    }
    
    try {
      // Execute action (run + update phases)
      // First, run the action to get the result
      const result = await nextAction.run({ state: this._state, inputs });
      
      // Then update state with the result
      const writesState = nextAction.update({ result, state: this._state, inputs });
      
      // Merge writes back into the full application state (preserving unwritten fields)
      const mergedData = { ...this._state.data, ...writesState.data };
      this._state = this._state.update(mergedData as any) as ApplicationStateInstance<TStateSchema>;
      
      // Update priorStep to track execution history
      const actionName = nextAction.name || 'unknown';
      this.setPriorStep(actionName);
      
      return {
        action: nextAction,
        result,
        state: this._state
      };
    } catch (error) {
      // TODO: Format error message like Python (include action name, state, inputs)
      // For now, re-throw with basic context
      if (error instanceof Error) {
        const actionName = nextAction.name || 'unknown';
        throw new Error(`Error executing action '${actionName}': ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  /**
   * Runs the application to completion.
   * 
   * Executes steps until a terminal state is reached or a halt condition is met.
   * Does not provide intermediate state access - use iterate() if you need that.
   * 
   * @param options - Execution options (inputs, haltBefore, haltAfter)
   * @returns RunResult containing the final action, result, and state
   * 
   * @example
   * ```typescript
   * const result = await app.run({
   *   inputs: { userId: '123' },
   *   haltAfter: ['final_action']
   * });
   * console.log(`Final state:`, result.state.data);
   * ```
   */
  async run(options?: ExecutionOptions): Promise<RunResult<TStateSchema>> {
    const haltBefore = options?.haltBefore || [];
    const haltAfter = options?.haltAfter || [];
    const inputs = options?.inputs || {};
    
    let lastAction: Action<any, any, any, any> | null = null;
    let lastResult: Record<string, any> | void | null = null;
    
    while (true) {
      // Check halt_before condition
      const nextAction = this.getNextAction();
      if (nextAction && haltBefore.includes(nextAction.name || '')) {
        // Halt before executing this action
        return {
          action: nextAction,
          result: null, // Didn't execute, so no result
          state: this._state
        };
      }
      
      // Execute a step
      const stepResult = await this.step({ inputs });
      
      // If terminal (no more actions), return
      if (!stepResult) {
        // TODO: Add warning if lastAction is null (no actions were executed)
        // Python considers this undefined behavior: app starts at terminal state with no actions available.
        // Should warn user to fix state machine or halt conditions.
        return {
          action: lastAction,
          result: lastResult,
          state: this._state
        };
      }
      
      // Update tracking
      lastAction = stepResult.action;
      lastResult = stepResult.result;
      
      // Check halt_after condition
      if (haltAfter.includes(stepResult.action.name || '')) {
        return {
          action: stepResult.action,
          result: stepResult.result,
          state: stepResult.state
        };
      }
    }
  }

  /**
   * Iterates through the application execution, yielding each step.
   * 
   * Returns an async iterable that yields StepResult for each executed action.
   * This allows you to observe state changes as they happen.
   * 
   * @param options - Execution options (inputs, halt conditions)
   * @returns AsyncIterable that yields StepResult for each step
   * 
   * @example
   * ```typescript
   * for await (const step of app.iterate({
   *   inputs: { userId: '123' },
   *   haltAfter: ['final_action']
   * })) {
   *   console.log(`State:`, step.state.data);
   *   console.log(`Next:`, step.next);
   * }
   * ```
   */
  async *iterate(options?: ExecutionOptions): AsyncIterable<StepResult<TStateSchema>> {
    const haltBefore = options?.haltBefore || [];
    const haltAfter = options?.haltAfter || [];
    const inputs = options?.inputs || {};
    
    while (true) {
      // Check halt_before condition
      const nextAction = this.getNextAction();
      if (nextAction && haltBefore.includes(nextAction.name || '')) {
        // Halt before executing this action
        break;
      }
      
      // Execute a step
      const stepResult = await this.step({ inputs });
      
      // If terminal (no more actions), stop
      if (!stepResult) {
        break;
      }
      
      // Yield the step result
      yield stepResult;
      
      // Check halt_after condition
      if (haltAfter.includes(stepResult.action.name || '')) {
        break;
      }
    }
  }
}

