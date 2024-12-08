export class ConnectionPool<Connection> {
  private clearingOrCleared: boolean = false
  private readonly promises = new Map<string, Promise<Connection>>()
  private readonly connections = new Map<string, Connection>()

  constructor(
    private readonly createConnection: (tenant: string) => Promise<Connection>,
    private readonly closeConnection: (connection: Connection) => Promise<void>,
    private readonly isUsable: (connection: Connection) => Promise<boolean>,
    private readonly signal?: AbortSignal
  ) {
    this.signal?.addEventListener("abort", () => {
      this.clear().catch(console.error)
    })
  }

  async getConnection(tenant: string): Promise<Connection> {
    if (this.clearingOrCleared) {
      throw new Error("Cannot create or get a connection while the pool is closing or closed")
    }

    const mPromise = this.promises.get(tenant)

    if (mPromise)
      return mPromise

    const mConnection = this.connections.get(tenant)

    if (mConnection) {
      if (!this.isUsable(mConnection)) {
        this.connections.delete(tenant)
        return await this.getConnection(tenant)
      }

      return mConnection
    }

    const connection = this.createConnection(tenant)
      .then(connection => {
        this.connections.set(tenant, connection)
        return connection
      })
      .finally(() => this.promises.delete(tenant))

    this.promises.set(tenant, connection)
    return connection
  }

  async clear(): Promise<void> {
    this.clearingOrCleared = true

    for (const [tenant, promise] of this.promises.entries()) {
      const connection = await promise
      await this.closeConnection(connection)
      this.promises.delete(tenant)
    }

    for (const [ tenant, connection ] of this.connections.entries()) {
      await this.closeConnection(connection)
      this.connections.delete(tenant)
    }
  }
}