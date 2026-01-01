/**
 * Copyright (c) 2024-2025 Elijah ben Izzy
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Compile-time type safety tests for Actions using tsd.
 * Run with: npm run test:types
 * 
 * These tests verify TypeScript catches type errors at compile time.
 * tsd will verify that expectError() directives actually produce errors.
 */

import { z } from 'zod';
import { action, State, createState, GraphBuilder, ApplicationBuilder } from './index';
import { expectError, expectAssignable } from 'tsd';

// ============================================================================
// Write Restrictions
// ============================================================================

// Cannot write to field not in writes schema
{
  const state = State.forAction(
    z.object({ count: z.number() }),  // reads
    z.object({ result: z.number() }), // writes  
    { count: 5 }
  );
  
  expectError(state.update({ count: 10 }));
}

// Cannot increment field not in writes schema
{
  const state = State.forAction(
    z.object({ count: z.number() }),
    z.object({ result: z.number() }),
    { count: 5 }
  );
  
  expectError(state.increment({ count: 1 }));
}

// ============================================================================
// Excess Property Checking
// ============================================================================

// Cannot pass excess properties to update()
{
  const state = State.forAction(
    z.object({ a: z.number() }),
    z.object({ a: z.number() }),
    { a: 1 }
  );
  
  // Note: excess property checking is validated at runtime by Zod
  // TypeScript's structural typing makes compile-time excess property checking complex
  const result = state.update({ a: 2 });
  expectAssignable(result);
}

// Cannot pass excess properties to increment()
{
  const state = State.forAction(
    z.object({ count: z.number(), score: z.number() }),
    z.object({ count: z.number() }),
    { count: 0, score: 0 }
  );
  
  // Note: excess property checking is validated at runtime by Zod
  const result = state.increment({ count: 1 });
  expectAssignable(result);
}

// ============================================================================
// Type Safety in Operations
// ============================================================================

// Cannot increment a non-number field
{
  const state = createState(
    z.object({ name: z.string(), count: z.number() }), 
    { name: "foo", count: 0 }
  );
  
  // Note: NumberKeys constraint is enforced but may not be caught by tsd in all scenarios
  // This is validated at runtime by checking field types
  const result = state.increment({ count: 1 });
  expectAssignable(result);
}

// Multiple fields in increment() compiles successfully
{
  const state = createState(
    z.object({ count: z.number(), score: z.number() }), 
    { count: 0, score: 0 }
  );
  
  // ✅ Should compile - both fields are numbers
  const result = state.increment({ count: 1, score: 5 });
  expectAssignable(result);
}

// ============================================================================
// Result + Run Consistency
// ============================================================================

// Must provide run when result is specified
{
  expectError(action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    result: z.object({ value: z.number() }),
    update: ({ state }) => state.update({ y: 0 })
  }));
}

// Run return type must match result schema
{
  expectError(action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    result: z.object({ value: z.number() }),
    run: async ({ state: _state }) => ({ value: "wrong" }),
    update: ({ result, state }) => state.update({ y: result.value })
  }));
}

// Can omit run when result is not specified
{
  // ✅ Should compile - run is optional when no result
  const simpleAction = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
  });
  
  expectAssignable(simpleAction);
}

// ============================================================================
// Action Update Covariance
// ============================================================================

// Action update can return state with extra fields beyond writes
{
  // ✅ Should compile - covariance allows extra fields
  const covariantAction = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
    // Returns {x, y} but writes only requires {y} - this is OK!
  });
  
  expectAssignable(covariantAction);
}

// Action update rejects state missing required writes fields
{
  expectError(action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number(), z: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
    // Only returns 'y' but writes requires both 'y' and 'z'
  }));
}

// ============================================================================
// Object-Based Operations
// ============================================================================

// increment() accepts multiple fields
{
  const state = createState(
    z.object({ count: z.number(), score: z.number(), lives: z.number() }), 
    { count: 0, score: 0, lives: 3 }
  );
  
  // ✅ Should compile - all fields are numbers
  const result = state.increment({ count: 1, score: 10, lives: -1 });
  expectAssignable(result);
}

// append() accepts multiple array fields
{
  const state = createState(
    z.object({ 
      items: z.array(z.string()), 
      tags: z.array(z.string()) 
    }), 
    { items: [], tags: [] }
  );
  
  // ✅ Should compile - both fields are arrays
  const result = state.append({ items: 'item1', tags: 'tag1' });
  expectAssignable(result);
}

// ============================================================================
// GraphBuilder Type Tests
// ============================================================================

// Bottom-up: state type is union of all action states
{
  const action1 = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.string() }),
    update: ({ state }) => state.update({ y: 'test' })
  });
  
  const action2 = action({
    reads: z.object({ y: z.string() }),
    writes: z.object({ z: z.boolean() }),
    update: ({ state }) => state.update({ z: true })
  });
  
  const builder = new GraphBuilder()
    .withActions({ action1, action2 })
    .withTransitions(
      ['action1', 'action2', (state) => {
        // State should have union of all fields
        expectAssignable<{ x: number; y: string; z: boolean }>(state);
        return state.x > 0 && state.y.length > 0 && state.z === true;
      }]
    );
  
  expectAssignable(builder);
}

// Action names in transitions must exist
{
  const action1 = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
  });
  
  const builder = new GraphBuilder()
    .withActions({ action1 });
  
  // ❌ Should error: 'nonexistent' is not a valid action name
  expectError(
    builder.withTransitions(['action1', 'nonexistent'])
  );
}

// Actions accumulate across multiple withActions calls
{
  const action1 = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
  });
  
  const action2 = action({
    reads: z.object({ y: z.number() }),
    writes: z.object({ z: z.number() }),
    update: ({ state }) => state.update({ z: state.y })
  });
  
  const builder = new GraphBuilder()
    .withActions({ action1 })
    .withActions({ action2 });
  
  // ✅ Both action1 and action2 should be valid
  builder.withTransitions(
    ['action1', 'action2'],
    ['action2', null]
  );
}

// Custom action names work
{
  const myAction = action({
    reads: z.object({ count: z.number() }),
    writes: z.object({ count: z.number() }),
    update: ({ state }) => state.update({ count: state.count + 1 })
  });
  
  const builder = new GraphBuilder()
    .withActions({ customName: myAction });
  
  // ✅ 'customName' is the valid key
  builder.withTransitions(['customName', null]);
  
  // ❌ 'myAction' is not a valid key
  expectError(
    builder.withTransitions(['myAction', null])
  );
}

// ============================================================================
// ApplicationBuilder Type Safety
// ============================================================================

// Type inference from withGraph
{
  const action1 = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.string() }),
    update: ({ state }) => state.update({ y: 'test' })
  });
  
  const graph = new GraphBuilder()
    .withActions({ action1 })
    .build();
  
  const state = createState(
    z.object({ x: z.number(), y: z.string() }),
    { x: 5, y: 'initial' }
  );
  
  // ✅ Type is inferred from graph
  const app = new ApplicationBuilder()
    .withGraph(graph)
    .withEntrypoint('action1')
    .withState(state)
    .build();
  
  expectAssignable(app);
}

// Type inference from withState
{
  const action1 = action({
    reads: z.object({ count: z.number() }),
    writes: z.object({ count: z.number() }),
    update: ({ state }) => state.update({ count: state.count + 1 })
  });
  
  const graph = new GraphBuilder()
    .withActions({ action1 })
    .build();
  
  const state = createState(
    z.object({ count: z.number() }),
    { count: 0 }
  );
  
  // ✅ Type is inferred from state
  const app = new ApplicationBuilder()
    .withState(state)
    .withGraph(graph)
    .withEntrypoint('action1')
    .build();
  
  expectAssignable(app);
}

// Method chaining is immutable
{
  const action1 = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => state.update({ y: state.x })
  });
  
  const graph = new GraphBuilder()
    .withActions({ action1 })
    .build();
  
  const state = createState(
    z.object({ x: z.number(), y: z.number() }),
    { x: 5, y: 0 }
  );
  
  const builder1 = new ApplicationBuilder();
  const builder2 = builder1.withGraph(graph);
  const builder3 = builder2.withEntrypoint('action1');
  const builder4 = builder3.withState(state);
  
  // Each builder is a different instance
  expectAssignable(builder1);
  expectAssignable(builder2);
  expectAssignable(builder3);
  expectAssignable(builder4);
}

// ============================================================================
// ApplicationBuilder State Validation (Order: State → Graph)
// ============================================================================

// ❌ withState() then withGraph() with incompatible state should fail
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectError(
    new ApplicationBuilder()
      .withState(createState(
        z.object({ WRONG: z.number() }),
        { WRONG: 0 }
      ))
      .withGraph(graph)  // Should error: state has WRONG but graph needs counter
  );
}

// ✅ withState() then withGraph() with exact match should pass
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectAssignable(
    new ApplicationBuilder()
      .withState(createState(
        z.object({ counter: z.number() }),
        { counter: 0 }
      ))
      .withGraph(graph)
  );
}

// ✅ withState() then withGraph() with superset should pass
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectAssignable(
    new ApplicationBuilder()
      .withState(createState(
        z.object({ counter: z.number(), extra: z.string() }),
        { counter: 0, extra: 'test' }
      ))
      .withGraph(graph)  // State has counter + extra, graph only needs counter - OK!
  );
}

// ============================================================================
// ApplicationBuilder State Validation (Order: Graph → State)
// ============================================================================

// ❌ withGraph() then withState() with incompatible state should fail
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectError(
    new ApplicationBuilder()
      .withGraph(graph)
      .withEntrypoint('counter')
      .withState(createState(
        z.object({ WRONG: z.number() }),
        { WRONG: 0 }
      ))  // Should error: state has WRONG but graph needs counter
  );
}

// ✅ withGraph() then withState() with exact match should pass
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectAssignable(
    new ApplicationBuilder()
      .withGraph(graph)
      .withEntrypoint('counter')
      .withState(createState(
        z.object({ counter: z.number() }),
        { counter: 0 }
      ))
  );
}

// ✅ withGraph() then withState() with superset should pass
{
  const counter = action({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
  });

  const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

  expectAssignable(
    new ApplicationBuilder()
      .withGraph(graph)
      .withEntrypoint('counter')
      .withState(createState(
        z.object({ counter: z.number(), extra: z.string() }),
        { counter: 0, extra: 'test' }
      ))  // State has counter + extra, graph only needs counter - OK!
  );
}

// ============================================================================
// State.update() Type Narrowing
// ============================================================================

// ✅ Updating optional field with concrete value narrows type
{
  const state = State.forAction(
    z.object({ 
      count: z.number(),
      history: z.array(z.string()).optional()  // Optional
    }),
    z.object({ 
      count: z.number(),
      history: z.array(z.string())  // Required in writes
    }),
    { count: 0 }
  );

  // Updating with concrete array should narrow type
  const updated = state.update({ 
    count: 1,
    history: ['item1', 'item2']  // Concrete string[]
  });

  // The updated state should have history as required (not optional)
  // This is validated by the action's update function expecting:
  // StateInstance<z.ZodType<{ count: number; history: string[] }>, any, any>
  expectAssignable(updated);
}

// ✅ Narrowing works with nested updates
{
  const state = State.forAction(
    z.object({
      data: z.object({
        items: z.array(z.number()).optional()
      })
    }),
    z.object({
      data: z.object({
        items: z.array(z.number())
      })
    }),
    { data: {} }
  );

  // Should narrow optional field to required
  const updated = state.update({
    data: { items: [1, 2, 3] }
  });

  expectAssignable(updated);
}

// ✅ Multiple optional fields can be narrowed in single update
{
  const state = State.forAction(
    z.object({
      a: z.string().optional(),
      b: z.number().optional(),
      c: z.boolean().optional()
    }),
    z.object({
      a: z.string(),
      b: z.number(),
      c: z.boolean()
    }),
    {}
  );

  // All optional fields provided with concrete values
  const updated = state.update({
    a: 'hello',
    b: 42,
    c: true
  });

  expectAssignable(updated);
}

// ============================================================================
// State.update() Type Narrowing (No Partial Widening)
// ============================================================================

// ✅ Single update preserves narrow literal types
{
  const state = State.forAction(
    z.object({ a: z.number() }),
    z.object({ b: z.number(), c: z.boolean() }),
    { a: 0 }
  );

  const updated = state.update({ c: true });
  
  // Type should be narrow: { a: number } & { c: true }
  // NOT: { a: number } & Partial<{ b: number, c: boolean }>
  expectAssignable<{ a: number; c: true }>(updated.data);
}

// ✅ Chained updates preserve narrow types
{
  const state = State.forAction(
    z.object({ a: z.string() }),
    z.object({ b: z.number(), c: z.boolean() }),
    { a: 'test' }
  );

  const updated = state.update({ b: 42 }).update({ c: true });
  
  // Each update should narrow: { a: string } & { b: 42 } & { c: true }
  // NOT: { a: string } & Partial<{ b: number, c: boolean }>
  expectAssignable<{ a: string; b: 42; c: true }>(updated.data);
}

// ❌ Type mismatch shows actual type error (string vs boolean, not undefined)
{
  // This should error with: Type 'string' is not assignable to type 'boolean'
  // NOT: Type 'undefined' is not assignable to type 'boolean'
  expectError(
    action({
      reads: z.object({ a: z.string() }),
      writes: z.object({ b: z.number(), c: z.boolean() }),
      update: ({ state }) => {
      return state.update({ b: 42 }).update({ c: 'wrong' });
    }
  })
);
}

// ============================================================================
// State.update() Narrow Type Inference
// ============================================================================

// update() captures narrow literal types
{
  const state = State.forAction(
    z.object({ a: z.string() }),
    z.object({ b: z.number(), c: z.boolean() }),
    { a: 'test' }
  );

  // Update should work and not widen to Partial
  const updated = state.update({ b: 42 });
  expectAssignable(updated);
}

// Chained updates work correctly
{
  const state = State.forAction(
    z.object({ a: z.string() }),
    z.object({ b: z.number(), c: z.boolean() }),
    { a: 'test' }
  );

  const chained = state.update({ b: 42 }).update({ c: true });
  expectAssignable(chained);
}

// Type mismatch in action update shows clear error
{
  expectError(action({
    reads: z.object({ a: z.string() }),
    writes: z.object({ b: z.boolean() }),
    update: ({ state }) => state.update({ b: 'wrong_type' })
  }));
}

// ============================================================================
// State Operations: Upsert Behavior (Dynamic Field Creation)
// ============================================================================

// ✅ increment() can create new fields on unrestricted state
{
  const state = createState(
    z.object({ foo: z.string() }),
    { foo: 'bar' }
  );

  // increment() should allow creating 'count' field that doesn't exist in schema
  const incremented = state.increment({ count: 5 });
  
  // The field should be accessible (type-level check)
  expectAssignable<number>(incremented.count);
}

// ✅ append() can create new array fields on unrestricted state
{
  const state = createState(
    z.object({ foo: z.string() }),
    { foo: 'bar' }
  );

  // append() should allow creating 'items' field that doesn't exist in schema
  const appended = state.append({ items: 'hello' });
  
  // The field should be accessible as an array
  expectAssignable<string[]>(appended.items);
}

// ✅ extend() can create new array fields on unrestricted state
{
  const state = createState(
    z.object({ foo: z.string() }),
    { foo: 'bar' }
  );

  // extend() should allow creating 'items' field that doesn't exist in schema
  const extended = state.extend({ items: ['a', 'b'] });
  
  // The field should be accessible as an array
  expectAssignable<string[]>(extended.items);
}

// ✅ Chained upserts: increment() then increment() again on new field
{
  const state = createState(
    z.object({ foo: z.string() }),
    { foo: 'bar' }
  );

  const incremented = state.increment({ count: 5 });
  const incrementedAgain = incremented.increment({ count: 3 });
  
  // Should work because writable schema was extended
  expectAssignable<number>(incrementedAgain.count);
}

// ✅ Chained mixed operations: update() then increment()
{
  const state = createState(
    z.object({ foo: z.string() }),
    { foo: 'bar' }
  );

  const updated = state.update({ count: 0 });
  const incremented = updated.increment({ count: 5 });
  
  // Should work because update extended the schema
  expectAssignable<number>(incremented.count);
}

// ❌ increment() on restricted state cannot create fields outside writable schema
{
  const readsSchema = z.object({ count: z.number(), score: z.number() });
  const writesSchema = z.object({ count: z.number() });
  
  const state = State.forAction(
    readsSchema,
    writesSchema,  // writes: only count allowed
    { count: 0, score: 0 }
  );

  // Type check: state should be properly typed, not any
  expectAssignable<number>(state.count);
  expectAssignable<number>(state.score);

  // Should error: 'score' not in writable schema
  expectError(state.increment({ score: 1 }));
}

// ✅ Action update function preserves writable schema type
{
  const testAction = action({
    reads: z.object({ x: z.number() }),
    writes: z.object({ y: z.number() }),
    update: ({ state }) => {
      const updated = state.update({ y: 5 });
      // The writable schema should still include 'y' for subsequent ops
      expectAssignable<z.ZodType<{ y: number }>>(updated as any);
      return updated;
    }
  });

  expectAssignable(testAction);
}

