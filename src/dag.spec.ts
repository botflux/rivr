import {describe, test, TestContext} from "node:test"
import {addNode, addRootNode, createDAG, iterateBottomDown, iterateDepthFirst} from "./dag.ts";

describe('dag', { only: true }, function () {
  test("should be able to create a dag", (t) => {
    // Given
    // When
    // Then
    t.assert.notStrictEqual(createDAG(), undefined)
  })

  test("should be able to add node in a dag", (t: TestContext) => {
    // Given
    const dag = createDAG<string>()

    // When
    const [newDag, rootNode] = addRootNode(dag, "foo")

    // Then
    t.assert.deepStrictEqual(rootNode, {
      id: 0,
      value: "foo"
    })
    t.assert.deepStrictEqual(newDag, {
      nextId: 1,
      edges: [],
      nodes: new Map().set(0, rootNode)
    })
  })

  test("should be able to list nodes depth first", (t: TestContext) => {
    // Given
    const dag = createDAG<string>()
    const [newDag1, rootNode] = addRootNode(dag, "foo")
    const [newDag2, node1] = addNode(newDag1, "bar", rootNode)
    const [newDag3, node2] = addNode(newDag2, "baz", rootNode)
    const [newDag4, node3] = addNode(newDag3, "foofoo", node1)

    // When
    // Then
    t.assert.deepStrictEqual(Array.from(iterateDepthFirst(newDag4, rootNode)), [
      rootNode,
      node1,
      node3,
      node2
    ])
  })

  test("should be able to list nodes bottom to top", (t: TestContext) => {
    // Given
    const dag = createDAG<string>()
    const [newDag1, rootNode] = addRootNode(dag, "foo")
    const [newDag2, node1] = addNode(newDag1, "bar", rootNode)
    const [newDag3, node2] = addNode(newDag2, "baz", rootNode)
    const [newDag4, node3] = addNode(newDag3, "foofoo", node1)

    // When
    // Then
    t.assert.deepStrictEqual(Array.from(iterateBottomDown(newDag4, node3)), [
      node3,
      node1,
      rootNode
    ])
  })
})