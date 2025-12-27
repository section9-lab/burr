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

// ============================================================================
// Type Utilities for Type-Safe State Operations
// ============================================================================

/**
 * Extracts keys from T that have number values
 */
export type NumberKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

/**
 * Extracts keys from T that have array values
 */
export type ArrayKeys<T> = {
  [K in keyof T]: T[K] extends Array<any> ? K : never;
}[keyof T];

/**
 * Extracts the element type from an array type
 */
export type ArrayElement<T> = T extends Array<infer U> ? U : never;

// ============================================================================
// Operation Interface
// ============================================================================

/**
 * Represents a state transformation operation.
 * Type parameters track input and output state shapes for compile-time tracking.
 * 
 * @template TIn - Input state shape
 * @template TOut - Output state shape (may be extended with new fields)
 */
export interface Operation<
  TIn extends Record<string, any>,
  TOut extends Record<string, any> = TIn
> {
  /** Unique name for this operation type (for serialization) */
  readonly name: string;

  /** Returns the keys this operation reads from state */
  reads(): (keyof TIn)[];

  /** Returns the keys this operation writes to state */
  writes(): (keyof TOut)[];

  /** Validates that this operation can be applied to the given state */
  validate(state: TIn): void;

  /** Applies this operation to state, mutating it in place */
  apply(state: TIn): void;

  /** Serializes this operation to a JSON-compatible object */
  serialize(): Record<string, any>;
  
  /** Returns Zod schema extensions for new fields (empty object if no extensions) */
  schemaExtensions(): Record<string, z.ZodTypeAny>;
}

/**
 * Constructor interface for operation deserialization
 */
export interface OperationConstructor<
  TIn extends Record<string, any>,
  TOut extends Record<string, any> = TIn
> {
  deserialize(data: Record<string, any>): Operation<TIn, TOut>;
}

// ============================================================================
// Concrete Operation Implementations
// ============================================================================

/**
 * Operation that sets/updates fields in state.
 * TOut = TIn & TUpdates (output includes new fields from updates)
 */
export class SetFieldsOperation<
  TIn extends Record<string, any>,
  TUpdates extends Record<string, any> = Partial<TIn>
> implements Operation<TIn, TIn & TUpdates> {
  readonly name = 'set';

  constructor(private updates: TUpdates) {}

  reads(): (keyof TIn)[] {
    return Object.keys(this.updates) as (keyof TIn)[];
  }

  writes(): (keyof (TIn & TUpdates))[] {
    return Object.keys(this.updates) as (keyof (TIn & TUpdates))[];
  }

  schemaExtensions(): Record<string, z.ZodTypeAny> {
    // New fields get z.unknown() schema
    const extensions: Record<string, z.ZodTypeAny> = {};
    for (const key in this.updates) {
      extensions[key] = z.unknown();
    }
    return extensions;
  }

  validate(_state: TIn): void {
    // No validation needed for set operations
  }

  apply(state: TIn): void {
    Object.assign(state, this.updates);
  }

  serialize(): Record<string, any> {
    return {
      name: this.name,
      updates: this.updates,
    };
  }

  static deserialize<TIn extends Record<string, any>>(
    data: Record<string, any>
  ): SetFieldsOperation<TIn> {
    return new SetFieldsOperation<TIn>(data.updates);
  }
}

/**
 * Operation that appends a value to an array field
 * Type-safe: only allows appending to array fields with correct element types
 */
export class AppendFieldOperation<T extends Record<string, any>, K extends ArrayKeys<T>>
  implements Operation<T, T>
{
  readonly name = 'append';

  constructor(
    private key: K,
    private value: ArrayElement<T[K]>
  ) {}

  reads(): (keyof T)[] {
    return [this.key];
  }

  writes(): (keyof T)[] {
    return [this.key];
  }

  schemaExtensions(): Record<string, z.ZodTypeAny> {
    // No new fields added
    return {};
  }

  validate(state: T): void {
    const current = state[this.key];
    if (current !== undefined && !Array.isArray(current)) {
      throw new Error(
        `Cannot append to non-array field '${String(this.key)}'. Current type: ${typeof current}`
      );
    }
  }

  apply(state: T): void {
    const current = state[this.key] as any[] | undefined;
    if (current === undefined) {
      (state[this.key] as any) = [this.value];
    } else {
      current.push(this.value);
    }
  }

  serialize(): Record<string, any> {
    return {
      name: this.name,
      key: this.key,
      value: this.value,
    };
  }

  static deserialize<T extends Record<string, any>, K extends ArrayKeys<T>>(
    data: Record<string, any>
  ): AppendFieldOperation<T, K> {
    return new AppendFieldOperation<T, K>(data.key, data.value);
  }
}

/**
 * Operation that extends an array field with multiple values
 */
export class ExtendFieldOperation<T extends Record<string, any>, K extends ArrayKeys<T>>
  implements Operation<T, T>
{
  readonly name = 'extend';

  constructor(
    private key: K,
    private values: ArrayElement<T[K]>[]
  ) {}

  reads(): (keyof T)[] {
    return [this.key];
  }

  writes(): (keyof T)[] {
    return [this.key];
  }

  schemaExtensions(): Record<string, z.ZodTypeAny> {
    // No new fields added
    return {};
  }

  validate(state: T): void {
    const current = state[this.key];
    if (current !== undefined && !Array.isArray(current)) {
      throw new Error(
        `Cannot extend non-array field '${String(this.key)}'. Current type: ${typeof current}`
      );
    }
  }

  apply(state: T): void {
    const current = state[this.key] as any[] | undefined;
    if (current === undefined) {
      (state[this.key] as any) = [...this.values];
    } else {
      current.push(...this.values);
    }
  }

  serialize(): Record<string, any> {
    return {
      name: this.name,
      key: this.key,
      values: this.values,
    };
  }

  static deserialize<T extends Record<string, any>, K extends ArrayKeys<T>>(
    data: Record<string, any>
  ): ExtendFieldOperation<T, K> {
    return new ExtendFieldOperation<T, K>(data.key, data.values);
  }
}

/**
 * Operation that increments a numeric field
 * Type-safe: only allows incrementing number fields
 */
export class IncrementFieldOperation<T extends Record<string, any>, K extends NumberKeys<T>>
  implements Operation<T, T>
{
  readonly name = 'increment';

  constructor(
    private key: K,
    private delta: number = 1
  ) {}

  reads(): (keyof T)[] {
    return [this.key];
  }

  writes(): (keyof T)[] {
    return [this.key];
  }

  schemaExtensions(): Record<string, z.ZodTypeAny> {
    // No new fields added
    return {};
  }

  validate(state: T): void {
    const current = state[this.key];
    if (current !== undefined && typeof current !== 'number') {
      throw new Error(
        `Cannot increment non-numeric field '${String(this.key)}'. Current type: ${typeof current}`
      );
    }
  }

  apply(state: T): void {
    const current = (state[this.key] as number | undefined) ?? 0;
    (state[this.key] as any) = current + this.delta;
  }

  serialize(): Record<string, any> {
    return {
      name: this.name,
      key: this.key,
      delta: this.delta,
    };
  }

  static deserialize<T extends Record<string, any>, K extends NumberKeys<T>>(
    data: Record<string, any>
  ): IncrementFieldOperation<T, K> {
    return new IncrementFieldOperation<T, K>(data.key, data.delta);
  }
}

// ============================================================================
// Operation Registry for Deserialization
// ============================================================================

/**
 * Global registry for operation types
 * Allows deserialization of operations from JSON
 */
export class OperationRegistry {
  private static registry = new Map<string, OperationConstructor<any>>();

  /**
   * Register an operation type for deserialization
   */
  static register<T extends Record<string, any>>(
    name: string,
    constructor: OperationConstructor<T>
  ): void {
    this.registry.set(name, constructor);
  }

  /**
   * Deserialize an operation from JSON data
   */
  static deserialize<T extends Record<string, any>>(data: Record<string, any>): Operation<T> {
    const constructor = this.registry.get(data.name);
    if (!constructor) {
      throw new Error(`Unknown operation type: ${data.name}`);
    }
    return constructor.deserialize(data);
  }

  /**
   * Check if an operation type is registered
   */
  static has(name: string): boolean {
    return this.registry.has(name);
  }
}

// Register built-in operations
OperationRegistry.register('set', SetFieldsOperation);
OperationRegistry.register('append', AppendFieldOperation);
OperationRegistry.register('extend', ExtendFieldOperation);
OperationRegistry.register('increment', IncrementFieldOperation);

// ============================================================================
// State Class
// ============================================================================

/**
 * Immutable state container for Burr applications with optional read/write restrictions.
 *
 * State is the core data structure that flows through your application.
 * All mutations return new State instances, preserving immutability.
 *
 * Requires a Zod schema for runtime validation. Optionally supports read/write
 * restrictions for use in actions.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const ChatStateSchema = z.object({
 *   messages: z.array(z.string()),
 *   count: z.number()
 * });
 *
 * // Unrestricted state (default)
 * const state = createState(ChatStateSchema, { messages: [], count: 0 });
 * const newState = state.update({ count: 1 });
 *
 * // Restricted state (for actions)
 * const restricted = State.forAction(
 *   z.object({ messages: z.array(z.string()) }),  // reads
 *   z.object({ count: z.number() }),              // writes
 *   { messages: [] }
 * );
 * ```
 */
// State class with Proxy-based property access
// The actual class merges with the readable data type via Proxy
export type StateInstance<
  TSchema extends z.ZodType<Record<string, any>>,
  TReadableSchema extends z.ZodType<Record<string, any>> = TSchema,
  TWritableSchema extends z.ZodType<Record<string, any>> = TSchema
> = State<TSchema, TReadableSchema, TWritableSchema> & z.infer<TSchema>;

export class State<
  TSchema extends z.ZodType<Record<string, any>>,
  TReadableSchema extends z.ZodType<Record<string, any>> = TSchema,
  TWritableSchema extends z.ZodType<Record<string, any>> = TSchema
> {
  private readonly _data: z.infer<TSchema>;
  private readonly _schema: TSchema;
  private readonly _readableSchema: TReadableSchema;
  private readonly _writableSchema: TWritableSchema;

  /**
   * Creates a new State instance with runtime validation and optional restrictions.
   *
   * @param schema - Zod schema for the full state data
   * @param data - The initial state data
   * @param options - Optional read/write restrictions
   * @throws {z.ZodError} If the data doesn't match the schema
   */
  constructor(
    schema: TSchema,
    data: z.infer<TSchema>,
    options?: {
      readable?: TReadableSchema;
      writable?: TWritableSchema;
    }
  ) {
    this._schema = schema;
    this._readableSchema = (options?.readable ?? schema) as TReadableSchema;
    this._writableSchema = (options?.writable ?? schema) as TWritableSchema;

    // Validate restrictions are subsets of main schema
    if (options?.readable) {
      this.validateSubset(schema, options.readable, 'readable');
    }
    if (options?.writable) {
      this.validateSubset(schema, options.writable, 'writable');
    }

    // Validate and clone the data
    const validatedData = this._schema.parse(data);
    this._data = this.deepClone(validatedData);

    // Return Proxy for direct property access
    return new Proxy(this, {
      get(target, prop) {
        // If accessing a State method or private field, return it
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        // Otherwise, access data property (typed by TReadableSchema)
        const data = target._data as Record<string, any>;
        return data[prop as string];
      },
    }) as StateInstance<TSchema, TReadableSchema, TWritableSchema>;
  }

  /**
   * Validates that a subset schema only contains keys present in the parent schema.
   * Only validates ZodObject schemas (other types pass through).
   */
  private validateSubset(
    parentSchema: z.ZodType,
    subsetSchema: z.ZodType,
    name: string
  ): void {
    // Only validate for ZodObject types
    if (!(parentSchema instanceof z.ZodObject && subsetSchema instanceof z.ZodObject)) {
      return;
    }

    const parentKeys = Object.keys(parentSchema.shape);
    const subsetKeys = Object.keys(subsetSchema.shape);
    const invalidKeys = subsetKeys.filter((k) => !parentKeys.includes(k));

    if (invalidKeys.length > 0) {
      throw new Error(
        `${name} schema contains keys not in parent schema: ${invalidKeys.join(', ')}`
      );
    }
  }

  /**
   * Applies an operation to this state, returning a new state.
   * This is the core method that all mutations go through.
   *
   * Uses copy-on-write optimization:
   * 1. Shallow copy entire state (cheap - just copies references)
   * 2. Deep clone ONLY fields that are read (structural sharing for others)
   * 3. Mutate in place
   * 4. Validate against schema
   */
  applyOperation<TOut extends Record<string, any>>(
    operation: Operation<Record<string, any>, TOut>
  ): StateInstance<z.ZodType<TOut>, TReadableSchema, TWritableSchema> {
    // Shallow copy - O(n) where n = number of keys, but just copying references
    const newData = { ...this._data } as Record<string, any>;

    // Deep clone only the fields that will be read/modified
    // This enables structural sharing: unchanged fields still reference original objects
    for (const key of operation.reads()) {
      if (key in newData) {
        newData[key] = this.deepClone(newData[key]);
      }
    }

    // Validate before applying
    operation.validate(newData);

    // Apply mutation in place (no additional copy!)
    operation.apply(newData);

    // Extend schema if operation adds new fields
    const extensions = operation.schemaExtensions();
    const extendedSchema = 
      this._schema instanceof z.ZodObject && Object.keys(extensions).length > 0
        ? this._schema.extend(extensions)
        : this._schema;

    // Validate against extended schema after operation
    const validatedData = extendedSchema.parse(newData);

    // Return new State instance with extended schema
    // Cast through unknown: runtime has correct schema, TypeScript can't verify alignment
    return new State(extendedSchema, validatedData, {
      readable: this._readableSchema,
      writable: this._writableSchema,
    }) as unknown as StateInstance<z.ZodType<TOut>, TReadableSchema, TWritableSchema>;
  }

  /**
   * Updates state with new field values (upsert operation).
   * Dynamically extends the schema to include new fields, maintaining alignment
   * between runtime schema and compile-time types.
   * 
   * Only allows updating fields defined in the writable schema.
   */
  update<const TUpdates extends Partial<z.infer<TWritableSchema>>>(
    updates: TUpdates
  ): StateInstance<
    TSchema extends z.ZodObject<infer TShape>
      ? z.ZodObject<TShape & { [K in keyof TUpdates]: z.ZodType<TUpdates[K]> }>
      : z.ZodType<z.infer<TSchema> & TUpdates>,
    TReadableSchema,
    TWritableSchema
  > {
    // Runtime validation: ensure updates match writable schema
    if (this._writableSchema instanceof z.ZodObject) {
      this._writableSchema.partial().parse(updates);
    }

    // Extend the schema with new fields
    let extendedSchema: any;
    if (this._schema instanceof z.ZodObject) {
      const extension: Record<string, z.ZodTypeAny> = {};
      for (const key in updates) {
        if (!(key in this._schema.shape)) {
          extension[key] = z.unknown();
        }
      }
      extendedSchema = Object.keys(extension).length > 0
        ? this._schema.extend(extension)
        : this._schema;
    } else {
      extendedSchema = this._schema;
    }

    // Create new data
    const newData = { ...this._data, ...updates };

    // Return new State with extended schema
    return new State(extendedSchema, newData, {
      readable: this._readableSchema,
      writable: this._writableSchema,
    }) as any;
  }

  /**
   * Appends values to one or more array fields (type-safe).
   * Only allows appending to fields defined in the writable schema.
   * 
   * @example
   * state.append({ items: newItem, tags: newTag })
   */
  append<TUpdates extends {
    [K in ArrayKeys<z.infer<TWritableSchema>>]?: ArrayElement<z.infer<TWritableSchema>[K]>;
  }>(
    updates: TUpdates
  ): StateInstance<TSchema, TReadableSchema, TWritableSchema> {
    let currentState: StateInstance<TSchema, TReadableSchema, TWritableSchema> = this as any;
    
    for (const [key, value] of Object.entries(updates)) {
      currentState = currentState.applyOperation<z.infer<TSchema>>(
        new AppendFieldOperation<Record<string, any>, ArrayKeys<Record<string, any>>>(
          key as ArrayKeys<Record<string, any>>,
          value
        )
      ) as StateInstance<TSchema, TReadableSchema, TWritableSchema>;
    }
    
    return currentState;
  }

  /**
   * Extends one or more array fields with multiple values (type-safe).
   * Only allows extending fields defined in the writable schema.
   * 
   * @example
   * state.extend({ items: [item1, item2], tags: [tag1, tag2] })
   */
  extend<TUpdates extends {
    [K in ArrayKeys<z.infer<TWritableSchema>>]?: ArrayElement<z.infer<TWritableSchema>[K]>[];
  }>(
    updates: TUpdates
  ): StateInstance<TSchema, TReadableSchema, TWritableSchema> {
    let currentState: StateInstance<TSchema, TReadableSchema, TWritableSchema> = this as any;
    
    for (const [key, values] of Object.entries(updates)) {
      currentState = currentState.applyOperation<z.infer<TSchema>>(
        new ExtendFieldOperation<Record<string, any>, ArrayKeys<Record<string, any>>>(
          key as ArrayKeys<Record<string, any>>,
          values as any[]
        )
      ) as StateInstance<TSchema, TReadableSchema, TWritableSchema>;
    }
    
    return currentState;
  }

  /**
   * Increments one or more numeric fields (type-safe).
   * Only allows incrementing fields defined in the writable schema.
   * 
   * @example
   * state.increment({ count: 1, score: 5 })
   */
  increment<TUpdates extends {
    [K in NumberKeys<z.infer<TWritableSchema>>]?: number;
  }>(
    updates: TUpdates
  ): StateInstance<TSchema, TReadableSchema, TWritableSchema> {
    let currentState: StateInstance<TSchema, TReadableSchema, TWritableSchema> = this as any;
    
    for (const [key, delta] of Object.entries(updates)) {
      currentState = currentState.applyOperation<z.infer<TSchema>>(
        new IncrementFieldOperation<Record<string, any>, NumberKeys<Record<string, any>>>(
          key as NumberKeys<Record<string, any>>,
          delta as number
        )
      ) as StateInstance<TSchema, TReadableSchema, TWritableSchema>;
    }
    
    return currentState;
  }

  /**
   * Returns all keys in state
   */
  keys(): string[] {
    return Object.keys(this._data as Record<string, any>);
  }

  /**
   * Returns the underlying data (for internal use by actions/application)
   */
  get data(): z.infer<TSchema> {
    return this._data;
  }

  /**
   * Merges another state into this one (other's values win on conflicts)
   */
  merge(other: State<TSchema, any, any>): StateInstance<TSchema, TReadableSchema, TWritableSchema> {
    const mergedData = {
      ...(this._data as Record<string, any>),
      ...(other._data as Record<string, any>),
    } as z.infer<TSchema>;
    return new State(this._schema, mergedData, {
      readable: this._readableSchema,
      writable: this._writableSchema,
    }) as StateInstance<TSchema, TReadableSchema, TWritableSchema>;
  }

  /**
   * Serializes state to JSON-compatible object
   */
  serialize(): z.infer<TSchema> {
    return this._data;
  }

  /**
   * Deserializes state from JSON-compatible object with schema validation.
   * This ensures that loaded state matches the expected schema.
   *
   * @param schema - Zod schema to validate against
   * @param data - The serialized state data
   * @throws {z.ZodError} If the data doesn't match the schema
   */
  static deserialize<TSchema extends z.ZodType<Record<string, any>>>(
    schema: TSchema,
    data: z.infer<TSchema>
  ): StateInstance<TSchema, TSchema, TSchema> {
    return new State(schema, data) as StateInstance<TSchema, TSchema, TSchema>;
  }

  /**
   * Creates a restricted state for use in actions.
   * The state can read from 'reads' schema and write to 'writes' schema.
   *
   * @param reads - Schema defining readable fields
   * @param writes - Schema defining writable fields
   * @param data - Initial data matching the reads schema
   */
  static forAction<
    TReadsSchema extends z.ZodType<Record<string, any>>,
    TWritesSchema extends z.ZodType<Record<string, any>>
  >(
    reads: TReadsSchema,
    writes: TWritesSchema,
    data: z.infer<TReadsSchema>
  ): StateInstance<TReadsSchema, TReadsSchema, TWritesSchema> {
    return new State(reads, data, {
      readable: reads,
      writable: writes,
    }) as StateInstance<TReadsSchema, TReadsSchema, TWritesSchema>;
  }

  /**
   * Deep clones a value using structuredClone.
   * Handles Date, RegExp, Map, Set, circular references, etc.
   */
  private deepClone<V>(value: V): V {
    return structuredClone(value);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper function to create an unrestricted State with automatic type inference from schema.
 * This provides better DX by inferring the type parameter from the schema.
 *
 * @example
 * ```typescript
 * const MyStateSchema = z.object({
 *   count: z.number(),
 *   name: z.string()
 * });
 *
 * const state = createState(MyStateSchema, { count: 0, name: 'test' });
 * // Can read and write all fields
 * ```
 */
export function createState<TSchema extends z.ZodType<Record<string, any>>>(
  schema: TSchema,
  initialData: z.infer<TSchema>
): StateInstance<TSchema, TSchema, TSchema> {
  return new State(schema, initialData) as StateInstance<TSchema, TSchema, TSchema>;
}
