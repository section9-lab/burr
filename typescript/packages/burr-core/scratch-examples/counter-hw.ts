import { z } from "zod";
import { defineAction, ApplicationBuilder, GraphBuilder, createState } from "../src";

const counter = defineAction({
    reads: z.object({ counter: z.number() }),
    writes: z.object({ counter: z.number() }),
    update: ({ state }) => state.update({ counter: state.counter + 1 })
});

// Build graph (bottom-up: infers state schema from actions)
const graph = new GraphBuilder()
    .withActions({ counter })
    .build();

// ❌ This should fail - state has WRONG but graph needs counter
export const appWithError = new ApplicationBuilder()
    .withEntrypoint('counter')
    .withState(createState(
        z.object({ WRONG: z.number() }),
        { WRONG: 0 }
    ))
    // @ts-expect-error - Intentional: Graph requires { counter } but state has { WRONG }
    .withGraph(graph)
    .build();

// ✅ This works - state has counter as required
export const appCorrect = new ApplicationBuilder()
    .withGraph(graph)
    .withEntrypoint('counter')
    .withState(createState(
        z.object({ counter: z.number() }),
        { counter: 0 }
    ))
    .build();

console.log('Application built successfully:', {
    entrypoint: appCorrect.entrypoint,
    initialState: appCorrect.initialState.counter
});

