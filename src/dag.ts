export type Node<T> = {
  value: T
  id: number
  root: boolean
}
export type DAG<T> = {
  nextId: number
  nodes: Map<number, Node<T>>
  edges: [number, number][]
}

export function createDAG<T>(): DAG<T> {
  return {
    nodes: new Map<number, Node<T>>(),
    edges: [],
    nextId: 0
  }
}

export function getRootNode<T>(dag: DAG<T>): Node<T> | undefined {
  return Array.from(dag.nodes.values()).find(({ root }) => root)
}

export function* iterateDepthFirst<T>(dag: DAG<T>, start: Node<T>): Generator<Node<T>> {
  yield start

  const edges = dag.edges
    .filter(([from]) => from === start.id)
    .map(([, to]) => to)

  for (const edge of edges) {
    const node = dag.nodes.get(edge)

    if (node === undefined)
      throw new Error(`No node found for id '${edge}'`)

    for (const neighbor of iterateDepthFirst(dag, node)) {
      yield neighbor
    }
  }
}

export function iterateBottomDown<T>(dag: DAG<T>, start: Node<T>): Generator<Node<T>> {
  const reversedEdges = dag.edges
    .map(([from, to]) => [to, from] as const) as [number, number][]

  return iterateDepthFirst({
    ...dag,
    edges: reversedEdges
  }, start)
}

export function addRootNode<T>(dag: DAG<T>, value: T): [newDag: DAG<T>, newNode: Node<T>] {
  const {
    nextId,
  } = dag

  const newNode: Node<T> = {
      value,
      id: nextId,
      root: true
  }

  const newDag: DAG<T> = {
      nextId: nextId + 1,
      nodes: new Map<number, Node<T>>().set(nextId, newNode),
      edges: []
  }

  return [ newDag, newNode ]
}

export function addNode<T>(dag: DAG<T>, value: T, parent: Node<T>): [newDag: DAG<T>, newNode: Node<T>] {
  const {
    nodes,
    nextId,
    edges
  } = dag

  const newNode: Node<T> = {
    value,
    id: nextId,
    root: false
  }

  const newDag: DAG<T> = {
    nextId: nextId + 1,
    nodes: new Map<number, Node<T>>(nodes.entries()).set(nextId, newNode),
    edges: [
      ...edges,
      [parent.id, nextId]
    ]
  }

  return [newDag, newNode]
}