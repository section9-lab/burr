/**
 * Copyright (c) 2024-2025 Elijah ben Izzy
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { defineAction } from '../action';
import { GraphBuilder } from '../graph';
import { ApplicationBuilder } from '../application-builder';
import { Application } from '../application';
import { createState } from '../state';

describe('ApplicationBuilder', () => {
  // Test fixtures
  const action1 = defineAction({
    reads: z.object({ count: z.number() }),
    writes: z.object({ count: z.number() }),
    update: ({ state }) => state.update({ count: state.count + 1 })
  });

  const action2 = defineAction({
    reads: z.object({ count: z.number() }),
    writes: z.object({ done: z.boolean() }),
    update: ({ state }) => state.update({ done: true })
  });

  const testGraph = new GraphBuilder()
    .withActions({ action1, action2 })
    .withTransitions(['action1', 'action2'])
    .build();

  const testState = createState(
    z.object({ count: z.number(), done: z.boolean() }),
    { count: 0, done: false }
  );

  describe('withGraph', () => {
    test('sets the graph', () => {
      const builder = new ApplicationBuilder().withGraph(testGraph);
      const app = builder.withEntrypoint('action1').withState(testState).build();
      
      expect(app.graph).toBe(testGraph);
    });

    test('throws if graph already set', () => {
      const builder = new ApplicationBuilder().withGraph(testGraph);
      
      expect(() => {
        builder.withGraph(testGraph);
      }).toThrow('Graph is already set');
    });

    test('returns new builder instance (immutable)', () => {
      const builder1 = new ApplicationBuilder();
      const builder2 = builder1.withGraph(testGraph);
      
      expect(builder1).not.toBe(builder2);
    });
  });

  describe('withEntrypoint', () => {
    test('sets the entrypoint', () => {
      const builder = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1');
      
      const app = builder.withState(testState).build();
      expect(app.entrypoint).toBe('action1');
    });

    test('throws if entrypoint already set', () => {
      const builder = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1');
      
      expect(() => {
        builder.withEntrypoint('action2');
      }).toThrow('Entrypoint is already set');
    });

    test('throws if graph not set', () => {
      const builder = new ApplicationBuilder();
      
      expect(() => {
        builder.withEntrypoint('action1');
      }).toThrow('Graph must be set before entrypoint');
    });

    test('throws if entrypoint action not in graph', () => {
      const builder = new ApplicationBuilder().withGraph(testGraph);
      
      expect(() => {
        builder.withEntrypoint('nonexistent');
      }).toThrow("Entrypoint action 'nonexistent' not found in graph");
    });

    test('returns new builder instance (immutable)', () => {
      const builder1 = new ApplicationBuilder().withGraph(testGraph);
      const builder2 = builder1.withEntrypoint('action1');
      
      expect(builder1).not.toBe(builder2);
    });
  });

  describe('withState', () => {
    test('sets the initial state', () => {
      const builder = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1')
        .withState(testState);
      
      const app = builder.build();
      expect(app.initialState).toBe(testState);
    });

    test('throws if state already set', () => {
      const builder = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1')
        .withState(testState);
      
      expect(() => {
        builder.withState(testState);
      }).toThrow('Initial state is already set');
    });

    test('returns new builder instance (immutable)', () => {
      const builder1 = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1');
      const builder2 = builder1.withState(testState);
      
      expect(builder1).not.toBe(builder2);
    });
  });

  describe('build', () => {
    test('creates application with all components', () => {
      const app = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1')
        .withState(testState)
        .build();
      
      expect(app).toBeInstanceOf(Application);
      expect(app.graph).toBe(testGraph);
      expect(app.entrypoint).toBe('action1');
      expect(app.initialState).toBe(testState);
    });

    test('throws if graph not set', () => {
      const builder = new ApplicationBuilder();
      
      expect(() => {
        builder.build();
      }).toThrow('Cannot build application without graph');
    });

    test('throws if entrypoint not set', () => {
      const builder = new ApplicationBuilder().withGraph(testGraph);
      
      expect(() => {
        builder.build();
      }).toThrow('Cannot build application without entrypoint');
    });

    test('throws if state not set', () => {
      const builder = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1');
      
      expect(() => {
        builder.build();
      }).toThrow('Cannot build application without initial state');
    });
  });

  describe('method chaining', () => {
    test('can chain all methods in order', () => {
      const app = new ApplicationBuilder()
        .withGraph(testGraph)
        .withEntrypoint('action1')
        .withState(testState)
        .build();
      
      expect(app).toBeInstanceOf(Application);
    });

    test('can chain methods in different order', () => {
      const app = new ApplicationBuilder()
        .withGraph(testGraph)
        .withState(testState)
        .withEntrypoint('action1')
        .build();
      
      expect(app).toBeInstanceOf(Application);
    });

    test('state can be set before entrypoint', () => {
      const app = new ApplicationBuilder()
        .withGraph(testGraph)
        .withState(testState)
        .withEntrypoint('action1')
        .build();
      
      expect(app).toBeInstanceOf(Application);
    });
  });
});

describe('Application', () => {
  test('stores graph, entrypoint, and initial state', () => {
    const action = defineAction({
      reads: z.object({ x: z.number() }),
      writes: z.object({ y: z.number() }),
      update: ({ state }) => state.update({ y: state.x })
    });

    const graph = new GraphBuilder()
      .withActions({ action })
      .build();

    const state = createState(
      z.object({ x: z.number(), y: z.number() }),
      { x: 5, y: 0 }
    );

    // Use ApplicationBuilder instead of direct construction (recommended pattern)
    const app = new ApplicationBuilder()
      .withGraph(graph)
      .withEntrypoint('action')
      .withState(state)
      .build();

    expect(app.graph).toBe(graph);
    expect(app.entrypoint).toBe('action');
    expect(app.initialState).toBe(state);
  });
});

