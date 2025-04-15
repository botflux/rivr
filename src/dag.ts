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

export class DAG2<T> {
  #nextId = 0
  #edges: [number, number][] = []
  #nodes = new Map<number, Node<T>>()

  addRootNode(value: T): Node<T> {
    const id = this.#nextId ++

    const node: Node<T> = {
      value,
      id,
      root: true
    }

    this.#nodes.set(id, node)
    return node
  }

  addNode<U extends T>(value: U, parent: Node<T>): Node<U> {
    const id = this.#nextId ++
    const node: Node<U> = {
      value,
      id,
      root: false
    }
    this.#nodes.set(id, node)
    this.#edges = [
      ...this.#edges,
      [ parent.id, id ]
    ]
    return node
  }

  * iterateDepthFirst(start: Node<T>): Generator<Node<T>> {
    yield start

    const edges = this.#edges
      .filter(([from]) => from === start.id)
      .map(([, to]) => to)

    for (const edge of edges) {
      const node = this.#nodes.get(edge)

      if (node === undefined)
        throw new Error(`No node found for id '${edge}'`)

      for (const neighbor of this.iterateDepthFirst(node)) {
        yield neighbor
      }
    }
  }

  iterateBottomToTop(start: Node<T>): Generator<Node<T>> {
    const reversedEdges = this.#edges
      .map(([from, to]) => [to, from] as const) as [number, number][]

    return this.iterateDepthFirst(start)
  }

  getRootNode(): Node<T> | undefined {
    return Array.from(this.#nodes.values())
      .find(node => node.root)
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