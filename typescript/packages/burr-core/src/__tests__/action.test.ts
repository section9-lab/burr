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
import { defineAction } from '../action';
import { createState } from '../state';

describe('Action - Construction', () => {
  test('defineAction creates action with full configuration', () => {
    // Action increments a counter by a delta
    // Pass: Action object created with run and update methods
    const action = defineAction({
      reads: z.object({
        count: z.number(),
        userId: z.string()
      }),
      writes: z.object({
        count: z.number()
      }),
      inputs: z.object({
        delta: z.number()
      }),
      result: z.object({
        newCount: z.number(),
        timestamp: z.string()
      }),
      run: async ({ state, inputs }) => ({
        newCount: state.count + inputs.delta,
        timestamp: new Date().toISOString()
      }),
      update: ({ result, state }) => state.update({
        count: result.newCount
      })
    });

    expect(action).toBeDefined();
    expect(typeof action.run).toBe('function');
    expect(typeof action.update).toBe('function');
  });

  test('defineAction with minimal configuration (no inputs, no result)', () => {
    // Side-effect action that just updates state
    // Pass: Action works with optional inputs and result omitted
    const action = defineAction({
      reads: z.object({
        userId: z.string()
      }),
      writes: z.object({
        lastRun: z.string()
      }),
      run: async ({ state: _state }) => {
        // Simulate side effect (e.g., send notification)
        return undefined;
      },
      update: ({ state }) => state.update({
        lastRun: new Date().toISOString()
      })
    });

    expect(action).toBeDefined();
    expect(action.inputs).toEqual([]);
  });

  test('defineAction with inputs but no result', () => {
    // Action that takes input but returns void
    // Pass: Inputs metadata extracted even when result is void
    const action = defineAction({
      reads: z.object({
        value: z.number()
      }),
      writes: z.object({
        doubled: z.number()
      }),
      inputs: z.object({
        multiplier: z.number()
      }),
      run: async ({ state: _state, inputs: _inputs }) => undefined,
      update: ({ state }) => state.update({
        doubled: state.value * 2
      })
    });

    expect(action.inputs).toEqual(['multiplier']);
  });
});

describe('Action - Metadata Extraction', () => {
  test('reads keys extracted from Zod object schema', () => {
    // Pass: Reads array contains all top-level keys from reads schema
    const action = defineAction({
      reads: z.object({
        count: z.number(),
        userId: z.string(),
        settings: z.object({ theme: z.string() })
      }),
      writes: z.object({ count: z.number() }),
      result: z.object({ newCount: z.number() }),
      run: async ({ state }) => ({ newCount: state.count + 1 }),
      update: ({ result, state }) => state.update({ count: result.newCount })
    });

    expect(action.reads).toEqual(['count', 'userId', 'settings']);
  });

  test('writes keys extracted from Zod object schema', () => {
    // Pass: Writes array contains all top-level keys from writes schema
    const action = defineAction({
      reads: z.object({ value: z.number() }),
      writes: z.object({
        result: z.number(),
        status: z.string(),
        metadata: z.object({ processed: z.boolean() })
      }),
      result: z.object({ computed: z.number() }),
      run: async ({ state }) => ({ computed: state.value * 2 }),
      update: ({ result, state }) => state.update({
        result: result.computed,
        status: 'complete',
        metadata: { processed: true }
      })
    });

    expect(action.writes).toEqual(['result', 'status', 'metadata']);
  });

  test('inputs keys extracted when provided', () => {
    // Pass: Inputs array contains all top-level keys from inputs schema
    const action = defineAction({
      reads: z.object({ base: z.number() }),
      writes: z.object({ total: z.number() }),
      inputs: z.object({
        multiplier: z.number(),
        offset: z.number(),
        label: z.string()
      }),
      result: z.object({ value: z.number() }),
      run: async ({ state, inputs }) => ({
        value: state.base * inputs.multiplier + inputs.offset
      }),
      update: ({ result, state }) => state.update({ total: result.value })
    });

    expect(action.inputs).toEqual(['multiplier', 'offset', 'label']);
  });

  test('inputs empty array when not provided', () => {
    // Pass: Inputs defaults to empty array when omitted from config
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({ value: state.x * 2 }),
      update: ({ result, state }) => state.update({ y: result.value })
    });

    expect(action.inputs).toEqual([]);
  });

  test('schema property returns all four schemas', () => {
    // Pass: Schema getter provides access to all original Zod schemas
    const readsSchema = z.object({ a: z.number() });
    const writesSchema = z.object({ b: z.number() });
    const inputsSchema = z.object({ c: z.number() });
    const resultSchema = z.object({ d: z.number() });

    const action = defineAction({
      reads: readsSchema,
      writes: writesSchema,
      inputs: inputsSchema,
      result: resultSchema,
      run: async ({ state }) => ({ d: state.a }),
      update: ({ result, state }) => state.update({ b: result.d })
    });

    expect(action.schema.reads).toBe(readsSchema);
    expect(action.schema.writes).toBe(writesSchema);
    expect(action.schema.inputs).toBe(inputsSchema);
    expect(action.schema.result).toBe(resultSchema);
  });
});

describe('Action - Execution (run)', () => {
  test('run executes async function and returns result', async () => {
    // Pass: Run method executes user function and returns result object
    const action = defineAction({
      reads: z.object({ count: z.number() }),
      writes: z.object({ count: z.number() }),
      result: z.object({ newCount: z.number() }),
      run: async ({ state }) => {
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 1));
        return { newCount: state.count + 1 };
      },
      update: ({ result, state }) => state.update({ count: result.newCount })
    });

    const readsSchema = z.object({ count: z.number() });
    const result = await action.run({ 
      state: createState(readsSchema, { count: 5 }), 
      inputs: undefined 
    });

    expect(result).toEqual({ newCount: 6 });
  });

  test('run receives correct state subset', async () => {
    // Pass: User function receives state matching reads schema
    const action = defineAction({
      reads: z.object({
        counter: z.number(),
        multiplier: z.number()
      }),
      writes: z.object({ result: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({
        value: state.counter * state.multiplier
      }),
      update: ({ result, state }) => state.update({ result: result.value })
    });

    const readsSchema = z.object({ counter: z.number(), multiplier: z.number() });
    const result = await action.run({
      state: createState(readsSchema, { counter: 10, multiplier: 3 }) as any,
      inputs: undefined
    });

    expect(result).toEqual({ value: 30 });
  });

  test('run receives and uses inputs', async () => {
    // Pass: User function receives both state and inputs correctly
    const action = defineAction({
      reads: z.object({ base: z.number() }),
      writes: z.object({ total: z.number() }),
      inputs: z.object({ addition: z.number() }),
      result: z.object({ sum: z.number() }),
      run: async ({ state, inputs }) => ({
        sum: state.base + inputs.addition
      }),
      update: ({ result, state }) => state.update({ total: result.sum })
    });

    const readsSchema = z.object({ base: z.number() });
    const result = await action.run({ 
      state: createState(readsSchema, { base: 10 }) as any, 
      inputs: { addition: 5 } 
    });

    expect(result).toEqual({ sum: 15 });
  });

  test('run validates state before execution', async () => {
    // Pass: Throws error when state doesn't match reads schema
    const action = defineAction({
      reads: z.object({ count: z.number() }),
      writes: z.object({ count: z.number() }),
      result: z.object({ newCount: z.number() }),
      run: async ({ state }) => ({ newCount: state.count + 1 }),
      update: ({ result, state }) => state.update({ count: result.newCount })
    });

    // Pass invalid state (count should be number, not string)
    const invalidState = createState(z.object({ count: z.any() }), { count: 'invalid' }) as any;
    await expect(
      action.run({ state: invalidState, inputs: undefined })
    ).rejects.toThrow('Action validation failed for state (reads)');
  });

  test('run validates inputs before execution', async () => {
    // Pass: Throws error when inputs don't match inputs schema
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      inputs: z.object({ delta: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state, inputs }) => ({ value: state.x + inputs.delta }),
      update: ({ result, state }) => state.update({ y: result.value })
    });

    // Pass invalid inputs (delta should be number, not string)
    const readsSchema = z.object({ x: z.number() });
    await expect(
      action.run({ 
        state: createState(readsSchema, { x: 10 }) as any, 
        inputs: { delta: 'bad' } as any 
      })
    ).rejects.toThrow('Action validation failed for inputs');
  });

  test('run validates result after execution', async () => {
    // Pass: Throws error when user function returns wrong shape
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state: _state }) => {
        // Return wrong shape
        return { wrongKey: 123 } as any;
      },
      update: ({ result, state }) => state.update({ y: result.value })
    });

    const readsSchema = z.object({ x: z.number() });
    await expect(
      action.run({ state: createState(readsSchema, { x: 10 }) as any, inputs: undefined })
    ).rejects.toThrow('Action validation failed for result');
  });
});

describe('Action - Execution (update)', () => {
  test('update transforms result into state writes', () => {
    // Pass: Update method transforms result to writes correctly
    const action = defineAction({
      reads: z.object({ input: z.string() }),
      writes: z.object({
        output: z.string(),
        length: z.number()
      }),
      result: z.object({
        processed: z.string(),
        charCount: z.number()
      }),
      run: async ({ state }) => ({
        processed: state.input.toUpperCase(),
        charCount: state.input.length
      }),
      update: ({ result }) => {
        const writesSchema = z.object({ output: z.string(), length: z.number() });
        return createState(writesSchema, {
          output: result.processed,
          length: result.charCount
        });
      }
    });

    const readsSchema = z.object({ input: z.string() });
    const writes = action.update({
      result: { processed: 'HELLO', charCount: 5 },
      state: createState(readsSchema, { input: 'hello' }) as any,
      inputs: undefined
    });

    expect(writes.data.output).toBe('HELLO');
    expect(writes.data.length).toBe(5);
  });

  test('update can reference original state', () => {
    // Useful for relative updates or conditional logic
    // Pass: Update function receives both result and original state
    const action = defineAction({
      reads: z.object({ count: z.number() }),
      writes: z.object({ count: z.number() }),
      result: z.object({ increment: z.number() }),
      run: async ({ state: _state }) => ({
        increment: Math.floor(Math.random() * 10)
      }),
      update: ({ result, state }) => state.update({
        count: state.count + result.increment
      })
    });

    const readsSchema = z.object({ count: z.number() });
    const writes = action.update({
      result: { increment: 3 },
      state: createState(readsSchema, { count: 10 }),
      inputs: undefined
    });

    expect(writes.data.count).toBe(13);
  });

  test('update validates result before transformation', () => {
    // Pass: Throws error when result doesn't match result schema
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({ value: state.x * 2 }),
      update: ({ result, state }) => state.update({ y: result.value })
    });

    // Pass invalid result
    const readsSchema = z.object({ x: z.number() });
    expect(() =>
      action.update({ 
        result: { value: 'bad' } as any, 
        state: createState(readsSchema, { x: 10 }) as any, 
        inputs: undefined 
      })
    ).toThrow('Action validation failed for result');
  });

  test('update validates state before transformation', () => {
    // Pass: Throws error when state doesn't match reads schema
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({ value: state.x * 2 }),
      update: ({ result, state }) => state.update({ y: result.value })
    });

    // Pass invalid state
    const invalidState = createState(z.object({ x: z.any() }), { x: 'bad' }) as any;
    expect(() =>
      action.update({ result: { value: 20 }, state: invalidState, inputs: undefined })
    ).toThrow('Action validation failed for state (reads)');
  });

  test('update validates writes after transformation', () => {
    // Pass: Throws error when update returns wrong shape
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({ value: state.x * 2 }),
      update: ({ state }) => {
        // Return wrong shape - update with wrong key
        return state.update({ wrongKey: 123 } as any) as any;
      }
    });

    const readsSchema = z.object({ x: z.number() });
    expect(() =>
      action.update({ 
        result: { value: 20 }, 
        state: createState(readsSchema, { x: 10 }) as any, 
        inputs: undefined 
      })
    ).toThrow('Action validation failed for writes');
  });
});

describe('Action - Integration', () => {
  test('run then update produces correct final state', async () => {
    // Full two-step workflow
    // Pass: Run result correctly feeds into update to produce writes
    const action = defineAction({
      reads: z.object({
        items: z.array(z.number())
      }),
      writes: z.object({
        sum: z.number(),
        count: z.number()
      }),
      result: z.object({
        total: z.number(),
        itemCount: z.number()
      }),
      run: async ({ state }) => {
        const total = state.items.reduce((a, b) => a + b, 0);
        return {
          total,
          itemCount: state.items.length
        };
      },
      update: ({ result }) => {
        const writesSchema = z.object({ sum: z.number(), count: z.number() });
        return createState(writesSchema, {
          sum: result.total,
          count: result.itemCount
        });
      }
    });

    const readsSchema = z.object({ items: z.array(z.number()) });
    const stateSubset = createState(readsSchema, { items: [1, 2, 3, 4, 5] }) as any;
    
    // Step 1: Run computation
    const result = await action.run({ state: stateSubset, inputs: undefined });
    expect(result).toEqual({ total: 15, itemCount: 5 });

    // Step 2: Transform to writes
    const writes = action.update({ result, state: stateSubset, inputs: undefined });
    expect(writes.data.sum).toBe(15);
    expect(writes.data.count).toBe(5);
  });

  test('action with no result (void) works end-to-end', async () => {
    // Action that just logs and updates timestamp
    // Pass: Void result flows through run and update correctly
    const action = defineAction({
      reads: z.object({ userId: z.string() }),
      writes: z.object({ lastActivity: z.string() }),
      result: z.void(),  // Explicitly specify void for side-effect actions
      run: async ({ state }) => {
        // Side effect only
        console.log(`Activity by user: ${state.userId}`);
        return undefined;
      },
      update: () => {
        const writesSchema = z.object({ lastActivity: z.string() });
        return createState(writesSchema, {
          lastActivity: '2025-12-25T10:00:00.000Z'
        });
      }
    });

    const readsSchema = z.object({ userId: z.string() });
    const stateSubset = createState(readsSchema, { userId: 'user-123' }) as any;
    const result = await action.run({ state: stateSubset, inputs: undefined });
    expect(result).toBeUndefined();

    const writes = action.update({ result, state: stateSubset, inputs: undefined });
    expect(writes.data.lastActivity).toBe('2025-12-25T10:00:00.000Z');
  });
});

describe('Action - Type Safety with Zod', () => {
  test('schema.pick() creates subset schema for reads', () => {
    // Central app state
    // Pass: Action operates on state subset with full type safety
    const AppStateSchema = z.object({
      userId: z.string(),
      userName: z.string(),
      count: z.number(),
      email: z.string(),
      preferences: z.object({
        theme: z.string()
      })
    });

    // Action only operates on subset of state
    const action = defineAction({
      reads: AppStateSchema.pick({ count: true, userId: true }),
      writes: AppStateSchema.pick({ count: true }),
      result: z.object({ newCount: z.number() }),
      run: async ({ state }) => {
        // Type-safe: state is { count: number, userId: string }
        return { newCount: state.count + 1 };
      },
      update: ({ result, state }) => state.update({ count: result.newCount })
    });

    expect(action.reads).toEqual(['count', 'userId']);
    expect(action.writes).toEqual(['count']);
  });

  test('complex nested schemas work correctly', () => {
    // Pass: Nested objects in schemas are handled and metadata extracted
    const action = defineAction({
      reads: z.object({
        user: z.object({
          id: z.string(),
          profile: z.object({
            name: z.string(),
            age: z.number()
          })
        }),
        settings: z.object({
          notifications: z.boolean()
        })
      }),
      writes: z.object({
        processed: z.boolean()
      }),
      result: z.object({
        summary: z.string()
      }),
      run: async ({ state }) => ({
        summary: `User ${state.user.profile.name} (${state.user.id}), age ${state.user.profile.age}`
      }),
      update: ({ state }) => state.update({ processed: true })
    });

    expect(action.reads).toEqual(['user', 'settings']);
  });

  test('result constrained to object or void', () => {
    // This test documents the type constraint
    // Result must be z.object() or z.void()
    // Pass: Object and void results compile; primitives would fail
    
    // Valid: object result
    const action1 = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.object({ value: z.number() }),
      run: async ({ state }) => ({ value: state.x }),
      update: ({ result }) => createState(z.object({ y: z.number() }), { y: result.value })
    });

    // Valid: void result
    const action2 = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      result: z.void(),
      run: async ({ state: _state }) => undefined,
      update: ({ state }) => state.update({ y: 0 })
    });

    // Invalid: primitives not allowed (compile-time error)
    // const action3 = defineAction({
    //   reads: z.object({ x: z.number() }),
    //   writes: z.object({ y: z.number() }),
    //   result: z.number(),  // ❌ TypeScript error
    //   run: async (state) => 42,
    //   update: (result) => ({ y: result })
    // });

    expect(action1).toBeDefined();
    expect(action2).toBeDefined();
  });
});

describe('Action - Playground / Template', () => {
  test('template action for experimentation', async () => {
    // Test 1: Write restrictions now work! TypeScript catches invalid writes at definition time.
    // This SHOULD error because 'count' is not in writes schema
    // @ts-expect-error - unused variable for demonstration
    const _actionNoAnnotation = defineAction({
      reads: z.object({count: z.number()}),
      writes: z.object({count: z.number(), requiredButNotAdded: z.number()}),
      result: z.object({newCount: z.number()}),
      run: async ({ state }) => ({ newCount: state.count + 1 }),
      update: ({ state, result }) => state.increment({ count: result.newCount }).update({requiredButNotAdded: state.count})
    });

    // Test 2: With explicit return type - SHOULD ERROR!
    // const writesSchema = z.object({count: z.number(), requiredButNotAdded: z.number()});
    // const actionWithAnnotation = defineAction({
    //   reads: z.object({count: z.number()}),
    //   writes: writesSchema,
    //   update: ({ state }): StateInstance<typeof writesSchema, any, any> => {
    //     return state.increment({ count: 1 });  // Should error here!
    //   }
    // });
    
    // expect(actionNoAnnotation).toBeDefined();
    // expect(actionWithAnnotation).toBeDefined();
  });
});

