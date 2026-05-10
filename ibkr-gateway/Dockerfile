FROM debian:bookworm-slim

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    unzip \
    curl \
    procps \
    vim \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/gateway

# Download and unzip IBKR Client Portal Gateway
RUN curl -sL https://download2.interactivebrokers.com/portal/clientportal.gw.zip \
        -o clientportal.gw.zip \
    && unzip clientportal.gw.zip \
    && rm clientportal.gw.zip

# Copy our custom config and startup script
COPY conf.yaml root/conf.yaml
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 5055

CMD ["/app/start.sh"]
