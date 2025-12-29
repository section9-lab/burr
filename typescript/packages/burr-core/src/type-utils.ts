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

/**
 * Central collection of reusable type utilities for Burr.
 * 
 * This module provides compile-time type operations used throughout the codebase:
 * - Schema transformations (fix, normalize)
 * - Type merging (union to intersection)
 * - Field extraction (by value type)
 * - Validation (excess properties, constraints)
 * - Conditional logic (mode selection)
 * 
 * @module type-utils
 */

// ============================================================================
// Schema Transformations
// ============================================================================

/**
 * Fixes Zod's empty schema inference to prevent type pollution.
 * 
 * Problem: `z.object({}).pick({})` infers to `Record<string, never>`, which
 * breaks `extends` checks when intersected with other types.
 * 
 * Solution: Convert `Record<string, never>` to `{}` (empty object type).
 * 
 * @example
 * ```typescript
 * // Without fix: Record<string, never> & { a: number } = never (unusable!)
 * // With fix: {} & { a: number } = { a: number } (correct!)
 * type Fixed = FixEmptySchema<Record<string, never>>; // => {}
 * ```
 */
export type FixEmptySchema<T> = T extends Record<string, never> ? {} : T;

// ============================================================================
// Type Merging
// ============================================================================

/**
 * Merges all value types in a record into a single intersection type.
 * 
 * This converts a union of types to an intersection by using distributive
 * conditional types and contravariance. The trick works because:
 * 1. Function parameters are contravariant
 * 2. When inferring from a contravariant position, TypeScript produces an intersection
 * 
 * NOTE: TypeScript's naming is backwards from set theory!
 * - TS `&` (intersection) = merge fields (like set union: A ∪ B)
 * - TS `|` (union) = either/or (like set disjunction: A ∩ B)
 * 
 * @example
 * ```typescript
 * type Actions = {
 *   action1: { reads: { x: number } };
 *   action2: { reads: { y: string } };
 * };
 * 
 * type AllReads = MergeRecordValues<{
 *   [K in keyof Actions]: Actions[K]['reads']
 * }>; // => { x: number } & { y: string }
 * ```
 */
export type MergeRecordValues<TRecord extends Record<string, any>> = 
  (TRecord[keyof TRecord] extends infer U
    ? (U extends any ? (x: U) => void : never) extends (x: infer I) => void 
      ? I 
      : never
    : never);

// ============================================================================
// Field Extraction by Value Type
// ============================================================================

/**
 * Generic utility to extract keys where the value matches a specific type.
 * 
 * This uses mapped types with conditional filtering to extract only the keys
 * whose values extend the target type.
 * 
 * @example
 * ```typescript
 * type Example = {
 *   a: number;
 *   b: string;
 *   c: number;
 *   d: boolean;
 * };
 * 
 * type NumKeys = KeysWhere<Example, number>; // => 'a' | 'c'
 * type StrKeys = KeysWhere<Example, string>; // => 'b'
 * ```
 */
export type KeysWhere<T, ValueType> = {
  [K in keyof T]: T[K] extends ValueType ? K : never;
}[keyof T];

/**
 * Extract keys with number values.
 * Used for operations like `increment()` that only work on numeric fields.
 * 
 * @example
 * ```typescript
 * type State = { count: number; name: string; score: number };
 * type Nums = NumberKeys<State>; // => 'count' | 'score'
 * ```
 */
export type NumberKeys<T> = KeysWhere<T, number>;

/**
 * Extract keys with array values.
 * Used for operations like `append()` and `extend()` that work on arrays.
 * 
 * @example
 * ```typescript
 * type State = { items: string[]; count: number; tags: number[] };
 * type Arrays = ArrayKeys<State>; // => 'items' | 'tags'
 * ```
 */
export type ArrayKeys<T> = KeysWhere<T, Array<any>>;

/**
 * Extract keys with string values.
 * Useful for string-specific operations.
 * 
 * @example
 * ```typescript
 * type State = { name: string; count: number; id: string };
 * type Strings = StringKeys<State>; // => 'name' | 'id'
 * ```
 */
export type StringKeys<T> = KeysWhere<T, string>;

/**
 * Extract the element type from an array type.
 * 
 * @example
 * ```typescript
 * type Arr = string[];
 * type Elem = ArrayElement<Arr>; // => string
 * 
 * type Nested = number[][];
 * type NestedElem = ArrayElement<Nested>; // => number[]
 * ```
 */
export type ArrayElement<T> = T extends Array<infer U> ? U : never;

// ============================================================================
// Validation & Constraints
// ============================================================================

/**
 * Ensures `Actual` has only keys from `Allowed`, showing clear error messages for excess properties.
 * 
 * This is used to enforce write restrictions: when a function declares it writes certain fields,
 * TypeScript will catch attempts to write to undeclared fields at compile-time.
 * 
 * Usage Pattern:
 * ```typescript
 * function update<T extends Partial<Allowed>>(
 *   data: T & NoExcessProperties<Partial<Allowed>, T>
 * ) {
 *   // T is inferred narrowly first, then validated
 * }
 * ```
 * 
 * The `T &` intersection forces TypeScript to infer `T` before applying the constraint,
 * which results in precise type inference and helpful error messages.
 * 
 * @example
 * ```typescript
 * type Allowed = { a: number; b: string };
 * 
 * // ✅ Valid
 * type Valid = { a: number } & NoExcessProperties<Allowed, { a: number }>;
 * 
 * // ❌ Error: Property 'c' is not in writes schema
 * type Invalid = { c: boolean } & NoExcessProperties<Allowed, { c: boolean }>;
 * ```
 */
export type NoExcessProperties<Allowed, Actual> = {
  [K in keyof Actual]: K extends keyof Allowed
    ? Actual[K]
    : `❌ ERROR: Property '${K & string}' is not allowed. Remove it or update schema.`;
};

/**
 * Custom constraint with user-defined error message.
 * Useful for creating domain-specific validation with clear error messages.
 * 
 * @example
 * ```typescript
 * function process<T>(
 *   data: AssertExtends<T, { id: string }, 'Data must have an id field'>
 * ) {
 *   // ...
 * }
 * ```
 */
export type AssertExtends<
  T, 
  U, 
  ErrorMsg extends string = 'Type constraint failed'
> = T extends U 
  ? T 
  : { [K in ErrorMsg]: { expected: U; got: T } };

// ============================================================================
// Conditional Type Selection
// ============================================================================

/**
 * Choose between two types based on whether `Condition` extends `Target`.
 * 
 * This is useful for implementing "mode selection" in builders or APIs where
 * behavior differs based on whether certain type parameters are provided.
 * 
 * @example
 * ```typescript
 * // Bottom-up vs top-down mode
 * type StateType<TProvided> = ChooseType<
 *   TProvided,
 *   never,
 *   ComputedType,  // bottom-up: compute from actions
 *   TProvided      // top-down: use provided type
 * >;
 * ```
 */
export type ChooseType<
  Condition,
  Target,
  IfTrue,
  IfFalse
> = Condition extends Target ? IfTrue : IfFalse;

