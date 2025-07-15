import {describe, test, TestContext, mock} from "node:test"
import {NormalizedWorkflowState, WorkflowState} from "../../workflow/state/state";
import {randomUUID} from "crypto";
import {Message} from "../../queue";
import {WorkflowMessageHandler} from "./workflow-message-handler";
import {TestLogger} from "../../logger/test-logger";
import {rivr} from "../../workflow/workflow";
import {WorkflowStateStorage} from "../../workflow/state/storage";
import {TestClock} from "../../clock/test-clock";

class MemoryStateStorage implements WorkflowStateStorage {
  states = new Map<string, { latest: NormalizedWorkflowState<unknown>, history: NormalizedWorkflowState<unknown>[] }>

  async upsert<State>(states: NormalizedWorkflowState<State>[]): Promise<void> {
      for (const state of states) {
        const { history = [] } = this.states.get(state.id) ?? {}
        const newState = { latest: state, history: [ ...history, state ] }
        this.states.set(state.id, newState)
      }
  }
  async get<State>(id: string): Promise<NormalizedWorkflowState<State> | undefined> {
      return this.states.get(id)?.latest as NormalizedWorkflowState<State>
  }
}

describe('WorkflowMessageHandler', function () {
  describe('#support', function () {
    test("should be able to return true given a workflow message", (t: TestContext) => {
      // Given
      const message: Message = {
        type: "workflow_message@v1",
        id: randomUUID(),
        payload: randomWorkflowState(),
        createdAt: new Date(),
      }

      const handler = new WorkflowMessageHandler([])

      // When
      // Then
      t.assert.strictEqual(handler.support(message), true, "The workflow handler should support the message")
    })

    test("should be able to return false any other message", (t: TestContext) => {
      // Given
      const handler = new WorkflowMessageHandler([])

      // When
      // Then
      t.assert.strictEqual(handler.support({
        type: "hello",
        createdAt: new Date(),
        id: randomUUID(),
        payload: { message: "hello world"
        }
      }), false, "Should not be supported")
    })
  })

  describe('#handle', function () {
    test("should be able to log a warning if no workflow matches the state's targeted workflow", async (t: TestContext) => {
      // Given
      const logger = new TestLogger()
      const handler = new WorkflowMessageHandler([], undefined, logger)
      const state = randomWorkflowState()
      const message: Message & { payload: NormalizedWorkflowState<unknown> } = {
        type: "workflow_message@v1",
        payload: state,
        id: randomUUID(),
        createdAt: new Date()
      }

      // When
      const messages = await handler.handle(message)

      // Then
      t.assert.deepStrictEqual(messages, [])
      t.assert.deepStrictEqual(logger.messages, [
        {
          level: "warn",
          message: `State '${state.id}' references to workflow '${state.name}' that the worker doesn't know about.`,
          type: "unknown_workflow",
          stateId: state.id,
          stateName: state.name
        }
      ])
    })

    test("should be able to log a warning if there is no step to execute", async (t: TestContext) => {
      // Given
      const workflow = rivr.workflow<number>("calc")
      const testLogger = new TestLogger()
      const handler = new WorkflowMessageHandler([ workflow ], undefined, testLogger)
      const payload = randomWorkflowState()
      const message: Message & { payload: NormalizedWorkflowState<unknown> } = {
        type: "workflow_message@v1",
        createdAt: new Date(),
        id: randomUUID(),
        payload
      }

      // When
      const messages = await handler.handle(message)

      // Then
      t.assert.deepStrictEqual(messages, [])
      t.assert.deepStrictEqual(testLogger.messages, [
        {
          level: "warn",
          message: `There is no step to execute within the workflow 'calc'`,
          type: "no_step_to_execute",
          stateId: payload.id,
          stateName: payload.name,
        }
      ])
    })

    test("should be able to execute a workflow step", async (t: TestContext) => {
      // Given
      const logger = new TestLogger()
      let called = 0

      const workflow = rivr.workflow<number>("calc").step({
        name: "add-1",
        handler: ({ state }) => {
          called ++
          return state + 1
        }
      })
      const handler = new WorkflowMessageHandler([ workflow ], undefined, logger)
      const payload = WorkflowState.initialize(
        workflow,
        "add-1",
        1,
        randomUUID(),
        new Date()
      ).toNormalized()
      const message: Message & { payload: NormalizedWorkflowState<unknown> } = {
        type: "rivr_workflow@v1",
        createdAt: new Date(),
        id: randomUUID(),
        payload
      }

      // When
      const messages = await handler.handle(message)

      // Then
      t.assert.deepStrictEqual(messages, [])
      t.assert.deepStrictEqual(logger.messages, [])
      t.assert.strictEqual(called, 1)
    })

    test("should be able to produce the message that'll trigger the next step", async (t: TestContext) => {
      // Given
      const logger = new TestLogger()
      const now = new Date()
      const clock = new TestClock().setNow(now)

      const workflow = rivr.workflow<number>("calc")
        .step({
          name: "add-1",
          handler: ({ state }) => state + 1
        })
        .step({
          name: "minus-2",
          handler: ({ state }) => state - 2
        })
      const handler = new WorkflowMessageHandler([ workflow ], undefined, logger, clock)
      const payload = WorkflowState.initialize(
        workflow,
        "add-1",
        1,
        randomUUID(),
        new Date()
      ).toNormalized()
      const message: Message & { payload: NormalizedWorkflowState<unknown> } = {
        type: "rivr_workflow@v1",
        createdAt: new Date(),
        id: randomUUID(),
        payload
      }

      // When
      const messages = await handler.handle(message)

      // Then
      t.assert.deepStrictEqual(messages.map(m => m.payload), [
        {
          ...payload,
          lastModified: now,
          steps: [
            {
              name: "add-1",
              attempts: [
                {
                  id: 1,
                  status: "successful",
                  inputState: 1,
                  result: {
                    state: 2,
                    type: "success"
                  }
                }
              ]
            },
            {
              name: "minus-2",
              attempts: [
                {
                  id: 1,
                  status: "to_execute",
                  inputState: 2
                }
              ]
            }
          ]
        } satisfies NormalizedWorkflowState<number>
      ])
      t.assert.deepStrictEqual(logger.messages, [])
    })

    test("should be able to save the workflow's state", async (t: TestContext) => {
      // Given
      const logger = new TestLogger()
      const now = new Date()
      const clock = new TestClock().setNow(now)
      const workflow = rivr.workflow<number>("calc").step({
        name: "add-1",
        handler: ({ state }) => state + 1,
      })
      const stateStorage = new MemoryStateStorage()
      const handler = new WorkflowMessageHandler([ workflow ], stateStorage, logger, clock)

      const payload = WorkflowState.initialize(
        workflow,
        "add-1",
        1,
        randomUUID(),
        new Date()
      ).toNormalized()
      const message: Message & { payload: NormalizedWorkflowState<unknown> } = {
        id: randomUUID(),
        type: "rivr_workflow@v1",
        createdAt: new Date(),
        payload
      }

      // When
      const messages = await handler.handle(message)

      // Then
      t.assert.deepStrictEqual(messages, [])
      t.assert.deepStrictEqual(logger.messages, [])
      t.assert.deepStrictEqual(stateStorage.states.get(payload.id)?.history, [
        {
          ...payload,
          status: "in_progress",
          lastModified: now,
          steps: [
            {
              name: "add-1",
              attempts: [
                {
                  id: 1,
                  status: "in_progress",
                  inputState: 1
                }
              ]
            }
          ]
        },
        {
          ...payload,
          lastModified: now,
          status: "successful",
          steps: [
            {
              name: "add-1",
              attempts: [
                {
                  id: 1,
                  status: "successful",
                  inputState: 1,
                  result: {
                    state: 2,
                    type: "success"
                  }
                }
              ]
            }
          ]
        }
      ])
    })
  })
})

function randomWorkflowState (): NormalizedWorkflowState<unknown> {
  return {
    name: "calc",
    id: randomUUID(),
    status: "in_progress",
    steps: [],
    lastModified: new Date()
  }
}