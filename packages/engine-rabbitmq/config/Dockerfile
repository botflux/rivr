# Use the official RabbitMQ image with management plugin
ARG VERSION=4.1.0
FROM rabbitmq:$VERSION
ARG VERSION

# Download and install the delayed exchange plugin
RUN apt-get update && apt-get install -y wget && \
    wget https://github.com/rabbitmq/rabbitmq-delayed-message-exchange/releases/download/v$VERSION/rabbitmq_delayed_message_exchange-$VERSION.ez && \
    cp rabbitmq_delayed_message_exchange-$VERSION.ez $RABBITMQ_HOME/plugins/ && \
    rm rabbitmq_delayed_message_exchange-$VERSION.ez && \
    apt-get remove -y wget && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Enable the delayed exchange plugin
RUN rabbitmq-plugins enable --offline rabbitmq_delayed_message_exchange
