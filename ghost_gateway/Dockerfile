FROM rust:1.75 as builder

WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Create a dummy main.rs to build dependencies
RUN mkdir src && echo "fn main(){}" > src/main.rs
RUN cargo build --release

# Copy actual source code
RUN rm -rf src
COPY . .

# Build the actual application
RUN rm -f target/release/deps/ghost_gateway*
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install SSL certificates
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/target/release/ghost_gateway /usr/local/bin/ghost_gateway

# Expose port
EXPOSE 8080

# Run the application
CMD ["ghost_gateway"]
