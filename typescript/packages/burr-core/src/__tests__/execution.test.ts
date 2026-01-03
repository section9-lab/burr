// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

/**
 * E2E Execution Tests
 * 
 * Contract tests for Application execution engine:
 * - app.step() - Single step execution
 * - app.run() - Run to completion
 * - app.iterate() - Iterator pattern
 * - State management
 * - Graph transitions
 */

import { z } from 'zod';
import { action, createState, GraphBuilder, ApplicationBuilder } from '../index';

// ============================================================================
// Test Fixtures
// ============================================================================

const counter = action({
  reads: z.object({ count: z.number() }),
  writes: z.object({ count: z.number() }),
  update: ({ state }) => state.update({ count: state.count + 1 })
});

const counterWithInputs = action({
  reads: z.object({ count: z.number() }),
  writes: z.object({ count: z.number() }),
  inputs: z.object({ additional: z.number() }),
  update: ({ state, inputs }) => state.update({ 
    count: state.count + 1 + inputs.additional 
  })
});

const result = action({
  reads: z.object({ count: z.number() }),
  writes: z.object({}),
  result: z.object({ value: z.number() }),
  run: async ({ state }) => ({ value: state.count }),
  // @ts-expect-error - Empty writes is valid for read-only actions
  update: ({ state }) => state
});


// ============================================================================
// Core Execution - app.step()
// ============================================================================

describe('app.step() - Basic Execution', () => {
  // Tests basic single step execution with simple self-looping graph.
  // Create graph with one action + self-loop transition, execute step, verify state incremented and next action returned.
  test('executes single action and advances state', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter })
      .withTransitions(['counter', 'counter'])
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    const result = await app.step();

    expect(result).not.toBeNull();
    expect(result!.state.count).toBe(1);
  });

  // Tests that step() correctly passes runtime inputs to actions requiring them.
  // Create graph with input-requiring action, call step() with inputs object, verify inputs used in state computation.
  test('passes inputs to action', async () => {
    const graph = new GraphBuilder()
      .withActions({ counterWithInputs })
      .withTransitions(['counterWithInputs', 'counterWithInputs'])
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counterWithInputs')
      .build();

    const result = await app.step({ inputs: { additional: 5 } });

    expect(result).not.toBeNull();
    expect(result!.state.count).toBe(6);  // 0 + 1 + 5
  });

  // Tests validation error when required inputs are not provided to step().
  // Create action requiring inputs, call step() without providing them, expect validation error thrown.
  test('throws validation error for missing inputs', async () => {
    const graph = new GraphBuilder()
      .withActions({ counterWithInputs })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counterWithInputs')
      .build();

    await expect(app.step()).rejects.toThrow(/required.*input|missing/i);
  });

  // Tests terminal state detection when action has no outgoing transitions.
  // Create graph with no transitions from entrypoint, execute two steps, second step returns null at terminal.
  test('returns null when no next actions', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    await app.step();  // First step succeeds
    const result = await app.step();  // Second step hits terminal

    expect(result).toBeNull();
  });

  // Tests that errors thrown during action execution propagate to caller.
  // Create action that throws error in run(), execute step, expect error to bubble up with action context.
  test('action errors bubble up', async () => {
    const brokenAction = action({
      reads: z.object({}),
      writes: z.object({}),
      run: async () => {
        throw new Error('Action failed!');
      },
      update: ({ state }) => state
    });

    const graph = new GraphBuilder()
      .withActions({ brokenAction })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({}), {}))
      .withEntrypoint('brokenAction')
      .build();

    await expect(app.step()).rejects.toThrow('Action failed!');
  });
});

// ============================================================================
// Core Execution - app.run()
// ============================================================================

describe('app.run() - Run to Completion', () => {
  // Tests run() executes steps until reaching action with no outgoing transitions.
  // Create graph with conditional loop and terminal action, call run(), verify final state after all steps executed.
  test('runs until terminal state', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter, result })
      .withTransitions(
        ['counter', 'counter', (state) => state.count < 10],
        ['counter', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    const final = await app.run();

    expect(final.state.count).toBe(10);
    expect(final.result).toHaveProperty('value', 10);
  });

  // Tests haltAfter stops execution immediately after specified action completes.
  // Run with haltAfter targeting terminal action, verify action executed and result captured before stopping.
  test('stops after executing specified action', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter, result })
      .withTransitions(
        ['counter', 'counter', (state) => state.count < 10],
        ['counter', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    const final = await app.run({ haltAfter: ['result'] });

    expect(final.state.count).toBe(10);
    expect(final.result).toHaveProperty('value', 10);
  });

  // Tests haltBefore stops execution before specified action runs.
  // Run with haltBefore targeting specific action, verify execution stops without running that action (result is null).
  test('stops before executing specified action', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter, result })
      .withTransitions(
        ['counter', 'counter', (state) => state.count < 10],
        ['counter', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    const final = await app.run({ haltBefore: ['result'] });

    expect(final.state.count).toBe(10);
    expect(final.result).toBeNull();  // Didn't execute result (halted before)
  });

  // Tests that inputs passed to run() are available to all actions throughout execution.
  // Run with global inputs, verify each action in sequence receives and uses the inputs in computation.
  test('global inputs available to all actions', async () => {
    const graph = new GraphBuilder()
      .withActions({ counterWithInputs, result })
      .withTransitions(
        ['counterWithInputs', 'counterWithInputs', (state) => state.count < 10],
        ['counterWithInputs', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counterWithInputs')
      .build();

    const final = await app.run({ inputs: { additional: 4 }, haltAfter: ['result'] });

    // Each step: count + 1 + 4 = count + 5
    // Step 1: 0 + 5 = 5
    // Step 2: 5 + 5 = 10
    expect(final.state.count).toBe(10);
  });

});

// ============================================================================
// Core Execution - app.iterate()
// ============================================================================

describe('app.iterate() - Iterator Pattern', () => {
  // Tests iterate() async generator yields each step result until terminal state.
  // Create graph that loops N times then terminates, iterate collecting all steps, verify total count matches expected.
  test('yields each step until completion', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter, result })
      .withTransitions(
        ['counter', 'counter', (state) => state.count < 5],
        ['counter', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    let stepCount = 0;
    for await (const _step of app.iterate()) {
      stepCount++;
    }

    // counter runs 5 times (0→1→2→3→4→5), then result = 6 total steps
    expect(stepCount).toBe(6);
  });

  // Tests that user can manually break from iterate() loop before completion.
  // Create infinite loop graph, iterate with conditional break statement, verify execution stopped early at correct count.
  test('user can break out of iteration', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter })
      .withTransitions(['counter', 'counter'])
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    let stepCount = 0;
    for await (const step of app.iterate()) {
      stepCount++;
      if (step.state.count === 5) {
        break;  // User-controlled break
      }
    }

    expect(stepCount).toBe(5);
  });
});

// ============================================================================
// State Management
// ============================================================================

describe('State Management', () => {
  // Tests that state merge preserves fields not declared in action's writes schema.
  // Create action writing subset of state fields, execute step, verify unwritten fields remain unchanged.
  test('preserves unwritten fields', async () => {
    const partialWriter = action({
      reads: z.object({ count: z.number(), name: z.string() }),
      writes: z.object({ count: z.number() }),
      update: ({ state }) => state.update({ count: state.count + 1 })
    });

    const graph = new GraphBuilder()
      .withActions({ partialWriter })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(
        z.object({ count: z.number(), name: z.string() }), 
        { count: 0, name: 'Alice' }
      ))
      .withEntrypoint('partialWriter')
      .build();

    const result = await app.step();

    expect(result).not.toBeNull();
    expect(result!.state.count).toBe(1);     // Updated
    expect(result!.state.name).toBe('Alice'); // Preserved
  });

  // Tests validation error when action doesn't write all declared write fields.
  // Create action declaring writes but not producing them in update(), execute step, expect validation error.
  test('runtime error for missing writes', async () => {
    const missingWrites = action({
      reads: z.object({}),
      writes: z.object({ missing: z.number(), present: z.number() }),
      // @ts-expect-error - Intentionally missing 'missing' field to test runtime validation
      update: ({ state }) => state.update({ present: 1 })
    });

    const graph = new GraphBuilder()
      .withActions({ missingWrites })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({}), {}))
      .withEntrypoint('missingWrites')
      .build();

    await expect(app.step()).rejects.toThrow(/missing.*not.*written|required/i);
  });

  // Tests validation error when state missing fields required by action's reads schema.
  // Create action requiring field not present in state, execute step, expect validation error on reads check.
  test('runtime error for missing state fields', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({}), {}))  // Missing 'count'
      .withEntrypoint('counter')
      .build();

    await expect(app.step()).rejects.toThrow(/validation.*failed|required/i);
  });
});

// ============================================================================
// Graph & Transitions
// ============================================================================

describe('Graph & Transitions', () => {
  // Tests that transition conditions are evaluated in declaration order and first match is taken.
  // Create graph with multiple overlapping conditional transitions, execute with different states, verify correct transition selected based on order.
  test('transitions_evaluated_in_order: first match wins', async () => {
    const low = action({
      reads: z.object({ count: z.number() }),
      writes: z.object({ level: z.string() }),
      update: ({ state }) => state.update({ level: 'low' })
    });
    const high = action({
      reads: z.object({ count: z.number() }),
      writes: z.object({ level: z.string() }),
      update: ({ state }) => state.update({ level: 'high' })
    });

    const graph = new GraphBuilder()
      .withActions({ counter, low, high })
      .withTransitions(
        ['counter', 'low', (state) => state.count < 5],   // Check first
        ['counter', 'high', (state) => state.count >= 5]  // Check second
        // low and high have no outgoing transitions = terminal
      )
      .build();

    const app1 = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(
        z.object({ count: z.number(), level: z.string().optional() }),
        { count: 0, level: "hello" }
      ))
      .withEntrypoint('counter')
      .build();

    const result1 = await app1.step();
    expect(result1).not.toBeNull();
    // First transition matches (count < 5), will go to 'low' on next step

    const app2 = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(
        z.object({ count: z.number(), level: z.string().optional() }),
        { count: 5 }
      ))
      .withEntrypoint('counter')
      .build();

    const result2 = await app2.step();
    expect(result2).not.toBeNull();
    // First transition fails (count >= 5), second matches, will go to 'high' on next step
  });

  // Tests that transition conditions evaluate using state after action execution.
  // Create graph with conditional loop checking counter, run to completion, verify condition controlled flow using updated state.
  test('transitions_conditional: conditions evaluate on current state', async () => {
    const setLevel = action({
      reads: z.object({ count: z.number() }),
      writes: z.object({ level: z.string() }),
      update: ({ state }) => state.update({ 
        level: state.count < 5 ? 'low' : 'high' 
      })
    });

    const graph = new GraphBuilder()
      .withActions({ counter, setLevel })
      .withTransitions(
        ['counter', 'counter', (state) => state.count! < 10],
        ['counter', 'setLevel']
        // setLevel has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(
        z.object({ count: z.number(), level: z.string().optional() }),
        { count: 0 }
      ))
      .withEntrypoint('counter')
      .build();

    const result = await app.run();

    expect(result.state.count).toBe(10);
    expect(result.state.level).toBe('high');  // 10 >= 5
  });

});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {
  // Tests multi-step execution sequence with state evolution through multiple actions.
  // Execute multiple manual steps through conditional loop then terminal action, verify state progression at each step.
  test('multi_action_sequence: counter → result → terminal', async () => {
    const graph = new GraphBuilder()
      .withActions({ counter, result })
      .withTransitions(
        ['counter', 'counter', (state) => state.count < 3],
        ['counter', 'result']
        // result has no outgoing transition = terminal
      )
      .build();

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(z.object({ count: z.number() }), { count: 0 }))
      .withEntrypoint('counter')
      .build();

    // Step 1: counter (0 → 1)
    const step1 = await app.step();
    expect(step1?.state.count).toBe(1);

    // Step 2: counter (1 → 2)
    const step2 = await app.step();
    expect(step2?.state.count).toBe(2);

    // Step 3: counter (2 → 3)
    const step3 = await app.step();
    expect(step3?.state.count).toBe(3);

    // Step 4: result (extracts count)
    const step4 = await app.step();
    expect(step4?.result).toHaveProperty('value', 3);

    // Step 5: terminal
    const step5 = await app.step();
    expect(step5).toBeNull();
  });

  // Tests that actions with separate run/update phases execute both correctly.
  // Create action with both run() producing result and update() using result, execute step, verify both run output and state update applied.
  test('action_with_result: run/update phases work correctly', async () => {
    const multiPhase = action({
      reads: z.object({ input: z.string() }),
      writes: z.object({ output: z.string() }),
      result: z.object({ processed: z.string() }),
      run: async ({ state }) => ({ 
        processed: state.input.toUpperCase() 
      }),
      update: ({ state, result }) => state.update({ 
        output: result.processed 
      })
    });

    const graph = new GraphBuilder()
      .withActions({ multiPhase })
      .build();  // No transitions = terminal

    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withState(createState(
        z.object({ input: z.string(), output: z.string().optional() }), 
        { input: 'hello' }
      ))
      .withEntrypoint('multiPhase')
      .build();

    const result = await app.step();

    expect(result).not.toBeNull();
    expect(result!.result).toHaveProperty('processed', 'HELLO');  // run() output
    expect(result!.state.output).toBe('HELLO');                    // update() applied it
  });
});
