// import {describe, test} from "node:test";
// import {rivrPlugin} from "./types";
// import {rivr} from "./workflow";
// import {installUnhandledRejectionHook} from "./spec/engine-spec";
//
// installUnhandledRejectionHook()
//
// describe('extension', function () {
//   test("register a plugin with a missing dependency throw an error",  async (t) => {
//     const plugin1 = rivrPlugin({
//       deps: [],
//       name: "plugin-1",
//       plugin: p => p.input()
//     })
//     const plugin2 = rivrPlugin({
//       deps: [ plugin1 ],
//       name: "plugin-2",
//       plugin: p => p.input()
//     })
//
//     await t.assert.rejects(
//       rivr.workflow("my-workflow").register(plugin2).ready(),
//       new Error(`Plugin "plugin-2" needs "plugin-1" to be registered`)
//     )
//   })
//
//   test("should be able to list all the missing dependencies", async (t) => {
//     // Given
//     const p1 = rivrPlugin({
//       name: "plugin-1",
//       plugin: p => p.input()
//     })
//
//     const p2 = rivrPlugin({
//       name: "plugin-2",
//       plugin: p => p.input()
//     })
//
//     const p3 = rivrPlugin({
//       name: "plugin-3",
//       plugin: p => p.input()
//     })
//
//     const p4 = rivrPlugin({
//       name: "plugin-4",
//       deps: [ p1, p2, p3 ],
//       plugin: p => p.input()
//     })
//
//     const workflow = rivr.workflow("p")
//       .register(p2)
//       .register(p4)
//
//     // When
//     // Then
//     await t.assert.rejects(
//       workflow.ready(),
//       new Error('Plugin "plugin-4" needs "plugin-1", "plugin-3" to be registered')
//     )
//   })
//
//   test("should not be able to decorate using the property twice",  (t) => {
//     // Given
//     const workflow = rivr.workflow<number>("complex-calculation")
//     workflow.decorate("foo", 1)
//
//     // When
//     // Then
//     t.assert.throws(() => workflow.decorate("foo", 2), new Error(`Cannot decorate the same property 'foo' twice`))
//   })
// })