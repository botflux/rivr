import {MessageHandler} from "./message-handler";
import {OutboxMessage} from "../../outbox/types";
import {Message} from "../../queue";
import {isOutboxState} from "../../outbox/handler";

export class OutboxMessageHandler implements MessageHandler<OutboxMessage> {
  support(message: Message): message is Message & { payload: OutboxMessage; } {
    return isOutboxState(message.payload)
  }

  async handle(message: Message & { payload: OutboxMessage; }): Promise<Message[]> {
    return [message]
  }
}