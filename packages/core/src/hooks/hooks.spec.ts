import {describe, test, TestContext} from "node:test"
import {Hooks} from "./hooks";

describe('hooks', function () {
  test("should be able to execute a hook", (t: TestContext) => {
    // Given
    let called = false

    const hooks = new Hooks<{ onClose: () => void }>()
      .addHook("onClose", () => called = true)

    // When
    hooks.executeHook("onClose", [])

    // Then
    t.assert.strictEqual(called, true)
  })

  test("should be able to execute a hook with params", (t: TestContext) => {
    // Given
    let params: unknown[] = []

    const hooks = new Hooks<{ onError: (error: unknown, param2: string) => void }>()
      .addHook("onError", (error: unknown, param2: string) => {
        params = [ error, param2 ]
      })

    // When
    hooks.executeHook("onError", [ "this is an error", "another string" ])

    // Then
    t.assert.deepStrictEqual(params, [ "this is an error", "another string" ])
  })
})