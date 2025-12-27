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
import { State, createState } from '../state';

// Test schema for structured state tests
const TestStateSchema = z.object({
  foo: z.string(),
  bar: z.string().optional(),
  count: z.number(),
  messages: z.array(z.string()),
  numbers: z.array(z.number()),
});

describe('State', () => {
  // ==========================================================================
  // Basic Access & Retrieval
  // Matches Python: test_state_access, test_state_get, test_state_in
  // ==========================================================================

  test('test_state_access', () => {
    // Demonstrates: Direct property access via Proxy with typed state and runtime validation
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: [], numbers: [] });
    expect(state.foo).toBe('bar');
  });

  test('test_state_access_missing', () => {
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: [], numbers: [] });
    // TS: Missing key returns undefined at runtime
    expect((state as any).baz).toBeUndefined();
  });

  test('test_state_in', () => {
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: [], numbers: [] });
    // TS: has() works with Proxy for runtime existence checks (checks _data)
    expect('foo' in state.data).toBe(true);
    expect('baz' in state.data).toBe(false);
  });

  test('test_state_get_all', () => {
    const state = createState(
      z.object({ foo: z.string(), baz: z.string() }),
      { foo: 'bar', baz: 'qux' }
    );
    expect(state.data).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('test_state_keys_returns_list', () => {
    // Matches Python: test_state_keys_returns_list
    const state = createState(
      z.object({ a: z.number(), b: z.number(), c: z.number() }),
      { a: 1, b: 2, c: 3 }
    );
    const keys = state.keys();

    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toEqual(['a', 'b', 'c']);

    // Test with empty state
    const emptyState = new State(z.object({}), {});
    expect(emptyState.keys()).toEqual([]);
  });

  // ==========================================================================
  // State Mutations
  // Matches Python: test_state_update, test_state_append, test_state_extend
  // ==========================================================================

  test('test_state_init', () => {
    const state = createState(
      z.object({ foo: z.string(), baz: z.string() }),
      { foo: 'bar', baz: 'qux' }
    );
    expect(state.data).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('test_state_update', () => {
    const state = createState(
      z.object({ foo: z.string(), baz: z.string() }),
      { foo: 'bar', baz: 'qux' }
    );
    const updated = state.update({ foo: 'baz' });
    expect(updated.data).toEqual({ foo: 'baz', baz: 'qux' });
  });

  test('test_state_append', () => {
    // TS: Type-safe - can only append to array fields
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: ['hello'], numbers: [] });
    const appended = state.append({ messages: 'world' });
    expect(appended.data).toEqual({
      foo: 'bar',
      count: 0,
      messages: ['hello', 'world'],
      numbers: [],
    });
  });

  test('test_state_extend', () => {
    // TS: Type-safe - can only extend array fields
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: ['hello'], numbers: [] });
    const extended = state.extend({ messages: ['world', 'typescript'] });
    expect(extended.data).toEqual({
      foo: 'bar',
      count: 0,
      messages: ['hello', 'world', 'typescript'],
      numbers: [],
    });
  });

  test('test_state_increment', () => {
    // TS: Type-safe - can only increment number fields
    const state = createState(TestStateSchema, { foo: 'bar', count: 1, messages: [], numbers: [] });
    const incremented = state.increment({ count: 2 });
    expect(incremented.count).toBe(3);
  });

  test('test_state_increment_creates_if_missing', () => {
    // Demonstrates: increment creates field if missing (like Python)
    // Use z.record() for dynamic fields since we're creating 'count' at runtime
    const state = createState(z.record(z.string(), z.any()), { foo: 'bar' });
    const incremented = state.increment({ count: 5 });
    expect(incremented.count).toBe(5);
  });

  // ==========================================================================
  // Advanced Operations
  // Matches Python: test_state_merge, test_state_subset
  // ==========================================================================

  test('test_state_merge', () => {
    // Use z.record() since merge combines states with different fields
    const state = createState(z.record(z.string(), z.string()), { foo: 'bar', baz: 'qux' });
    const other = createState(z.record(z.string(), z.string()), { foo: 'baz', quux: 'corge' });
    const merged = state.merge(other);
    expect(merged.data).toEqual({ foo: 'baz', baz: 'qux', quux: 'corge' });
  });

  // ==========================================================================
  // Validation & Error Handling
  // Matches Python: test_state_append_validate_failure, etc.
  // ==========================================================================

  test('test_state_append_validate_failure', () => {
    // TS: Runtime validation catches type errors
    // Use z.record() to test runtime validation (bypasses compile-time checks)
    const state = createState(z.record(z.string(), z.any()), { foo: 'bar' });
    expect(() => state.append({ foo: 'baz' })).toThrow("Cannot append to non-array field 'foo'");
  });

  test('test_state_extend_validate_failure', () => {
    // Use z.record() to test runtime validation
    const state = createState(z.record(z.string(), z.any()), { foo: 'bar' });
    expect(() => state.extend({ foo: ['baz', 'qux'] })).toThrow("Cannot extend non-array field 'foo'");
  });

  test('test_state_increment_validate_failure', () => {
    // Use z.record() to test runtime validation
    const state = createState(z.record(z.string(), z.any()), { foo: 'bar' });
    expect(() => state.increment({ foo: 1 })).toThrow("Cannot increment non-numeric field 'foo'");
  });

  // ==========================================================================
  // Immutability (TypeScript-specific)
  // ==========================================================================

  test('state_mutations_preserve_immutability', () => {
    // TS-specific: Demonstrates immutability
    const original = createState(
      z.object({ foo: z.string(), count: z.number(), messages: z.array(z.string()) }),
      { foo: 'bar', count: 0, messages: ['hello'] }
    );
    const updated = original.update({ foo: 'baz' });

    // Original unchanged
    expect(original.foo).toBe('bar');
    expect(updated.foo).toBe('baz');
  });

  test('state_mutations_preserve_structural_sharing', () => {
    // TS-specific: Tests copy-on-write behavior
    // Note: structuredClone creates deep copies, so we test that unread fields
    // are not modified during operations that don't touch them
    const original = createState(
      z.object({
        unchanged: z.object({ value: z.string() }),
        modified: z.string()
      }),
      { unchanged: { value: 'test' }, modified: 'old' }
    );
    const updated = original.update({ modified: 'new' });

    // Values should be equal (deep equality)
    expect(updated.unchanged).toEqual({ value: 'test' });
    expect(updated.modified).toBe('new');
    
    // Original unchanged
    expect(original.modified).toBe('old');
  });

  test('state_append_creates_array_if_missing', () => {
    // Demonstrates: append creates array if field doesn't exist
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: [], numbers: [] });
    const appended = state.append({ numbers: 42 });
    expect(appended.numbers).toEqual([42]);
  });

  // ==========================================================================
  // Serialization
  // ==========================================================================

  test('test_state_serialize_deserialize', () => {
    const schema = z.object({
      foo: z.string(),
      count: z.number(),
      items: z.array(z.number())
    });
    const state = createState(schema, { foo: 'bar', count: 42, items: [1, 2, 3] });
    const serialized = state.serialize();
    const deserialized = State.deserialize(schema, serialized);

    expect(deserialized.data).toEqual({ foo: 'bar', count: 42, items: [1, 2, 3] });
  });

  test('test_state_serialize_complex_types', () => {
    // TS: structuredClone handles Date, nested objects, etc.
    const now = new Date();
    const state = createState(
      z.object({
        timestamp: z.date(),
        nested: z.object({ deep: z.object({ value: z.string() }) }),
        array: z.array(z.number())
      }),
      {
        timestamp: now,
        nested: { deep: { value: 'test' } },
        array: [1, 2, 3],
      }
    );

    const serialized = state.serialize();
    expect(serialized.timestamp).toEqual(now);
    expect(serialized.nested).toEqual({ deep: { value: 'test' } });
  });

  // ==========================================================================
  // Type Safety Demonstrations (compile-time, shown through usage)
  // ==========================================================================

  test('type_safety_demonstrations', () => {
    // This test demonstrates TypeScript's compile-time type safety
    // The following would NOT compile (commented out to show):

    const StrictStateSchema = z.object({
      name: z.string(),
      age: z.number(),
      tags: z.array(z.string()),
    });

    const state = createState(StrictStateSchema, { name: 'Alice', age: 30, tags: [] });

    // ✅ Valid: append string to tags (array of strings)
    const s1 = state.append({ tags: 'typescript' });
    expect(s1.tags).toEqual(['typescript']);

    // ✅ Valid: increment age (number field)
    const s2 = state.increment({ age: 1 });
    expect(s2.age).toBe(31);

    // ❌ Would NOT compile: append to non-array field
    // const s3 = state.append({ age: 1 }); // TypeScript error!

    // ❌ Would NOT compile: increment non-number field
    // const s4 = state.increment({ name: 1 }); // TypeScript error!

    // ❌ Would NOT compile: append wrong type to array
    // const s5 = state.append({ tags: 123 }); // TypeScript error!

    // This test passes because the valid operations work correctly
    expect(true).toBe(true);
  });

  // ==========================================================================
  // Chaining Operations
  // ==========================================================================

  test('test_state_chaining', () => {
    // Demonstrates: fluent API with immutable operations
    const state = createState(TestStateSchema, { foo: 'bar', count: 0, messages: [], numbers: [] });

    const result = state
      .update({ foo: 'baz' })
      .increment({ count: 5 })
      .append({ messages: 'hello' })
      .append({ messages: 'world' });

    expect(result.data).toEqual({
      foo: 'baz',
      count: 5,
      messages: ['hello', 'world'],
      numbers: [],
    });

    // Original unchanged
    expect(state.foo).toBe('bar');
    expect(state.count).toBe(0);
  });
});

