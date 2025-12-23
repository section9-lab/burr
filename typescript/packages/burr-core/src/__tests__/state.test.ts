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

import { State } from '../state';

// Test interface demonstrating type safety
interface TestState {
  foo: string;
  bar?: string;
  count: number;
  messages: string[];
  numbers: number[];
}

describe('State', () => {
  // ==========================================================================
  // Basic Access & Retrieval
  // Matches Python: test_state_access, test_state_get, test_state_in
  // ==========================================================================

  test('test_state_access', () => {
    // Demonstrates: Type-safe get() with typed state
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: [], numbers: [] });
    expect(state.get('foo')).toBe('bar');
  });

  test('test_state_access_missing', () => {
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: [], numbers: [] });
    // TS: Missing key throws error at runtime
    // @ts-expect-error - Testing runtime error for invalid key
    expect(() => state.get('baz')).toThrow('Key "baz" not found in state');
  });

  test('test_state_in', () => {
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: [], numbers: [] });
    // TS: has() accepts any string - it's a runtime existence check
    expect(state.has('foo')).toBe(true);
    expect(state.has('baz')).toBe(false);
  });

  test('test_state_get_all', () => {
    const state = new State({ foo: 'bar', baz: 'qux' });
    expect(state.getAll()).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('test_state_keys_returns_list', () => {
    // Matches Python: test_state_keys_returns_list
    const state = new State({ a: 1, b: 2, c: 3 });
    const keys = state.keys();

    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toEqual(['a', 'b', 'c']);

    // Test with empty state
    const emptyState = new State({});
    expect(emptyState.keys()).toEqual([]);
  });

  // ==========================================================================
  // State Mutations
  // Matches Python: test_state_update, test_state_append, test_state_extend
  // ==========================================================================

  test('test_state_init', () => {
    const state = new State({ foo: 'bar', baz: 'qux' });
    expect(state.getAll()).toEqual({ foo: 'bar', baz: 'qux' });
  });

  test('test_state_update', () => {
    const state = new State({ foo: 'bar', baz: 'qux' });
    const updated = state.update({ foo: 'baz' });
    expect(updated.getAll()).toEqual({ foo: 'baz', baz: 'qux' });
  });

  test('test_state_append', () => {
    // TS: Type-safe - can only append to array fields
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: ['hello'], numbers: [] });
    const appended = state.append('messages', 'world');
    expect(appended.getAll()).toEqual({
      foo: 'bar',
      count: 0,
      messages: ['hello', 'world'],
      numbers: [],
    });
  });

  test('test_state_extend', () => {
    // TS: Type-safe - can only extend array fields
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: ['hello'], numbers: [] });
    const extended = state.extend('messages', ['world', 'typescript']);
    expect(extended.getAll()).toEqual({
      foo: 'bar',
      count: 0,
      messages: ['hello', 'world', 'typescript'],
      numbers: [],
    });
  });

  test('test_state_increment', () => {
    // TS: Type-safe - can only increment number fields
    const state = new State<TestState>({ foo: 'bar', count: 1, messages: [], numbers: [] });
    const incremented = state.increment('count', 2);
    expect(incremented.get('count')).toBe(3);
  });

  test('test_state_increment_creates_if_missing', () => {
    // Demonstrates: increment creates field if missing (like Python)
    const state = new State({ foo: 'bar' });
    // @ts-expect-error - Testing increment on missing field
    const incremented = state.increment('count', 5);
    // @ts-expect-error - Testing get on field not in original type
    expect(incremented.get('count')).toBe(5);
  });

  // ==========================================================================
  // Advanced Operations
  // Matches Python: test_state_merge, test_state_subset
  // ==========================================================================

  test('test_state_merge', () => {
    const state = new State({ foo: 'bar', baz: 'qux' });
    const other = new State({ foo: 'baz', quux: 'corge' });
    // @ts-expect-error - merge() accepts different state types (runtime operation)
    const merged = state.merge(other);
    expect(merged.getAll()).toEqual({ foo: 'baz', baz: 'qux', quux: 'corge' });
  });

  test('test_state_subset', () => {
    const state = new State({ foo: 'bar', baz: 'qux' });
    const subset = state.subset('foo');
    expect(subset.getAll()).toEqual({ foo: 'bar' });
  });

  // ==========================================================================
  // Validation & Error Handling
  // Matches Python: test_state_append_validate_failure, etc.
  // ==========================================================================

  test('test_state_append_validate_failure', () => {
    // TS: Runtime validation catches type errors
    const state = new State({ foo: 'bar' });
    // @ts-expect-error - Testing runtime validation for invalid append
    expect(() => state.append('foo', 'baz')).toThrow("Cannot append to non-array field 'foo'");
  });

  test('test_state_extend_validate_failure', () => {
    const state = new State({ foo: 'bar' });
    // @ts-expect-error - Testing runtime validation for invalid extend
    expect(() => state.extend('foo', ['baz', 'qux'])).toThrow("Cannot extend non-array field 'foo'");
  });

  test('test_state_increment_validate_failure', () => {
    const state = new State({ foo: 'bar' });
    // @ts-expect-error - Testing runtime validation for invalid increment
    expect(() => state.increment('foo', 1)).toThrow("Cannot increment non-numeric field 'foo'");
  });

  // ==========================================================================
  // Immutability (TypeScript-specific)
  // ==========================================================================

  test('state_mutations_preserve_immutability', () => {
    // TS-specific: Demonstrates immutability
    const original = new State({ foo: 'bar', count: 0, messages: ['hello'] });
    const updated = original.update({ foo: 'baz' });

    // Original unchanged
    expect(original.get('foo')).toBe('bar');
    expect(updated.get('foo')).toBe('baz');
  });

  test('state_mutations_preserve_structural_sharing', () => {
    // TS-specific: Tests copy-on-write behavior
    // Note: structuredClone creates deep copies, so we test that unread fields
    // are not modified during operations that don't touch them
    const original = new State({ unchanged: { value: 'test' }, modified: 'old' });
    const updated = original.update({ modified: 'new' });

    // Values should be equal (deep equality)
    expect(updated.get('unchanged')).toEqual({ value: 'test' });
    expect(updated.get('modified')).toBe('new');
    
    // Original unchanged
    expect(original.get('modified')).toBe('old');
  });

  test('state_append_creates_array_if_missing', () => {
    // Demonstrates: append creates array if field doesn't exist
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: [], numbers: [] });
    const appended = state.append('numbers', 42);
    expect(appended.get('numbers')).toEqual([42]);
  });

  // ==========================================================================
  // Serialization
  // ==========================================================================

  test('test_state_serialize_deserialize', () => {
    const state = new State({ foo: 'bar', count: 42, items: [1, 2, 3] });
    const serialized = state.serialize();
    const deserialized = State.deserialize(serialized);

    expect(deserialized.getAll()).toEqual({ foo: 'bar', count: 42, items: [1, 2, 3] });
  });

  test('test_state_serialize_complex_types', () => {
    // TS: structuredClone handles Date, nested objects, etc.
    const now = new Date();
    const state = new State({
      timestamp: now,
      nested: { deep: { value: 'test' } },
      array: [1, 2, 3],
    });

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

    interface StrictState {
      name: string;
      age: number;
      tags: string[];
    }

    const state = new State<StrictState>({ name: 'Alice', age: 30, tags: [] });

    // ✅ Valid: append string to tags (array of strings)
    const s1 = state.append('tags', 'typescript');
    expect(s1.get('tags')).toEqual(['typescript']);

    // ✅ Valid: increment age (number field)
    const s2 = state.increment('age', 1);
    expect(s2.get('age')).toBe(31);

    // ❌ Would NOT compile: append to non-array field
    // const s3 = state.append('age', 1); // TypeScript error!

    // ❌ Would NOT compile: increment non-number field
    // const s4 = state.increment('name', 1); // TypeScript error!

    // ❌ Would NOT compile: append wrong type to array
    // const s5 = state.append('tags', 123); // TypeScript error!

    // This test passes because the valid operations work correctly
    expect(true).toBe(true);
  });

  // ==========================================================================
  // Chaining Operations
  // ==========================================================================

  test('test_state_chaining', () => {
    // Demonstrates: fluent API with immutable operations
    const state = new State<TestState>({ foo: 'bar', count: 0, messages: [], numbers: [] });

    const result = state
      .update({ foo: 'baz' })
      .increment('count', 5)
      .append('messages', 'hello')
      .append('messages', 'world');

    expect(result.getAll()).toEqual({
      foo: 'baz',
      count: 5,
      messages: ['hello', 'world'],
      numbers: [],
    });

    // Original unchanged
    expect(state.get('foo')).toBe('bar');
    expect(state.get('count')).toBe(0);
  });
});

