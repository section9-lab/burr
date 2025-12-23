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
 * Operations are immutable, serializable objects that can be applied to state.
 */
export interface Operation<T extends Record<string, any>> {
  /** Unique name for this operation type (for serialization) */
  readonly name: string;

  /** Returns the keys this operation reads from state */
  reads(): (keyof T)[];

  /** Returns the keys this operation writes to state */
  writes(): (keyof T)[];

  /** Validates that this operation can be applied to the given state */
  validate(state: T): void;

  /** Applies this operation to state, mutating it in place */
  apply(state: T): void;

  /** Serializes this operation to a JSON-compatible object */
  serialize(): Record<string, any>;
}

/**
 * Constructor interface for operation deserialization
 */
export interface OperationConstructor<T extends Record<string, any>> {
  deserialize(data: Record<string, any>): Operation<T>;
}

// ============================================================================
// Concrete Operation Implementations
// ============================================================================

/**
 * Operation that sets/updates fields in state
 */
export class SetFieldsOperation<T extends Record<string, any>> implements Operation<T> {
  readonly name = 'set';

  constructor(private updates: Partial<T>) {}

  reads(): (keyof T)[] {
    return Object.keys(this.updates) as (keyof T)[];
  }

  writes(): (keyof T)[] {
    return Object.keys(this.updates) as (keyof T)[];
  }

  validate(_state: T): void {
    // No validation needed for set operations
  }

  apply(state: T): void {
    Object.assign(state, this.updates);
  }

  serialize(): Record<string, any> {
    return {
      name: this.name,
      updates: this.updates,
    };
  }

  static deserialize<T extends Record<string, any>>(
    data: Record<string, any>
  ): SetFieldsOperation<T> {
    return new SetFieldsOperation<T>(data.updates);
  }
}

/**
 * Operation that appends a value to an array field
 * Type-safe: only allows appending to array fields with correct element types
 */
export class AppendFieldOperation<T extends Record<string, any>, K extends ArrayKeys<T>>
  implements Operation<T>
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
  implements Operation<T>
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
  implements Operation<T>
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
 * Immutable state container for Burr applications.
 *
 * State is the core data structure that flows through your application.
 * All mutations return new State instances, preserving immutability.
 *
 * @example
 * ```typescript
 * interface ChatState {
 *   messages: string[];
 *   count: number;
 * }
 *
 * const state = new State<ChatState>({ messages: [], count: 0 });
 * const newState = state
 *   .append('messages', 'Hello!')
 *   .increment('count');
 * ```
 */
export class State<T extends Record<string, any>> {
  private readonly _data: T;

  constructor(data: T) {
    this._data = this.deepClone(data);
  }

  /**
   * Applies an operation to this state, returning a new state.
   * This is the core method that all mutations go through.
   *
   * Uses copy-on-write optimization:
   * 1. Shallow copy entire state (cheap - just copies references)
   * 2. Deep clone ONLY fields that are read (structural sharing for others)
   * 3. Mutate in place
   */
  applyOperation(operation: Operation<T>): State<T> {
    // Shallow copy - O(n) where n = number of keys, but just copying references
    const newData = { ...this._data };

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

    // Return new state
    return new State(newData);
  }

  /**
   * Updates state with new field values (upsert operation)
   */
  update(updates: Partial<T>): State<T> {
    return this.applyOperation(new SetFieldsOperation(updates));
  }

  /**
   * Appends a value to an array field (type-safe)
   */
  append<K extends ArrayKeys<T>>(key: K, value: ArrayElement<T[K]>): State<T> {
    return this.applyOperation(new AppendFieldOperation(key, value));
  }

  /**
   * Extends an array field with multiple values (type-safe)
   */
  extend<K extends ArrayKeys<T>>(key: K, values: ArrayElement<T[K]>[]): State<T> {
    return this.applyOperation(new ExtendFieldOperation(key, values));
  }

  /**
   * Increments a numeric field (type-safe)
   */
  increment<K extends NumberKeys<T>>(key: K, delta: number = 1): State<T> {
    return this.applyOperation(new IncrementFieldOperation(key, delta));
  }

  /**
   * Gets a field value from state
   */
  get<K extends keyof T>(key: K): T[K] {
    if (!(key in this._data)) {
      throw new Error(
        `Key "${String(key)}" not found in state. Available keys: ${Object.keys(this._data).join(', ')}`
      );
    }
    return this._data[key];
  }

  /**
   * Checks if a key exists in state
   * Accepts any string key for runtime existence checks
   */
  has(key: string): boolean {
    return key in this._data;
  }

  /**
   * Returns all keys in state
   */
  keys(): (keyof T)[] {
    return Object.keys(this._data) as (keyof T)[];
  }

  /**
   * Returns a copy of all state data
   */
  getAll(): T {
    return { ...this._data };
  }

  /**
   * Returns a subset of state with only specified keys
   */
  subset(...keys: (keyof T)[]): State<T> {
    const subsetData = {} as Partial<T>;
    for (const key of keys) {
      if (key in this._data) {
        subsetData[key] = this._data[key];
      }
    }
    return new State(subsetData as T);
  }

  /**
   * Merges another state into this one (other's values win on conflicts)
   */
  merge(other: State<T>): State<T> {
    return new State({ ...this._data, ...other._data });
  }

  /**
   * Serializes state to JSON-compatible object
   */
  serialize(): T {
    return this._data;
  }

  /**
   * Deserializes state from JSON-compatible object
   */
  static deserialize<T extends Record<string, any>>(data: T): State<T> {
    return new State(data);
  }

  /**
   * Deep clones a value using structuredClone.
   * Handles Date, RegExp, Map, Set, circular references, etc.
   */
  private deepClone<V>(value: V): V {
    return structuredClone(value);
  }
}
