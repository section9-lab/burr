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

import { z } from 'zod';
import { State, StateInstance } from './state';

/**
 * Helper type to enforce strict return type checking for update functions.
 * Forces TypeScript to validate the return type at definition time, not usage time.
 */
type UpdateFunction<
  TReadsSchema extends z.ZodType<Record<string, any>>,
  TWritesSchema extends z.ZodType<Record<string, any>>,
  TInputsSchema extends z.ZodType,
  TResultSchema extends z.ZodObject<any> | z.ZodVoid
> = (params: {
  result: z.infer<TResultSchema>;
  state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
  inputs: z.infer<TInputsSchema>;
}) => StateInstance<z.ZodType<z.infer<TWritesSchema>>, any, any>;

/**
 * Two-step action with separate run and update phases.
 *
 * Actions are the core execution units in Burr. They:
 * - Read from state (subset defined by reads schema)
 * - Execute async logic (run method)
 * - Transform results into state writes (update method)
 *
 * The two-step pattern enables:
 * - Event sourcing: store results and replay updates
 * - Testing: test computation and state transformation separately
 * - Audit trails: track what was computed vs. what was stored
 */
export class Action<
  TReadsSchema extends z.ZodType<Record<string, any>>,
  TWritesSchema extends z.ZodType<Record<string, any>>,
  TInputsSchema extends z.ZodType,
  TResultSchema extends z.ZodObject<any> | z.ZodVoid
> {
  // Schemas
  private readonly _reads: TReadsSchema;
  private readonly _writes: TWritesSchema;
  private readonly _inputs: TInputsSchema;
  private readonly _result: TResultSchema;

  // User-provided functions
  private readonly _runFn: (params: {
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }) => Promise<z.infer<TResultSchema>>;

  private readonly _updateFn: (params: {
    result: z.infer<TResultSchema>;
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }) => StateInstance<z.ZodType<z.infer<TWritesSchema>>, any, any>;

  // Cached metadata
  private readonly _readsKeys: readonly string[];
  private readonly _writesKeys: readonly string[];
  private readonly _inputsKeys: readonly string[];

  constructor(config: {
    reads: TReadsSchema;
    writes: TWritesSchema;
    inputs: TInputsSchema;
    result: TResultSchema;
    run: (params: {
      state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
      inputs: z.infer<TInputsSchema>;
    }) => Promise<z.infer<TResultSchema>>;
    update: (params: {
      result: z.infer<TResultSchema>;
      state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
      inputs: z.infer<TInputsSchema>;
    }) => StateInstance<z.ZodType<z.infer<TWritesSchema>>, any, any>;
  }) {
    this._reads = config.reads;
    this._writes = config.writes;
    this._inputs = config.inputs;
    this._result = config.result;
    this._runFn = config.run;
    this._updateFn = config.update;

    // Extract and cache metadata
    this._readsKeys = this.extractKeys(config.reads);
    this._writesKeys = this.extractKeys(config.writes);
    this._inputsKeys = this.extractKeys(config.inputs);
  }

  /**
   * Extract keys from Zod schema.
   * Returns empty array for non-object schemas (e.g., z.void() for inputs).
   */
  private extractKeys(schema: z.ZodType): readonly string[] {
    if (schema instanceof z.ZodObject) {
      return Object.keys(schema.shape);
    }
    return [];  // z.void() or other non-object schemas
  }

  /**
   * Validate data against schema with contextual error messages.
   */
  private validate(data: unknown, schema: z.ZodType, context: string): void {
    try {
      schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Action validation failed for ${context}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Keys that this action reads from state
   */
  get reads(): readonly string[] {
    return this._readsKeys;
  }

  /**
   * Keys that this action writes to state
   */
  get writes(): readonly string[] {
    return this._writesKeys;
  }

  /**
   * Keys for runtime inputs
   */
  get inputs(): readonly string[] {
    return this._inputsKeys;
  }

  /**
   * Schemas for validation
   */
  get schema() {
    return {
      reads: this._reads,
      writes: this._writes,
      inputs: this._inputs,
      result: this._result,
    } as const;
  }

  /**
   * Execute the action's computation.
   * Validates state and inputs, calls user's run function, validates result.
   *
   * @param params - Parameters object
   * @param params.state - State instance with reads/writes restrictions
   * @param params.inputs - Runtime inputs that match inputs schema
   * @returns Result object that matches result schema
   */
  async run(params: {
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }): Promise<z.infer<TResultSchema>> {
    const { state, inputs } = params;
    
    // Validate inputs
    this.validate(state.data, this._reads, 'state (reads)');
    this.validate(inputs, this._inputs, 'inputs');

    // Execute user function
    const result = await this._runFn({ state, inputs });

    // Validate result
    this.validate(result, this._result, 'result');

    return result;
  }

  /**
   * Transform result into state writes.
   * Validates result and state, calls user's update function, validates writes.
   *
   * @param params - Parameters object
   * @param params.result - Result from run method
   * @param params.state - State instance (for reference)
   * @param params.inputs - Runtime inputs (for convenience)
   * @returns State with writes applied
   */
  update(params: {
    result: z.infer<TResultSchema>;
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }): StateInstance<z.ZodType<z.infer<TWritesSchema>>, any, any> {
    const { result, state, inputs } = params;
    
    // Validate inputs
    this.validate(result, this._result, 'result');
    this.validate(state.data, this._reads, 'state (reads)');
    this.validate(inputs, this._inputs, 'inputs');

    // Execute user function
    const updatedState = this._updateFn({ result, state, inputs });

    // Validate that the returned state contains the required writes
    this.validate(updatedState.data, this._writes, 'writes');

    return updatedState;
  }

  /**
   * Execute the full action (run + update) with a full application state.
   * This is the method applications use to execute actions.
   *
   * @param params - Parameters object
   * @param params.state - The full application state (unrestricted)
   * @param params.inputs - Runtime inputs
   * @returns State containing the writes (for merging back into app state)
   */
  async execute(params: {
    state: StateInstance<any, any, any>;
    inputs: z.infer<TInputsSchema>;
  }): Promise<StateInstance<z.ZodType<z.infer<TWritesSchema>>, any, any>> {
    const { state: fullAppState, inputs } = params;
    
    // Extract reads subset from full app state
    const readsData = this._reads.parse(fullAppState.data);

    // Create action-scoped restricted state
    const actionState = State.forAction(this._reads, this._writes, readsData) as StateInstance<
      TReadsSchema,
      TReadsSchema,
      TWritesSchema
    >;

    // Run the action
    const result = await this.run({ state: actionState, inputs });

    // Update and return writes
    const writesState = this.update({ result, state: actionState, inputs });

    return writesState;
  }
}

/**
 * Creates a two-step action with separate run and update phases.
 *
 * Actions work with State instances, providing direct property access and
 * immutable updates. Result must be an object (z.object) or void (z.void).
 *
 * @example
 * ```typescript
 * // Full action with run and update
 * const myAction = defineAction({
 *   reads: z.object({ count: z.number() }),
 *   writes: z.object({ count: z.number() }),
 *   inputs: z.object({ delta: z.number() }),
 *   result: z.object({ newCount: z.number() }),
 *
 *   run: async ({ state, inputs }) => ({
 *     newCount: state.count + inputs.delta  // Direct property access
 *   }),
 *
 *   update: ({ result, state }) => {
 *     return state.update({ count: result.newCount });  // Returns State
 *   }
 * });
 *
 * // Simple action without run (for direct state transformations)
 * const incrementAction = defineAction({
 *   reads: z.object({ count: z.number() }),
 *   writes: z.object({ count: z.number() }),
 *   // No result specified, run defaults to () => ({})
 *   update: ({ state }) => state.update({ count: state.count + 1 })
 * });
 * ```
 */

// Overload 1: When result is specified, run is required
export function defineAction<
  TReadsSchema extends z.ZodType<Record<string, any>>,
  TWritesSchema extends z.ZodType<Record<string, any>>,
  TInputsSchema extends z.ZodType,
  TResultSchema extends z.ZodObject<any> | z.ZodVoid
>(config: {
  reads: TReadsSchema;
  writes: TWritesSchema;
  inputs?: TInputsSchema;
  result: TResultSchema;
  run: (params: {
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }) => Promise<z.infer<TResultSchema>>;
  update: UpdateFunction<TReadsSchema, TWritesSchema, TInputsSchema, TResultSchema>;
}): Action<TReadsSchema, TWritesSchema, TInputsSchema, TResultSchema>;

// Overload 2: When result is NOT specified, run is optional (defaults to empty object)
export function defineAction<
  TReadsSchema extends z.ZodType<Record<string, any>>,
  TWritesSchema extends z.ZodType<Record<string, any>>,
  TInputsSchema extends z.ZodType = z.ZodVoid
>(config: {
  reads: TReadsSchema;
  writes: TWritesSchema;
  inputs?: TInputsSchema;
  result?: never;
  run?: (params: {
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }) => Promise<Record<string, never>>;
  update: UpdateFunction<TReadsSchema, TWritesSchema, TInputsSchema, z.ZodObject<{}>>;
}): Action<TReadsSchema, TWritesSchema, TInputsSchema, z.ZodObject<{}>>;

// Implementation
export function defineAction<
  TReadsSchema extends z.ZodType<Record<string, any>>,
  TWritesSchema extends z.ZodType<Record<string, any>>,
  TInputsSchema extends z.ZodType = z.ZodVoid,
  TResultSchema extends z.ZodObject<any> | z.ZodVoid = z.ZodObject<{}>
>(config: {
  reads: TReadsSchema;
  writes: TWritesSchema;
  inputs?: TInputsSchema;
  result?: TResultSchema;
  run?: (params: {
    state: StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
    inputs: z.infer<TInputsSchema>;
  }) => Promise<z.infer<TResultSchema>>;
  update: UpdateFunction<TReadsSchema, TWritesSchema, TInputsSchema, TResultSchema>;
}): Action<TReadsSchema, TWritesSchema, TInputsSchema, TResultSchema> {
  // Default run function returns empty object for simple actions
  const defaultRun = async () => ({}) as z.infer<TResultSchema>;
  
  // Default result schema is empty object
  const defaultResult = z.object({}) as TResultSchema;
  
  return new Action({
    reads: config.reads,
    writes: config.writes,
    inputs: (config.inputs ?? z.void()) as TInputsSchema,
    result: (config.result ?? defaultResult) as TResultSchema,
    run: (config.run ?? defaultRun) as typeof config.run extends undefined 
      ? typeof defaultRun 
      : NonNullable<typeof config.run>,
    update: config.update,
  });
}
